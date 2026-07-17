'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TipoAlmacen = 'FISICO' | 'VIRTUAL' | 'TRANSITO' | 'CONSIGNACION'


export interface Almacen {
  almacen_id:  string
  client_id:   string
  empresa_id:  string
  nombre:      string
  descripcion: string | null
  tipo:        TipoAlmacen
  activo:      boolean
  created_at:  string
  updated_at:  string
}

export interface AlmacenesPageData {
  almacenes:       Almacen[]
  empresa_nombres: Record<string, string>   // empresa_id → nombre
  empresas:        { empresa_id: string; nombre: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generarAlmacenId(): string {
  return `ALM-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

// ── Obtener ───────────────────────────────────────────────────────────────────

export async function obtenerAlmacenes(): Promise<AlmacenesPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db      = createAdminClient()
  const empresas = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)

  const { data } = await db
    .from('almacenes')
    .select('*')
    .eq('client_id', session.client_id)
    .in('empresa_id', empresa_ids.length ? empresa_ids : ['__none__'])
    .order('nombre')

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    almacenes:       (data ?? []) as Almacen[],
    empresa_nombres,
    empresas:        empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
  }
}

// ── Guardar (crear / editar) ──────────────────────────────────────────────────

export async function guardarAlmacen(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const almacen_id = (formData.get('almacen_id') as string)?.trim()
  const empresa_id = (formData.get('empresa_id') as string)?.trim()
  const nombre     = (formData.get('nombre')     as string)?.trim()
  const descripcion= (formData.get('descripcion') as string)?.trim() || null
  const tipo       = (formData.get('tipo')        as string)?.trim() as TipoAlmacen

  if (!nombre)     return { ok: false, error: 'El nombre del almacén es obligatorio.' }
  if (!empresa_id) return { ok: false, error: 'Debes seleccionar una empresa.' }
  if (!tipo)       return { ok: false, error: 'Debes seleccionar un tipo de almacén.' }

  // Verificar que la empresa pertenece al cliente
  const empresas    = await obtenerEmpresas()
  const empresaValida = empresas.some(e => e.empresa_id === empresa_id)
  if (!empresaValida) return { ok: false, error: 'Empresa no válida.' }

  const payload = {
    empresa_id,
    client_id:   session.client_id,
    nombre,
    descripcion,
    tipo,
    updated_at:  new Date().toISOString(),
  }

  if (!almacen_id) {
    // Crear
    const { error } = await db.from('almacenes').insert({
      ...payload,
      almacen_id: generarAlmacenId(),
      activo:     true,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    // Editar
    const { error } = await db.from('almacenes')
      .update(payload)
      .eq('almacen_id', almacen_id)
      .eq('client_id',  session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/almacenes')
  return { ok: true }
}

// ── Archivar / restaurar ──────────────────────────────────────────────────────

export async function archivarAlmacen(
  almacen_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const { error } = await createAdminClient()
    .from('almacenes')
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq('almacen_id', almacen_id)
    .eq('client_id',  session.client_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/almacenes')
  return { ok: true }
}

export async function restaurarAlmacen(
  almacen_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const { error } = await createAdminClient()
    .from('almacenes')
    .update({ activo: true, updated_at: new Date().toISOString() })
    .eq('almacen_id', almacen_id)
    .eq('client_id',  session.client_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/almacenes')
  return { ok: true }
}
