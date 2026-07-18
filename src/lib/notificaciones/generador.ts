// Generador de notificaciones internas POR TIEMPO (cron diario).
//
// Lo llama /api/cron/recordatorios después del barrido de correos. Un solo
// recorrido: carga los tenants y sus preferencias de una vez, y cada escáner
// consulta su tabla para TODOS los tenants a la vez (no una query por cliente).
//
// Fase 1: suscripción CLAUX y contratos de terceros. Los demás escáneres
// (finanzas, inventario, RRHH, caja, IA, dossier) entran en la Fase 2 — ver
// docs/planes/notificaciones-internas.md.

import { createAdminClient } from '@/lib/supabase/admin'
import { toDateStr, fmtFechaEs } from '@/lib/date-utils'
import { umbralParaFecha, type Severidad, type Umbral } from './catalogo'
import {
  crearNotificacion, resolverNotificaciones,
  type ContextoTenant, type Preferencia,
} from './crear'

export interface ResumenGenerador {
  tenants: number
  creadas: number
}

const MS_DIA = 86_400_000

/** Días desde hoy hasta `fecha` (negativo = ya pasó). Ambas en fecha local, sin hora. */
function diasHasta(fecha: string, hoy: string): number {
  return Math.round((new Date(fecha).getTime() - new Date(hoy).getTime()) / MS_DIA)
}

interface Tenant {
  client_id:        string
  nombre_empresa:   string
  estado:           string
  fecha_expiracion: string | null
  modulos_activos:  unknown
}

export async function generarNotificacionesInternas(): Promise<ResumenGenerador> {
  const db  = createAdminClient()
  const hoy = toDateStr(new Date())

  const [{ data: clientes }, { data: prefsRaw }] = await Promise.all([
    db.from('clients').select('client_id, nombre_empresa, estado, fecha_expiracion, modulos_activos'),
    db.from('notificacion_config').select('client_id, tipo, activa, severidad_override'),
  ])

  const tenants = (clientes ?? []) as Tenant[]
  if (tenants.length === 0) return { tenants: 0, creadas: 0 }

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

  const ctxDe = new Map<string, ContextoTenant>()
  for (const t of tenants) {
    ctxDe.set(t.client_id, {
      clientId: t.client_id,
      modulos:  Array.isArray(t.modulos_activos) ? (t.modulos_activos as string[]) : [],
      prefs:    prefsPorTenant.get(t.client_id) ?? new Map(),
    })
  }

  let creadas = 0
  creadas += await escanearSuscripciones(tenants, ctxDe, hoy)
  creadas += await escanearContratosTerceros(db, ctxDe, hoy)

  return { tenants: tenants.length, creadas }
}

// ── 1. Suscripción con CLAUX ──────────────────────────────────────────────────
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
        enlace:      '/portal/perfil',
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
      enlace:      '/portal/perfil',
      entidadTipo: 'suscripcion',
      entidadId:   t.fecha_expiracion,
      umbral,
      sustituyeA:  ['suscripcion_por_vencer'],
    }, ctx)
    if (ok) creadas++
  }

  return creadas
}

// ── 2. Contratos de terceros (clientes y proveedores) ─────────────────────────
async function escanearContratosTerceros(
  db: ReturnType<typeof createAdminClient>,
  ctxDe: Map<string, ContextoTenant>,
  hoy: string,
): Promise<number> {
  // Solo tenants con la base contratada: el resto ni siquiera ve Terceros.
  const conBase = [...ctxDe.values()].filter(c => c.modulos.includes('base')).map(c => c.clientId)
  if (conBase.length === 0) return 0

  const { data, error } = await db
    .from('third_parties')
    .select('tercero_id, client_id, empresa_id, nombre, fecha_fin_contrato')
    .in('client_id', conBase)
    .eq('activo', true)
    .not('fecha_fin_contrato', 'is', null)

  if (error) {
    console.error('[notificaciones] escáner de contratos de terceros falló', error.message)
    return 0
  }

  let creadas = 0
  // Entidades que HOY siguen dentro de una ventana de aviso, por tenant: todo lo
  // demás (contrato renovado a futuro lejano o borrado) se archiva al final.
  const vivas = new Map<string, string[]>()

  for (const t of (data ?? []) as {
    tercero_id: string; client_id: string; empresa_id: string | null
    nombre: string; fecha_fin_contrato: string
  }[]) {
    const ctx  = ctxDe.get(t.client_id)
    const dias = diasHasta(t.fecha_fin_contrato, hoy)

    const vencido = dias < 0
    const tipo: 'contrato_tercero_vencido' | 'contrato_tercero_vence' =
      vencido ? 'contrato_tercero_vencido' : 'contrato_tercero_vence'
    const umbral: Umbral | null = vencido ? 'vencido' : umbralParaFecha(tipo, dias)
    if (!umbral) continue

    if (!vivas.has(t.client_id)) vivas.set(t.client_id, [])
    vivas.get(t.client_id)!.push(t.tercero_id)

    const ok = await crearNotificacion({
      clientId:    t.client_id,
      empresaId:   t.empresa_id,
      tipo,
      titulo:      vencido
        ? `Contrato vencido — ${t.nombre}`
        : `Contrato por vencer — ${t.nombre}`,
      cuerpo:      vencido
        ? `El contrato con ${t.nombre} venció el ${fmtFechaEs(t.fecha_fin_contrato)}.`
        : `El contrato con ${t.nombre} vence el ${fmtFechaEs(t.fecha_fin_contrato)}${dias === 0 ? ' (hoy)' : ` (faltan ${dias} día${dias === 1 ? '' : 's'})`}.`,
      enlace:      `/portal/terceros/${t.tercero_id}`,
      entidadTipo: 'tercero',
      entidadId:   t.tercero_id,
      umbral,
      meta:        { fecha_fin_contrato: t.fecha_fin_contrato },
      sustituyeA:  ['contrato_tercero_vence', 'contrato_tercero_vencido'],
    }, ctx)
    if (ok) creadas++
  }

  // Resolución: un contrato renovado (o dado de baja) deja de avisar.
  for (const clientId of conBase) {
    await resolverNotificaciones(
      db, clientId,
      ['contrato_tercero_vence', 'contrato_tercero_vencido'],
      'tercero',
      vivas.get(clientId) ?? [],
    )
  }

  return creadas
}
