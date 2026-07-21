// Generador de notificaciones internas POR TIEMPO (cron diario).
//
// Lo llama /api/cron/recordatorios después del barrido de correos. Este fichero
// es solo el ORQUESTADOR: carga los tenants y sus preferencias de una vez y
// reparte a cada escáner únicamente los que tienen su módulo contratado. Los
// escáneres viven en escaneres.ts, uno por área de negocio.
//
// La suscripción con CLAUX se resuelve aquí y no allí a propósito: es lo único
// que no depende de ningún módulo y sale de las filas de `clients` que el
// orquestador ya tiene cargadas.

import { createAdminClient } from '@/lib/supabase/admin'
import { toDateStr, fmtFechaEs } from '@/lib/date-utils'
import { umbralParaFecha, type Severidad } from './catalogo'
import { crearNotificacion, type ContextoTenant, type Preferencia } from './crear'
import {
  diasHasta,
  escanearContratosTerceros, escanearCuentas, escanearOfertas, escanearCaja,
  escanearStock, escanearRrhh, escanearCredito, escanearReservas,
  escanearIa, escanearDossier, escanearServicios, escanearRenovaciones,
} from './escaneres'
import { facturarAutomatico } from '@/lib/facturacion-suscripciones'

export interface ResumenGenerador {
  tenants: number
  creadas: number
  purgadas: number
}

/**
 * Retención: una notificación ya atendida no aporta nada meses después, y la
 * bandeja crece sin techo (el cron escribe todos los días). Se borran las
 * leídas/archivadas con más de esto; las que siguen `nueva` NO se tocan por
 * viejas que sean — que nadie las haya atendido es justo el motivo de dejarlas.
 */
const DIAS_RETENCION = 90

interface Tenant {
  client_id:        string
  nombre_empresa:   string
  estado:           string
  fecha_expiracion: string | null
  modulos_activos:  unknown
}

/**
 * @param soloCliente Acota TODO el barrido a un tenant. Sirve para probar sobre
 *   el negocio de prueba sin crear avisos en los portales de clientes reales,
 *   que verían aparecer cosas fuera de su momento.
 */
export async function generarNotificacionesInternas(
  soloCliente?: string,
): Promise<ResumenGenerador> {
  const db  = createAdminClient()
  const hoy = toDateStr(new Date())

  const qClientes = db
    .from('clients')
    .select('client_id, nombre_empresa, estado, fecha_expiracion, modulos_activos')
  const qPrefs = db
    .from('notificacion_config')
    .select('client_id, tipo, activa, severidad_override')

  const [{ data: clientes }, { data: prefsRaw }] = await Promise.all([
    soloCliente ? qClientes.eq('client_id', soloCliente) : qClientes,
    soloCliente ? qPrefs.eq('client_id', soloCliente)    : qPrefs,
  ])

  const tenants = (clientes ?? []) as Tenant[]
  if (tenants.length === 0) return { tenants: 0, creadas: 0, purgadas: 0 }

  // Preferencias agrupadas por tenant (una query para todos).
  const prefsPorTenant = new Map<string, Map<string, Preferencia>>()
  for (const p of prefsRaw ?? []) {
    const clientId = p.client_id as string
    if (!prefsPorTenant.has(clientId)) prefsPorTenant.set(clientId, new Map())
    prefsPorTenant.get(clientId)!.set(p.tipo as string, {
      activa:             p.activa as boolean,
      severidad_override: (p.severidad_override ?? null) as Severidad | null,
    })
  }

  const contextos: ContextoTenant[] = tenants.map(t => ({
    clientId: t.client_id,
    modulos:  Array.isArray(t.modulos_activos) ? (t.modulos_activos as string[]) : [],
    prefs:    prefsPorTenant.get(t.client_id) ?? new Map(),
  }))
  const ctxDe = new Map(contextos.map(c => [c.clientId, c]))

  /** Los tenants que tienen contratado alguno de estos módulos. */
  const con = (...modulos: string[]) =>
    contextos.filter(c => modulos.some(m => c.modulos.includes(m)))

  let creadas = 0
  creadas += await escanearSuscripciones(tenants, ctxDe, hoy)

  const conBase = con('base')
  creadas += await escanearContratosTerceros(db, conBase, hoy)
  creadas += await escanearCuentas(db, conBase, hoy)
  creadas += await escanearOfertas(db, conBase, hoy)
  creadas += await escanearCredito(db, conBase)

  creadas += await escanearCaja(db, con('caja'))
  creadas += await escanearStock(db, con('inventario'))
  creadas += await escanearRrhh(db, con('rrhh'), hoy)
  creadas += await escanearServicios(db, con('servicios'), hoy)

  // Facturación automática ANTES de avisar: si la empresa la tiene activada, el
  // borrador ya está hecho cuando se genera el aviso, y así «Toca cobrar» no le pide
  // al dueño algo que el sistema acaba de dejarle resuelto. Exige las DOS claves:
  // servicios (las suscripciones) y base (facturar de verdad).
  const conServiciosYBase = contextos.filter(c =>
    c.modulos.includes('servicios') && c.modulos.includes('base'))
  if (conServiciosYBase.length > 0) {
    await facturarAutomatico(db, conServiciosYBase.map(c => c.clientId), hoy)
  }

  creadas += await escanearRenovaciones(db, con('servicios'), hoy)
  creadas += await escanearReservas(db, con('reservas_citas', 'agenda'), hoy)
  creadas += await escanearIa(con('asistente_ia'))
  creadas += await escanearDossier(db, con('dossier'))

  const purgadas = await purgarAntiguas(db, soloCliente)
  return { tenants: tenants.length, creadas, purgadas }
}

