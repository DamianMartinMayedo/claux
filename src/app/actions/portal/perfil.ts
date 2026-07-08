'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { leerSetting }       from '@/lib/settings'
import { suscripcionLabel }  from '@/lib/billing'
import { hashPasswordPortal } from '@/lib/portal-auth'

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface PerfilData {
  // Cuenta del cliente (read-only)
  client_id:        string
  nombre_empresa:   string
  nombre_contacto:  string | null
  email_admin:      string
  estado:           string
  suscripcion:      string
  fecha_expiracion: string | null
  slug:             string | null
  // Mi usuario (editable)
  user_id:      string
  email:        string
  nombre:       string | null
  rol:          string
  solo_lectura: boolean
}

// ── Obtener perfil ────────────────────────────────────────────────────────────

export async function obtenerPerfil(): Promise<PerfilData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const [{ data: cliente }, { data: usuario }] = await Promise.all([
    db.from('clients')
      .select('nombre_empresa, nombre_contacto, email_admin, estado, precio_mensual_usd, ciclo_facturacion, fecha_expiracion, slug')
      .eq('client_id', session.client_id)
      .single(),
    db.from('client_users')
      .select('nombre, rol, solo_lectura')
      .eq('user_id', session.user_id)
      .single(),
  ])

  if (!cliente || !usuario) return null

  const precioMes   = Number(cliente.precio_mensual_usd ?? 0)
  const descuento   = parseInt(await leerSetting('descuento_anual_pct', '10'), 10) || 0
  const suscripcion = suscripcionLabel(precioMes, cliente.ciclo_facturacion ?? 'mensual', descuento)

  return {
    client_id:        session.client_id,
    nombre_empresa:   cliente.nombre_empresa,
    nombre_contacto:  cliente.nombre_contacto,
    email_admin:      cliente.email_admin,
    estado:           cliente.estado,
    suscripcion,
    fecha_expiracion: cliente.fecha_expiracion,
    slug:             cliente.slug ?? null,
    user_id:          session.user_id,
    email:            session.email,
    nombre:           usuario.nombre,
    rol:              usuario.rol,
    solo_lectura:     usuario.solo_lectura ?? false,
  }
}

// ── Actualizar mi perfil (nombre + contraseña opcional) ───────────────────────

export async function actualizarMiPerfil(formData: FormData): Promise<{
  ok: boolean
  error?: string
}> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sin sesión.' }

  const nombre          = ((formData.get('nombre')          as string) ?? '').trim() || null
  const password_actual = ((formData.get('password_actual') as string) ?? '').trim()
  const password_nueva  = ((formData.get('password_nueva')  as string) ?? '').trim()

  // El identificador público (slug) ya NO se gestiona aquí: es config propia de
  // Reservas/Citas (pestaña Configuración de cada una).
  const db = createAdminClient()

  if (password_nueva) {
    // Validaciones de contraseña
    if (!password_actual) return { ok: false, error: 'Introduce tu contraseña actual.' }
    if (password_nueva.length < 8)
      return { ok: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' }

    // Verificar contraseña actual
    const { data: usr } = await db
      .from('client_users')
      .select('password_hash, salt')
      .eq('user_id', session.user_id)
      .single()
    if (!usr) return { ok: false, error: 'Usuario no encontrado.' }

    const hashActual = await hashPasswordPortal(password_actual, usr.salt)
    if (hashActual !== usr.password_hash)
      return { ok: false, error: 'La contraseña actual no es correcta.' }

    // Nueva salt + hash
    const nuevaSalt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('')
    const nuevoHash = await hashPasswordPortal(password_nueva, nuevaSalt)

    const { error } = await db
      .from('client_users')
      .update({ nombre, password_hash: nuevoHash, salt: nuevaSalt })
      .eq('user_id', session.user_id)
    if (error) return { ok: false, error: 'Error al actualizar.' }

  } else {
    // Solo actualizar nombre
    const { error } = await db
      .from('client_users')
      .update({ nombre })
      .eq('user_id', session.user_id)
    if (error) return { ok: false, error: 'Error al actualizar.' }
  }

  revalidatePath('/portal/perfil')
  return { ok: true }
}
