import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { actualizarTasasCliente } from '@/lib/tasas-auto'

// Cron diario de tasas de cambio. Refresca los pares automáticos (El Toque /
// Frankfurter) de TODOS los clientes que tengan alguno, para que el dueño no
// dependa de acordarse de pulsar «Actualizar»: en Cuba el cambio se mueve a
// diario y una tasa de ayer ya descuadra lo consolidado.
//
// Programado a las 12:00 UTC = 8:00 en Cuba durante el horario de verano
// (America/Havana, UTC-4, de marzo a noviembre). Vercel Cron solo entiende UTC,
// así que en invierno cae a las 7:00 Cuba — una hora que no cambia el hecho de
// que la tasa del día ya esté publicada. Ver vercel.json.

export const dynamic = 'force-dynamic'
// Una llamada a fuente externa por cliente, secuencial: ampliamos el límite.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Mismo candado que el resto de crons: Vercel añade `Authorization: Bearer
  // <CRON_SECRET>`. Sin secreto configurado no se ejecuta (evita endpoint abierto).
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
  }

  const db = createAdminClient()

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
  const conError: { client_id: string; errores: string[] }[] = []
  for (const clientId of clientes) {
    const r = await actualizarTasasCliente(db, clientId)
    actualizadas += r.actualizadas
    sinCambios   += r.sinCambios
    if (r.errores.length > 0) conError.push({ client_id: clientId, errores: r.errores })
  }

  return NextResponse.json({
    ok: true,
    clientes: clientes.length,
    actualizadas,
    sinCambios,
    conError,
  })
}
