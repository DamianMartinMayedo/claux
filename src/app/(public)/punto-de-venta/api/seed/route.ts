import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitOk } from '@/lib/rate-limit'
import { construirSeed, getCajaToken, type CajaRow } from '@/lib/caja/ingesta'

// Semilla de la caja offline (Claux → dispositivo). La app la pide al instalar
// y al pulsar "Actualizar productos". Autenticación por sync_token (opaco).
export async function GET(req: NextRequest) {
  const token = getCajaToken(req)
  if (!token) return NextResponse.json({ ok: false, error: 'Sin token' }, { status: 401 })

  if (!(await rateLimitOk('caja_seed', 60, 60, token.slice(0, 12)))) {
    return NextResponse.json({ ok: false, error: 'Demasiadas peticiones' }, { status: 429 })
  }

  const db = createAdminClient()
  const { data: caja } = await db.from('cajas')
    .select('caja_id, client_id, empresa_id, almacen_id, cuentas_moneda, monedas_aceptadas, tipos_catalogo, activa')
    .eq('sync_token', token).maybeSingle()
  if (!caja || caja.activa === false) {
    return NextResponse.json({ ok: false, error: 'Caja no encontrada o desactivada' }, { status: 404 })
  }

  const seed = await construirSeed(db, caja as CajaRow)
  return NextResponse.json({ ok: true, seed })
}
