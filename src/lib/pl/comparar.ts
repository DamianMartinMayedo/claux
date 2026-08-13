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
  | 'aparte'   // encabezado de lo que NO entra en el resultado (fase 2)

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
  bueno:     'subir' | 'bajar' | 'neutro'
  /** Solo en 'cat': las subcategorías, para poder plegarlas. */
  hijos?:    FilaPL[]
}

function fila(
  clave: string, nivel: NivelFila, concepto: string,
  monto: number, ingresos: number,
  anterior: number | null, bueno: 'subir' | 'bajar' | 'neutro',
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

  // Las Ventas se despliegan por LÍNEA DE NEGOCIO (fase 3), igual que una categoría
  // de gasto se despliega por subcategoría: es el mismo gesto y la misma jerarquía,
  // así que no hace falta un concepto visual nuevo. Colgando de «Ventas» y no al
  // lado, la suma de las partes es visiblemente el todo del que cuelgan.
  const ventas = fila('ventas', 'cat', 'Ventas (facturas)', r.ventas, ing, anteriorDe(ant?.ventas), 'subir', false)
  ventas.hijos = r.ventas_lineas.map(l => {
    // Por `linea_id`, no por nombre: renombrar «Comida» a «Cocina» entre dos
    // períodos no puede partir su serie en dos. El cajón se empareja con el cajón.
    const lAnt = ant?.ventas_lineas.find(x =>
      (l.linea_id && x.linea_id === l.linea_id) || (!l.linea_id && !x.linea_id))
    return fila(`linea:${l.linea_id ?? '__sin__'}`, 'hija', l.nombre, l.monto, ing, anteriorDe(lAnt?.monto), 'subir', false)
  })
  filas.push(ventas)

  // Y los cobros sin factura se despliegan por su CATEGORÍA, que es lo único que
  // llevan: no tienen líneas de producto que mirar. En un negocio de mostrador
  // este renglón es toda la facturación, y sin desplegar era un número mudo.
  const cobros = fila('cobros', 'cat', 'Cobros directos', r.cobros_directos, ing, anteriorDe(ant?.cobros_directos), 'subir', false)
  cobros.hijos = r.cobros_nodos.map(n => {
    const nAnt = ant?.cobros_nodos.find(x =>
      (n.categoria_id && x.categoria_id === n.categoria_id) || (!n.categoria_id && !x.categoria_id))
    return fila(`cobro:${n.categoria_id ?? '__sin__'}`, 'hija', n.nombre, n.monto, ing, anteriorDe(nAnt?.monto), 'subir', false)
  })
  filas.push(cobros)

  // Lo que entró sin ser lo que vendes (fase 4). A diferencia de los dos de
  // arriba, este renglón NO se pinta a cero: «Ventas» y «Cobros directos» son las
  // dos puertas por las que entra el dinero en cualquier negocio y su ausencia
  // dice algo, pero «Otros ingresos: 0» solo ocupa una fila para informar de que
  // no vendiste ninguna moto. Se pinta si hay dato en cualquiera de los dos
  // períodos — un renglón que desaparece de la comparación se lee como un cero
  // que nadie puso.
  if (Math.abs(r.otros_ingresos) > 0.005 || Math.abs(ant?.otros_ingresos ?? 0) > 0.005) {
    const otrosIng = fila('otros_ingresos', 'cat', 'Otros ingresos', r.otros_ingresos, ing, anteriorDe(ant?.otros_ingresos), 'subir', false)
    otrosIng.hijos = r.otros_ingresos_nodos.map(n => {
      const nAnt = ant?.otros_ingresos_nodos.find(x =>
        (n.categoria_id && x.categoria_id === n.categoria_id) || (!n.categoria_id && !x.categoria_id))
      return fila(`otroing:${n.categoria_id ?? '__sin__'}`, 'hija', n.nombre, n.monto, ing, anteriorDe(nAnt?.monto), 'subir', false)
    })
    filas.push(otrosIng)
  }

  const bloqueAnt = (rol: RolPL) => ant?.bloques.find(b => b.rol === rol)

  /**
   * Vuelca un bloque (encabezado + categorías + subcategorías) en `filas`.
   *
   * Lo usan el waterfall y la sección de fuera del resultado. Es el mismo dibujo
   * —un rol con sus categorías desplegables— y tenerlo dos veces garantizaba que
   * un día el emparejamiento por `categoria_id` se arreglase en una copia y no en
   * la otra.
   */
  const volcarBloque = (
    b: ResultadoPL['bloques'][number],
    bAnt: ResultadoPL['bloques'][number] | undefined,
    opciones: { signo: string; bueno: 'bajar' | 'neutro'; conPct: boolean },
  ) => {
    filas.push(fila(
      `rol:${b.rol}`, 'grupo', `${opciones.signo}${b.etiqueta}`,
      b.total, ing, anteriorDe(bAnt?.total), opciones.bueno, opciones.conPct,
    ))

    for (const n of b.nodos) {
      // Por `categoria_id`, NO por nombre: renombrar una categoría entre dos
      // períodos no puede romper su serie histórica. El nombre es el respaldo
      // para el cajón «Sin categoría», que no tiene id.
      const nAnt = bAnt?.nodos.find(x =>
        (n.categoria_id && x.categoria_id === n.categoria_id) ||
        (!n.categoria_id && !x.categoria_id))

      const f = fila(`cat:${n.categoria_id ?? n.nombre}`, 'cat', n.nombre, n.monto, ing, anteriorDe(nAnt?.monto), opciones.bueno, false)

      f.hijos = n.hijos.map(h => {
        const hAnt = nAnt?.hijos.find(x => x.categoria_id === h.categoria_id)
        return fila(`hija:${h.categoria_id}`, 'hija', h.nombre, h.monto, ing, anteriorDe(hAnt?.monto), opciones.bueno, false)
      })
      // Lo imputado a la madre y no a una hija. Sin este renglón las
      // subcategorías no suman su total y parece un error de cálculo.
      if (n.hijos.length > 0 && n.propio > 0.005) {
        f.hijos.push(fila(`hija:${n.categoria_id}:propio`, 'hija', 'Sin subcategoría', n.propio, ing, null, opciones.bueno, false))
      }
      filas.push(f)
    }
  }

  /**
   * Un subtotal, en el sitio exacto del waterfall donde su número es cierto.
   *
   * 🔴 La POSICIÓN es parte del dato. «= Resultado operativo» pintado debajo de
   * «− Otros» afirma que los otros ya están restados en él, y no lo están: el
   * dueño lee dos números que no cuadran entre sí y deja de fiarse del informe.
   * Por eso cada subtotal se emite ANTES del bloque que lo separa del neto, y no
   * al final del recorrido.
   *
   * Idempotente por clave, porque un subtotal puede tener dos bloques candidatos
   * debajo (el operativo va antes de «Otros» y, si no hay «Otros», antes del
   * impuesto) y solo se pinta una vez.
   */
  const emitidos = new Set<string>()
  const subtotal = (clave: string, concepto: string, monto: number | null, montoAnt: number | null | undefined) => {
    if (monto == null || emitidos.has(clave)) return
    emitidos.add(clave)
    filas.push(fila(clave, 'subtotal', concepto, monto, ing, anteriorDe(montoAnt ?? undefined), 'subir'))
  }

  for (const b of r.bloques) {
    // Los dos subtotales de abajo se cuelan ANTES de su bloque. Se comprueban los
    // dos roles porque cualquiera de los dos puede faltar en un negocio dado.
    if (b.rol === 'OTRO' || b.rol === 'IMPUESTO_UTILIDAD') {
      subtotal('resultado_operativo', '= Resultado operativo', r.resultado_operativo, ant?.resultado_operativo)
    }
    if (b.rol === 'IMPUESTO_UTILIDAD') {
      subtotal('resultado_antes_impuestos', '= Resultado antes de impuestos', r.resultado_antes_impuestos, ant?.resultado_antes_impuestos)
    }

    volcarBloque(b, bloqueAnt(b.rol), { signo: '− ', bueno: 'bajar', conPct: true })

    if (b.rol === 'COSTE_VENTAS') {
      subtotal('margen_bruto', '= Margen bruto', r.margen_bruto, ant?.margen_bruto)
    }
  }

  // Red de seguridad: hoy un subtotal no nulo implica que su bloque existe, así
  // que estas dos llamadas no pintan nada. Están porque el día que esa implicación
  // cambie, el renglón debe salir en un sitio raro, no desaparecer sin ruido.
  subtotal('resultado_operativo', '= Resultado operativo', r.resultado_operativo, ant?.resultado_operativo)
  subtotal('resultado_antes_impuestos', '= Resultado antes de impuestos', r.resultado_antes_impuestos, ant?.resultado_antes_impuestos)

  filas.push(fila('neto', 'final', '= Resultado neto', r.neto, ing, anteriorDe(ant?.neto), 'subir'))

  // ── Lo que movió dinero y no es resultado (fase 2) ──
  //
  // Va DEBAJO del resultado neto y con encabezado propio, no como un bloque más
  // del waterfall. La posición es la explicación: todo lo de arriba resta, esto
  // no resta nada. Si estuviera entre los gastos, el dueño leería «Inversiones
  // 40.000» en la misma columna que «Alquiler 3.000» y sacaría la conclusión que
  // la fase 2 existe para evitar.
  //
  // Sin % vertical y sin color de bueno/malo: invertir más no es peor que
  // invertir menos, y teñirlo de rojo sería opinar sobre una decisión del dueño.
  if (r.fuera.length > 0) {
    filas.push(fila(
      'fuera', 'aparte', 'No afecta a tu resultado', r.total_fuera, ing,
      anteriorDe(ant?.total_fuera), 'neutro', false,
    ))
    const fueraAnt = (rol: RolPL) => ant?.fuera.find(b => b.rol === rol)
    for (const b of r.fuera) {
      volcarBloque(b, fueraAnt(b.rol), { signo: '', bueno: 'neutro', conPct: false })
    }
  }

  return filas
}
