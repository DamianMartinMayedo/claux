'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { requirePermiso } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActividad } from '@/lib/audit'
import { getPortalSession } from '@/app/actions/portal/auth'
import {
  signPortalToken,
  PORTAL_COOKIE,
  PORTAL_COOKIE_OPTS,
} from '@/lib/portal-auth'

// Duración corta de la sesión de configuración (impersonación). El JWT del
// portal es stateless (no revocable antes de expirar), así que el TTL corto es
// la mitigación: 4 horas bastan para una sesión de configuración.
const IMP_TTL_SEC = 60 * 60 * 4

/**
 * Entra al portal del cliente como sesión de CONFIGURACIÓN (impersonación).
 * No crea ninguna credencial: firma un JWT de portal para el usuario admin del
 * tenant y lo guarda en la cookie `claux_portal`. La sesión de admin (Supabase
 * Auth) sigue viva en paralelo (cookies distintas), así que "Salir" vuelve al
 * admin sin re-login. Marcada con `imp` para el banner y para no contar en las
 * métricas de uso del cliente.
 */
export async function entrarComoCliente(
  clientId: string,
): Promise<{ error?: string }> {
  // Gating: quien gestiona clientes puede impersonar (acción potente, ya implica
  // control total del tenant: crear usuarios, regenerar contraseñas, etc.).
  const ctx = await requirePermiso('clientes')

  const db = createAdminClient()
  // Usuario admin del tenant, para heredar acceso a todos los módulos contratados.
  // Preferimos el primer usuario (U001) y, en su defecto, cualquier admin activo.
  const { data: usuario } = await db
    .from('client_users')
    .select('user_id, client_id, email, rol')
    .eq('client_id', clientId)
    .eq('rol', 'admin_empresa')
    .eq('estado', 'ACTIVO')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!usuario) {
    return { error: 'Este cliente no tiene un usuario administrador activo al que entrar.' }
  }

  const token = await signPortalToken(
    {
      user_id:      usuario.user_id,
      client_id:    usuario.client_id,
      email:        usuario.email,
      rol:          'admin_empresa',
      solo_lectura: false,
      imp:          { admin_email: ctx.email },
    },
    IMP_TTL_SEC,
  )

  const jar = await cookies()
  jar.set(PORTAL_COOKIE, token, { ...PORTAL_COOKIE_OPTS, maxAge: IMP_TTL_SEC })

  const supabase = await createClient()
  await logActividad(supabase, {
    user_email:  ctx.email,
    entity:      'cliente',
    entity_id:   clientId,
    action:      'impersonar',
    description: `Entró al portal de ${clientId} para configuración`,
  })

  redirect('/portal/dashboard')
}

/**
 * Sale de la sesión de configuración: borra la cookie del portal (mismo path que
 * al crearla, si no el navegador no la elimina) y vuelve al detalle del cliente.
 */
export async function salirDeImpersonacion(): Promise<void> {
  const session = await getPortalSession()
  const clientId = session?.client_id ?? null

  const jar = await cookies()
  jar.set(PORTAL_COOKIE, '', { ...PORTAL_COOKIE_OPTS, maxAge: 0 })

  redirect(clientId ? `/admin/clientes/${clientId}` : '/admin/clientes')
}
