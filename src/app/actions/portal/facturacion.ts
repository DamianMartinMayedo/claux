'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { leerSetting }       from '@/lib/settings'
import { suscripcionLabel, precioMensualEfectivo, esSocioHoy, COLUMNAS_CONDICIONES } from '@/lib/billing'
import { cargarContextoLimites, usoDeLimites, DIMENSIONES, type UsoDimension } from '@/lib/limites'

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
  /** Socio CLAUX: no se le genera cobro. Bandera, no estado (§10 del plan). */
  es_socio:         boolean
  socio_hasta:      string | null
  /** Nombre humano del nivel contratado («Empresa»), no la clave. */
  nivel_nombre:     string
  /** Uso y tope de cada dimensión, ya filtrado a los módulos que tiene. `null` si falló el conteo. */
  capacidad:        UsoDimension[] | null
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
      .select(`nombre_empresa, estado, es_prueba, ${COLUMNAS_CONDICIONES}, ciclo_facturacion, fecha_expiracion, fecha_fin_gracia, nivel, modulos_activos`)
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

  // Lo que paga, no lo que cuesta: aquí el cliente mira su factura.
  const precioMes   = precioMensualEfectivo(cliente)
  const ciclo       = cliente.ciclo_facturacion ?? 'mensual'
  const descuento   = parseInt(await leerSetting('descuento_anual_pct', '10'), 10) || 0
  const suscripcion = suscripcionLabel(precioMes, ciclo, descuento)
  const emailSoporte = await leerSetting('email_soporte', 'soporte@claux.es')

  // Su nivel y lo que le cabe. Hasta ahora el dueño solo se enteraba de en qué
  // nivel estaba el día que chocaba con un tope («el máximo de tu nivel Empresa»),
  // que es la peor manera posible de descubrir lo que has comprado. Aquí lo tiene
  // antes de chocar, y de paso ve cuánto le queda.
  //
  // Se filtra a los módulos que de verdad tiene: enseñarle «0 de 300 trabajadores»
  // a quien no contrató RRHH no es informar, es ofrecerle un tope de algo que no
  // puede usar. Las dimensiones sin módulo (`modulo: null`) valen para todos.
  const ctx = await cargarContextoLimites(db, session.client_id)
  const modulos = Array.isArray(cliente.modulos_activos) ? cliente.modulos_activos as string[] : []
  let capacidad: UsoDimension[] | null = null
  try {
    // El conteo puede fallar (`contarActivos` propaga a propósito: un cero falso
    // es el tope desapareciendo en silencio). Si falla, la tarjeta no se pinta —
    // pero el resto de la página, que es su factura, sí.
    const uso = await usoDeLimites(db, session.client_id)
    capacidad = uso.filter(u => {
      const mod = DIMENSIONES[u.dimension as keyof typeof DIMENSIONES]?.modulo
      return !mod || modulos.includes(mod)
    })
  } catch (e) {
    console.error('[facturacion] no se pudo contar el uso', e)
  }

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
    // `esSocioHoy` y no `es_socio` a secas: la condición caduca, y el día después
    // de `socio_hasta` el cliente vuelve al flujo normal de cobro.
    es_socio:         esSocioHoy(cliente),
    socio_hasta:      cliente.socio_hasta ?? null,
    nivel_nombre:     ctx.nivelNombre,
    capacidad,
    email_soporte:    emailSoporte,
    pagos:            (pagos ?? []) as PagoPortal[],
  }
}
