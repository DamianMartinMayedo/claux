// ────────────────────────────────────────────────────────────────────────────
// EL CONTRATO ÚNICO DE FILTRO DEL PORTAL
//
// Un filtro se DECLARA una vez y de esa declaración salen las tres cosas que antes se
// escribían a mano en cada pantalla:
//
//   1. la barra de filtros (`<Filtros>`),
//   2. lo que viaja a la descarga (`FiltroExport`),
//   3. el texto de «lo que vas a descargar» del desplegable.
//
// ── POR QUÉ ───────────────────────────────────────────────────────────────────
// La lógica de cada filtro vivía TRES veces: el `useMemo` de la vista, la query del
// listado y otra vez el registro de exportación. De esa triplicación salieron todos los
// fallos de la Fase 0 del plan, y ninguno era detectable leyendo una sola pantalla:
//
//   · Tesorería mandaba a la descarga el ID de la categoría contra una columna de TEXTO:
//     filtrar por categoría devolvía un fichero **vacío**, siempre.
//   · «Sin categoría» tenía dos centinelas distintos y el de Productos se traducía a
//     cadena vacía: pedirla descargaba **todo el catálogo**.
//   · Inventario no mandaba el rango ni la empresa: el chip decía «Todo el listado» y el
//     fichero traía la historia entera de todas las empresas.
//   · El resumen imprimía códigos internos («PENDIENTE», «INGRESO») y hasta un UUID.
//
// Con la etiqueta viviendo JUNTO al valor y el filtro generándose de la declaración, esos
// cuatro son imposibles de escribir. Ese es el punto: no arreglarlos, sino que no puedan
// volver.
//
// ── DÓNDE SE APLICA CADA UNO (la decisión de fondo) ───────────────────────────
// En 3G, filtrar en el servidor cuesta segundos por clic y filtrar en el navegador es
// instantáneo — pero MIENTE cuando el listado está recortado por el techo: filtras por
// «Empresa B» y ves lo que de Empresa B cayó entre las 500 filas más recientes, sin que
// nada lo diga.
//
// La regla del producto es que **un filtro busca siempre en TODO** (D5 del plan). Así que
// no se elige un lado: se elige por filtro, y el caso normal es `escalado` —el navegador
// mientras todo quepa (mismo resultado que la consulta completa, o sea que no miente) y el
// servidor en cuanto haya filas sin traer, con su indicador de carga—.
//
// Sin 'use server': tipos y funciones puras que usan las vistas Y las server actions.
// ────────────────────────────────────────────────────────────────────────────

// `import type` a propósito: se borra al compilar, así que traer la FORMA del contrato de
// exportación no arrastra el registro de tablas (que no es client-safe) al bundle.
import type { FiltroExport } from '@/lib/exportar/tablas'

/** Una opción de un filtro: el valor que viaja y la palabra que lee el dueño. */
export interface OpcionFiltro {
  valor:  string
  /** En las palabras del dueño, NUNCA el código: «Pendiente», no «PENDIENTE». */
  label:  string
  /** Punto de color (empresas). */
  color?: string | null
  /** Cuántas filas caen aquí, cuando el número es parte de la información (tramos de CxC/CxP). */
  count?: number
  /**
   * Grupo dentro del desplegable (`<optgroup>`). Existe por los proveedores del catálogo:
   * en un negocio con dos empresas, «Distribuidora X» aparece una vez por empresa y sin el
   * grupo no hay forma de saber cuál es cuál.
   */
  grupo?: string
}

/**
 * Dónde se aplica un filtro.
 *
 * · `servidor` — cambia QUÉ se trae, no cómo se pinta. Lo archivado, por ejemplo: traerlo
 *   para esconderlo gasta cupo del techo y desplaza filas vivas.
 * · `escalado`  — el navegador mientras no haya truncamiento; el servidor en cuanto lo haya.
 *   Es el caso normal y el que mantiene la promesa de «busca siempre en todo».
 * · `cliente`   — solo cuando el conjunto NUNCA se trunca (una tabla maestra pequeña).
 */
export type DondeSeAplica = 'servidor' | 'escalado' | 'cliente'

export type WidgetFiltro = 'pastillas' | 'select' | 'toggle'

/**
 * Claves que viven SOLO en la URL y no son del contrato de exportación.
 *
 * Ahora mismo una: el `anio` de Nómina. El período de una nómina es el año, no unos días
 * sueltos, así que la pantalla filtra por año pero la descarga filtra por fecha — el año se
 * traduce a `desde`/`hasta` al generar el filtro. Va con `sinExportar` para que no viaje como
 * sí mismo y se ignore en silencio.
 */
export type ClaveSoloUrl = 'anio'

