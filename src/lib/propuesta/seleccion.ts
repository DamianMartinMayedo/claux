// ── Guardar lo que se marcó en el configurador ──────────────────────────────
//
// Una sola regla de qué se guarda, con DOS puertas de entrada: el enlace
// público (`/p/<token>/seleccion`, que autoriza el token) y la vista previa del
// comercial (`actions/propuesta-seleccion.ts`, que autoriza el permiso). Si cada
// una decidiera por su cuenta, la reunión y el enlace escribirían cosas
// distintas — que es exactamente el defecto que esta propuesta vino a cerrar.

import { normalizarNivel, sumarModulos, type ModuloPrecios } from '@/lib/niveles'
import { normalizarMonedaClaux } from '@/lib/moneda-claux'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any

/** Claves de módulo: minúsculas, dígitos y guion bajo. Nada más entra. */
const CLAVE = /^[a-z0-9_]{1,40}$/

/** Lo mínimo de la propuesta para poner precio a lo marcado. */
export interface PropuestaParaSeleccion {
  id:             number
  nivel:          string | null
  moneda:         string | null
  presupuesto_id: number | null
}

/** Las claves que llegan del navegador, saneadas y sin repetir. */
export function clavesValidas(entrada: unknown): string[] {
  if (!Array.isArray(entrada)) return []
  return [...new Set(entrada.filter((c): c is string => typeof c === 'string' && CLAVE.test(c)))]
}

/**
 * Guarda la selección con la cuota **recalculada aquí** contra el catálogo vivo.
 *
 * La cuota no se acepta del cliente aunque el navegador la sepa: un importe que
 * se guarda tal como llega es un importe que se puede escribir a mano, y esta
 * cifra acaba precargando un presupuesto. Lo mismo con las claves: solo entran
 * las que el catálogo vende hoy, o el presupuesto arrancaría con un módulo que
 * ya no existe.
 */
export async function guardarSeleccion(
  db: Db, prop: PropuestaParaSeleccion, entrada: unknown,
): Promise<{ ok: boolean; cuota?: number; moneda?: string }> {
  const claves = clavesValidas(entrada)
  if (claves.length === 0) return { ok: false }

  // La moneda del presupuesto manda, igual que al armar la propuesta: si no, la
  // cuota guardada saldría en una moneda y la diapositiva en otra.
  let moneda = normalizarMonedaClaux(prop.moneda)
  if (prop.presupuesto_id) {
    const { data: pre } = await db.from('presupuestos_instalacion')
      .select('moneda').eq('id', prop.presupuesto_id).maybeSingle()
    if (pre?.moneda) moneda = normalizarMonedaClaux(pre.moneda)
  }

  const { data } = await db.from('modulos_catalogo')
    .select('clave, precio_inicial_usd, precio_empresa_usd, precio_pro_usd, '
      + 'precio_inicial_eur, precio_empresa_eur, precio_pro_eur')
    .in('clave', claves).eq('activo', true)

  const catalogo = (data ?? []) as ModuloPrecios[]
  if (catalogo.length === 0) return { ok: false }

  const vivas = catalogo.map(m => m.clave)
  const cuota = sumarModulos(catalogo, vivas, normalizarNivel(prop.nivel), moneda)

  const { error } = await db.from('propuesta_selecciones')
    .insert({ propuesta_id: prop.id, modulos: vivas, cuota, moneda })
  if (error) return { ok: false }
  return { ok: true, cuota, moneda }
}
