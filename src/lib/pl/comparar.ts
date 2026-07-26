// ── El estado de resultados como FILAS comparables — lógica pura ────────────
//
// Aplana el waterfall (que es un árbol: bloques por rol → categorías → sub-
// categorías) en la lista de renglones que se pinta, y empareja cada uno con su
// equivalente del período anterior.
//
// POR QUÉ VIVE AQUÍ Y NO EN LA VISTA: lo consumen la tabla de la pantalla, el PDF
// y el Excel que se le manda al asesor. Emparejar «Compras de julio» con «Compras
// de junio» tiene reglas —por `categoria_id`, no por nombre, porque el dueño puede
// renombrar una categoría entre dos períodos— y tres copias de esa regla son tres
// informes que un día dirán cosas distintas del mismo negocio.
//
// LA COMPARACIÓN ES POR RENGLÓN, no de totales: «los ingresos suben un 56% pero el
// coste de ventas sube un 70%» es la frase que explica por qué cae el margen. Con
// solo los tres totales, esa frase no se puede decir.

import { variacionPct, pctSobre, type ResultadoPL, type RolPL } from './estado'

/** Papel del renglón en la lectura del informe (decide su peso visual). */
export type NivelFila =
  | 'grupo'    // Ingresos, − Coste de ventas, − Gastos de personal…
  | 'cat'      // una categoría dentro de un grupo
  | 'hija'     // una subcategoría
  | 'subtotal' // = Margen bruto, = Resultado operativo
  | 'final'    // = Resultado neto

export interface FilaPL {
  /** Identidad estable para emparejar entre períodos y para las `key` de React. */
  clave:     string
  nivel:     NivelFila
  concepto:  string
  monto:     number
  /** % vertical sobre los ingresos; null donde no aporta (las subcategorías). */
  pct:       number | null
  /** Mismo renglón del período anterior; null si no se compara o no existía. */
  anterior:  number | null
  /** Variación relativa; null si el anterior era cero (∞ no informa). */
  variacion: number | null
  /**
   * Si el renglón sube, ¿es buena noticia? Un ingreso que sube y un gasto que
   * sube pintan distinto, y deducirlo del signo sería teñir de verde una subida
   * de costes.
   */
  bueno:     'subir' | 'bajar'
  /** Solo en 'cat': las subcategorías, para poder plegarlas. */
  hijos?:    FilaPL[]
}

function fila(
  clave: string, nivel: NivelFila, concepto: string,
  monto: number, ingresos: number,
  anterior: number | null, bueno: 'subir' | 'bajar',
  conPct = true,
): FilaPL {
  return {
    clave, nivel, concepto, monto,
    pct:       conPct ? pctSobre(monto, ingresos) : null,
    anterior,
    variacion: anterior == null ? null : variacionPct(monto, anterior),
    bueno,
  }
}

/**
 * Construye los renglones del informe de una moneda, ya emparejados.
 * `ant` a null → no se compara y todas las columnas de comparación salen null
 * (la vista y el Excel simplemente no pintan esas columnas).
 */
export function construirFilasPL(r: ResultadoPL, ant: ResultadoPL | null): FilaPL[] {
  const ing = r.total_ingresos
  const filas: FilaPL[] = []

  // Un renglón que no existía en el período anterior vale 0, no «sin dato»: la
  // categoría nueva creció desde cero, y eso es exactamente lo que hay que ver.
  // Solo cuando NO se compara en absoluto la columna es null.
  const anteriorDe = (v: number | undefined) => (ant ? (v ?? 0) : null)

  filas.push(fila('ingresos', 'grupo', 'Ingresos', r.total_ingresos, ing, anteriorDe(ant?.total_ingresos), 'subir'))
  filas.push(fila('ventas',  'cat', 'Ventas (facturas)', r.ventas,          ing, anteriorDe(ant?.ventas),          'subir', false))
  filas.push(fila('cobros',  'cat', 'Cobros directos',   r.cobros_directos, ing, anteriorDe(ant?.cobros_directos), 'subir', false))

  const bloqueAnt = (rol: RolPL) => ant?.bloques.find(b => b.rol === rol)

  for (const b of r.bloques) {
    const bAnt = bloqueAnt(b.rol)
    filas.push(fila(`rol:${b.rol}`, 'grupo', `− ${b.etiqueta}`, b.total, ing, anteriorDe(bAnt?.total), 'bajar'))

    for (const n of b.nodos) {
      // Por `categoria_id`, NO por nombre: renombrar una categoría entre dos
      // períodos no puede romper su serie histórica. El nombre es el respaldo
      // para el cajón «Sin categoría», que no tiene id.
      const nAnt = bAnt?.nodos.find(x =>
        (n.categoria_id && x.categoria_id === n.categoria_id) ||
        (!n.categoria_id && !x.categoria_id))

      const f = fila(`cat:${n.categoria_id ?? n.nombre}`, 'cat', n.nombre, n.monto, ing, anteriorDe(nAnt?.monto), 'bajar', false)

      f.hijos = n.hijos.map(h => {
        const hAnt = nAnt?.hijos.find(x => x.categoria_id === h.categoria_id)
        return fila(`hija:${h.categoria_id}`, 'hija', h.nombre, h.monto, ing, anteriorDe(hAnt?.monto), 'bajar', false)
      })
      // Lo imputado a la madre y no a una hija. Sin este renglón las
      // subcategorías no suman su total y parece un error de cálculo.
      if (n.hijos.length > 0 && n.propio > 0.005) {
        f.hijos.push(fila(`hija:${n.categoria_id}:propio`, 'hija', 'Sin subcategoría', n.propio, ing, null, 'bajar', false))
      }
      filas.push(f)
    }

    if (b.rol === 'COSTE_VENTAS' && r.margen_bruto != null) {
      filas.push(fila('margen_bruto', 'subtotal', '= Margen bruto', r.margen_bruto, ing, anteriorDe(ant?.margen_bruto ?? undefined), 'subir'))
    }
  }

  if (r.resultado_operativo != null) {
    filas.push(fila('resultado_operativo', 'subtotal', '= Resultado operativo', r.resultado_operativo, ing, anteriorDe(ant?.resultado_operativo ?? undefined), 'subir'))
  }

  filas.push(fila('neto', 'final', '= Resultado neto', r.neto, ing, anteriorDe(ant?.neto), 'subir'))

  return filas
}
