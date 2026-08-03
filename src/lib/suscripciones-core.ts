// Núcleo de ESCRITURA de suscripciones (sin 'use server'): lo comparten el alta
// manual (`actions/portal/suscripciones.ts`) y el importador
// (`lib/importador/adaptadores/suscripciones.ts`), para que las dos vías validen
// y escriban exactamente igual. A propósito NO incluye el efecto secundario de
// facturar solo el primer cobro (`borradorDelPrimerCobro`, en la acción): el
// importador migra historial y nunca debe generar una factura sola.

import type { createAdminClient } from '@/lib/supabase/admin'
import {
  generarSuscripcionId, generarLineaId, planReanudacion,
  type PeriodicidadSub, type DescuentoModo, type AcuerdoPausado, type PlanReanudacion,
} from '@/lib/suscripciones'

type Db = ReturnType<typeof createAdminClient>

/**
 * El cliente tiene que ser de ESA empresa. Los terceros son por empresa, así que
 * sin esta guardia se podía atar una suscripción de una empresa a la ficha de
 * otra, y la factura —que sí pertenece a una empresa— saldría a nombre de un
 * tercero ajeno.
 */
export async function clienteDeEmpresa(
  db: Db, client_id: string, cliente_id: string, empresa_id: string,
): Promise<boolean> {
  const { data } = await db.from('third_parties')
    .select('tercero_id').eq('client_id', client_id)
    .eq('tercero_id', cliente_id).eq('empresa_id', empresa_id).maybeSingle()
  return !!data
}

/**
 * Qué servicios de los pedidos son de verdad suscribibles. Se comprueba contra
 * la base y no se confía en lo que diga el formulario o el archivo: aquí es
 * donde se cuela un `producto_id` que no debería poder suscribirse.
 */
export async function serviciosSuscribibles(
  db: Db, client_id: string, producto_ids: string[],
): Promise<Set<string>> {
  if (!producto_ids.length) return new Set()
  const { data } = await db.from('products')
    .select('producto_id').eq('client_id', client_id)
    .eq('tipo', 'SERVICIO').eq('es_suscribible', true)
    .in('producto_id', [...new Set(producto_ids)])
  return new Set(((data ?? []) as { producto_id: string }[]).map(p => p.producto_id))
}

export interface CamposAcuerdoSuscripcion {
  empresa_id:            string
  cliente_id:            string
  moneda:                string
  periodicidad:          PeriodicidadSub
  fecha_inicio:          string
  fecha_proximo_cobro:   string
  fecha_fin:             string | null
  renovacion_automatica: boolean
  notas:                 string | null
  /** Prorratear el PRIMER período (mig. 163). Opcional: por defecto, ciclo completo. */
  prorratear?:           boolean
}

/** Crea la CABECERA del acuerdo (sin líneas todavía). Nace siempre ACTIVA. */
export async function crearAcuerdoSuscripcion(
  db: Db, client_id: string, campos: CamposAcuerdoSuscripcion,
): Promise<string> {
  const suscripcion_id = generarSuscripcionId()
  const { error } = await db.from('suscripciones').insert({
    suscripcion_id, client_id, estado: 'ACTIVA', created_at: new Date().toISOString(), ...campos,
  })
  if (error) throw new Error(error.message)
  return suscripcion_id
}

export interface DatosLineaSuscripcion {
  producto_id:     string
  precio_mensual:  number
  descuento_modo:  DescuentoModo
  descuento_valor: number
}

/** Crea UNA línea del acuerdo. El precio es SUYO (mig. 124); el descuento, de ella misma (mig. 125). */
export async function crearLineaSuscripcion(
  db: Db, client_id: string, suscripcion_id: string, linea: DatosLineaSuscripcion,
): Promise<string> {
  const linea_id = generarLineaId()
  const { error } = await db.from('suscripcion_lineas').insert({
    linea_id, client_id, suscripcion_id, ...linea,
  })
  if (error) throw new Error(error.message)
  return linea_id
}

// ── Reanudar: la pausa no se cobra ────────────────────────────────────────────
//
// La REGLA (qué ciclos se saltan y por qué) es pura y vive en `lib/suscripciones.ts`
// (`planReanudacion`), donde también la lee el diálogo de confirmación. Aquí solo está la
// escritura, y vive fuera de `'use server'` porque la usan DOS vías: el botón «Reanudar»
// del portal y el escáner del cron que reanuda las que llegan a su `pausada_hasta`.

/**
 * Reanuda de verdad: vuelve a ACTIVA, aplica el plan y limpia las marcas de la pausa.
 * Devuelve el plan aplicado para poder contarlo (el aviso del cron dice qué pasó).
 */
export async function reanudarAcuerdo(
  db: Db, client_id: string, s: AcuerdoPausado, hoy: string, cobrarPausados = false,
): Promise<PlanReanudacion> {
  const plan = planReanudacion(s, hoy, cobrarPausados)
  const { error } = await db.from('suscripciones')
    .update({
      estado:              'ACTIVA',
      fecha_proximo_cobro: plan.proximoCobro,
      pausada_desde:       null,
      pausada_hasta:       null,
      updated_at:          new Date().toISOString(),
    })
    .eq('suscripcion_id', s.suscripcion_id).eq('client_id', client_id)
  if (error) throw new Error(error.message)
  return plan
}
