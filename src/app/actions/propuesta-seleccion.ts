'use server'

// ── Guardar la selección desde la vista previa del comercial ────────────────
//
// La reunión se lleva en `/p/preview/<id>`, donde no hay token: el borrador no
// tiene uno hasta que se publica, y publicar no hace falta para presentar. Así
// que la puerta de entrada de la reunión no puede ser la ruta pública.
//
// Es un fichero aparte y no una función más de `actions/propuestas.ts` a
// propósito: lo importa un componente de cliente que se pinta en una página
// PÚBLICA, y eso deja las acciones de ese módulo invocables desde ahí. Todas
// llevan candado, pero exponer una superficie de diez acciones del admin para
// usar una es regalar trabajo a quien vaya a auditarlo. Aquí solo vive esta.

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { revalidatePath } from 'next/cache'
import { guardarSeleccion } from '@/lib/propuesta/seleccion'

export async function guardarSeleccionBorrador(
  propuestaId: number, modulos: string[],
): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('propuestas')
  if (!Number.isInteger(propuestaId) || propuestaId <= 0) return { ok: false, error: 'Propuesta no válida.' }

  const db = createAdminClient()
  const { data: prop } = await db.from('propuestas')
    .select('id, nivel, moneda, presupuesto_id')
    .eq('id', propuestaId).maybeSingle()
  if (!prop) return { ok: false, error: 'Esa propuesta ya no existe.' }

  const r = await guardarSeleccion(db, prop, modulos)
  if (!r.ok) return { ok: false, error: 'No se pudo guardar la selección.' }

  // La ficha de la propuesta enseña la última selección: sin esto, el comercial
  // vuelve al admin desde la reunión y sigue viendo la de antes.
  revalidatePath(`/admin/ventas/propuestas/${propuestaId}`)
  revalidatePath('/admin/ventas/propuestas')
  return { ok: true }
}