async function purgarAntiguas(
  db: ReturnType<typeof createAdminClient>,
  soloCliente?: string,
): Promise<number> {
  const corte = new Date(Date.now() - DIAS_RETENCION * 86_400_000).toISOString()
  let q = db
    .from('notificaciones')
    .delete()
    .in('estado', ['leida', 'archivada'])
    .lt('created_at', corte)
  // Acotado también: una prueba sobre un tenant no debe borrar nada de los demás.
  if (soloCliente) q = q.eq('client_id', soloCliente)

  const { data, error } = await q.select('id')

  if (error) {
    console.error('[notificaciones] purga fallida', error.message)
    return 0
  }
  return data?.length ?? 0
}

// ── Suscripción con CLAUX (plataforma, sin módulo) ────────────────────────────
// Espeja en la campana lo que ya se envía por correo. La entidad es la propia
// fecha de expiración: al renovar cambia, así que el aviso del ciclo siguiente
// vuelve a ser elegible sin tocar nada.
async function escanearSuscripciones(
  tenants: Tenant[],
  ctxDe: Map<string, ContextoTenant>,
  hoy: string,
): Promise<number> {
  let creadas = 0

  for (const t of tenants) {
    if (!t.fecha_expiracion) continue
    const dias = diasHasta(t.fecha_expiracion, hoy)
    const ctx  = ctxDe.get(t.client_id)

    if (dias < 0) {
      // Vencida: solo si el estado lo confirma (el barrido de estados ya corrió).
      if (t.estado !== 'DESACTIVADO' && t.estado !== 'GRACIA') continue
      const ok = await crearNotificacion({
        clientId:    t.client_id,
        tipo:        'suscripcion_vencida',
        titulo:      'Tu suscripción ha vencido',
        cuerpo:      `Venció el ${fmtFechaEs(t.fecha_expiracion)}. Ponte al día para seguir usando CLAUX sin interrupciones.`,
        enlace:      '/portal/facturacion',
        entidadTipo: 'suscripcion',
        entidadId:   t.fecha_expiracion,
        umbral:      'vencido',
        sustituyeA:  ['suscripcion_por_vencer'],
      }, ctx)
      if (ok) creadas++
      continue
    }

    if (t.estado !== 'ACTIVO' && t.estado !== 'TRIAL') continue
    const umbral = umbralParaFecha('suscripcion_por_vencer', dias)
    if (!umbral) continue

    const ok = await crearNotificacion({
      clientId:    t.client_id,
      tipo:        'suscripcion_por_vencer',
      titulo:      dias === 0 ? 'Tu suscripción vence hoy' : `Tu suscripción vence en ${dias} día${dias === 1 ? '' : 's'}`,
      cuerpo:      `Tu suscripción a CLAUX vence el ${fmtFechaEs(t.fecha_expiracion)}.`,
      enlace:      '/portal/facturacion',
      entidadTipo: 'suscripcion',
      entidadId:   t.fecha_expiracion,
      umbral,
      sustituyeA:  ['suscripcion_por_vencer'],
    }, ctx)
    if (ok) creadas++
  }

  return creadas
}
