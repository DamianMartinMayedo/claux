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

/**
 * El porqué de un movimiento, tipificado (mig. 154).
 *
 * El `motivo` libre se conserva como detalle: el tipo es para poder SUMAR (cuánto
 * se pierde en mermas al mes es dinero que el negocio no medía), el texto para
 * explicar el caso concreto.
 */
export const MOTIVOS_MOVIMIENTO = [
  'CONTEO', 'MERMA', 'ROTURA', 'CADUCADO', 'ROBO',
  'AUTOCONSUMO', 'REGALO', 'DEVOLUCION', 'PRODUCCION', 'ENTRADA_NO_REGISTRADA', 'OTRO',
] as const
export type MotivoTipo = typeof MOTIVOS_MOVIMIENTO[number]

export const MOTIVO_LABEL: Record<MotivoTipo, string> = {
  // «Error de registro» y no «Conteo físico» (mig. 159): el conteo es la OPERACIÓN,
  // no la causa. Como causa esto significa una sola cosa —el papel y el sistema no
  // coinciden por un apunte mal hecho, no por mercancía perdida— y confundir las dos
  // deja la merma sin poder sumarse, que es para lo que existe este vocabulario.
  CONTEO:                'Error de registro',
  MERMA:                 'Merma',
  ROTURA:                'Rotura',
  CADUCADO:              'Caducado',
  ROBO:                  'Robo o pérdida',
  AUTOCONSUMO:           'Consumo del negocio',
  REGALO:                'Regalo o cortesía',
  DEVOLUCION:            'Devolución',
  PRODUCCION:            'Producción',
  ENTRADA_NO_REGISTRADA: 'Entrada sin registrar',
  OTRO:                  'Otro',
}

export function esMotivoValido(v: string): v is MotivoTipo {
  return (MOTIVOS_MOVIMIENTO as readonly string[]).includes(v)
}

/**
 * Causas de un FALTANTE y de un SOBRANTE (mig. 159).
 *
 * Se separan porque la mitad no tienen sentido en el otro signo: nadie «rompe» algo
 * y acaba con más existencias, y una entrada sin registrar no explica que falte.
 * Ofrecer las once causas en los dos casos es garantizar que se elija una que miente.
 */
export const MOTIVOS_FALTANTE: readonly MotivoTipo[] = [
  'MERMA', 'ROTURA', 'CADUCADO', 'ROBO', 'AUTOCONSUMO', 'REGALO', 'CONTEO', 'OTRO',
]
export const MOTIVOS_SOBRANTE: readonly MotivoTipo[] = [
  'ENTRADA_NO_REGISTRADA', 'DEVOLUCION', 'PRODUCCION', 'CONTEO', 'OTRO',
]

/** ¿Puede esa causa explicar una diferencia de este signo? */
export function motivoValidoParaDiferencia(v: string, delta: number): v is MotivoTipo {
  const lista = delta < 0 ? MOTIVOS_FALTANTE : MOTIVOS_SOBRANTE
  return (lista as readonly string[]).includes(v)
}

// Traduce los códigos de RAISE EXCEPTION de las funciones plpgsql a mensajes
// amables. Si no reconoce el mensaje, lo devuelve tal cual.
export function traducirErrorInventario(msg: string): string {
  if (msg.includes('STOCK_NEGATIVO'))       return 'No hay stock suficiente en el almacén para este movimiento.'
  if (msg.includes('PRODUCTO_NO_FISICO'))   return 'Los servicios no tienen existencias: solo los productos mueven stock.'
  if (msg.includes('STOCK_CONSUMIDO'))      return 'No se puede anular: parte del stock de esta compra ya fue consumido. Ajusta el stock antes de anular.'
  if (msg.includes('COMPRA_NO_ENCONTRADA')) return 'Compra no encontrada.'
  if (msg.includes('COMPRA_NO_BORRADOR'))   return 'La compra ya está confirmada o anulada.'
  if (msg.includes('COMPRA_NO_CONFIRMADA')) return 'Solo se pueden anular compras confirmadas.'
  if (msg.includes('COMPRA_SIN_IMPORTE'))   return 'La compra no tiene importe.'
  if (msg.includes('COMPRA_PAGADA'))        return 'No se puede anular: la compra tiene pagos registrados. Anula primero el pago en Cuentas por pagar / Tesorería.'
  return msg
}

// Stock actual de un producto en un almacén concreto (0 si no hay fila).
// El client_id no es decorativo: `products.producto_id` NO tiene índice único en
// producción, así que una vía que escriba códigos sin pasar por generarProductoId()
// haría que esta lectura devolviera el stock de otro tenant.
export async function stockEnAlmacen(
  db: Db, client_id: string, producto_id: string, almacen_id: string,
): Promise<number> {
  const { data } = await db
    .from('stock_almacenes')
    .select('cantidad')
    .eq('client_id', client_id)
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
  /** Motivo tipificado (mig. 154). NULL en lo que no lo informa: no se adivina. */
  motivo_tipo?:       MotivoTipo | null
  origen?:            OrigenMovimiento
  referencia_id?:     string | null
  permitir_negativo?: boolean         // ventas de caja: la venta ya ocurrió, el stock puede quedar negativo
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
    p_permitir_negativo:  m.permitir_negativo ?? false,
    p_motivo_tipo:        m.motivo_tipo ?? null,
  })
  if (error) throw new Error(traducirErrorInventario(error.message))
  const r = (data ?? {}) as { movimiento_id: string; stock_global: number; stock_almacen: number }
  return {
    movimiento_id: r.movimiento_id,
    stock_global:  Number(r.stock_global),
    stock_almacen: Number(r.stock_almacen),
  }
}
