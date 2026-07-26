// ── Motor del estado de resultados (P&L) — lógica PURA, sin I/O ─────────────
//
// Recibe apuntes ya normalizados (ingresos y gastos por moneda y mes) más el
// catálogo de categorías, y devuelve el estado de resultados estructurado.
// Vive aquí, fuera de los ficheros `'use server'`, porque lo consumen el informe
// en vivo del portal y —congelado— el dossier: en un módulo de server actions
// toda exportación es un endpoint HTTP, y esto no lo es.
//
// ── EL PRINCIPIO QUE LO GOBIERNA: P&L PROGRESIVO ──────────────────────────────
//
//  1. Un renglón sin fuente de datos NO se pinta. Ni a cero, ni con guion, ni en
//     gris con candado: desaparece. Un P&L rico sobre datos pobres se ve PEOR que
//     uno simple — «Coste de ventas: 0 · Margen bruto: 0%» no parece profesional,
//     parece roto. Por eso los subtotales del waterfall son `number | null` y no
//     `number`: `null` significa «este negocio no tiene con qué calcularlo».
//  2. El esqueleto mínimo cuadra solo: Ingresos − Gastos = Resultado. Todo lo
//     demás son subtotales que se INSERTAN sin romper esa identidad.
//  3. La etiqueta dice la verdad sobre el dato: sin `inventario` no hay variación
//     de existencias, así que el renglón se rotula «Coste de compras del período»,
//     que es lo que de verdad es.

// ── Vocabulario ──────────────────────────────────────────────────────────────

