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

export const ROLES_PL = [
  // Dentro del resultado: restan.
  'COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'OTRO',
  // Fuera del resultado (fase 2, mig. 188): mueven dinero y no son gasto.
  'INVERSION', 'PATRIMONIO', 'FINANCIACION',
  // Ingreso (fase 3, mig. 190): el cobro SIN factura, que no tiene líneas.
  'INGRESO_OPERATIVO',
  // Fase 4 (mig. 191): dos renglones de gasto que se leen aparte y el ingreso
  // que no es facturación. Ver `ORDEN_ROL` para dónde cae cada uno.
  'DEPRECIACION', 'IMPUESTO_UTILIDAD', 'INGRESO_OTRO',
] as const
export type RolPL = (typeof ROLES_PL)[number]

/**
 * Los papeles del lado del INGRESO.
 *
 * Existen porque el dinero entra por dos puertas y solo una lleva detalle: la
 * factura tiene líneas y sus líneas tienen productos, así que su desglose sale
 * del catálogo de productos; el cobro sin factura —el cierre del TPV, la
 * suscripción, el reembolso del proveedor— no tiene más que su categoría. En un
 * negocio de mostrador, ahí está TODA la facturación.
 *
 * `INGRESO_OTRO` (fase 4) es el segundo: lo que entra sin ser lo que vendes. Se
 * cuenta igual dentro de los ingresos —el dinero entró— pero con renglón propio,
 * porque un mes bueno de verdad y un mes en el que vendiste la moto no pueden
 * leerse igual.
 */
export const ROLES_INGRESO = ['INGRESO_OPERATIVO', 'INGRESO_OTRO'] as const
export type RolIngreso = (typeof ROLES_INGRESO)[number]

export function esRolIngreso(rol: RolPL): rol is RolIngreso {
  return (ROLES_INGRESO as readonly string[]).includes(rol)
}

/**
 * Los tres papeles que sacan un apunte del resultado.
 *
 * 🔴 **No es una categoría más del informe: es la línea que separa «me fue mal»
 * de «invertí».** Comprar un refrigerador, sacar dinero el dueño o devolver el
 * principal de un préstamo saca dinero de la caja, pero no empobrece al negocio
 * —cambia dinero por una cosa, o cambia de dueño, o cancela una deuda—. Contarlo
 * como gasto es el error más caro que comete un negocio pequeño: le dice que
 * perdió justo el mes que invirtió, y con eso decide no volver a invertir.
 *
 * Del préstamo, aquí va SOLO el principal. Los intereses son `OTRO` y sí restan:
 * el interés es el precio del dinero, el principal es dinero prestado.
 */
export const ROLES_FUERA_RESULTADO = ['INVERSION', 'PATRIMONIO', 'FINANCIACION'] as const
export type RolFueraResultado = (typeof ROLES_FUERA_RESULTADO)[number]

/** Los que SÍ forman el resultado, en orden de waterfall. */
export const ROLES_RESULTADO = [
  'COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'DEPRECIACION', 'OTRO', 'IMPUESTO_UTILIDAD',
] as const

/**
 * Los cuatro que EXPLICA la guía del dossier.
 *
 * No son todos los del resultado a propósito. La guía enseña el waterfall en
 * tarjetas, y `DEPRECIACION` e `IMPUESTO_UTILIDAD` solo existen para quien lleva
 * libros con un contador: convertir una explicación de cuatro tarjetas en una de
 * seis se la quita de encima a todo el mundo para servir a unos pocos. Los seis
 * están igualmente en el desplegable, que es donde se eligen.
 */
