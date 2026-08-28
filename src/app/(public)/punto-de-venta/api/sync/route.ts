import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitOk } from '@/lib/rate-limit'
import { ingestarLote, getCajaToken, type CajaRow, type LotePayload } from '@/lib/caja/ingesta'

// Sincronización de ventas (dispositivo → Claux). Recibe el lote de tickets +
// cierres y lo ingesta de forma idempotente. Autenticación por sync_token.
//
// AQUÍ NO SE COMPRUEBA NINGÚN LÍMITE DE NIVEL, Y ES DELIBERADO. Lo que llega por
// esta ruta son ventas YA COBRADAS en el mostrador, offline, hace horas o días.
// Rechazar una por cupo no impide nada: el dinero ya entró y lo único que se
// consigue es que el negocio pierda el registro. Los límites se comprueban al
// CREAR (cajas, productos, empleados…), que es cuando todavía hay algo que
// decidir. Si alguien añade aquí una comprobación «por coherencia», rompe la
// caja offline. Plan: docs/planes/niveles-comerciales.md §15 riesgo 4.
export async function POST(req: NextRequest) {
  const token = getCajaToken(req)
  if (!token) return NextResponse.json({ ok: false, error: 'Sin token' }, { status: 401 })

  if (!(await rateLimitOk('caja_sync', 30, 60, token.slice(0, 12)))) {
    return NextResponse.json({ ok: false, error: 'Demasiadas peticiones' }, { status: 429 })
  }

  const db = createAdminClient()
  const { data: caja } = await db.from('cajas')
    .select('caja_id, client_id, empresa_id, nombre, almacen_id, cuentas_moneda, monedas_aceptadas, tipos_catalogo, activa')
    .eq('sync_token', token).maybeSingle()
  if (!caja || caja.activa === false) {
    return NextResponse.json({ ok: false, error: 'Caja no encontrada o desactivada' }, { status: 404 })
  }

  let body: LotePayload
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }

  const tickets = Array.isArray(body?.tickets) ? body.tickets : []
  if (tickets.length > 5000) {
    return NextResponse.json({ ok: false, error: 'Lote demasiado grande (máx. 5000 tickets)' }, { status: 413 })
  }

  const resultado = await ingestarLote(db, caja as CajaRow, body, 'ONLINE')
  return NextResponse.json({ ok: true, resultado })
}
