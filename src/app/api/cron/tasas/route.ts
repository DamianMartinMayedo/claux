import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { actualizarTasasCliente, type CambioTasa } from '@/lib/tasas-auto'
import { crearNotificacion } from '@/lib/notificaciones/crear'
import { relojNegocio } from '@/lib/fecha-tz'

// Cron diario de tasas de cambio. Refresca los pares automáticos (El Toque /
// Frankfurter) de TODOS los clientes que tengan alguno, para que el dueño no
// dependa de acordarse de pulsar «Actualizar»: en Cuba el cambio se mueve a
// diario y una tasa de ayer ya descuadra lo consolidado.
//
// ── Por qué corre a las 5:00 de Cuba y por qué hay DOS entradas en vercel.json ─
// A las 5 la tasa del día ya está publicada y el negocio no ha abierto: el dueño
// entra por la mañana y el dashboard ya está bien. Pero Vercel Cron solo entiende
// UTC y La Habana cambia de UTC−4 a UTC−5 con el horario de verano, así que «las
// 5 en Cuba» son las 09:00 UTC medio año y las 10:00 UTC el otro medio. Se
// programan las dos horas y el guard de aquí deja pasar la que toca:
//   · antes de las 5 de Cuba no se hace nada (la entrada de la otra estación);
//   · si ya se barrió hoy (fecha del calendario CUBANO), tampoco.
// El barrido se marca al TERMINAR, no al empezar: si la primera pasada revienta
// —una fuente caída, un timeout—, la segunda hora del día es su reintento.

export const dynamic = 'force-dynamic'
// Una llamada a fuente externa por cliente, secuencial: ampliamos el límite.
export const maxDuration = 60

const HORA_CUBA   = 5
const CLAVE_MARCA = 'tasas_ultimo_barrido'

/** «USD→CUP 425 · EUR→CUP 460», recortado: el aviso se lee de un vistazo. */
function resumenCambios(cambios: CambioTasa[]): string {
  const MAX = 3
  const fmt = (c: CambioTasa): string =>
    `${c.origen}→${c.destino} ${c.tasa.toLocaleString('es-ES', { maximumFractionDigits: c.tasa >= 1 ? 2 : 4 })}`
  const lista = cambios.slice(0, MAX).map(fmt).join(' · ')
  const resto = cambios.length - MAX
  return resto > 0 ? `${lista} y ${resto} más` : lista
}

export async function GET(req: NextRequest) {
  // Mismo candado que el resto de crons: Vercel añade `Authorization: Bearer
  // <CRON_SECRET>`. Sin secreto configurado no se ejecuta (evita endpoint abierto).
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
  }

  const db   = createAdminClient()
  const cuba = relojNegocio()

  if (cuba.hora < HORA_CUBA) {
    return NextResponse.json({ ok: true, omitido: `Todavía no son las ${HORA_CUBA}:00 en Cuba (${cuba.hhmm}).` })
  }
  const { data: marca } = await db.from('settings').select('value').eq('key', CLAVE_MARCA).maybeSingle()
  if (marca?.value === cuba.fecha) {
    return NextResponse.json({ ok: true, omitido: `Las tasas ya se actualizaron hoy (${cuba.fecha}).` })
  }

  // Solo los clientes con AL MENOS un par automático activo: no gastamos una
  // llamada por cada cliente que fija sus tasas a mano.
  const { data: filas } = await db
    .from('pares_tasa')
    .select('client_id')
    .eq('activo', true)
    .neq('fuente', 'MANUAL')
  const clientes = [...new Set((filas ?? []).map(f => f.client_id as string))]

  let actualizadas = 0
  let sinCambios   = 0
  let avisados     = 0
  const conError: { client_id: string; errores: string[] }[] = []
  for (const clientId of clientes) {
    const r = await actualizarTasasCliente(db, clientId)
    actualizadas += r.actualizadas
    sinCambios   += r.sinCambios
    if (r.errores.length > 0) conError.push({ client_id: clientId, errores: r.errores })

    // El aviso lleva la HORA: el dueño tiene que poder distinguir «lo cambié yo»
    // de «se actualizó solo esta madrugada» al ver otro número en el dashboard.
    // Idempotente por día (entidad_id = fecha), así que un reintento no repite.
    if (r.cambios.length > 0) {
      const creada = await crearNotificacion({
        clientId,
        tipo:   'tasas_actualizadas',
        titulo: `Tasas de cambio actualizadas (${cuba.hhmm})`,
        cuerpo: `Se actualizaron solas a las ${cuba.hhmm}, hora de Cuba: ${resumenCambios(r.cambios)}. `
              + 'Todo lo que se consolida —ventas, gastos y deudas— ya usa estas tasas.',
        enlace:      '/portal/monedas',
        entidadTipo: 'tasas',
        entidadId:   cuba.fecha,
        meta:        { hora: cuba.hhmm, cambios: r.cambios },
      })
      if (creada) avisados++
    }
  }

  // Marca del día EN HORA DE CUBA: es lo que hace que la segunda entrada de
  // vercel.json (la de la otra estación) no repita el barrido.
  await db.from('settings').upsert(
    { key: CLAVE_MARCA, value: cuba.fecha, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )

  return NextResponse.json({
    ok: true,
    hora_cuba: cuba.hhmm,
    clientes: clientes.length,
    actualizadas,
    sinCambios,
    avisados,
    conError,
  })
}