export const ROLES_GUIA = ['COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'OTRO'] as const

export function esFueraDelResultado(rol: RolPL): rol is RolFueraResultado {
  return (ROLES_FUERA_RESULTADO as readonly string[]).includes(rol)
}

/**
 * Orden de aparición en el informe (es el orden del waterfall, no alfabético).
 *
 * La fase 4 mete dos renglones y cada uno en el sitio que le toca, no al final:
 *  · `DEPRECIACION` va ANTES del resultado operativo. Es gasto de operar —el
 *    desgaste de lo que usas para vender— aunque no salga de la caja.
 *  · `IMPUESTO_UTILIDAD` va el ÚLTIMO, debajo de todo. Se calcula SOBRE el
 *    resultado, así que meterlo dentro contaminaría el número del que sale.
 */
const ORDEN_ROL: RolPL[] = [
  'COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'DEPRECIACION', 'OTRO', 'IMPUESTO_UTILIDAD',
]

/** Orden del bloque de abajo, el que no entra en el resultado. */
const ORDEN_ROL_FUERA: RolPL[] = ['INVERSION', 'PATRIMONIO', 'FINANCIACION']

export const ROL_PL_LABEL: Record<RolPL, string> = {
  COSTE_VENTAS: 'Coste de ventas',
  PERSONAL:     'Gastos de personal',
  OPERATIVO:    'Gastos operativos',
  OTRO:         'Otros (impuestos y financieros)',
  INVERSION:    'Inversiones',
  PATRIMONIO:   'Movimientos del dueño',
  FINANCIACION: 'Préstamos y financiación',
  INGRESO_OPERATIVO: 'Ingresos del negocio',
  DEPRECIACION:      'Depreciación y provisiones',
  IMPUESTO_UTILIDAD: 'Impuesto sobre utilidades',
  INGRESO_OTRO:      'Otros ingresos',
}

/** Ayuda del selector de clasificación (pestaña Categorías y paso del dossier). */
export const ROL_PL_AYUDA: Record<RolPL, string> = {
  COSTE_VENTAS: 'Lo que te cuesta lo que vendes: mercancía, materia prima, el proveedor del servicio.',
  PERSONAL:     'Sueldos, seguridad social y todo lo que cuesta tu gente.',
  OPERATIVO:    'Lo que cuesta tener el negocio abierto: alquiler, luz, transporte, publicidad.',
  OTRO:         'Impuestos, comisiones e intereses. Fuera del resultado operativo para no distorsionarlo.',
  INVERSION:    'Lo que compras y te dura años: equipos, obra, vehículos, mobiliario.',
  PATRIMONIO:   'Tu dinero entrando o saliendo del negocio. No es ingreso ni gasto.',
  FINANCIACION: 'El dinero del préstamo y lo que devuelves de él. Los intereses no: esos sí son gasto.',
  INGRESO_OPERATIVO: 'Dinero que ENTRA por lo que vendes, cobrado sin factura: mostrador, suscripciones.',
  DEPRECIACION:      'El desgaste anual de lo que compraste una vez. Resta, pero no sale de tu caja.',
  IMPUESTO_UTILIDAD: 'El impuesto sobre la utilidad. Se calcula sobre el resultado, así que va debajo de él.',
  INGRESO_OTRO:      'Dinero que entra sin ser lo que vendes: la tasa, un reembolso, vender algo usado.',
}

/**
 * El EFECTO de cada papel, en una frase y sin jerga contable (F1.6).
 *
 * `ROL_PL_LABEL` nombra el renglón; esto dice qué le pasa al dinero. Al dueño de
 * un negocio «Coste de ventas» no le dice nada: lo que necesita saber es que ese
 * gasto va a restarse de sus ventas antes de calcular su margen. Se enseña esto,
 * no el rol, en cuanto la clasificación se decide.
 */
export const ROL_PL_EFECTO: Record<RolPL, string> = {
  COSTE_VENTAS: 'Se restará de tus ventas para calcular tu margen bruto.',
  PERSONAL:     'Se contará aparte, en el renglón de lo que te cuesta tu gente.',
  OPERATIVO:    'Se contará como gasto de tener el negocio abierto.',
  OTRO:         'Quedará fuera de tu resultado operativo, para no distorsionarlo.',
  INVERSION:    'No restará de tu resultado: no te empobrece, cambias dinero por una cosa que te queda.',
  PATRIMONIO:   'No restará de tu resultado: es dinero tuyo moviéndose, no dinero que el negocio gana o pierde.',
  FINANCIACION: 'No restará de tu resultado: devolver lo prestado cancela una deuda, no es un gasto.',
  INGRESO_OPERATIVO: 'Sumará a tus ingresos, junto a lo que facturas.',
  DEPRECIACION:      'Restará en su propio renglón, para que se vea qué parte de tu gasto no es caja.',
  IMPUESTO_UTILIDAD: 'Restará al final, debajo del resultado sobre el que se calcula.',
  INGRESO_OTRO:      'Sumará a tus ingresos, en un renglón aparte del de lo que vendes.',
}

/**
 * Las tres preguntas que clasifican un gasto sin nombrar ni una vez el informe.
 *
 * Se hacen EN ORDEN y la primera que se responde «sí» decide. Si las tres son
 * «no», es un gasto operativo — el caso mayoritario, y por eso es el que no hay
 * que saber contestar. Un desplegable con los cuatro renglones pedía entender la
 * contabilidad ANTES de poder guardar una categoría.
 */
export const PREGUNTAS_ROL: { rol: RolPL; pregunta: string; ejemplo: string }[] = [
  {
    rol: 'COSTE_VENTAS',
    pregunta: '¿Este gasto sube cuando vendes más?',
    ejemplo: 'La mercancía que revendes, la materia prima, el proveedor que presta el servicio por ti.',
  },
  {
    rol: 'PERSONAL',
    pregunta: '¿Es lo que te cuesta tu gente?',
    ejemplo: 'Sueldos, seguridad social, la comida del personal, los estímulos.',
  },
  {
    rol: 'OTRO',
    pregunta: '¿Es un impuesto, una comisión del banco o un interés?',
    ejemplo: 'No depende de cómo lleves el negocio, así que se cuenta aparte.',
  },
]

/**
 * La pregunta que va ANTES de las tres, desde la fase 2.
 *
 * Se pregunta primero porque es la que más daño evita: quien se equivoca aquí no
 * se equivoca de renglón, se equivoca de informe. Y va formulada por el efecto
 * que el dueño SÍ reconoce —«sale de la caja pero no es un gasto»— porque
 * «inversión», «patrimonio» y «financiación» son las tres palabras que lo
 * mandarían a preguntarle a un contador antes de poder guardar una categoría.
 *
 * El «no» es el camino ancho: casi todo es gasto, y por eso esta pregunta se
 * responde que no sin pensarla.
 */
export const PREGUNTA_FUERA = {
  pregunta: '¿Es dinero que sale de tu caja pero NO es un gasto del negocio?',
  ejemplo: 'Comprar algo que te dura años, sacar dinero para ti, o devolver lo que te prestaron.',
}

/** Las tres salidas de la pregunta de arriba, dichas con lo que el dueño hace. */
export const OPCIONES_FUERA: { rol: RolFueraResultado; titulo: string; ejemplo: string }[] = [
  {
    rol: 'INVERSION',
    titulo: 'Compré algo que me dura años',
    ejemplo: 'Un refrigerador, una moto, obra en el local, mesas y sillas.',
  },
  {
    rol: 'PATRIMONIO',
    titulo: 'Es mi dinero, entrando o saliendo',
    ejemplo: 'Lo que saco para mí, o lo que pongo de mi bolsillo cuando falta.',
  },
  {
    rol: 'FINANCIACION',
    titulo: 'Es un préstamo, o lo que devuelvo de él',
    ejemplo: 'El dinero que te prestaron y las cuotas del principal. Los intereses no: esos sí son gasto.',
  },
]

/**
 * La cuarta salida de esa misma pregunta: no sale, ENTRA (fase 3).
 *
 * Va colgada de la pregunta de arriba y no como una pregunta propia, porque
 * añadir un paso más al principio le cuesta un clic a todo el mundo para
 * resolver el caso de unos pocos: casi toda categoría que se crea es de gasto.
 * Quien viene a crear la categoría con la que anota lo que cobra sí sabe
 * reconocerla de un vistazo, y por eso basta con que la salida esté a la vista.
 */
export const OPCION_INGRESO: { rol: RolIngreso; titulo: string; ejemplo: string } = {
  rol: 'INGRESO_OPERATIVO',
  titulo: 'No sale: es dinero que ENTRA',
  ejemplo: 'El cierre del día en el mostrador, una suscripción que te pagan, un reembolso.',
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
  /**
   * Categoría del COBRO SIN FACTURA (fase 3): `categorias_gastos`, la misma tabla
   * del gasto y la misma que el dueño ya elige al anotar el cobro. `categoria` es
   * el respaldo por texto cuando falta la FK, igual que en el gasto.
   *
   * Es un campo DISTINTO de `linea_id` y no un duplicado: el dinero entra por dos
   * puertas y solo una lleva detalle de producto. La factura se desglosa por lo
   * que vendió; el cobro de mostrador solo sabe decir su categoría.
   */
  categoria_id?: string | null
  categoria?:    string | null
  /**
   * Línea de negocio a la que pertenece la venta (fase 3): el `categoria_id` de
   * `product_categories`, la categoría del PRODUCTO vendido.
   *
   * `null` = no se pudo clasificar, y es un caso mayoritario, no un error: el
   * cierre del punto de venta y el cobro directo no tienen líneas que mirar, y un
   * negocio puede tener su catálogo sin categorizar. Ver la escalera de
   * degradación en `@/lib/pl/apuntes`.
   */
  linea_id: string | null
}

/**
 * El catálogo de líneas de ingreso: `product_categories`, plano.
 *
 * Deliberadamente NO es `CategoriaPL`. Son dos tablas distintas —una clasifica lo
 * que compras, la otra lo que vendes—, y la de productos no tiene jerarquía ni
 * `rol_pl`. Un tipo común obligaría a arrastrar campos que no existen en un lado
 * y a inventarles un valor, que es como se cuelan los errores silenciosos.
 */
export interface LineaIngresoPL {
  linea_id: string
  nombre:   string
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

/**
 * Una línea de negocio dentro de las Ventas (fase 3): «Comida 12.400».
 *
 * Es un DESGLOSE DE `ventas`, no de los ingresos totales: el cobro directo no
 * pasa por el catálogo de productos y no tiene línea que enseñar. Por eso se
 * pinta colgando del renglón «Ventas» y no al lado de él — así la suma de las
 * partes es visiblemente el todo del que cuelgan.
 */
export interface LineaVentaPL {
  /** null solo en el cajón «Sin clasificar». */
  linea_id: string | null
  nombre:   string
  monto:    number
}

/**
 * Un cobro sin factura agrupado por su categoría RAÍZ (fase 3): «Ventas del día
 * 8.400». Es el desglose de `cobros_directos`, la otra puerta por la que entra
 * el dinero. Se agrupa por raíz igual que el gasto: sin subir, «Cobros ·
 * Suscripciones» saldría suelta al lado de «Cobros» como si fueran dos ingresos
 * distintos del mismo nivel.
 */
export interface NodoCobroPL {
  /** null solo en el cajón «Sin categoría». */
  categoria_id: string | null
  nombre:       string
  monto:        number
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
  /**
   * Lo que entró sin ser lo que vendes (fase 4): la ganancia por la tasa, un
   * reembolso, la venta de un activo usado. Cuenta DENTRO de `total_ingresos`
   * —el dinero entró— pero con renglón propio.
   */
  otros_ingresos:  number
  total_ingresos:  number
  total_gastos:    number
  neto:            number

  /**
   * Desglose de `ventas` por línea de negocio (fase 3), mayor primero.
   *
   * **Vacío mientras no aporte nada**, que es la regla 1 del P&L progresivo
   * aplicada al lado del ingreso: si nada se pudo clasificar, la única línea
   * posible sería «Sin clasificar» por el importe entero de las ventas —el mismo
   * número otra vez, con una etiqueta que suena a error del sistema—. Se pinta en
   * cuanto hay UNA línea de verdad; con una sola ya dice algo («todo lo que
   * vendes es comida»).
   */
  ventas_lineas: LineaVentaPL[]

  /**
   * Desglose de `cobros_directos` por categoría (fase 3), mayor primero. Misma
   * regla que `ventas_lineas`: vacío mientras no haya ni una categoría de verdad.
   */
  cobros_nodos: NodoCobroPL[]

  /**
   * Desglose de `otros_ingresos` por categoría (fase 4). Vacío si no hay otros
   * ingresos; aquí no hace falta la regla del cajón, porque para caer en este
   * renglón hay que tener la categoría clasificada.
   */
  otros_ingresos_nodos: NodoCobroPL[]

  /** Bloques de gasto CON dato, en orden de waterfall. Los vacíos no aparecen. */
  bloques: BloqueRolPL[]

  /**
   * Lo que movió dinero pero NO es gasto (fase 2): inversiones, movimientos del
   * dueño y principal de préstamos. Va aparte y DEBAJO del resultado.
   *
   * No entra en `total_gastos` ni en `neto` ni en la evolución mensual: si
   * entrara, el informe volvería a decir que el negocio perdió el mes que
   * invirtió, que es exactamente lo que la fase 2 existe para arreglar. Se
   * enseña igualmente porque el dueño necesita ver a dónde se le fue el dinero
   * — el resultado explica cómo le va, esto explica por qué la caja no cuadra
   * con el resultado.
   */
  fuera: BloqueRolPL[]
  /** Suma de `fuera`. 0 si no hay nada: es un total de caja, no un subtotal del P&L. */
  total_fuera: number

  // ── Subtotales del waterfall ──
  // `null` = este negocio no tiene esa fuente de datos → el renglón NO se pinta.
  coste_ventas:        number | null
  margen_bruto:        number | null
  margen_bruto_pct:    number | null
  personal:            number | null
  operativos:          number | null
  /** Fase 4: gasto que resta y no es caja. Va DENTRO del resultado operativo. */
  depreciacion:        number | null
  otros:               number | null
  /** Fase 4: se calcula sobre el resultado, así que va debajo de él. */
  impuesto_utilidad:   number | null
  /** Solo se calcula si hay algo debajo; sin ello sería idéntico al neto y sobra. */
  resultado_operativo: number | null
  /** Solo si hay impuesto sobre utilidades que restar debajo. Misma regla. */
  resultado_antes_impuestos: number | null

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
  lineasIngreso: LineaIngresoPL[] = [],
): ResultadoPL {
  const idx = indexarCategorias(categorias)
  const nombreLinea = new Map(lineasIngreso.map(l => [l.linea_id, l.nombre]))

  // ── Ingresos ──
  let ventas = 0, cobros_directos = 0, otros_ingresos = 0
  const mesIngresos = new Map<string, number>()
  // Desglose de las VENTAS por línea de negocio. Clave: `linea_id` | '__sin__'.
  const porLinea = new Map<string, number>()
  // Desglose de los COBROS por categoría raíz. Clave: `categoria_id` | '__sin__'.
  const porCobro = new Map<string, { nombre: string; monto: number }>()
  // Y el de los otros ingresos (fase 4), con la misma forma: es el mismo desglose
  // por categoría, en otro renglón.
  const porOtroIngreso = new Map<string, { nombre: string; monto: number }>()
  for (const i of ingresos) {
    const m = Number(i.monto) || 0
    if (i.fuente === 'VENTA') {
      ventas += m
      // El cobro directo no entra aquí: no pasa por el catálogo de productos, así
      // que no tiene línea que enseñar. Meterlo en «Sin clasificar» diría que la
      // venta está mal registrada cuando lo que pasa es que no es una venta.
      //
      // Un id que ya no está en el catálogo —el dueño borró la categoría después
      // de vender— cae al cajón junto a lo no clasificado. Dejarlo con su id daría
      // dos renglones «Sin clasificar» distintos en la misma tabla.
      const clave = i.linea_id && nombreLinea.has(i.linea_id) ? i.linea_id : '__sin__'
      porLinea.set(clave, (porLinea.get(clave) ?? 0) + m)
    } else {
      // Misma resolución que el gasto —FK, después nombre— y mismo rollup a la
      // raíz: el criterio de agrupar no puede cambiar según de qué lado del
      // informe caiga la fila.
      const fila = (i.categoria_id ? idx.porId.get(i.categoria_id) : undefined)
        ?? (i.categoria ? idx.porNombre.get(norm(i.categoria)) : undefined)
      const raiz = fila ? (idx.raizDe.get(fila.categoria_id) ?? fila) : null
      // Lo que entra sin ser lo que vendes va a su propio renglón (fase 4). Sigue
      // dentro de los ingresos —el dinero entró de verdad— pero separado: mezclado
      // con la facturación, el mes que vendiste la moto se lee como un buen mes de
      // negocio, y el % de cada gasto sobre «ingresos» pasa a compararse contra
      // una base que no se repite.
      const esOtroIngreso = !!raiz && raiz.rol_pl === 'INGRESO_OTRO'
      const destino = esOtroIngreso ? porOtroIngreso : porCobro
      if (esOtroIngreso) otros_ingresos += m; else cobros_directos += m
      const clave = raiz?.categoria_id ?? '__sin__'
      const acc = destino.get(clave) ?? { nombre: raiz?.nombre ?? 'Sin categoría', monto: 0 }
      acc.monto += m
      destino.set(clave, acc)
    }
    if (i.mes) mesIngresos.set(i.mes, (mesIngresos.get(i.mes) ?? 0) + m)
  }
  const total_ingresos = round2(ventas + cobros_directos + otros_ingresos)

  const lineasVenta: LineaVentaPL[] = [...porLinea.entries()]
    .map(([clave, monto]) => ({
      linea_id: clave === '__sin__' ? null : clave,
      nombre:   clave === '__sin__' ? 'Sin clasificar' : (nombreLinea.get(clave) ?? 'Sin clasificar'),
      monto:    round2(monto),
    }))
    .filter(l => Math.abs(l.monto) > EPS)
    .sort((a, b) => b.monto - a.monto)
  // Sin ni una línea de verdad el desglose repetiría el total de ventas bajo una
  // etiqueta que parece un fallo. Se calla.
  const ventas_lineas = lineasVenta.some(l => l.linea_id != null) ? lineasVenta : []

  const nodosDe = (m: Map<string, { nombre: string; monto: number }>): NodoCobroPL[] =>
    [...m.entries()]
      .map(([clave, acc]) => ({
        categoria_id: clave === '__sin__' ? null : clave,
        nombre:       acc.nombre,
        monto:        round2(acc.monto),
      }))
      .filter(n => Math.abs(n.monto) > EPS)
      .sort((a, b) => b.monto - a.monto)

  const nodosCobro = nodosDe(porCobro)
  const cobros_nodos = nodosCobro.some(n => n.categoria_id != null) ? nodosCobro : []
  // Los otros ingresos SÍ se desglosan siempre que existan: llegar a este renglón
  // ya exige haber clasificado la categoría, así que aquí no hay cajón que repita
  // el total con una etiqueta de avería.
  const otros_ingresos_nodos = nodosDe(porOtroIngreso)

  // ── Gastos: acumulados por raíz, con detalle de subcategoría ──
  interface Acc { rol: RolPL; nombre: string; propio: number; hijos: Map<string, { nombre: string; monto: number }> }
  const porRaiz = new Map<string, Acc>()   // clave: categoria_id de la raíz | '__sin__'
  const mesGastos = new Map<string, number>()
  let total_gastos = 0

  for (const g of gastos) {
    const monto = Number(g.monto) || 0

    // Resolución: FK → nombre → cajón «Sin categoría».
    const fila = (g.categoria_id ? idx.porId.get(g.categoria_id) : undefined)
      ?? (g.categoria ? idx.porNombre.get(norm(g.categoria)) : undefined)

    // 🔴 El papel se mira ANTES de sumar. Una inversión o una retirada del dueño
    // se acumulan en `porRaiz` como cualquier otra fila —para poder enseñarlas
    // abajo con su desglose— pero no tocan `total_gastos` ni la evolución
    // mensual: no son gasto, y sumarlas ahí es el error que la fase 2 corrige.
    // Sin categoría resuelta no hay papel que mirar, así que cuenta como gasto:
    // ante la duda, el importe entra en el resultado y se ve.
    const raizPrevia = fila ? (idx.raizDe.get(fila.categoria_id) ?? fila) : null
    const fueraDelResultado = !!raizPrevia && esFueraDelResultado(raizPrevia.rol_pl)

    if (!fueraDelResultado) {
      total_gastos += monto
      if (g.mes) mesGastos.set(g.mes, (mesGastos.get(g.mes) ?? 0) + monto)
    }

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

    const raiz = raizPrevia ?? fila
    // Un GASTO clasificado con un papel del lado del INGRESO no tiene renglón al
    // que ir, y sin esta línea desaparecería del desglose mientras sigue dentro
    // de `total_gastos`: el informe no cuadraría consigo mismo, en silencio. El
    // dinero salió, así que se cuenta como gasto operativo y se ve. La interfaz
    // no deja elegir esa combinación; los datos viejos y las importaciones sí.
    const rolGasto = esRolIngreso(raiz.rol_pl) ? 'OPERATIVO' : raiz.rol_pl
    const acc = porRaiz.get(raiz.categoria_id)
      ?? { rol: rolGasto, nombre: raiz.nombre, propio: 0, hijos: new Map<string, { nombre: string; monto: number }>() }

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
  // El mismo armado sirve para el waterfall y para lo que queda fuera de él: lo
  // único que cambia es qué roles se recorren y en qué orden.
  const armarBloques = (orden: RolPL[]): BloqueRolPL[] => {
    const salida: BloqueRolPL[] = []
    for (const rol of orden) {
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
      salida.push({
        rol,
        etiqueta: rol === 'COSTE_VENTAS' && !opciones.hayInventario
          ? 'Coste de compras del período'
          : ROL_PL_LABEL[rol],
        total: round2(total),
        // El % vertical solo tiene sentido dentro del resultado: «esta inversión
        // es el 40% de tus ingresos» compara dos cosas que no se comparan.
        pct: esFueraDelResultado(rol) ? 0 : pctSobre(total, total_ingresos),
        nodos,
      })
    }
    return salida
  }

  const bloques = armarBloques(ORDEN_ROL)
  const fuera   = armarBloques(ORDEN_ROL_FUERA)
  const total_fuera = round2(fuera.reduce((s, b) => s + b.total, 0))

  const totalDe = (rol: RolPL): number | null => {
    const b = bloques.find(x => x.rol === rol)
    return b ? b.total : null
  }

  const coste_ventas = totalDe('COSTE_VENTAS')
  const personal     = totalDe('PERSONAL')
  const operativos   = totalDe('OPERATIVO')
  const depreciacion = totalDe('DEPRECIACION')
  const otros        = totalDe('OTRO')
  const impuesto_utilidad = totalDe('IMPUESTO_UTILIDAD')

  // El margen bruto solo informa si queda ALGO por restar debajo. Si el coste de
  // ventas es el único bloque de gasto, margen bruto y resultado neto son el mismo
  // número, y pintarlos los dos —con el mismo importe y el mismo %— no da
  // profundidad: hace dudar de la aritmética del informe. Misma regla que el
  // resultado operativo, unas líneas más abajo.
  const hayGastoBajoElMargen = personal != null || operativos != null
    || depreciacion != null || otros != null || impuesto_utilidad != null
  const margen_bruto = (coste_ventas == null || !hayGastoBajoElMargen)
    ? null
    : round2(total_ingresos - coste_ventas)
  // El resultado operativo solo aporta información si hay un renglón DEBAJO que lo
  // separe del neto. Sin nada debajo los dos números son el mismo y pintar los dos
  // es ruido que hace dudar de la aritmética.
  //
  // La depreciación va DENTRO de él (fase 4): es gasto de operar aunque no salga
  // de la caja, y dejarla fuera convertiría este renglón en un EBITDA rotulado
  // como resultado operativo.
  const hayRenglonDebajo = otros != null || impuesto_utilidad != null
  const resultado_operativo = !hayRenglonDebajo
    ? null
    : round2(total_ingresos - (coste_ventas ?? 0) - (personal ?? 0) - (operativos ?? 0) - (depreciacion ?? 0))
  // Y el resultado antes de impuestos existe solo si hay impuesto DEBAJO que lo
  // separe del neto y algo ENTRE MEDIAS que lo separe del operativo. Sin «Otros»
  // los dos subtotales son el mismo número con dos nombres, que es peor que no
  // tener el segundo: el dueño busca la diferencia entre ellos y no la hay.
  const resultado_antes_impuestos = (impuesto_utilidad == null || otros == null)
    ? null
    : round2((resultado_operativo ?? total_ingresos) - otros)

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
    otros_ingresos: round2(otros_ingresos),
    otros_ingresos_nodos,
    total_ingresos,
    total_gastos,
    neto,
    ventas_lineas,
    cobros_nodos,
    bloques,
    fuera,
    total_fuera,
    coste_ventas,
    margen_bruto,
    margen_bruto_pct: margen_bruto == null ? null : pctSobre(margen_bruto, total_ingresos),
    personal,
    operativos,
    depreciacion,
    otros,
    impuesto_utilidad,
    resultado_operativo,
    resultado_antes_impuestos,
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
  lineasIngreso: LineaIngresoPL[] = [],
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
      lineasIngreso,
    ))
}