export const ROLES_PL = ['COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'OTRO'] as const
export type RolPL = (typeof ROLES_PL)[number]

/** Orden de aparición en el informe (es el orden del waterfall, no alfabético). */
const ORDEN_ROL: RolPL[] = ['COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'OTRO']

export const ROL_PL_LABEL: Record<RolPL, string> = {
  COSTE_VENTAS: 'Coste de ventas',
  PERSONAL:     'Gastos de personal',
  OPERATIVO:    'Gastos operativos',
  OTRO:         'Otros (impuestos y financieros)',
}

/** Ayuda del selector de clasificación (pestaña Categorías y paso del dossier). */
export const ROL_PL_AYUDA: Record<RolPL, string> = {
  COSTE_VENTAS: 'Lo que te cuesta lo que vendes: mercancía, materia prima, el proveedor del servicio.',
  PERSONAL:     'Sueldos, seguridad social y todo lo que cuesta tu gente.',
  OPERATIVO:    'Lo que cuesta tener el negocio abierto: alquiler, luz, transporte, publicidad.',
  OTRO:         'Impuestos, comisiones e intereses. Fuera del resultado operativo para no distorsionarlo.',
}

export function esRolPL(v: unknown): v is RolPL {
  return typeof v === 'string' && (ROLES_PL as readonly string[]).includes(v)
}

// ── Entradas ─────────────────────────────────────────────────────────────────

export interface CategoriaPL {
  categoria_id: string
  nombre:       string
  /** null = categoría raíz. Una subcategoría HEREDA el rol de su madre. */
  parent_id:    string | null
  rol_pl:       RolPL
}

/** Un ingreso ya normalizado. `mes` en formato 'YYYY-MM'. */
export interface ApunteIngreso {
  moneda: string
  monto:  number
  mes:    string
  fuente: 'VENTA' | 'COBRO'
}

/** Un gasto ya normalizado. `categoria_id` manda; `categoria` es el respaldo. */
export interface ApunteGasto {
  moneda:       string
  monto:        number
  mes:          string
  categoria_id: string | null
  categoria:    string | null
}

export interface OpcionesPL {
  /**
   * Con `inventario` hay variación de existencias y el renglón es coste de
   * ventas de verdad. Sin él es el coste de las COMPRAS del período, y se rotula
   * así: la regla 3 de arriba, aplicada.
   */
  hayInventario: boolean
}

// ── Salida ───────────────────────────────────────────────────────────────────

export interface SubcategoriaPL {
  categoria_id: string
  nombre:       string
  monto:        number
}

export interface NodoGastoPL {
  /** null solo en el cajón «Sin categoría». */
  categoria_id: string | null
  nombre:       string
  /** Incluye lo de sus subcategorías (rollup). */
  monto:        number
  /** Vacío si nadie usó subcategorías: la fila no se despliega. */
  hijos:        SubcategoriaPL[]
  /** Parte del total que NO cuelga de ninguna subcategoría (imputada al padre). */
  propio:       number
}

export interface BloqueRolPL {
  rol:      RolPL
  etiqueta: string
  total:    number
  /** % vertical sobre los ingresos del período (0 si no hay ingresos). */
  pct:      number
  nodos:    NodoGastoPL[]
}

export interface MesPL {
  mes:      string
  ingresos: number
  gastos:   number
  neto:     number
}

export interface ResultadoPL {
  moneda:          string
  ventas:          number
  cobros_directos: number
  total_ingresos:  number
  total_gastos:    number
  neto:            number

  /** Bloques de gasto CON dato, en orden de waterfall. Los vacíos no aparecen. */
  bloques: BloqueRolPL[]

  // ── Subtotales del waterfall ──
  // `null` = este negocio no tiene esa fuente de datos → el renglón NO se pinta.
  coste_ventas:        number | null
  margen_bruto:        number | null
  margen_bruto_pct:    number | null
  personal:            number | null
  operativos:          number | null
  otros:               number | null
  /** Solo se calcula si hay «Otros»; sin ellos sería idéntico al neto y sobra. */
  resultado_operativo: number | null

  /** % del neto sobre ingresos. */
  margen_neto_pct: number

  /** Etiqueta honesta del renglón de coste (ver OpcionesPL.hayInventario). */
  etiqueta_coste: string

  /** Serie mensual del período, ordenada. Vacía si el período es de un solo mes. */
  evolucion: MesPL[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const EPS = 0.005

/** Porcentaje sobre ingresos; 0 cuando no hay base sobre la que calcularlo. */
export function pctSobre(parte: number, total: number): number {
  return Math.abs(total) > EPS ? round2((parte / total) * 100) : 0
}

/** Variación relativa entre dos períodos; null si el anterior era cero (∞ no informa). */
export function variacionPct(actual: number, anterior: number): number | null {
  if (Math.abs(anterior) <= EPS) return null
  return round2(((actual - anterior) / Math.abs(anterior)) * 100)
}

interface IndiceCategorias {
  /** categoria_id → su categoría raíz (ella misma si ya lo es). */
  raizDe:  Map<string, CategoriaPL>
  /** categoria_id → la propia fila. */
  porId:   Map<string, CategoriaPL>
  /** nombre (normalizado) de raíz → fila, para el respaldo por texto. */
  porNombre: Map<string, CategoriaPL>
}

const norm = (s: string) => s.trim().toLowerCase()

export function indexarCategorias(categorias: CategoriaPL[]): IndiceCategorias {
  const porId = new Map<string, CategoriaPL>()
  for (const c of categorias) porId.set(c.categoria_id, c)

  const raizDe = new Map<string, CategoriaPL>()
  for (const c of categorias) {
    let nodo = c
    // Solo dos niveles por diseño (mig. 126), pero el bucle acotado protege de
    // un ciclo en datos sucios: sin tope, una fila que se apunte a sí misma
    // colgaría el informe entero.
    for (let i = 0; i < 4 && nodo.parent_id; i++) {
      const padre = porId.get(nodo.parent_id)
      if (!padre || padre.categoria_id === nodo.categoria_id) break
      nodo = padre
    }
    raizDe.set(c.categoria_id, nodo)
  }

  const porNombre = new Map<string, CategoriaPL>()
  for (const c of categorias) if (!c.parent_id) porNombre.set(norm(c.nombre), c)

  return { raizDe, porId, porNombre }
}

// ── Motor ────────────────────────────────────────────────────────────────────

/**
 * Construye el estado de resultados de UNA moneda.
 *
 * Los gastos se agrupan por `categoria_id` —no por el texto `categoria`—, con
 * respaldo al nombre cuando la FK falta. Agrupar por texto era lo que hacía
 * INVISIBLE la jerarquía de subcategorías (mig. 126): las hijas salían como
 * hermanas planas de sus madres, el mismo destrozo visual que ya se corrigió en
 * la tabla de Categorías, reproducido dentro del informe.
 */
export function construirResultadoPL(
  moneda: string,
  ingresos: ApunteIngreso[],
  gastos: ApunteGasto[],
  categorias: CategoriaPL[],
  opciones: OpcionesPL,
): ResultadoPL {
  const idx = indexarCategorias(categorias)

  // ── Ingresos ──
  let ventas = 0, cobros_directos = 0
  const mesIngresos = new Map<string, number>()
  for (const i of ingresos) {
    const m = Number(i.monto) || 0
    if (i.fuente === 'VENTA') ventas += m; else cobros_directos += m
    if (i.mes) mesIngresos.set(i.mes, (mesIngresos.get(i.mes) ?? 0) + m)
  }
  const total_ingresos = round2(ventas + cobros_directos)

  // ── Gastos: acumulados por raíz, con detalle de subcategoría ──
  interface Acc { rol: RolPL; nombre: string; propio: number; hijos: Map<string, { nombre: string; monto: number }> }
  const porRaiz = new Map<string, Acc>()   // clave: categoria_id de la raíz | '__sin__'
  const mesGastos = new Map<string, number>()
  let total_gastos = 0

  for (const g of gastos) {
    const monto = Number(g.monto) || 0
    total_gastos += monto
    if (g.mes) mesGastos.set(g.mes, (mesGastos.get(g.mes) ?? 0) + monto)

    // Resolución: FK → nombre → cajón «Sin categoría».
    const fila = (g.categoria_id ? idx.porId.get(g.categoria_id) : undefined)
      ?? (g.categoria ? idx.porNombre.get(norm(g.categoria)) : undefined)

    if (!fila) {
      const acc = porRaiz.get('__sin__')
        ?? { rol: 'OPERATIVO' as RolPL, nombre: g.categoria?.trim() || 'Sin categoría', propio: 0, hijos: new Map() }
      // Varios textos sueltos distintos caen en el mismo cajón; el nombre del
      // primero valdría por todos, así que se generaliza en cuanto hay más de uno.
      if (porRaiz.has('__sin__') && acc.nombre !== (g.categoria?.trim() || 'Sin categoría')) acc.nombre = 'Sin categoría'
      acc.propio += monto
      porRaiz.set('__sin__', acc)
      continue
    }

    const raiz = idx.raizDe.get(fila.categoria_id) ?? fila
    const acc = porRaiz.get(raiz.categoria_id)
      ?? { rol: raiz.rol_pl, nombre: raiz.nombre, propio: 0, hijos: new Map<string, { nombre: string; monto: number }>() }

    if (fila.categoria_id === raiz.categoria_id) {
      acc.propio += monto
    } else {
      const h = acc.hijos.get(fila.categoria_id) ?? { nombre: fila.nombre, monto: 0 }
      h.monto += monto
      acc.hijos.set(fila.categoria_id, h)
    }
    porRaiz.set(raiz.categoria_id, acc)
  }
  total_gastos = round2(total_gastos)

  // ── Bloques por rol (solo los que tienen dato) ──
  const bloques: BloqueRolPL[] = []
  for (const rol of ORDEN_ROL) {
    const nodos: NodoGastoPL[] = []
    let total = 0
    for (const [clave, acc] of porRaiz) {
      if (acc.rol !== rol) continue
      const hijos = [...acc.hijos.entries()]
        .map(([categoria_id, h]) => ({ categoria_id, nombre: h.nombre, monto: round2(h.monto) }))
        .sort((a, b) => b.monto - a.monto)
      const monto = round2(acc.propio + hijos.reduce((s, h) => s + h.monto, 0))
      if (Math.abs(monto) <= EPS && hijos.length === 0) continue
      total += monto
      nodos.push({
        categoria_id: clave === '__sin__' ? null : clave,
        nombre: acc.nombre,
        monto,
        propio: round2(acc.propio),
        hijos,
      })
    }
    if (!nodos.length) continue
    nodos.sort((a, b) => b.monto - a.monto)
    bloques.push({
      rol,
      etiqueta: rol === 'COSTE_VENTAS' && !opciones.hayInventario
        ? 'Coste de compras del período'
        : ROL_PL_LABEL[rol],
      total: round2(total),
      pct: pctSobre(total, total_ingresos),
      nodos,
    })
  }

  const totalDe = (rol: RolPL): number | null => {
    const b = bloques.find(x => x.rol === rol)
    return b ? b.total : null
  }

  const coste_ventas = totalDe('COSTE_VENTAS')
  const personal     = totalDe('PERSONAL')
  const operativos   = totalDe('OPERATIVO')
  const otros        = totalDe('OTRO')

  // El margen bruto solo informa si queda ALGO por restar debajo. Si el coste de
  // ventas es el único bloque de gasto, margen bruto y resultado neto son el mismo
  // número, y pintarlos los dos —con el mismo importe y el mismo %— no da
  // profundidad: hace dudar de la aritmética del informe. Misma regla que el
  // resultado operativo, unas líneas más abajo.
  const hayGastoBajoElMargen = personal != null || operativos != null || otros != null
  const margen_bruto = (coste_ventas == null || !hayGastoBajoElMargen)
    ? null
    : round2(total_ingresos - coste_ventas)
  // El resultado operativo solo aporta información si hay un renglón DEBAJO que lo
  // separe del neto. Sin «Otros» los dos números son el mismo y pintar los dos es
  // ruido que hace dudar de la aritmética.
  const resultado_operativo = otros == null
    ? null
    : round2(total_ingresos - (coste_ventas ?? 0) - (personal ?? 0) - (operativos ?? 0))

  const neto = round2(total_ingresos - total_gastos)

  // ── Evolución mensual ──
  const meses = [...new Set([...mesIngresos.keys(), ...mesGastos.keys()])].sort()
  const evolucion: MesPL[] = meses.map(mes => {
    const ing = round2(mesIngresos.get(mes) ?? 0)
    const gas = round2(mesGastos.get(mes) ?? 0)
    return { mes, ingresos: ing, gastos: gas, neto: round2(ing - gas) }
  })

  return {
    moneda,
    ventas: round2(ventas),
    cobros_directos: round2(cobros_directos),
    total_ingresos,
    total_gastos,
    neto,
    bloques,
    coste_ventas,
    margen_bruto,
    margen_bruto_pct: margen_bruto == null ? null : pctSobre(margen_bruto, total_ingresos),
    personal,
    operativos,
    otros,
    resultado_operativo,
    margen_neto_pct: pctSobre(neto, total_ingresos),
    etiqueta_coste: opciones.hayInventario ? 'Coste de ventas' : 'Coste de compras del período',
    // Un solo mes no es una evolución: es el mismo número otra vez.
    evolucion: evolucion.length > 1 ? evolucion : [],
  }
}

/**
 * Reparte los apuntes por moneda y construye un resultado para cada una.
 * Sin conversión: el consolidado es un paso aparte y explícito (una moneda que el
 * cliente no tiene no cotiza, CONTEXTO §2).
 */
export function construirResultadosPorMoneda(
  ingresos: ApunteIngreso[],
  gastos: ApunteGasto[],
  categorias: CategoriaPL[],
  opciones: OpcionesPL,
): ResultadoPL[] {
  const monedas = new Set<string>([...ingresos.map(i => i.moneda), ...gastos.map(g => g.moneda)])
  return [...monedas]
    .sort((a, b) => a.localeCompare(b))
    .map(moneda => construirResultadoPL(
      moneda,
      ingresos.filter(i => i.moneda === moneda),
      gastos.filter(g => g.moneda === moneda),
      categorias,
      opciones,
    ))
}
