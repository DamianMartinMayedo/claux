'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { leerSetting }       from '@/lib/settings'
import { suscripcionLabel }  from '@/lib/billing'

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface PagoPortal {
  pago_id:              string
  fecha:                string
  fecha_inicio_periodo: string | null
  fecha_fin_periodo:    string | null
  concepto:             string | null
  estado:               string | null
  monto_usd:            number
  metodo:               string
  notas:                string | null
}

export interface FacturacionData {
  client_id:        string
  nombre_empresa:   string
  estado:           string
  es_prueba:        boolean
  suscripcion:      string
  precio_mensual:   number
  ciclo:            string
  fecha_expiracion: string | null
  fecha_fin_gracia: string | null
  email_soporte:    string
  pagos:            PagoPortal[]
}

// ── Obtener datos de facturación ──────────────────────────────────────────────

export async function obtenerFacturacion(): Promise<FacturacionData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const [{ data: cliente }, { data: pagos }] = await Promise.all([
    db.from('clients')
      .select('nombre_empresa, estado, es_prueba, precio_mensual_usd, ciclo_facturacion, fecha_expiracion, fecha_fin_gracia')
      .eq('client_id', session.client_id)
      .single(),
    db.from('payments')
      // `estado` viaja al panel del cliente a propósito: sin él, un cobro POR
      // CONFIRMAR (el de configuración recién generado, p. ej.) se leía como un
      // pago ya hecho dentro del «Historial de pagos».
      .select('pago_id, fecha, fecha_inicio_periodo, fecha_fin_periodo, concepto, estado, monto_usd, metodo, notas')
      .eq('client_id', session.client_id)
      .order('fecha', { ascending: false }),
  ])

  if (!cliente) return null

  const precioMes   = Number(cliente.precio_mensual_usd ?? 0)
  const ciclo       = cliente.ciclo_facturacion ?? 'mensual'
  const descuento   = parseInt(await leerSetting('descuento_anual_pct', '10'), 10) || 0
  const suscripcion = suscripcionLabel(precioMes, ciclo, descuento)
  const emailSoporte = await leerSetting('email_soporte', 'soporte@claux.es')

  return {
    client_id:        session.client_id,
    nombre_empresa:   cliente.nombre_empresa,
    estado:           cliente.estado,
    es_prueba:        cliente.es_prueba ?? false,
    suscripcion,
    precio_mensual:   precioMes,
    ciclo,
    fecha_expiracion: cliente.fecha_expiracion ?? null,
    fecha_fin_gracia: cliente.fecha_fin_gracia ?? null,
    email_soporte:    emailSoporte,
    pagos:            (pagos ?? []) as PagoPortal[],
  }
}
