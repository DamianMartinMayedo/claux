'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'
import { hashPasswordPortal } from '@/lib/portal-auth'
import type { ModuloPerm } from '@/lib/permisos'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail, tipoEmailActivo } from '@/lib/email/enviar'

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

async function enviarCredencialesPortal(params: {
  tipo: 'bienvenida' | 'password_reset'
  email: string
  nombre: string | null
  password: string
  clientId: string
  empresa: string
}): Promise<boolean> {
  if (!(await tipoEmailActivo(params.tipo))) return false
  const plantilla = await renderPlantilla(params.tipo, {
    nombre: params.nombre || params.email,
    empresa: params.empresa,
    usuario: params.email,
    password_temporal: params.password,
    link_portal: `${(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://claux.es').replace(/\/$/, '')}/portal/login`,
  })
  const resultado = await enviarEmail({
    to: params.email,
    subject: plantilla.asunto,
    html: plantilla.html,
    tipo: params.tipo,
    clientId: params.clientId,
  })
  return resultado.ok
}

async function validarEmpresas(
  db: ReturnType<typeof createAdminClient>, clientId: string, ids: string[],
): Promise<string[] | null> {
  const unicas = [...new Set(ids.filter(Boolean))]
  if (!unicas.length) return []
  const { data } = await db.from('empresas').select('empresa_id')
    .eq('client_id', clientId).eq('estado', 'ACTIVO').in('empresa_id', unicas)
  const validas = new Set((data ?? []).map(e => e.empresa_id as string))
  return validas.size === unicas.length ? unicas : null
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
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error: errorBorrado } = await db.from('usuario_modulo').delete().eq('user_id', user_id)
  if (errorBorrado) return { ok: false, error: 'No se pudieron actualizar los permisos por módulo.' }
  if (rol !== 'usuario') return { ok: true }

  const { data: cliente } = await db.from('clients').select('modulos_activos')
    .eq('client_id', clientId).maybeSingle()
  const contratados = new Set(Array.isArray(cliente?.modulos_activos) ? cliente.modulos_activos as string[] : [])
  const modulos    = [...new Set((formData.getAll('modulos') as string[]).filter(m => contratados.has(m)))]
  const editables  = new Set(formData.getAll('modulos_editar') as string[])
  if (modulos.length === 0) return { ok: true }

  const { error } = await db.from('usuario_modulo').insert(
    modulos.map(clave => ({ user_id, modulo_clave: clave, puede_editar: editables.has(clave) })),
  )
  return error
    ? { ok: false, error: 'No se pudieron guardar los permisos por módulo.' }
    : { ok: true }
}

// ── Crear usuario ─────────────────────────────────────────────────────────────

export async function crearUsuario(formData: FormData): Promise<{
  ok: boolean
  passwordTemporal?: string
  emailEnviado?: boolean
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
  if (rol === 'usuario') {
    const empresasValidas = await validarEmpresas(db, session.client_id, empresas)
    if (!empresasValidas) {
      await db.from('client_users').delete().eq('user_id', user_id).eq('client_id', session.client_id)
      return { ok: false, error: 'Una de las empresas seleccionadas no pertenece a este negocio o está inactiva.' }
    }
    if (empresasValidas.length > 0) {
      const { error: errorEmpresas } = await db.from('empresa_usuario').insert(
        empresasValidas.map(empresa_id => ({ user_id, empresa_id }))
      )
      if (errorEmpresas) {
        await db.from('client_users').delete().eq('user_id', user_id).eq('client_id', session.client_id)
        return { ok: false, error: 'No se pudieron guardar las empresas del usuario.' }
      }
    }
  }

  // Permisos por módulo (solo rol usuario; sin filas = todos los contratados)
  const modulos = await sincronizarModulos(db, user_id, rol, formData, session.client_id)
  if (!modulos.ok) {
    await db.from('client_users').delete().eq('user_id', user_id).eq('client_id', session.client_id)
    return { ok: false, error: modulos.error }
  }

  const { data: cliente } = await db.from('clients').select('nombre_empresa')
    .eq('client_id', session.client_id).maybeSingle()
  const emailEnviado = await enviarCredencialesPortal({
    tipo: 'bienvenida', email, nombre, password, clientId: session.client_id,
    empresa: (cliente?.nombre_empresa as string) || 'tu negocio',
  })

  revalidatePath('/portal/usuarios')
  return { ok: true, passwordTemporal: password, emailEnviado }
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

  const empresasValidas = rol === 'usuario'
    ? await validarEmpresas(db, session.client_id, empresas)
    : []
  if (!empresasValidas) return { ok: false, error: 'Una de las empresas seleccionadas no pertenece a este negocio o está inactiva.' }

  const { error } = await db
    .from('client_users')
    .update({ nombre, rol, solo_lectura, estado })
    .eq('user_id', user_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al actualizar el usuario.' }

  // Sincronizar empresas asignadas (borrar todas y re-insertar)
  await db.from('empresa_usuario').delete().eq('user_id', user_id)
  if (rol === 'usuario' && empresasValidas.length > 0) {
    const { error: errorEmpresas } = await db.from('empresa_usuario').insert(
      empresasValidas.map(empresa_id => ({ user_id, empresa_id }))
    )
    if (errorEmpresas) return { ok: false, error: 'No se pudieron guardar las empresas del usuario.' }
  }

  // Sincronizar permisos por módulo (borrar + reinsertar; admin = sin filas = todos)
  const modulos = await sincronizarModulos(db, user_id, rol, formData, session.client_id)
  if (!modulos.ok) return { ok: false, error: modulos.error }

  revalidatePath('/portal/usuarios')
  return { ok: true }
}

// ── Resetear contraseña ───────────────────────────────────────────────────────

export async function resetearPassword(user_id: string): Promise<{
  ok: boolean
  passwordTemporal?: string
  emailEnviado?: boolean
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
  const { data: usr } = await db.from('client_users').select('email, nombre')
    .eq('user_id', user_id).eq('client_id', session.client_id).maybeSingle()
  const { data: cliente } = await db.from('clients').select('nombre_empresa')
    .eq('client_id', session.client_id).maybeSingle()
  const emailEnviado = usr
    ? await enviarCredencialesPortal({
        tipo: 'password_reset', email: usr.email, nombre: usr.nombre,
        password, clientId: session.client_id,
        empresa: (cliente?.nombre_empresa as string) || 'tu negocio',
      })
    : false
  return { ok: true, passwordTemporal: password, emailEnviado }
}
