'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'
import { hashPasswordPortal } from '@/lib/portal-auth'
import type { ModuloPerm } from '@/lib/permisos'

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface UsuarioPortal {
  user_id:      string
  client_id:    string
  email:        string
  nombre:       string | null
  rol:          'admin_empresa' | 'usuario'
  solo_lectura: boolean
  estado:       'ACTIVO' | 'INACTIVO'
  created_at:   string
  empresas:     string[]        // empresa_ids asignadas (solo para rol 'usuario')
  modulos:      ModuloPerm[]    // permisos por módulo (solo rol 'usuario'; vacío = todos)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generarPasswordTemporal(): string {
  // 12 caracteres: letras + números, fácil de leer (sin 0/O/l/1)
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(b => chars[b % chars.length])
    .join('')
}

function generarUserId(): string {
  return `USR-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

function generarSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Obtener usuarios ──────────────────────────────────────────────────────────

export async function obtenerUsuarios(): Promise<UsuarioPortal[]> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa') return []

  const db = createAdminClient()

  const { data: usuarios } = await db
    .from('client_users')
    .select('user_id, client_id, email, nombre, rol, solo_lectura, estado, created_at')
    .eq('client_id', session.client_id)
    .order('created_at')

  const userIds   = (usuarios ?? []).map(u => u.user_id)
  const idsFiltro = userIds.length ? userIds : ['__none__']

  const [{ data: asignaciones }, { data: permisos }] = await Promise.all([
    db.from('empresa_usuario').select('user_id, empresa_id').in('user_id', idsFiltro),
    db.from('usuario_modulo').select('user_id, modulo_clave, puede_editar').in('user_id', idsFiltro),
  ])

  // Agrupar empresas por usuario
  const empresasPorUsuario = new Map<string, string[]>()
  for (const a of (asignaciones ?? [])) {
    if (!empresasPorUsuario.has(a.user_id)) empresasPorUsuario.set(a.user_id, [])
    empresasPorUsuario.get(a.user_id)!.push(a.empresa_id)
  }

  // Agrupar permisos de módulo por usuario
  const modulosPorUsuario = new Map<string, ModuloPerm[]>()
  for (const p of (permisos ?? [])) {
    if (!modulosPorUsuario.has(p.user_id)) modulosPorUsuario.set(p.user_id, [])
    modulosPorUsuario.get(p.user_id)!.push({ clave: p.modulo_clave, puede_editar: !!p.puede_editar })
  }

  return (usuarios ?? []).map(u => ({
    ...u,
    solo_lectura: u.solo_lectura ?? false,
    empresas: empresasPorUsuario.get(u.user_id) ?? [],
    modulos:  modulosPorUsuario.get(u.user_id) ?? [],
  })) as UsuarioPortal[]
}

// Lee los permisos por módulo del formulario y los sincroniza para un usuario.
// Solo aplica a rol 'usuario'; admin_empresa no lleva filas (= todos los módulos).
async function sincronizarModulos(
  db: ReturnType<typeof createAdminClient>,
  user_id: string,
  rol: UsuarioPortal['rol'],
  formData: FormData,
): Promise<void> {
  await db.from('usuario_modulo').delete().eq('user_id', user_id)
  if (rol !== 'usuario') return

  const modulos    = formData.getAll('modulos') as string[]
  const editables  = new Set(formData.getAll('modulos_editar') as string[])
  if (modulos.length === 0) return

  await db.from('usuario_modulo').insert(
    modulos.map(clave => ({ user_id, modulo_clave: clave, puede_editar: editables.has(clave) })),
  )
}

// ── Crear usuario ─────────────────────────────────────────────────────────────

export async function crearUsuario(formData: FormData): Promise<{
  ok: boolean
  passwordTemporal?: string
  error?: string
}> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa' || session.solo_lectura) {
    return { ok: false, error: 'Sin permisos.' }
  }

  const email        = ((formData.get('email')  as string) ?? '').trim().toLowerCase()
  const nombre       = ((formData.get('nombre') as string) ?? '').trim() || null
  const rol          = ((formData.get('rol')    as string) ?? 'usuario') as UsuarioPortal['rol']
  const solo_lectura = formData.get('solo_lectura') === 'true'
  const empresas     = formData.getAll('empresas') as string[]

  if (!email) return { ok: false, error: 'El email es obligatorio.' }
  if (!['admin_empresa', 'usuario'].includes(rol)) return { ok: false, error: 'Rol inválido.' }

  const db = createAdminClient()

  // Verificar que el email no exista ya en este cliente
  const { data: existe } = await db
    .from('client_users')
    .select('user_id')
    .eq('client_id', session.client_id)
    .eq('email', email)
    .maybeSingle()

  if (existe) return { ok: false, error: `El email "${email}" ya está registrado.` }

  const password = generarPasswordTemporal()
  const salt     = generarSalt()
  const hash     = await hashPasswordPortal(password, salt)
  const user_id  = generarUserId()

  const { error } = await db.from('client_users').insert({
    user_id,
    client_id:         session.client_id,
    email,
    nombre,
    rol,
    solo_lectura,
    password_hash:     hash,
    salt,
    estado:            'ACTIVO',
    must_change_password: true,  // definirá su propia contraseña en el primer acceso
  })

  if (error) return { ok: false, error: 'Error al crear el usuario.' }

  // Asignar empresas si es rol usuario
  if (rol === 'usuario' && empresas.length > 0) {
    await db.from('empresa_usuario').insert(
      empresas.map(empresa_id => ({ user_id, empresa_id }))
    )
  }

  // Permisos por módulo (solo rol usuario; sin filas = todos los contratados)
  await sincronizarModulos(db, user_id, rol, formData)

  revalidatePath('/portal/usuarios')
  return { ok: true, passwordTemporal: password }
}

// ── Editar usuario ────────────────────────────────────────────────────────────

export async function editarUsuario(formData: FormData): Promise<{
  ok: boolean
  error?: string
}> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa' || session.solo_lectura) {
    return { ok: false, error: 'Sin permisos.' }
  }

  const user_id      = ((formData.get('user_id')  as string) ?? '').trim()
  const nombre       = ((formData.get('nombre')   as string) ?? '').trim() || null
  const rol          = ((formData.get('rol')       as string) ?? 'usuario') as UsuarioPortal['rol']
  const solo_lectura = formData.get('solo_lectura') === 'true'
  const estado       = formData.get('estado') === 'INACTIVO' ? 'INACTIVO' : 'ACTIVO'
  const empresas     = formData.getAll('empresas') as string[]

  if (!user_id) return { ok: false, error: 'usuario_id requerido.' }

  // No puede editar su propio usuario
  if (user_id === session.user_id) return { ok: false, error: 'No puedes editarte a ti mismo.' }

  const db = createAdminClient()

  // Verificar que el usuario pertenece a este cliente
  const { data: usr } = await db
    .from('client_users')
    .select('user_id')
    .eq('user_id', user_id)
    .eq('client_id', session.client_id)
    .maybeSingle()

  if (!usr) return { ok: false, error: 'Usuario no encontrado.' }

  const { error } = await db
    .from('client_users')
    .update({ nombre, rol, solo_lectura, estado })
    .eq('user_id', user_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al actualizar el usuario.' }

  // Sincronizar empresas asignadas (borrar todas y re-insertar)
  await db.from('empresa_usuario').delete().eq('user_id', user_id)
  if (rol === 'usuario' && empresas.length > 0) {
    await db.from('empresa_usuario').insert(
      empresas.map(empresa_id => ({ user_id, empresa_id }))
    )
  }

  // Sincronizar permisos por módulo (borrar + reinsertar; admin = sin filas = todos)
  await sincronizarModulos(db, user_id, rol, formData)

  revalidatePath('/portal/usuarios')
  return { ok: true }
}

// ── Resetear contraseña ───────────────────────────────────────────────────────

export async function resetearPassword(user_id: string): Promise<{
  ok: boolean
  passwordTemporal?: string
  error?: string
}> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa' || session.solo_lectura) {
    return { ok: false, error: 'Sin permisos.' }
  }
  if (user_id === session.user_id) return { ok: false, error: 'No puedes resetearte a ti mismo.' }

  const db       = createAdminClient()
  const password = generarPasswordTemporal()
  const salt     = generarSalt()
  const hash     = await hashPasswordPortal(password, salt)

  const { error } = await db
    .from('client_users')
    .update({ password_hash: hash, salt, must_change_password: true })
    .eq('user_id', user_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al resetear la contraseña.' }
  return { ok: true, passwordTemporal: password }
}
