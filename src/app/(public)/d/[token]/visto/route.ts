import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { esTokenValido } from '@/lib/dossier/token'

// ── Beacon de apertura del deck — POST /d/<token>/visto ──────────────────────
//
// El deck es caché de por vida (revalidate=false), así que la apertura NO se puede
// contar en el render: se contaría una vez y nunca más. En su lugar el cliente
// dispara este beacon una vez por sesión (dedupe con sessionStorage). Registra una
// fila en `dossier_aperturas` (mig. 177) para el acuse de lectura del dueño.
//
// SIN PII: no se guarda IP ni el user-agent crudo; solo `dispositivo` grueso
// (movil/escritorio) derivado aquí. Solo cuenta enlaces PUBLICADOS; la vista previa
// en borrador vive en /d/preview/… y ni siquiera llega a esta ruta.
//
// Runtime Node: usa el service_role (createAdminClient), que no va en el Edge.
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const limpio = (token ?? '').trim()
  // Respuesta 204 SIEMPRE (válido o no): un beacon no espera cuerpo y no debe
  // filtrar si un token existe. Nada que el cliente tenga que leer.
  if (!esTokenValido(limpio)) return new Response(null, { status: 204 })

  try {
    const db = createAdminClient()
    const { data: dos } = await db.from('dossiers').select('dossier_id, client_id')
      .eq('token', limpio).eq('estado', 'PUBLICADO').maybeSingle()
    if (dos) {
      const ua = req.headers.get('user-agent') ?? ''
      const dispositivo = /mobile|android|iphone|ipad|ipod/i.test(ua) ? 'movil' : 'escritorio'
      await db.from('dossier_aperturas').insert({
        client_id: dos.client_id, dossier_id: dos.dossier_id, dispositivo,
      })
    }
  } catch {
    // Fire-and-forget: si el registro falla, el inversor no debe notar nada.
  }
  return new Response(null, { status: 204 })
}
