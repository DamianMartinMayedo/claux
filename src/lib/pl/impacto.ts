// ── El aviso ante una operación estructural ──────────────────────────────────
//
// F1.5 del plan. Cambiar el `rol_pl` de una categoría, o mover una subcategoría a
// otra raíz, no toca ni un apunte y aun así REESCRIBE el informe hacia atrás: el
// gasto de enero se calcula con el catálogo de hoy. El dueño no tiene forma de
// verlo antes, y después no tiene forma de saber por qué su margen cambió.
//
// Esto es barato porque `construirResultadoPL` es una función PURA sin I/O: se
// corre el motor dos veces —con el catálogo actual y con el cambio aplicado— y se
// resta. Ni una consulta más que las del informe que ya se pinta.
//
// ── Las dos operaciones no son iguales ───────────────────────────────────────
//
//   rol_pl    → NO se corrige. Reescribe la historia y se queda así. Aviso
//               DISUASORIO, con cifras.
//   parent_id → Se corrige solo, al siguiente período completo. Aviso informativo.

import {
  construirResultadosPorMoneda,
  type ApunteIngreso, type ApunteGasto, type CategoriaPL,
  type OpcionesPL, type ResultadoPL, type RolPL,
} from './estado'

/** Lo que el asistente propone hacerle al árbol. */
export type OperacionEstructural =
  | { tipo: 'rol';    categoria_id: string; rol: RolPL }
  | { tipo: 'mover';  categoria_id: string; parent_id: string | null }

export interface RenglonImpacto {
  /** Etiqueta del renglón del waterfall, tal y como se lee en el informe. */
  renglon: string
  antes:   number | null
  despues: number | null
  /** `null` cuando alguno de los dos lados no se pinta (P&L progresivo). */
  delta:   number | null
}

export interface ImpactoMoneda {
  moneda:    string
  renglones: RenglonImpacto[]
  /** true si algún renglón se mueve. Sin esto no hay nada que avisar. */
  cambia:    boolean
}

export interface ImpactoEstructural {
  /** Una por moneda con datos: en Cuba un mismo negocio lleva CUP y USD a la vez. */
  monedas: ImpactoMoneda[]
  cambia:  boolean
  /**
   * `true` cuando el cambio reescribe la historia sin marcha atrás (`rol_pl`).
   * Es lo que decide si el aviso disuade o solo informa.
   */
  irreversible: boolean
}

/**
 * Aplica la operación a una COPIA del catálogo.
 *
 * Nunca al original: el llamador sigue usando el suyo para pintar el informe de
 * verdad, y mutarlo por debajo haría que el «antes» y el «después» fueran el
 * mismo número — el aviso saldría siempre vacío y nadie se daría cuenta.
 */
export function catalogoCon(
  categorias: CategoriaPL[], op: OperacionEstructural,
): CategoriaPL[] {
  return categorias.map(c => {
    if (c.categoria_id !== op.categoria_id) return c
    return op.tipo === 'rol'
      ? { ...c, rol_pl: op.rol }
      : { ...c, parent_id: op.parent_id }
  })
}

/** Los renglones del waterfall, en el orden en que se leen. */
function renglonesDe(r: ResultadoPL): { renglon: string; valor: number | null }[] {
  return [
    { renglon: r.etiqueta_coste, valor: r.coste_ventas },
    { renglon: 'Margen bruto',        valor: r.margen_bruto },
    { renglon: 'Personal',            valor: r.personal },
    { renglon: 'Gastos operativos',   valor: r.operativos },
    { renglon: 'Otros',               valor: r.otros },
    { renglon: 'Resultado operativo', valor: r.resultado_operativo },
    { renglon: 'Resultado neto',      valor: r.neto },
  ]
}

/**
 * El impacto de una operación estructural sobre el P&L del período cargado.
 *
 * Los ingresos no se tocan nunca —una categoría de gasto no los mueve—, pero se
 * pasan igual porque el margen bruto y los porcentajes se calculan contra ellos.
 */
export function impactoDe(
  ingresos: ApunteIngreso[],
  gastos: ApunteGasto[],
  categorias: CategoriaPL[],
  opciones: OpcionesPL,
  op: OperacionEstructural,
): ImpactoEstructural {
  return impactoAgregado(ingresos, gastos, categorias, opciones, [op])
}

/**
 * El impacto AGREGADO de varias operaciones a la vez.
 *
 * Existe por el modo «mover hijas»: en un cliente real son dieciséis movimientos
 * en una sesión, y dieciséis avisos seguidos no se leen ninguno. Se aplica todo
 * sobre el mismo catálogo y se enseña UNA comparación al final.
 */
export function impactoAgregado(
  ingresos: ApunteIngreso[],
  gastos: ApunteGasto[],
  categorias: CategoriaPL[],
  opciones: OpcionesPL,
  ops: OperacionEstructural[],
): ImpactoEstructural {
  const finales = ops.reduce(catalogoCon, categorias)

  const antes   = construirResultadosPorMoneda(ingresos, gastos, categorias, opciones)
  const despues = construirResultadosPorMoneda(ingresos, gastos, finales, opciones)

  return {
    ...compararResultados(antes, despues),
    // Un lote no se corrige solo por ser un lote: basta con que UNA de las
    // operaciones toque el rol para que el conjunto reescriba la historia.
    irreversible: ops.some(o => o.tipo === 'rol'),
  }
}

function compararResultados(
  antes: ResultadoPL[], despues: ResultadoPL[],
): Omit<ImpactoEstructural, 'irreversible'> {
  const porMoneda = new Map<string, ImpactoMoneda>()

  const registrar = (r: ResultadoPL, lado: 'antes' | 'despues') => {
    let m = porMoneda.get(r.moneda)
    if (!m) {
      m = { moneda: r.moneda, renglones: [], cambia: false }
      porMoneda.set(r.moneda, m)
    }
    for (const { renglon, valor } of renglonesDe(r)) {
      let fila = m.renglones.find(x => x.renglon === renglon)
      if (!fila) {
        fila = { renglon, antes: null, despues: null, delta: null }
        m.renglones.push(fila)
      }
      fila[lado] = valor
    }
  }

  antes.forEach(r => registrar(r, 'antes'))
  despues.forEach(r => registrar(r, 'despues'))

  for (const m of porMoneda.values()) {
    for (const fila of m.renglones) {
      fila.delta = fila.antes === null || fila.despues === null
        ? null
        : Math.round((fila.despues - fila.antes) * 100) / 100
      if (fila.delta !== 0 || (fila.antes === null) !== (fila.despues === null)) m.cambia = true
    }
    m.renglones = m.renglones.filter(
      f => f.delta !== 0 || (f.antes === null) !== (f.despues === null),
    )
  }

  const monedas = [...porMoneda.values()]
    .filter(m => m.cambia)
    .sort((a, b) => a.moneda.localeCompare(b.moneda))

  return { monedas, cambia: monedas.length > 0 }
}
