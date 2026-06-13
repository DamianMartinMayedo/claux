'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface PagoPortal {
  pago_id:              string
  fecha:                string
  fecha_inicio_periodo: string | null
  fecha_fin_periodo:    string | null
  concepto:             string | null
  monto_usd:            number
  metodo:               string
  notas:                string | null
}

export interface FacturacionData {
  client_id:        string
  nombre_empresa:   string
  estado:           string
  suscripcion:      string
  precio_mensual:   number
  ciclo:            string
  fecha_expiracion: string | null
  pagos:            PagoPortal[]
}

// ── Obtener datos de facturación ──────────────────────────────────────────────

export async function obtenerFacturacion(): Promise<FacturacionData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const [{ data: cliente }, { data: pagos }] = await Promise.all([
    db.from('clients')
      .select('nombre_empresa, estado, precio_mensual_usd, ciclo_facturacion, fecha_expiracion')
      .eq('client_id', session.client_id)
      .single(),
    db.from('payments')
      .select('pago_id, fecha, fecha_inicio_periodo, fecha_fin_periodo, concepto, monto_usd, metodo, notas')
      .eq('client_id', session.client_id)
      .order('fecha', { ascending: false }),
  ])

  if (!cliente) return null

  const precioMes   = Number(cliente.precio_mensual_usd ?? 0)
  const ciclo       = cliente.ciclo_facturacion ?? 'mensual'
  const suscripcion = `$${precioMes.toFixed(2)}/mes${ciclo === 'anual' ? ' · anual' : ''}`

  return {
    client_id:        session.client_id,
    nombre_empresa:   cliente.nombre_empresa,
    estado:           cliente.estado,
    suscripcion,
    precio_mensual:   precioMes,
    ciclo,
    fecha_expiracion: cliente.fecha_expiracion ?? null,
    pagos:            (pagos ?? []) as PagoPortal[],
  }
}
