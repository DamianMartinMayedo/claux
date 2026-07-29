// Registro de adaptadores por entidad. Añadir una entidad = añadir su adaptador
// aquí. Tier 1 (maestros) + Tier 2 (stock, saldos de caja, histórico financiero).

import { adaptadorTerceros } from './terceros'
import { adaptadorProductos, adaptadorServicios } from './catalogo'
import { adaptadorPersonal } from './personal'
import { adaptadorStockInicial } from './stock'
import { adaptadorTesoreriaSaldo } from './tesoreria'
import { adaptadorGastos, adaptadorCobros } from './gastos'
import { adaptadorSuscripciones } from './suscripciones'
import { DESHACEDORES_CATEGORIA, ENT_CAT_GASTO, ENT_CAT_GASTO_REAC, ENT_CAT_PRODUCTO, ENT_CAT_PROD_REAC } from './categorias'
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
  suscripciones:   adaptadorSuscripciones,
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

/**
 * Etiquetas humanas de lo que un lote crea DE PASO (`fila_origen = 0`): el
 * proveedor que un gasto nombraba, la categoría que no existía, el cliente o
 * el servicio que una suscripción nombraba… Se enseñan en el resumen final
 * para que el operador sepa qué más tocó la importación, no solo cuántas
 * filas del archivo se escribieron.
 */
export const ETIQUETAS_AUXILIARES: Record<string, string> = {
  terceros:  'Clientes o proveedores nuevos',
  servicios: 'Servicios nuevos',
  [ENT_CAT_GASTO]:      'Categorías de gasto nuevas',
  [ENT_CAT_GASTO_REAC]: 'Categorías de gasto reactivadas',
  [ENT_CAT_PRODUCTO]:      'Categorías de catálogo nuevas',
  [ENT_CAT_PROD_REAC]:     'Categorías de catálogo reactivadas',
}
