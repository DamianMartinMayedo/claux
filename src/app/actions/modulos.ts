'use server'

import { requirePermiso } from '@/lib/admin-guard'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'

export async function editarModulo(formData: FormData) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const clave                = (formData.get('clave')                as string ?? '').trim()
  const nombre               = (formData.get('nombre')               as string ?? '').trim()
  const descripcion          = (formData.get('descripcion')          as string ?? '').trim() || null
  const tipo                 = (formData.get('tipo')                 as string ?? '').trim() || null
  const precio_fundador_usd  = parseFloat(formData.get('precio_fundador_usd')  as string ?? '0')
  const precio_estandar_usd  = parseFloat(formData.get('precio_estandar_usd')  as string ?? '0')
  const activo               = formData.get('activo') === 'true'
  const orden                = parseInt(formData.get('orden') as string ?? '0', 10)

  const paginasRaw = formData.get('paginas') as string ?? null
  const paginas = paginasRaw ? JSON.parse(paginasRaw) : null

  if (!clave || !nombre) return { ok: false, error: 'Clave y nombre son obligatorios.' }
  if (isNaN(precio_fundador_usd) || isNaN(precio_estandar_usd)) return { ok: false, error: 'Precios inválidos.' }

  // Obtener tipo actual para validar cambios
  const { data: actual } = await supabase
    .from('modulos_catalogo')
    .select('tipo')
    .eq('clave', clave)
    .single()

  const update: Record<string, unknown> = {
    nombre, descripcion, precio_fundador_usd, precio_estandar_usd, activo,
    updated_at: new Date().toISOString(),
  }
  if (!isNaN(orden)) update.orden = orden
  // Solo permitir cambio entre modulo ↔ funcionalidad, no desde/hacia addon o base
  if (tipo && actual && actual.tipo !== 'base' && actual.tipo !== 'addon' && ['modulo', 'funcionalidad'].includes(tipo)) {
    update.tipo = tipo
  }
  // Si cambia a addon, limpiar páginas
  if (tipo === 'addon') update.paginas = JSON.stringify([])
  else if (paginas !== null) update.paginas = paginas

  const { error } = await supabase
    .from('modulos_catalogo')
    .update(update)
    .eq('clave', clave)

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   clave,
    action:      'editar',
    description: `Editó módulo ${clave} — fundador: $${precio_fundador_usd} / estándar: $${precio_estandar_usd} — activo: ${activo}`,
  })

  revalidatePath('/admin/modulos')
  return { ok: true as const }
}

// ── Crear módulo ─────────────────────────────────────────────────────
export async function crearModulo(formData: FormData) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const clave                = (formData.get('clave')                as string ?? '').trim()
  const nombre               = (formData.get('nombre')               as string ?? '').trim()
  const tipo                 = (formData.get('tipo')                 as string ?? 'modulo').trim()
  const descripcion          = (formData.get('descripcion')          as string ?? '').trim() || null
  const precio_fundador_usd  = parseFloat(formData.get('precio_fundador_usd')  as string ?? '0')
  const precio_estandar_usd  = parseFloat(formData.get('precio_estandar_usd')  as string ?? '0')

  if (!clave || !nombre) return { ok: false, error: 'Clave y nombre son obligatorios.' }
  if (!['modulo', 'funcionalidad', 'addon'].includes(tipo)) return { ok: false, error: 'Tipo inválido.' }
  if (isNaN(precio_fundador_usd) || isNaN(precio_estandar_usd)) return { ok: false, error: 'Precios inválidos.' }

  // Verificar que la clave no exista
  const { data: existente } = await supabase
    .from('modulos_catalogo')
    .select('clave')
    .eq('clave', clave)
    .maybeSingle()
  if (existente) return { ok: false, error: `La clave "${clave}" ya existe.` }

  // Calcular orden (al final)
  const { count } = await supabase
    .from('modulos_catalogo')
    .select('*', { count: 'exact', head: true })
  const orden = (count ?? 0) + 1

  const { error } = await supabase
    .from('modulos_catalogo')
    .insert({
      clave, nombre, tipo, descripcion,
      precio_fundador_usd, precio_estandar_usd,
      es_base: false, orden, activo: true,
      paginas: JSON.stringify([]),
    })

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   clave,
    action:      'crear',
    description: `Creó ${tipo} "${nombre}" (${clave}) — fundador: $${precio_fundador_usd} / estándar: $${precio_estandar_usd}`,
  })

  revalidatePath('/admin/modulos')
  return { ok: true as const }
}

// ── Reordenar módulos ────────────────────────────────────────────────
export async function reordenarModulos(claves: string[]) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  for (let i = 0; i < claves.length; i++) {
    await supabase
      .from('modulos_catalogo')
      .update({ orden: i + 1 })
      .eq('clave', claves[i])
  }

  revalidatePath('/admin/modulos')
  return { ok: true as const }
}

// ── Archivar / reactivar módulo ──────────────────────────────────────
// Archivar = ocultarlo del alta de clientes sin borrarlo (activo=false).
// Los clientes que ya lo tienen contratado lo conservan.
export async function archivarModulo(clave: string, archivar: boolean) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const { data: mod } = await supabase
    .from('modulos_catalogo')
    .select('es_base, nombre')
    .eq('clave', clave)
    .maybeSingle()
  if (!mod) return { ok: false, error: 'Módulo no encontrado.' }
  if (mod.es_base) return { ok: false, error: 'La base no se puede archivar.' }

  const { error } = await supabase
    .from('modulos_catalogo')
    .update({ activo: !archivar, updated_at: new Date().toISOString() })
    .eq('clave', clave)
  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   clave,
    action:      archivar ? 'archivar' : 'reactivar',
    description: `${archivar ? 'Archivó' : 'Reactivó'} el módulo ${mod.nombre} (${clave})`,
  })

  revalidatePath('/admin/modulos')
  return { ok: true as const }
}

// ── Eliminar módulo (con guardia) ────────────────────────────────────
// Solo si no es la base y ningún cliente lo tiene contratado; si está en uso,
// se bloquea y se sugiere archivar.
export async function eliminarModulo(clave: string) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const { data: mod } = await supabase
    .from('modulos_catalogo')
    .select('es_base, nombre')
    .eq('clave', clave)
    .maybeSingle()
  if (!mod) return { ok: false, error: 'Módulo no encontrado.' }
  if (mod.es_base) return { ok: false, error: 'La base es obligatoria; no se puede eliminar.' }

  // Guardia: ¿algún cliente lo tiene activo? modulos_activos es text[].
  const { count } = await supabase
    .from('clients')
    .select('client_id', { count: 'exact', head: true })
    .contains('modulos_activos', [clave])
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `No se puede eliminar: ${count} cliente(s) lo tienen contratado. Archívalo en su lugar.`,
    }
  }

  const { error } = await supabase
    .from('modulos_catalogo')
    .delete()
    .eq('clave', clave)
  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   clave,
    action:      'eliminar',
    description: `Eliminó el módulo ${mod.nombre} (${clave})`,
  })

  revalidatePath('/admin/modulos')
  return { ok: true as const }
}
