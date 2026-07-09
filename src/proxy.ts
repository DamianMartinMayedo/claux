import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isAuthBypassed } from '@/lib/dev-auth'
import {
  signPortalToken,
  verifyPortalToken,
  PORTAL_COOKIE,
  PORTAL_COOKIE_OPTS,
  RENEW_THROTTLE,
} from '@/lib/portal-auth'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { pathname } = request.nextUrl

  // Bypass de login SOLO en desarrollo local (doble candado en isAuthBypassed):
  // nunca mostramos el login; si se pide /admin/login, redirigimos al dashboard.
  if (isAuthBypassed()) {
    if (pathname === '/admin/login') {
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    }
    return response
  }

  // ── Portal: sesión deslizante ──────────────────────────────────────────────
  // No gatea (eso lo hace getPortalSession en las páginas/acciones); solo desliza
  // la ventana de 7 días re-emitiendo la cookie con el uso, como máximo 1 vez/día.
  if (pathname.startsWith('/portal')) {
    const token = request.cookies.get(PORTAL_COOKIE)?.value
    if (token) {
      const session = await verifyPortalToken(token)
      if (session && Math.floor(Date.now() / 1000) - session.iat >= RENEW_THROTTLE) {
        const nuevo = await signPortalToken({
          user_id:      session.user_id,
          client_id:    session.client_id,
          email:        session.email,
          rol:          session.rol,
          solo_lectura: session.solo_lectura,
        })
        response.cookies.set(PORTAL_COOKIE, nuevo, PORTAL_COOKIE_OPTS)
      }
    }
    return response
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Rutas del admin protegidas
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    if (!user) {
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }
  }

  // Si ya está logueado, no mostrar login
  if (pathname === '/admin/login' && user) {
    return NextResponse.redirect(new URL('/admin/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: ['/admin/:path*', '/portal/:path*'],
}
