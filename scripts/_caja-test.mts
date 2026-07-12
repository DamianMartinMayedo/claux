// Verificación end-to-end del núcleo de ingesta de la caja (script temporal).
// Ejecuta el MISMO ingestarLote que usan los endpoints, contra la BD real, con
// la caja demo CAJ-DEMO0003. Comprueba: posteo de resúmenes + idempotencia.
//   node --env-file=.env.local --import tsx scripts/_caja-test.mts
import { createAdminClient } from '@/lib/supabase/admin'
import { ingestarLote, type CajaRow, type LotePayload } from '@/lib/caja/ingesta'

async function main() {
  const db = createAdminClient()
  const { data: caja, error } = await db.from('cajas')
    .select('caja_id, client_id, empresa_id, almacen_id, cuentas_moneda, monedas_aceptadas')
    .eq('caja_id', 'CAJ-DEMO0003').single()
  if (error || !caja) throw new Error('caja demo no encontrada: ' + (error?.message ?? ''))

  const now = new Date().toISOString()
  const antes = new Date(Date.now() - 3600e3).toISOString()
  const payload: LotePayload = {
    tickets: [
      { ticket_uuid: 'demo-tk-eur-0001', sesion_uuid: 'demo-ses-0001', fecha: now, moneda: 'EUR', total: 6, medio_pago: 'Efectivo',
        lineas: [{ producto_id: 'PRD-5EED0001', descripcion: 'Café en grano 1kg', cantidad: 2, precio_unitario: 3, subtotal: 6 }] },
      { ticket_uuid: 'demo-tk-cup-0001', sesion_uuid: 'demo-ses-0001', fecha: now, moneda: 'CUP', total: 400, medio_pago: 'Efectivo',
        lineas: [{ producto_id: 'PRD-5EED0001', descripcion: 'Café en grano 1kg', cantidad: 1, precio_unitario: 400, subtotal: 400 }] },
    ],
    cierres: [
      { sesion_uuid: 'demo-ses-0001', abierta_at: antes, cerrada_at: now, estado: 'CERRADA', fondo_inicial: {}, efectivo_contado: { EUR: 6, CUP: 400 } },
    ],
  }

  const stock0 = (await db.from('products').select('stock_actual').eq('producto_id', 'PRD-5EED0001').single()).data?.stock_actual
  console.log('stock Café inicial:', stock0)

  const r1 = await ingestarLote(db, caja as CajaRow, payload, 'ONLINE')
  console.log('RUN1:', JSON.stringify(r1))
  const r2 = await ingestarLote(db, caja as CajaRow, payload, 'ONLINE')
  console.log('RUN2 (idempotencia):', JSON.stringify(r2))

  const [tk, tes, inv, ses, prod] = await Promise.all([
    db.from('caja_tickets').select('ticket_uuid', { count: 'exact', head: true }).eq('sesion_uuid', 'demo-ses-0001'),
    db.from('movimientos_tesoreria').select('moneda, monto, cuenta_id, origen').eq('referencia_id', 'demo-ses-0001'),
    db.from('movimientos_inventario').select('producto_id, tipo, cantidad, origen, almacen_id').eq('referencia_id', 'demo-ses-0001'),
    db.from('caja_sesiones').select('estado, posted_at, tesoreria_movs, stock_movs, total_por_moneda').eq('sesion_uuid', 'demo-ses-0001').single(),
    db.from('products').select('stock_actual').eq('producto_id', 'PRD-5EED0001').single(),
  ])
  console.log('tickets en cierre:', tk.count)
  console.log('tesoreria (referencia=cierre):', JSON.stringify(tes.data))
  console.log('inventario (referencia=cierre):', JSON.stringify(inv.data))
  console.log('cierre:', JSON.stringify(ses.data))
  console.log('stock Café final:', prod.data?.stock_actual)
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR', e); process.exit(1) })