export interface Filtro {
  /**
   * Clave del contrato de exportación (`empresa_id`, `estado`, `categoria`, `tercero`,
   * `cuenta_id`, `almacen_id`, `motivo`, `tramo`, `archivadas`, `con_saldo`…). Es también
   * el nombre del parámetro en la URL salvo que se diga otro en `param`.
   */
  clave: keyof FiltroExport | ClaveSoloUrl
  /** Nombre del parámetro en la URL, si no coincide con la clave (`empresa_id` → `empresa`). */
  param?: string
  /** Rótulo del filtro. En un `select` es su opción «todos» («Todas las categorías»). */
  label: string
  /**
   * Nombre CORTO del filtro («Categoría», «Proveedor»), para el rótulo de encima del control
   * en el panel de «Filtros (N)».
   *
   * Se pide explícito y no se deduce del `label`: quitarle el «Todas las» y singularizar en
   * español es adivinar («almacenes» → «almacen»), y el wording de la UI lo pone el dueño, no
   * una regla de cadenas. Sin él se cae al `label`, que se lee peor pero nunca miente.
   */
  rotulo?: string
  valor: string
  opciones?: OpcionFiltro[]
  widget: WidgetFiltro
  donde: DondeSeAplica
  /**
   * NO es un filtro del usuario sino la identidad de la pantalla: el `tipo` GASTO/COBRO que
   * es la pestaña de Gastos, o el `tipo` PRODUCTO/SERVICIO con el que Inventario y Servicios
   * comparten vista. Viaja a la descarga, pero no se puede limpiar ni cuenta como filtro
   * activo — si contara, «Limpiar» dejaría la pantalla enseñando otra cosa.
   */
  implicito?: boolean
  /** Se oculta cuando no hay nada que elegir (una sola empresa, cero proveedores). */
  ocultarSi?: boolean
  /** Contador de la opción «todos», cuando las opciones llevan contador. */
  todasCount?: number
  /**
   * La descarga NO puede reproducir este filtro.
   *
   * Es el caso de «Con deuda» en Suscripciones: la deuda de un acuerdo se calcula sobre sus
   * facturas y sus cobros, no es una columna que la consulta del fichero pueda filtrar.
   * Antes se mandaba igual y se ignoraba en silencio: marcabas el filtro y te bajabas todo.
   * Ahora no viaja —para no prometer lo que no hace— y el desplegable lo DICE, que es la
   * regla del plan: un filtro que no se puede aplicar se dice, no se ignora.
   */
  sinExportar?: boolean
}

/**
 * Opciones de un filtro por TERCERO. Siempre por aquí, nunca a mano.
 *
 * ── POR QUÉ ES UNA REGLA Y NO UN DETALLE ──────────────────────────────────────
 * Un tercero es **por empresa** (`third_parties.empresa_id`): el mismo proveedor real tiene
 * una ficha por cada empresa que le compra. Un desplegable plano lista «CLAUDIA» tres veces,
 * idénticas, y no hay forma de saber cuál se está eligiendo — pasó en CLI-0003, que opera con
 * varias empresas. Y agrupar por NOMBRE para quitar el duplicado es peor: fusiona tres fichas
 * distintas en una opción, así que filtrar por «CLAUDIA» enseña las deudas de las tres sin
 * decirlo. La única salida honesta es el `id` como valor y la EMPRESA como grupo.
 *
 * Con una sola empresa no se agrupa: el grupo sería una etiqueta que no distingue nada.
 *
 * Los FORMULARIOS no usan esto: ahí se elige primero la empresa (del almacén, de la factura)
 * y la lista de terceros se acota a ella, que es más fuerte todavía — no se puede elegir el
 * tercero de otra empresa. Ver `_CompraFormModal` y `_ProductoFormModal`.
 */
export function opcionesTercero(
  terceros: { tercero_id: string; nombre: string; empresa_id?: string | null }[],
  /** `nombreOf` de `useEmpresas()` encaja tal cual: puede no conocer una empresa borrada. */
  nombreEmpresa: (empresa_id: string) => string | undefined,
  multiempresa: boolean,
  /**
   * Empresa filtrada en la barra, si hay una.
   *
   * Con «Empresa 2» puesta, la lista ofrecía IGUALMENTE los proveedores de la 1 y la 3, y
   * elegir uno dejaba la pantalla vacía sin explicar por qué: un tercero es de UNA empresa
   * (`third_parties` es por empresa), así que «empresa 2 + proveedor de la empresa 1» es una
   * combinación que no puede devolver nada. Acotando, la pregunta imposible ni se ofrece.
   * Y como entonces todos son de la misma, el `<optgroup>` sobra: no hay ambigüedad que
   * deshacer.
   */
  empresaId?: string,
): OpcionFiltro[] {
  const lista = empresaId ? terceros.filter(t => t.empresa_id === empresaId) : terceros
  const agrupa = multiempresa && !empresaId
  const out = lista.map(t => ({
    valor: t.tercero_id,
    label: t.nombre,
    // Si la empresa no se conoce (ficha de una empresa ya borrada), el grupo es el id: feo,
    // pero visible. Dejarlo sin grupo la mezclaría con las demás, que es el fallo original.
    grupo: agrupa && t.empresa_id
      ? (nombreEmpresa(t.empresa_id) ?? t.empresa_id)
      : undefined,
  }))
  // Por empresa y luego por nombre: dentro de un grupo, alfabético; y los grupos salen en el
  // orden en que aparecen, que es el de `empresas`.
  if (!agrupa) return out.sort((a, b) => a.label.localeCompare(b.label))
  return out.sort((a, b) =>
    (a.grupo ?? '').localeCompare(b.grupo ?? '') || a.label.localeCompare(b.label))
}

