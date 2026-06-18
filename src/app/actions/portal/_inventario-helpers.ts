// Helpers de stock compartidos por inventario.ts (movimientos manuales) y
// compras.ts (entradas al confirmar). NO es 'use server': son funciones
// internas que operan sobre un cliente admin ya creado, nunca se exponen al
// navegador (por eso pueden recibir el `db` como argumento).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type TipoMovimiento = 'ENTRADA' | 'SALIDA' | 'AJUSTE' | 'TRANSFERENCIA'
export type OrigenMovimiento = 'MANUAL' | 'COMPRA' | 'VENTA'

export function generarMovimientoInvId(): string {
  return `MVI-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

// Stock actual de un producto en un almacén concreto (0 si no hay fila).
export async function stockEnAlmacen(
  db: Db, producto_id: string, almacen_id: string,
): Promise<number> {
  const { data } = await db
    .from('stock_almacenes')
    .select('cantidad')
    .eq('producto_id', producto_id)
    .eq('almacen_id', almacen_id)
    .maybeSingle()
  return Number(data?.cantidad ?? 0)
}

// Suma un delta (puede ser negativo) al stock de (producto, almacén). Devuelve
// el nuevo valor. Upsert sobre la PK (producto_id, almacen_id).
async function sumarStockAlmacen(
  db: Db, client_id: string, producto_id: string, almacen_id: string, delta: number,
): Promise<number> {
  const actual = await stockEnAlmacen(db, producto_id, almacen_id)
  const nuevo  = actual + delta
  const { error } = await db.from('stock_almacenes').upsert({
    client_id, producto_id, almacen_id,
    cantidad:   nuevo,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'producto_id,almacen_id' })
  if (error) throw new Error(`stock_almacenes: ${error.message}`)
  return nuevo
}

// Suma un delta al stock global del producto (products.stock_actual).
async function sumarStockGlobal(
  db: Db, client_id: string, producto_id: string, delta: number,
): Promise<void> {
  const { data: prod } = await db
    .from('products')
    .select('stock_actual')
    .eq('producto_id', producto_id)
    .eq('client_id', client_id)
    .single()
  const nuevo = (Number(prod?.stock_actual ?? 0)) + delta
  const { error } = await db.from('products')
    .update({ stock_actual: nuevo, updated_at: new Date().toISOString() })
    .eq('producto_id', producto_id)
    .eq('client_id', client_id)
  if (error) throw new Error(`products.stock_actual: ${error.message}`)
}

export interface MovimientoInput {
  client_id:          string
  empresa_id:         string
  fecha:              string
  tipo:               TipoMovimiento
  producto_id:        string
  almacen_id:         string
  almacen_destino_id?: string | null
  cantidad:           number          // magnitud (>0); en AJUSTE puede ser negativa (delta)
  costo_unitario?:    number | null
  motivo?:            string | null
  origen?:            OrigenMovimiento
  referencia_id?:     string | null
}

// Registra un movimiento: inserta la fila en el ledger y aplica los deltas de
// stock (por almacén + global). NO valida disponibilidad — eso es del llamador.
//   ENTRADA       → +cantidad en almacen_id              · global +cantidad
//   SALIDA        → −cantidad en almacen_id              · global −cantidad
//   AJUSTE        → +cantidad (signed) en almacen_id     · global +cantidad
//   TRANSFERENCIA → −cantidad en almacen_id, +cantidad en almacen_destino_id · global 0
export async function aplicarMovimiento(db: Db, m: MovimientoInput): Promise<string> {
  const movimiento_id = generarMovimientoInvId()

  const { error: insErr } = await db.from('movimientos_inventario').insert({
    movimiento_id,
    client_id:          m.client_id,
    empresa_id:         m.empresa_id,
    fecha:              m.fecha,
    tipo:               m.tipo,
    producto_id:        m.producto_id,
    almacen_id:         m.almacen_id,
    almacen_destino_id: m.almacen_destino_id ?? null,
    cantidad:           m.cantidad,
    costo_unitario:     m.costo_unitario ?? null,
    motivo:             m.motivo ?? null,
    origen:             m.origen ?? 'MANUAL',
    referencia_id:      m.referencia_id ?? null,
  })
  if (insErr) throw new Error(`movimientos_inventario: ${insErr.message}`)

  if (m.tipo === 'TRANSFERENCIA') {
    await sumarStockAlmacen(db, m.client_id, m.producto_id, m.almacen_id, -m.cantidad)
    await sumarStockAlmacen(db, m.client_id, m.producto_id, m.almacen_destino_id as string, m.cantidad)
    // global: neto cero
  } else if (m.tipo === 'SALIDA') {
    await sumarStockAlmacen(db, m.client_id, m.producto_id, m.almacen_id, -m.cantidad)
    await sumarStockGlobal(db, m.client_id, m.producto_id, -m.cantidad)
  } else {
    // ENTRADA o AJUSTE: cantidad es el delta con su signo (ENTRADA siempre >0)
    await sumarStockAlmacen(db, m.client_id, m.producto_id, m.almacen_id, m.cantidad)
    await sumarStockGlobal(db, m.client_id, m.producto_id, m.cantidad)
  }

  return movimiento_id
}
