'use server'

// ── Edición de los precios del presupuesto de instalación ──
//
// Estaban en constantes del código: cambiar el precio de una hora era tocar `config.ts` y
// desplegar. Desde la mig. 168 son datos, y esto es lo que los escribe.

import { createAdminClient } from '@/lib/supabase/admin'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { logActividad } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { AJUSTES_PRESUPUESTO, type LineaParametro } from '@/lib/presupuesto/config'

export interface GuardarParametrosInput {
  /** Escalares (`tarifa_hora_usd`, horas fijas), por su clave de `AJUSTES_PRESUPUESTO`. */
  escalares: Record<string, number>
  /** Líneas presupuestables con sus cuatro números. */
  lineas: Pick<LineaParametro, 'clave' | 'horas_base' | 'incluido' | 'tramo' | 'horas_por_tramo'>[]
}

const noNeg = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export async function guardarParametrosPresupuesto(
  input: GuardarParametrosInput,
): Promise<{ ok: boolean; error?: string }> {
  // Super admin, igual que el resto de la configuración de facturación: esto es el precio
  // de venta, no un ajuste de pantalla.
  const ctx = await requireSuperAdmin()
  const db = createAdminClient()

  // ── Escalares ──
  const filas = Object.entries(AJUSTES_PRESUPUESTO)
    .filter(([k]) => input.escalares[k] != null)
    .map(([k, a]) => ({ key: a.key, value: String(noNeg(input.escalares[k])), updated_at: new Date().toISOString() }))
  if (filas.length > 0) {
    const { error } = await db.from('settings').upsert(filas, { onConflict: 'key' })
    if (error) return { ok: false, error: error.message }
  }

  // ── Líneas ──
  for (const l of input.lineas ?? []) {
    // `tramo` es divisor: un 0 haría una división entre cero en el cálculo, así que el
    // mínimo es 1 aunque la línea no cobre por tramos (bastaría con horas_por_tramo = 0).
    const { error } = await db
      .from('presupuesto_parametros')
      .update({
        horas_base:      noNeg(l.horas_base),
        incluido:        Math.round(noNeg(l.incluido)),
        tramo:           Math.max(1, Math.round(noNeg(l.tramo))),
        horas_por_tramo: noNeg(l.horas_por_tramo),
        updated_at:      new Date().toISOString(),
      })
      .eq('clave', l.clave)
    if (error) return { ok: false, error: error.message }
  }

  await logActividad(db, {
    user_email:  ctx.email ?? 'sistema',
    entity:      'sistema',
    action:      'configuracion',
    description: `Actualizó los precios del presupuesto de instalación (tarifa $${noNeg(input.escalares.tarifaHora)}/h, ${input.lineas?.length ?? 0} líneas)`,
  })

  revalidatePath('/admin/configuracion')
  revalidatePath('/admin/presupuestos/nuevo')
  return { ok: true }
}
