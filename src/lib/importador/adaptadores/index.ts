// Registro de adaptadores por entidad. Añadir una entidad = añadir su adaptador
// aquí. Tier 1 (maestros) + Tier 2 (stock, saldos de caja, histórico financiero).

import { adaptadorTerceros } from './terceros'
import { adaptadorProductos, adaptadorServicios } from './catalogo'
import { adaptadorPersonal } from './personal'
import { adaptadorStockInicial } from './stock'
import { adaptadorTesoreriaSaldo } from './tesoreria'
import { adaptadorGastos, adaptadorCobros } from './gastos'
import { DESHACEDORES_CATEGORIA } from './categorias'
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

/**
 * Con qué deshacer cada traza del lote. Es lo de arriba MÁS las entidades que un
 * lote crea de paso sin ser importables: la categoría que un gasto nombraba, la
 * archivada que se reactivó (`registrarAuxiliar`). No van en `ADAPTADORES` porque
 * no se pueden elegir en el asistente —no tienen plantilla ni campos—, pero sí
 * tienen que desaparecer al deshacer.
 */
export const DESHACEDORES: Record<string, Pick<Adaptador, 'deshacer'>> = {
  ...ADAPTADORES,
  ...DESHACEDORES_CATEGORIA,
}
