import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { esTokenValido } from '@/lib/publico/token'
import { guardarSeleccion } from '@/lib/propuesta/seleccion'

// ── Lo que se marcó en el configurador — POST /p/<token>/seleccion ───────────
//
// El resultado de la reunión no se puede quedar en el navegador: es lo que
// precarga el presupuesto y lo que dice, cuando el enlace se compartió, qué tocó
// el cliente por su cuenta. Se guarda AL PULSAR EL BOTÓN, no en cada clic: una
// fila por decisión, no cien por indecisión.
//
// Autoriza el token, como el acuse de lectura: aquí no hay sesión. Y no valida
// más de lo que puede — no hay forma de saber si quien pulsa es el cliente o el
// comercial, ni hace falta: lo que se guarda es una lista de claves y un número
// que se recalcula en el servidor (`lib/propuesta/seleccion.ts`).
//
// Runtime Node: usa el service_role, que no va en el Edge.
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const limpio = (token ?? '').trim()
  // El mismo 400 para un token mal formado y para uno que no existe: distinguir
  // convertiría esta ruta en un oráculo para descubrir enlaces ajenos.
  if (!esTokenValido(limpio)) return Response.json({ ok: false }, { status: 400 })

  try {
    const body = await req.json()
    const db = createAdminClient()
    const { data: prop } = await db.from('propuestas')
      .select('id, nivel, moneda, presupuesto_id')
      .eq('token', limpio).eq('estado', 'PUBLICADA').maybeSingle()
    if (!prop) return Response.json({ ok: false }, { status: 400 })

    return Response.json(await guardarSeleccion(db, prop, body?.modulos))
  } catch {
    return Response.json({ ok: false }, { status: 400 })
  }
}
