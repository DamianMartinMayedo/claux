'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { tiposVisibles } from '@/lib/notificaciones/admin/visibilidad'
import { hoyEnTz, sumarDias } from '@/lib/fecha-tz'
import { escribirParte, type AvisoParte, type CifraParte } from '@/lib/ia/equipo'
import { IaApagada, IaBolsaAgotada } from '@/lib/ia/interna'
import { IA_SIN_RESPUESTA } from '@/lib/ia/propuesta'

// ── El parte del equipo (Fase 7) ─────────────────────────────────────────────
//
// «Qué ha pasado»: las cifras del día y de la semana, los avisos que el sistema
// ya ha detectado, y cinco líneas que dicen qué mirar primero y qué hacer ahora.
//
// LO QUE DETECTA SIGUE SIENDO CÓDIGO. Los problemas los encuentra el catálogo de
// avisos (`lib/notificaciones/admin/catalogo.ts`) y los números salen de consultas
// de aquí; la IA solo ordena y redacta. El ENLACE de cada línea no lo escribe
// ella: sale del aviso que citó, que es una fila nuestra con su ruta.
//
// Va en su propio fichero y no en `actions/admin/metricas.ts` —que es lo que
// decía el plan— porque aquel es `server-only` sin `'use server'`: marcarlo
// convertiría en endpoint cada una de sus lecturas agregadas.

/** Una línea del parte, ya lista para el panel de diagnóstico. */
export interface LineaParteUi {
  clave:  string
  marca:  string
  titulo: string
  enlace?: { href: string; texto: string }
}

/** Avisos que se le enseñan. Veinticinco es más de lo que nadie atiende en un día. */
const TOPE_AVISOS_PARTE = 25

/** El chip de la izquierda: la gravedad del aviso, o de dónde sale si no hay aviso. */
const MARCA_SEVERIDAD: Record<string, string> = {
  urgente: 'Urgente',
  aviso:   'Atender',
  info:    'Nota',
}

/**
 * El parte de hoy, memoizado POR DÍA Y POR PERSONA. Cada uno ve los avisos de sus
 * secciones, así que un parte no vale para otro; y sin el memo, cada recarga del
 * panel gastaría una llamada de la bolsa para contar lo mismo.
 *
 * El memo vive en memoria del proceso: en producción hay varias instancias, así
 * que el techo real son unas pocas llamadas al día y no una. Guardarlo en una
 * tabla sería una migración para cachear una frase.
 */
const memo = new Map<string, { fecha: string; lineas: LineaParteUi[] }>()

export async function parteDelDia(): Promise<
  { ok: true; lineas: LineaParteUi[] } | { ok: false; error: string; reintentar?: boolean }
> {
  const ctx = await requirePermiso('dashboard')
  const hoy = hoyEnTz()

  const guardado = memo.get(ctx.email)
  if (guardado?.fecha === hoy) return { ok: true, lineas: guardado.lineas }

  const db     = createAdminClient()
  const hace7  = sumarDias(hoy, -7)
  const tipos  = tiposVisibles(ctx)

  const [
    { count: pagosHoy }, { count: pagosSemana },
    { count: clientesNuevos }, { count: leadsNuevos },
    { count: soporteSinResponder }, { count: soporteSemana },
    { data: avisosData },
  ] = await Promise.all([
    db.from('payments').select('*', { count: 'exact', head: true })
      .neq('estado', 'por_confirmar').gte('fecha', hoy),
    db.from('payments').select('*', { count: 'exact', head: true })
      .neq('estado', 'por_confirmar').gte('fecha', hace7),
    db.from('clients').select('*', { count: 'exact', head: true })
      .eq('es_prueba', false).gte('created_at', hace7),
    db.from('diagnosticos').select('*', { count: 'exact', head: true })
      .gte('created_at', hace7),
    db.from('soporte_mensajes').select('*', { count: 'exact', head: true })
      .is('respuesta', null).neq('estado', 'RESUELTO'),
    db.from('soporte_mensajes').select('*', { count: 'exact', head: true })
      .gte('created_at', hace7),
    // Solo los avisos que ESTE admin puede ver, filtrado en la consulta: la
    // bandeja ya lo hace así, y un parte que cuente lo que no puedes abrir es
    // peor que no tener parte.
    tipos.length
      ? db.from('admin_notificaciones')
          .select('id, severidad, titulo, cuerpo, enlace, created_at')
          .in('tipo', tipos)
          .neq('estado', 'archivada')
          .order('created_at', { ascending: false })
          .limit(TOPE_AVISOS_PARTE)
      : Promise.resolve({ data: [] }),
  ])

  const cifras: CifraParte[] = [
    { etiqueta: 'Pagos registrados hoy',            valor: String(pagosHoy ?? 0) },
    { etiqueta: 'Pagos registrados esta semana',    valor: String(pagosSemana ?? 0) },
    { etiqueta: 'Clientes nuevos esta semana',      valor: String(clientesNuevos ?? 0) },
    { etiqueta: 'Leads nuevos esta semana',         valor: String(leadsNuevos ?? 0) },
    { etiqueta: 'Mensajes de soporte esta semana',  valor: String(soporteSemana ?? 0) },
    { etiqueta: 'Mensajes de soporte sin responder', valor: String(soporteSinResponder ?? 0) },
  ]

  const filas = (avisosData ?? []) as {
    id: number; severidad: string; titulo: string; cuerpo: string
    enlace: string | null; created_at: string
  }[]
  const avisos: AvisoParte[] = filas.map((a, i) => ({
    n:         i + 1,
    severidad: a.severidad,
    titulo:    a.titulo,
    cuerpo:    a.cuerpo ?? '',
    edad:      edadDe(a.created_at, hoy),
  }))

  try {
    const lineas = await escribirParte({ fecha: hoy, cifras, avisos })
    if (!lineas) return { ok: false, error: IA_SIN_RESPUESTA, reintentar: true }

    const ui: LineaParteUi[] = lineas.map((l, i) => {
      const av = l.aviso != null ? filas[l.aviso - 1] : null
      return {
        clave:  `parte:${i + 1}`,
        marca:  av ? (MARCA_SEVERIDAD[av.severidad] ?? 'Aviso') : 'Del día',
        titulo: l.texto,
        // El enlace sale del aviso, nunca del texto del modelo.
        ...(av?.enlace ? { enlace: { href: av.enlace, texto: 'Ir a la pantalla' } } : {}),
      }
    })
    memo.set(ctx.email, { fecha: hoy, lineas: ui })
    return { ok: true, lineas: ui }
  } catch (e) {
    // Bolsa agotada e interruptor apagado se dicen tal cual; la pantalla decide
    // si los enseña. No se memoiza el fallo: mañana —o al recargar la bolsa— hay
    // parte otra vez sin tener que esperar al día siguiente.
    if (e instanceof IaBolsaAgotada || e instanceof IaApagada) return { ok: false, error: e.message }
    throw e
  }
}

/** «hoy», «ayer», «hace 6 días». La antigüedad importa: un aviso viejo es otro problema. */
function edadDe(iso: string, hoy: string): string {
  const dia = (iso ?? '').slice(0, 10)
  if (!dia) return ''
  if (dia === hoy) return 'hoy'
  const dias = Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${dia}T00:00:00Z`)) / 86_400_000)
  if (dias === 1)  return 'ayer'
  if (dias > 1)    return `hace ${dias} días`
  return 'hoy'
}
