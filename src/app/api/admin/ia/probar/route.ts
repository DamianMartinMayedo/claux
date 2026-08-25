import { NextRequest, NextResponse } from 'next/server'
import { requirePermiso } from '@/lib/admin-guard'
import { probarModelo } from '@/lib/ia/modelo'
import { PRUEBA_LENTA_MS, type EstadoPrueba, type PruebaModeloResp } from '@/lib/ia/prueba-tipos'

// Health-check de UN modelo, lanzado a mano desde /admin/ia.
//
// Es un ROUTE HANDLER y no una server action a propósito. Next despacha las server
// actions **de una en una por cliente** (docs de Next 16, «Sequential dispatch on the
// client»): mientras una prueba no devolvía, el activar/desactivar de otro modelo y
// el guardar la configuración se quedaban en cola detrás y el admin parecía colgado.
// Los propios docs mandan a un route handler para peticiones que no mutan nada, que
// es justo este caso: aquí solo se le pregunta al proveedor. Así se pueden probar
// varios modelos a la vez de verdad y ninguno bloquea al resto de la pantalla.

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // holgado sobre el techo de la prueba, para no cortarla antes

export async function GET(req: NextRequest): Promise<NextResponse<PruebaModeloResp>> {
  try {
    await requirePermiso('ia')
  } catch {
    return NextResponse.json({ ok: false, error: 'Acceso no autorizado.' }, { status: 403 })
  }

  const id = (req.nextUrl.searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ ok: false, error: 'Id de modelo vacío.' }, { status: 400 })

  const r = await probarModelo(id, PRUEBA_LENTA_MS)
  // Agotar el techo NO es lo mismo que estar caído: el modelo puede acabar contestando
  // (3.7 tardó 150 s). Pero para el cliente da igual, así que se pinta como «lento» y
  // no como muerto: ni te hace descartar un modelo que existe, ni te deja creer que
  // sirve para producción.
  const estado: EstadoPrueba = r.ok
    ? (r.respondio ? 'vivo' : 'mudo')
    : (r.agotado ? 'lento' : 'caido')

  return NextResponse.json({ ok: true, prueba: { estado, ms: r.ms, detalle: r.error } })
}
