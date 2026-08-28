'use server'

// ─────────────────────────────────────────────────────────────────────────────
// Los tres niveles comerciales y su matriz de límites, editables desde /admin.
//
// Plan: docs/planes/niveles-comerciales.md §8.1
//
// Las CLAVES (`inicial`/`empresa`/`pro`) no se tocan desde aquí ni desde ningún
// sitio: están en un CHECK de `clients.nivel` y en el nombre de tres columnas de
// `modulos_catalogo`. Lo editable es lo que el cliente LEE (nombre, descripción)
// y lo que el nivel PERMITE (los límites). Renombrar «Empresa» a «Negocio» es un
// UPDATE aquí, no un despliegue.
//
// Permiso: el mismo que el catálogo de módulos (`modulos`). Poner precio a un
// módulo y decidir cuánto cabe en un nivel son la misma decisión comercial, y
// una sección más con su propia llave sería una llave que nadie recuerda dar.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache'
import { requirePermiso } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import { logActividad } from '@/lib/audit'
import { NIVELES, normalizarNivel } from '@/lib/niveles'
import { DIMENSIONES_LIMITE, type Dimension } from '@/lib/limites'

/** Nombre y descripción de un nivel. La clave y el orden no se tocan. */
export async function guardarNivel(formData: FormData) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const clave       = normalizarNivel(formData.get('clave'))
  const nombre      = (formData.get('nombre')      as string ?? '').trim()
  const descripcion = (formData.get('descripcion') as string ?? '').trim() || null
  const activo      = formData.get('activo') === 'true'

  if (!nombre) return { ok: false as const, error: 'El nombre del nivel no puede quedar vacío.' }

  const { error } = await supabase
    .from('niveles')
    .update({ nombre, descripcion, activo, updated_at: new Date().toISOString() })
    .eq('clave', clave)
  if (error) return { ok: false as const, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'nivel',
    entity_id:   clave,
    action:      'editar',
    description: `Editó el nivel ${clave} — nombre: "${nombre}" — ${activo ? 'a la venta' : 'retirado de la venta'}`,
  })

  revalidatePath('/admin/niveles')
  revalidatePath('/admin/modulos')
  return { ok: true as const }
}

/**
 * La matriz entera de un golpe. Se guarda completa a propósito: son treinta
 * celdas que se leen como una tabla y se piensan como una tabla; guardar celda a
 * celda deja el escalón a medio subir si se cierra la pestaña.
 *
 * Celda vacía = ILIMITADO (`base = null`). No es lo mismo que 0, que sería «ni
 * uno», así que el 0 se rechaza: no hay nivel en el que no quepa nada.
 */
export async function guardarLimites(formData: FormData) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  let filas: { nivel: string; dimension: string; base: number | null }[]
  try {
    filas = JSON.parse((formData.get('limites') as string) ?? '[]')
  } catch {
    return { ok: false as const, error: 'No se pudo leer la matriz de límites.' }
  }
  if (!Array.isArray(filas) || !filas.length) {
    return { ok: false as const, error: 'No hay límites que guardar.' }
  }

  const validas = filas.filter(f =>
    NIVELES.includes(normalizarNivel(f.nivel)) &&
    DIMENSIONES_LIMITE.includes(f.dimension as Dimension),
  )
  if (validas.length !== filas.length) {
    return { ok: false as const, error: 'La matriz trae un nivel o una dimensión que no existe.' }
  }
  if (validas.some(f => f.base !== null && !(Number(f.base) > 0))) {
    return { ok: false as const, error: 'Un límite es un número mayor que cero. Déjalo vacío para «ilimitado».' }
  }

  // `extra_por_empresa` no viaja en el formulario: hoy es 0 en todas partes
  // (límite plano y total por cliente, D6) y no hay pantalla que lo explique.
  // Se conserva la que haya en la fila en vez de pisarla con un 0 escrito a mano.
  const { error } = await supabase
    .from('nivel_limites')
    .upsert(
      validas.map(f => ({
        nivel:     normalizarNivel(f.nivel),
        dimension: f.dimension,
        base:      f.base === null ? null : Math.floor(Number(f.base)),
      })),
      { onConflict: 'nivel,dimension' },
    )
  if (error) return { ok: false as const, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'nivel',
    entity_id:   'limites',
    action:      'editar',
    description: `Actualizó la matriz de límites (${validas.length} celdas)`,
  })

  revalidatePath('/admin/niveles')
  return { ok: true as const }
}
