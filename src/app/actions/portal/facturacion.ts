'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface PagoPortal {
  pago_id:              string
  fecha:                string
  fecha_inicio_periodo: string
  fecha_fin_periodo:    string
  plan_id:              string | null
  monto_usd:            number
  metodo:               string
  notas:                string | null
}

export interface FacturacionData {
  client_id:        string
  nombre_empresa:   string
  estado:           string
  plan_id:          string | null
  plan_nombre:      string
  fecha_expiracion: string | null
  pagos:            PagoPortal[]
  plan_nombres:     Record<string, string>   // plan_id → nombre
}

// ── Obtener datos de facturación ──────────────────────────────────────────────

export async function obtenerFacturacion(): Promise<FacturacionData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const [{ data: cliente }, { data: pagos }] = await Promise.all([
    db.from('clients')
      .select('nombre_empresa, estado, plan_id, fecha_expiracion')
      .eq('client_id', session.client_id)
      .single(),
    db.from('payments')
      .select('pago_id, fecha, fecha_inicio_periodo, fecha_fin_periodo, plan_id, monto_usd, metodo, notas')
      .eq('client_id', session.client_id)
      .order('fecha', { ascending: false }),
  ])

  if (!cliente) return null

  // Recoger todos los plan_ids únicos (del cliente + pagos)
  const planIdsSet = new Set<string>()
  if (cliente.plan_id) planIdsSet.add(cliente.plan_id)
  for (const p of pagos ?? []) if (p.plan_id) planIdsSet.add(p.plan_id)

  const planNombres: Record<string, string> = {}
  if (planIdsSet.size > 0) {
    const { data: planes } = await db
      .from('plans')
      .select('plan_id, nombre')
      .in('plan_id', [...planIdsSet])
    for (const pl of planes ?? []) planNombres[pl.plan_id] = pl.nombre
  }

  const plan_nombre = (cliente.plan_id && planNombres[cliente.plan_id]) || cliente.plan_id || '—'

  return {
    client_id:        session.client_id,
    nombre_empresa:   cliente.nombre_empresa,
    estado:           cliente.estado,
    plan_id:          cliente.plan_id,
    plan_nombre,
    fecha_expiracion: cliente.fecha_expiracion ?? null,
    pagos:            (pagos ?? []) as PagoPortal[],
    plan_nombres:     planNombres,
  }
}
