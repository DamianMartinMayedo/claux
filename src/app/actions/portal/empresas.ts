'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'

// Paleta idéntica al GAS — orden preservado
const COLORES_EMPRESA = [
  '#00AFAA', '#C97A0C', '#2E7D32', '#1565C0',
  '#6A1B9A', '#AD1457', '#00838F', '#4E342E',
]

export interface Empresa {
  empresa_id:        string
  client_id:         string
  nombre:            string
  nombre_fiscal:     string | null
  rif_nit:           string | null
  pais:              string | null
  ciudad:            string | null
  direccion:         string | null
  telefono:          string | null
  email:             string | null
  moneda_funcional:  string | null
  letra_facturacion: string | null
  logo_url:          string | null
  mostrar_logo:      boolean
  color:             string
  estado:            'ACTIVO' | 'INACTIVO'
  created_at:        string
  updated_at:        string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validarColor(color: string): string {
  return COLORES_EMPRESA.includes(color) ? color : COLORES_EMPRESA[0]
}

function generarEmpresaId(): string {
  return `EMP-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

// ── Obtener empresas (respeta acceso por rol) ─────────────────────────────────

export async function obtenerEmpresas(): Promise<Empresa[]> {
  const session = await getPortalSession()
  if (!session) return []

  const db = createAdminClient()

  if (session.rol === 'admin_empresa') {
    const { data } = await db
      .from('empresas')
      .select('*')
      .eq('client_id', session.client_id)
      .order('nombre')
    return (data as Empresa[]) ?? []
  }

  // usuario → solo empresas asignadas explícitamente
  const { data: asignadas } = await db
    .from('empresa_usuario')
    .select('empresa_id')
    .eq('user_id', session.user_id)

  const ids = (asignadas ?? []).map((r: { empresa_id: string }) => r.empresa_id)
  if (!ids.length) return []

  const { data } = await db
    .from('empresas')
    .select('*')
    .eq('client_id', session.client_id)
    .in('empresa_id', ids)
    .order('nombre')

  return (data as Empresa[]) ?? []
}

// ── Obtener lista simplificada para selectores ────────────────────────────────

export async function obtenerEmpresasSelector(): Promise<
  Pick<Empresa, 'empresa_id' | 'nombre' | 'color' | 'moneda_funcional'>[]
> {
  const empresas = await obtenerEmpresas()
  return empresas
    .filter(e => e.estado === 'ACTIVO')
    .map(({ empresa_id, nombre, color, moneda_funcional }) => ({
      empresa_id, nombre, color, moneda_funcional,
    }))
}

// ── Guardar (crear / actualizar) ──────────────────────────────────────────────

export async function guardarEmpresa(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; empresa_id?: string }> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa') {
    return { ok: false, error: 'Solo el administrador puede gestionar empresas.' }
  }

  const nombre = ((formData.get('nombre') as string) ?? '').trim()
  if (!nombre) return { ok: false, error: 'El nombre de la empresa es obligatorio.' }

  const empresa_id_form = ((formData.get('empresa_id') as string) ?? '').trim()
  const color           = validarColor((formData.get('color') as string) ?? '')
  const db              = createAdminClient()

  // Letra de facturación: 1 carácter A-Z, opcional pero único por client_id
  const letraRaw = ((formData.get('letra_facturacion') as string) ?? '').trim().toUpperCase()
  const letra_facturacion = letraRaw || null
  if (letra_facturacion && !/^[A-Z]$/.test(letra_facturacion)) {
    return { ok: false, error: 'La letra de facturación debe ser una sola letra A-Z.' }
  }

  // Validar unicidad de letra por cliente (client-side check antes del constraint DB)
  if (letra_facturacion) {
    const { data: ocupada } = await db
      .from('empresas')
      .select('empresa_id, nombre')
      .eq('client_id', session.client_id)
      .eq('letra_facturacion', letra_facturacion)
      .neq('empresa_id', empresa_id_form || '__nuevo__')
      .maybeSingle()
    if (ocupada) {
      return { ok: false, error: `La letra "${letra_facturacion}" ya está asignada a "${ocupada.nombre}".` }
    }
  }

  const mostrar_logo = formData.get('mostrar_logo') === 'true'

  const campos = {
    nombre,
    nombre_fiscal:    ((formData.get('nombre_fiscal') as string) ?? '').trim() || null,
    rif_nit:          ((formData.get('rif_nit')        as string) ?? '').trim() || null,
    pais:             ((formData.get('pais')            as string) ?? '').trim() || null,
    ciudad:           ((formData.get('ciudad')          as string) ?? '').trim() || null,
    direccion:        ((formData.get('direccion')       as string) ?? '').trim() || null,
    telefono:         ((formData.get('telefono')        as string) ?? '').trim() || null,
    email:            ((formData.get('email')           as string) ?? '').trim() || null,
    moneda_funcional: ((formData.get('moneda_funcional') as string) ?? '').trim() || null,
    letra_facturacion,
    mostrar_logo,
    color,
    updated_at: new Date().toISOString(),
  }

  if (!empresa_id_form) {
    // ── Crear ──────────────────────────────────────────────────────────────
    // Verificar límite del plan
    const { data: cliente } = await db
      .from('clients')
      .select('plan_id')
      .eq('client_id', session.client_id)
      .single()

    if (cliente?.plan_id) {
      const { data: plan } = await db
        .from('plans')
        .select('max_empresas')
        .eq('plan_id', cliente.plan_id)
        .single()

      const maxEmp = plan?.max_empresas ?? null
      if (maxEmp !== null) {
        const { count } = await db
          .from('empresas')
          .select('empresa_id', { count: 'exact', head: true })
          .eq('client_id', session.client_id)

        if ((count ?? 0) >= maxEmp) {
          return {
            ok: false,
            error: `Tu plan permite un máximo de ${maxEmp} empresa${maxEmp === 1 ? '' : 's'}. Actualiza tu suscripción para añadir más.`,
          }
        }
      }
    }

    const empresa_id = generarEmpresaId()
    const { error } = await db.from('empresas').insert({
      empresa_id,
      client_id: session.client_id,
      estado:    'ACTIVO',
      created_at: new Date().toISOString(),
      ...campos,
    })

    if (error) return { ok: false, error: 'Error al crear la empresa.' }
    revalidatePath('/portal/empresas')
    return { ok: true, empresa_id }
  }

  // ── Actualizar ─────────────────────────────────────────────────────────────
  const estado = ((formData.get('estado') as string) ?? 'ACTIVO') === 'INACTIVO'
    ? 'INACTIVO'
    : 'ACTIVO'

  const { error } = await db
    .from('empresas')
    .update({ ...campos, estado })
    .eq('empresa_id', empresa_id_form)
    .eq('client_id', session.client_id)  // garantiza que la empresa es del cliente

  if (error) return { ok: false, error: 'Error al actualizar la empresa.' }
  revalidatePath('/portal/empresas')
  return { ok: true, empresa_id: empresa_id_form }
}

// ── Subir logo ─────────────────────────────────────────────────────────────────

export async function subirLogoEmpresa(
  formData: FormData,
): Promise<{ ok: boolean; logo_url?: string; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa') {
    return { ok: false, error: 'Sin permisos.' }
  }

  const empresa_id = ((formData.get('empresa_id') as string) ?? '').trim()
  const file       = formData.get('logo') as File | null

  if (!empresa_id) return { ok: false, error: 'empresa_id requerido.' }
  if (!file || file.size === 0) return { ok: false, error: 'No se recibió archivo.' }
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: 'El logo no puede superar 2 MB.' }

  const tipos = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
  if (!tipos.includes(file.type)) {
    return { ok: false, error: 'Formato no válido. Usa PNG, JPG o WebP.' }
  }

  const db = createAdminClient()

  // Verificar que la empresa pertenece al cliente
  const { data: emp } = await db
    .from('empresas')
    .select('empresa_id')
    .eq('empresa_id', empresa_id)
    .eq('client_id', session.client_id)
    .maybeSingle()

  if (!emp) return { ok: false, error: 'Empresa no encontrada.' }

  const ext  = file.type.split('/')[1].replace('jpeg', 'jpg')
  const path = `${session.client_id}/${empresa_id}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await db.storage
    .from('logos')
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (uploadError) return { ok: false, error: uploadError.message }

  const { data: { publicUrl } } = db.storage.from('logos').getPublicUrl(path)

  await db
    .from('empresas')
    .update({ logo_url: publicUrl, updated_at: new Date().toISOString() })
    .eq('empresa_id', empresa_id)
    .eq('client_id', session.client_id)

  revalidatePath('/portal/empresas')
  return { ok: true, logo_url: publicUrl }
}
