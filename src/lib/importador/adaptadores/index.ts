// Registro de adaptadores por entidad. Añadir una entidad = añadir su adaptador
// aquí. Tier 1 (maestros) + Tier 2 (stock, saldos de caja, histórico financiero).

import { adaptadorTerceros } from './terceros'
import { adaptadorProductos, adaptadorServicios } from './catalogo'
import { adaptadorPersonal } from './personal'
import { adaptadorStockInicial } from './stock'
import { adaptadorTesoreriaSaldo } from './tesoreria'
import { adaptadorGastos, adaptadorCobros } from './gastos'
import type { Adaptador } from '../tipos'

export const ADAPTADORES: Record<string, Adaptador> = {
  terceros:        adaptadorTerceros,
  productos:       adaptadorProductos,
  servicios:       adaptadorServicios,
  personal:        adaptadorPersonal,
  stock_inicial:   adaptadorStockInicial,
  tesoreria_saldo: adaptadorTesoreriaSaldo,
  gastos:          adaptadorGastos,
  cobros:          adaptadorCobros,
}
