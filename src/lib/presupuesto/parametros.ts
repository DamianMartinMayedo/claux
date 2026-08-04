// ── Carga de los parámetros de precio del presupuesto (servidor) ──
//
// UNA sola función para leerlos, y se pasan enteros al cálculo. El cálculo es isomórfico y
// NO lee de aquí: si el navegador y el servidor cargaran los precios cada uno por su cuenta,
// un cambio de tarifa a media sesión dejaría la vista previa diciendo una cifra y lo guardado
// otra, sin que nadie se enterara.

import { createAdminClient } from '@/lib/supabase/admin'
import { leerSetting } from '@/lib/settings'
import {
  AJUSTES_PRESUPUESTO,
  type LineaParametro, type ParametrosPresupuesto,
} from './config'

const nOr = (v: string, def: string): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : Number(def)
}

/** Los parámetros vigentes. Las líneas salen de `presupuesto_parametros` (mig. 168) y los
 *  escalares de `settings`; ambos se editan en /admin/configuracion → Facturación. */
export async function cargarParametros(): Promise<ParametrosPresupuesto> {
  const db = createAdminClient()
  const [{ data: filas }, ...valores] = await Promise.all([
    db.from('presupuesto_parametros')
      .select('clave, fase, etiqueta, modulo, horas_base, incluido, tramo, horas_por_tramo, orden')
      .eq('activo', true)
      .order('orden'),
    ...Object.values(AJUSTES_PRESUPUESTO).map(a => leerSetting(a.key, a.def)),
  ])

  const claves = Object.keys(AJUSTES_PRESUPUESTO) as (keyof typeof AJUSTES_PRESUPUESTO)[]
  const escalares = {} as Record<keyof typeof AJUSTES_PRESUPUESTO, number>
  claves.forEach((k, i) => {
    escalares[k] = nOr(valores[i] as string, AJUSTES_PRESUPUESTO[k].def)
  })

  return {
    ...escalares,
    // Postgres devuelve `numeric` como cadena: sin el Number() las horas se concatenarían
    // en vez de sumarse y el presupuesto saldría en un número imposible.
    lineas: (filas ?? []).map(f => ({
      clave:           f.clave as string,
      fase:            Number(f.fase) === 1 ? 1 : 2,
      etiqueta:        f.etiqueta as string,
      modulo:          (f.modulo as string | null) ?? null,
      horas_base:      Number(f.horas_base),
      incluido:        Number(f.incluido),
      tramo:           Number(f.tramo) || 1,
      horas_por_tramo: Number(f.horas_por_tramo),
      orden:           Number(f.orden),
    })) as LineaParametro[],
  }
}
