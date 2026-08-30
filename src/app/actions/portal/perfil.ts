'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { leerSetting }       from '@/lib/settings'
import { suscripcionLabel, precioMensualEfectivo, monedaDelCliente, esSocioHoy, COLUMNAS_CONDICIONES } from '@/lib/billing'
import { cargarContextoLimites } from '@/lib/limites'
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
  /** Nombre humano del nivel («Empresa»), no la clave. */
  nivel_nombre:     string
  /** Socio CLAUX vigente hoy: bandera, no estado — convive con `estado`. */
  es_socio:         boolean
  socio_hasta:      string | null
  fecha_fin_gracia: string | null
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
      .select(`nombre_empresa, nombre_contacto, email_admin, estado, ${COLUMNAS_CONDICIONES}, ciclo_facturacion, fecha_expiracion, fecha_fin_gracia, nivel`)
      .eq('client_id', session.client_id)
      .single(),
    db.from('client_users')
      .select('nombre, rol, solo_lectura')
      .eq('user_id', session.user_id)
      .single(),
  ])

  if (!cliente || !usuario) return null

  // El nivel se enseña aquí y no solo en «Mi plan CLAUX»: esta ficha la ve todo
  // usuario del portal, y aquella solo el administrador de la empresa.
  const ctx         = await cargarContextoLimites(db, session.client_id)
  const precioMes   = precioMensualEfectivo(cliente)
  const descuento   = parseInt(await leerSetting('descuento_anual_pct', '10'), 10) || 0
  const suscripcion = suscripcionLabel(precioMes, cliente.ciclo_facturacion ?? 'mensual', descuento, monedaDelCliente(cliente))

  return {
    client_id:        session.client_id,
    nombre_empresa:   cliente.nombre_empresa,
    nombre_contacto:  cliente.nombre_contacto,
    email_admin:      cliente.email_admin,
    estado:           cliente.estado,
    suscripcion,
    fecha_expiracion: cliente.fecha_expiracion,
    nivel_nombre:     ctx.nivelNombre,
    es_socio:         esSocioHoy(cliente),
    socio_hasta:      cliente.socio_hasta ?? null,
    fecha_fin_gracia: cliente.fecha_fin_gracia ?? null,
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

  // Solo-lectura puede cambiar SU contraseña (es dato de acceso propio, no de negocio),
  // pero NO su nombre visible: ese es un dato que gestiona quien administra los usuarios.
  const puedeCambiarNombre = !session.solo_lectura

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

    // El nombre solo entra en el update si tiene permiso para cambiarlo.
    const cambios = puedeCambiarNombre
      ? { nombre, password_hash: nuevoHash, salt: nuevaSalt }
      : { password_hash: nuevoHash, salt: nuevaSalt }
    const { error } = await db
      .from('client_users')
      .update(cambios)
      .eq('user_id', session.user_id)
    if (error) return { ok: false, error: 'Error al actualizar.' }

  } else {
    // Sin cambio de contraseña, solo queda el nombre: si no puede tocarlo, no hay nada
    // que guardar y se le dice por qué (en vez de un «guardado» que no guardó nada).
    if (!puedeCambiarNombre)
      return { ok: false, error: 'Como usuario de solo lectura solo puedes cambiar tu contraseña, no tu nombre.' }
    const { error } = await db
      .from('client_users')
      .update({ nombre })
      .eq('user_id', session.user_id)
    if (error) return { ok: false, error: 'Error al actualizar.' }
  }

  revalidatePath('/portal/perfil')
  return { ok: true }
}
