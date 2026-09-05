import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { esTokenValido } from '@/lib/publico/token'

// ── Beacon de apertura — POST /p/<token>/visto ───────────────────────────────
//
// Copia del beacon del dossier (mig. 177 → aquí `propuesta_aperturas`, mig. 229)
// y por el mismo motivo: la página es caché de por vida, así que contar la
// apertura en el render la contaría una vez y nunca más. El cliente lo dispara
// una sola vez por sesión (dedupe con sessionStorage en `enviarAcuse`).
//
// Para qué sirve de verdad: que el comercial sepa si la propuesta se abrió antes
// de llamar. Es la diferencia entre «¿le echaste un vistazo?» y llamar a ciegas.
//
// SIN PII: ni IP ni user-agent crudo, solo `dispositivo` grueso deducido aquí.
// Solo cuenta enlaces PUBLICADOS; la vista previa vive en /p/preview/… y no pasa
// por esta ruta.
//
// Runtime Node: usa el service_role, que no va en el Edge.
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const limpio = (token ?? '').trim()
  // 204 SIEMPRE, válido o no: un beacon no espera cuerpo, y responder distinto
  // convertiría esta ruta en un oráculo para saber qué tokens existen.
  if (!esTokenValido(limpio)) return new Response(null, { status: 204 })

  try {
    const db = createAdminClient()
    const { data: prop } = await db.from('propuestas').select('id')
      .eq('token', limpio).eq('estado', 'PUBLICADA').maybeSingle()
    if (prop) {
      const ua = req.headers.get('user-agent') ?? ''
      const dispositivo = /mobile|android|iphone|ipad|ipod/i.test(ua) ? 'movil' : 'escritorio'
      await db.from('propuesta_aperturas').insert({ propuesta_id: prop.id, dispositivo })
    }
  } catch {
    // Fire-and-forget: si el registro falla, el cliente no debe notar nada.
  }
  return new Response(null, { status: 204 })
}