/** Un filtro puesto, en palabras del dueño: lo que se pinta como chip y en la descarga. */
export interface FiltroActivo {
  clave: string
  label: string
  param: string
}

/** El nombre del parámetro de un filtro en la URL. */
export function paramDe(f: Filtro): string {
  return f.param ?? f.clave
}

/**
 * Los filtros PUESTOS, con su etiqueta humana ya resuelta.
 *
 * Es la única fuente de la frase «Últimos 3 meses · Empresa 1 · Vencidas»: la escribían a
 * mano diecinueve pantallas y por eso unas decían «PENDIENTE» y otra un UUID.
 */
export function filtrosActivos(filtros: Filtro[]): FiltroActivo[] {
  const out: FiltroActivo[] = []
  for (const f of filtros) {
    if (f.implicito || f.ocultarSi || !f.valor) continue
    const label = f.widget === 'toggle'
      ? f.label
      : (f.opciones?.find(o => o.valor === f.valor)?.label ?? f.valor)
    out.push({ clave: String(f.clave), label, param: paramDe(f) })
  }
  return out
}

/**
 * Lo que viaja a la descarga, GENERADO de la declaración.
 *
 * Aquí muere la clase de fallo «la pantalla filtra por X y el fichero no»: no hay un objeto
 * que escribir a mano y que se pueda quedar corto. Lo implícito SÍ viaja (es lo que
 * distingue la pestaña Gastos de la pestaña Cobros).
 */
export function filtroExport(filtros: Filtro[], base?: FiltroExport): FiltroExport {
  const out: FiltroExport = { ...base }
  for (const f of filtros) {
    if (f.ocultarSi || !f.valor || f.sinExportar) continue
    if (f.widget === 'toggle') {
      // Los booleanos del contrato (`archivadas`, `con_saldo`) no llevan valor de texto.
      ;(out as Record<string, unknown>)[f.clave] = f.valor === '1'
    } else {
      ;(out as Record<string, unknown>)[f.clave] = f.valor
    }
  }
  return out
}

/**
 * El resumen del menú de descarga, en las palabras del dueño.
 *
 * Lo que el fichero NO puede filtrar sale marcado. Es la única forma honesta: el desplegable
 * promete lo que se va a bajar, y callar la diferencia es la clase de fallo que este contrato
 * existe para cerrar.
 */
export function resumenDe(filtros: Filtro[]): string[] {
  const noExporta = new Set(
    filtros.filter(f => f.sinExportar).map(f => paramDe(f)),
  )
  return filtrosActivos(filtros).map(f =>
    noExporta.has(f.param) ? `${f.label} (el fichero no lo filtra)` : f.label,
  )
}

/**
 * ¿Este filtro tiene que aplicarlo el SERVIDOR en esta consulta?
 *
 * `servidor` siempre; `escalado` solo cuando el listado está recortado —mientras quepa
 * entero, el navegador da el mismo resultado sin gastar un viaje—.
 */
export function vaAlServidor(f: Filtro, hayMas: boolean): boolean {
  return f.donde === 'servidor' || (f.donde === 'escalado' && hayMas)
}

/**
 * Parámetro que le dice a la página «aplica los filtros en la consulta».
 *
 * Lo pone `<Filtros>` cuando sabe que el listado está truncado, porque el servidor no puede
 * saberlo antes de consultar y el navegador sí lo sabe del render anterior.
 */
export const PARAM_ESCALADA = 'srv'

/** Lee de la URL los filtros que la página debe aplicar en la consulta. */
export function filtrosDeUrl(
  params: Record<string, string | undefined>,
  claves: { clave: keyof FiltroExport; param?: string }[],
): FiltroExport {
  const out: FiltroExport = {}
  if (params[PARAM_ESCALADA] !== '1') return out
  for (const c of claves) {
    const v = params[c.param ?? String(c.clave)]
    if (v === undefined || v === '') continue
    ;(out as Record<string, unknown>)[c.clave] = v === '1' && esBooleano(c.clave) ? true : v
  }
  return out
}

/** Las claves del contrato que son booleanas, no texto. */
function esBooleano(clave: keyof FiltroExport): boolean {
  return clave === 'archivadas' || clave === 'con_saldo' || clave === 'con_descuento'
}
