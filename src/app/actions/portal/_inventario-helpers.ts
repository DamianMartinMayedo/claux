// Helpers de stock compartidos por inventario.ts (movimientos manuales),
// compras.ts y productos.ts. NO es 'use server': son funciones internas que
// operan sobre un cliente admin ya creado, nunca se exponen al navegador.
//
// La mutación de stock vive en funciones Postgres ATÓMICAS (migración 037):
// inv_aplicar_movimiento corre en una sola transacción y usa incrementos
// atómicos, así que aquí solo invocamos el RPC. stockEnAlmacen es una lectura
// para validaciones amables previas (best-effort); la garantía real la da la BD.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type TipoMovimiento = 'ENTRADA' | 'SALIDA' | 'AJUSTE' | 'TRANSFERENCIA'
export type OrigenMovimiento = 'MANUAL' | 'COMPRA' | 'VENTA'

// Traduce los códigos de RAISE EXCEPTION de las funciones plpgsql a mensajes
// amables. Si no reconoce el mensaje, lo devuelve tal cual.
export function traducirErrorInventario(msg: string): string {
  if (msg.includes('STOCK_NEGATIVO'))       return 'No hay stock suficiente en el almacén para este movimiento.'
  if (msg.includes('STOCK_CONSUMIDO'))      return 'No se puede anular: parte del stock de esta compra ya fue consumido. Ajusta el stock antes de anular.'
  if (msg.includes('COMPRA_NO_ENCONTRADA')) return 'Compra no encontrada.'
  if (msg.includes('COMPRA_NO_BORRADOR'))   return 'La compra ya está confirmada o anulada.'
  if (msg.includes('COMPRA_NO_CONFIRMADA')) return 'Solo se pueden anular compras confirmadas.'
  if (msg.includes('COMPRA_SIN_IMPORTE'))   return 'La compra no tiene importe.'
  if (msg.includes('COMPRA_PAGADA'))        return 'No se puede anular: la compra tiene pagos registrados. Anula primero el pago en Cuentas por pagar / Tesorería.'
  return msg
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

export interface MovimientoResult {
  movimiento_id: string
  stock_global:  number   // products.stock_actual resultante
  stock_almacen: number   // cantidad resultante en el almacén origen
}

// Registra un movimiento de forma atómica (ledger + stock por almacén + global)
// vía la función Postgres inv_aplicar_movimiento. Lanza si la BD señala error
// (p. ej. STOCK_NEGATIVO por una carrera de concurrencia).
export async function aplicarMovimiento(db: Db, m: MovimientoInput): Promise<MovimientoResult> {
  const { data, error } = await db.rpc('inv_aplicar_movimiento', {
    p_client_id:          m.client_id,
    p_empresa_id:         m.empresa_id,
    p_fecha:              m.fecha,
    p_tipo:               m.tipo,
    p_producto_id:        m.producto_id,
    p_almacen_id:         m.almacen_id,
    p_almacen_destino_id: m.almacen_destino_id ?? null,
    p_cantidad:           m.cantidad,
    p_costo_unitario:     m.costo_unitario ?? null,
    p_motivo:             m.motivo ?? null,
    p_origen:             m.origen ?? 'MANUAL',
    p_referencia_id:      m.referencia_id ?? null,
  })
  if (error) throw new Error(traducirErrorInventario(error.message))
  const r = (data ?? {}) as { movimiento_id: string; stock_global: number; stock_almacen: number }
  return {
    movimiento_id: r.movimiento_id,
    stock_global:  Number(r.stock_global),
    stock_almacen: Number(r.stock_almacen),
  }
}
