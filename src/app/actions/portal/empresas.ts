'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'

// Paleta moderna de identidad de empresa. Saturada y a media-oscuridad (no
// pastel) para que la inicial blanca del avatar/badge siempre contraste, y bien
// repartida en la rueda para distinguir empresas de un vistazo. Si cambia, hay
// que sincronizar COLORES en EmpresasGrid.tsx y mapear los tonos viejos en una
// migración (ver 075_paleta_colores_empresas.sql).
const COLORES_EMPRESA = [
  '#00AFAA', '#2563EB', '#7C3AED', '#C026D3',
  '#E11D48', '#EA580C', '#16A34A', '#64748B',
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

function validarColor(color: string): { ok: boolean; color?: string; error?: string } {
  if (!color || !COLORES_EMPRESA.includes(color)) {
    return { ok: false, error: 'Color no válido. Selecciona un color de la paleta.' }
  }
  return { ok: true, color }
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
  const colorResult     = validarColor((formData.get('color') as string) ?? '')
  if (!colorResult.ok) return { ok: false, error: colorResult.error }
  const color           = colorResult.color
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
    // Invariante de moneda: no se crea una empresa sin monedas configuradas. Toda
    // operación (ventas, gastos, compras, productos…) cuelga de la empresa y necesita
    // una moneda válida del cliente; permitirlo antes dejaría documentos cayendo a un
    // 'USD' hardcodeado que el cliente no tiene, descuadrando saldos y reportes. Solo
    // aplica al crear: editar una empresa ya existente no debe bloquearse.
    const { count: monedasCount } = await db
      .from('monedas')
      .select('codigo', { count: 'exact', head: true })
      .eq('client_id', session.client_id)
      .eq('activa', true)
    if ((monedasCount ?? 0) === 0) {
      return { ok: false, error: 'Crea al menos una moneda en «Monedas y tasas» antes de crear una empresa.' }
    }

    // Límite por módulo: sin 'multiempresa' el cliente solo puede tener 1 empresa.
    const { data: cliente } = await db
      .from('clients')
      .select('modulos_activos')
      .eq('client_id', session.client_id)
      .single()

    const tieneMultiempresa = Array.isArray(cliente?.modulos_activos)
      && cliente.modulos_activos.includes('multiempresa')

    if (!tieneMultiempresa) {
      const { count } = await db
        .from('empresas')
        .select('empresa_id', { count: 'exact', head: true })
        .eq('client_id', session.client_id)

      if ((count ?? 0) >= 1) {
        return {
          ok: false,
          error: 'Tu suscripción permite una sola empresa. Activa el módulo Multiempresa para añadir más.',
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

  // Subir como Blob, no como Buffer: en el runtime serverless de Vercel el Buffer
  // se manda como body crudo de fetch y se corrompe (recodificado a UTF-8); el
  // Blob va por multipart, binario seguro. (Ver nota en catalogo.ts/subirFotoItem.)
  const buffer = Buffer.from(await file.arrayBuffer())
  const blob = new Blob([new Uint8Array(buffer)], { type: file.type })
  const { error: uploadError } = await db.storage
    .from('logos')
    .upload(path, blob, { contentType: file.type, upsert: true })

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
