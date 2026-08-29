import { cache } from 'react'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { devPortalSession } from '@/lib/dev-auth'
import { modulosDeUsuario, calcularAcceso, type AccesoModulos, type Permiso } from '@/lib/permisos'
import { verifyPortalToken, PORTAL_COOKIE, type PortalSession } from '@/lib/portal-auth'

// Implementación REAL de la sesión del portal y del acceso a módulos, memoizada
// por petición con `cache` de React. Vive aquí y no en `actions/portal/auth.ts`
// porque ese fichero es `'use server'` y solo puede exportar funciones async: un
// `const = cache(...)` allí rompe el build (memoria `use-server-solo-async`, mismo
// motivo que `lib/publico/catalogo-qr.ts`). `auth.ts` conserva sus funciones como
// envoltorios finos, así que los ~350 puntos de llamada del repo no cambian.
//
// Por qué hace falta: `getPortalSession` se llama 347 veces y `accesoModulosSession`
// la usan `requireModulo`/`puedeEditarModulo` (~380 usos), y CADA llamada repetía
// las mismas consultas. Medido antes de esto: cargar /portal/gastos leía
// `client_users` 9-10 veces, y `clients`, `empresas` y `usuario_modulo` 3 veces cada
// una; guardar un gasto costaba 7 idas y vueltas a Supabase antes de escribir nada.
// Con la lambda en Virginia y el usuario en Cuba, eso se nota (CONTEXTO §3). Es el
// mismo remedio que ya lleva el lado admin en `lib/roles-server.ts`.
//
// Es seguro porque `cache` memoiza POR PETICIÓN, no entre peticiones: un cambio de
// permisos lo ve la siguiente carga. Y dentro de una misma petición nadie lee la
// sesión, la modifica y la vuelve a leer — todas las acciones que escriben en
// `client_users`/`usuario_modulo` la leen una vez arriba y luego escriben.

export const leerSesionPortal = cache(async function leerSesionPortal(): Promise<PortalSession | null> {
  const jar   = await cookies()
  const token = jar.get(PORTAL_COOKIE)?.value
  // Bypass de login SOLO en desarrollo local: si no hay cookie y el bypass está activo
  // (doble candado), impersonamos el tenant indicado en DEV_PORTAL_CLIENT_ID.
  if (!token) return devPortalSession()
  const session = await verifyPortalToken(token)
  if (!session) return null
  // El JWT evita consultar la sesión en cada página, pero rol, estado y solo lectura
  // son permisos revocables. Una cookie antigua no puede conservar acceso después de
  // que el administrador cambie esos campos desde «Usuarios».
  if (session.imp) return session
  const { data: usuario } = await createAdminClient().from('client_users')
    .select('email, rol, solo_lectura, puede_importar, estado')
    .eq('user_id', session.user_id).eq('client_id', session.client_id).maybeSingle()
  if (!usuario || usuario.estado !== 'ACTIVO') return null
  return {
    ...session,
    email: usuario.email,
    rol: usuario.rol as PortalSession['rol'],
    solo_lectura: !!usuario.solo_lectura,
    puede_importar: !!usuario.puede_importar,
  }
})

// El argumento es el objeto de sesión, y `cache` memoiza por IDENTIDAD de los
// argumentos: como `leerSesionPortal` devuelve siempre la misma referencia dentro
// de una petición, todas las llamadas aciertan. Si alguna vez llegara un objeto
// distinto, simplemente no acierta y consulta como antes — nunca da un resultado
// que no corresponda a esa sesión.
export const leerAccesoModulos = cache(async function leerAccesoModulos(session: PortalSession): Promise<AccesoModulos> {
  const db = createAdminClient()
  const [{ data: cliente }, { data: usr }, overrides] = await Promise.all([
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single(),
    db.from('client_users').select('permiso_defecto').eq('user_id', session.user_id).maybeSingle(),
    modulosDeUsuario(db, session.user_id),
  ])
  const activos: string[] = Array.isArray(cliente?.modulos_activos)
    ? (cliente.modulos_activos as string[])
    : []
  const raw = usr?.permiso_defecto
  const defecto: Permiso = raw === 'sin_acceso' || raw === 'ver' || raw === 'editar' ? raw : 'editar'
  return calcularAcceso(session, activos, defecto, overrides)
})
