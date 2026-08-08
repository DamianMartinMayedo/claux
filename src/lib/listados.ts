// Contrato común de los listados del módulo Contabilidad (Ventas, Gastos y cobros,
// Tesorería, CxC/CxP). Sin 'use server': tipos y helpers que usan las server actions y
// las vistas.
//
// Ojo al importarlo desde una vista: este fichero es client-safe a propósito (solo tipos y
// funciones puras). El registro de exportaciones NO lo es.

// El problema que resuelve: las cuatro funciones de listado traían la HISTORIA COMPLETA
// del negocio y filtraban en el cliente. Con dos años de datos eso son miles de filas por
// pantalla en una conexión de 3G, y encima los totales de cabecera sumaban todo mientras
// la tabla enseñaba un filtro — dos cifras que no cuadran y ninguna pista de por qué.
//
// Se agravó solo: una nómina confirmada pasó de escribir 2 filas a 5 (mig. 142-144), así
// que un negocio con dos empresas y nómina mensual añade ~120 filas al año únicamente por
// ahí, todas en Gastos y cobros.

import { hoyEnTz, sumarDias } from '@/lib/fecha-tz'

/** Techo de filas por consulta de listado. Con «Ver más» explícito, no scroll infinito:
 *  en 3G el scroll infinito es una promesa que no se puede cumplir. */
export const LIMITE_LISTADO = 500

/**
 * Techo de «Ver más». El listado ordena por fecha DESCENDENTE, así que el techo no
 * recorta «los primeros»: recorta **los más viejos**. Un negocio con 523 registros
 * veía los 500 recientes y creía que su histórico empezaba en enero —y el aviso le
 * decía «acota el rango», que para llegar a lo viejo no sirve de nada—. Con esto se
 * puede pedir más de una vez hasta traerlo todo, sin renunciar al techo que protege
 * la conexión en el primer pintado.
 */
export const TOPE_VER_MAS = 5_000

/**
 * Techo de filas de ESTA consulta.
 *
 * El de 500 protege el primer pintado, que es el que se paga en 3G. Pero **cuando
 * el dueño pide «Todo» explícitamente, «todo» tiene que ser todo**: el techo
 * recorta por fecha descendente, o sea que se come los registros más VIEJOS, y un
 * filtro que se llama «Todo» y omite filas en silencio miente. Con 523 registros,
 * el único de 2025 desaparecía y el histórico parecía empezar en enero — y el
 * aviso mandaba a «acotar el rango», que para llegar a lo antiguo no sirve.
 *
 * «Todo» llega como rango VACÍO (`desde: ''`), que es distinto de no haber pedido
 * nada (`undefined` → últimos 3 meses). Sigue habiendo techo, pero al nivel en el
 * que ya no es un recorte accidental sino una barbaridad de volumen.
 */
export function limiteDelFiltro(filtro?: FiltroListado): number {
  if (filtro?.limite) return Math.min(filtro.limite, TOPE_VER_MAS)
  const pidioTodo = filtro?.desde === '' && filtro?.hasta === ''
  return pidioTodo ? TOPE_VER_MAS : LIMITE_LISTADO
}

// ── Centinelas de los selectores «los que no tienen» ────────────────────────────
// Viven AQUÍ y no en `lib/exportar/tablas.ts` porque los usan las vistas, y ese fichero
// arrastra acciones de servidor: importarlo desde el navegador se lleva el registro entero
// de exportaciones al bundle.
//
// Un solo literal para todo el portal. Había dos para lo mismo (`__sin__` en Tesorería y
// CxC/CxP, `__sin_categoria__` en Productos) y el segundo se traducía a cadena vacía antes
// de mandarse a la descarga, o sea que pedir «Sin categoría» bajaba TODO el catálogo.

/** Selector de tercero: «los que no tienen» (CxC/CxP). */
export const SIN_TERCERO = '__sin__'

/** Selector de categoría: «las que no tienen» (Tesorería, Productos). */
export const SIN_CATEGORIA = '__sin__'

export interface FiltroListado {
  /** ISO `YYYY-MM-DD`. Ausente = sin límite inferior. */
  desde?: string
  hasta?: string
  /** Texto libre: número de documento, tercero, concepto o importe exacto. */
  q?: string
  /** Cuántas filas traer. Por defecto `LIMITE_LISTADO`. */
  limite?: number
  /**
   * Incluir lo archivado.
   *
   * Es filtro de SERVIDOR y no del navegador porque cambia qué se trae, no cómo se pinta: el
   * listado se traía las archivadas y las escondía en el cliente, así que **gastaban cupo del
   * techo de 500** y un negocio con mucho archivado veía muchas menos filas vivas de las que
   * creía, sin ninguna pista.
   */
  archivadas?: boolean

  // ── Filtros de la barra, cuando la vista los ESCALA al servidor ─────────────
  // Mismas claves que `FiltroExport` a propósito: es el mismo contrato, y tenerlas con dos
  // nombres distintos es exactamente cómo la pantalla y el fichero acabaron diciendo cosas
  // distintas. Solo las que SON columna; lo derivado (el estado de un gasto) no puede ir.
  empresa_id?: string
  tercero?:    string
  categoria?:  string
  estado?:     string
  tipo?:       string
  cuenta_id?:  string
  almacen_id?: string
  motivo?:     string
}

/**
 * «Hoy» de todos los filtros del portal, en la zona del NEGOCIO.
 *
 * Era `new Date().toISOString()`, o sea UTC. La Habana va a UTC−4/−5, así que a partir de
 * las 20:00 la fecha de UTC ya es la de mañana: el 31 de agosto por la noche, «Este mes»
 * pasaba a ser `{2026-09-01, 2026-09-01}` y **el listado salía vacío mientras la píldora
 * seguía diciendo «Este mes»**. Todo lo demás del repo (citas, reservas, dashboard,
 * reportes, el cron de tasas) ya usaba `hoyEnTz`; los filtros se habían quedado fuera.
 */
function hoy(): string {
  return hoyEnTz()
}

/**
 * Suma (o resta) meses a una fecha `YYYY-MM-DD` **sin desbordar el día**.
 *
 * `Date.UTC(y, m - 3, 31)` no es «hace tres meses»: si el mes destino no tiene 31 días, JS
 * rueda al siguiente. El 31 de mayo menos 3 meses daba «31 de febrero» → **3 de marzo**, y
 * la ventana de «Últimos 3 meses» se quedaba en 2 meses y 28 días. Como es el rango POR
 * DEFECTO de los cuatro listados de Contabilidad, el recorte era invisible: `presetDeFechas`
 * recalcula con la misma cuenta, así que la píldora seguía encendida.
 *
 * Aquí el día se recorta al último del mes destino, que es lo que significa «hace tres
 * meses» en un calendario: 31-may → 28-feb (29 en bisiesto), 31-jul → 30-abr.
 */
function sumarMeses(fechaISO: string, meses: number): string {
  const [y, m, d] = fechaISO.split('-').map(Number)
  const total   = (y * 12) + (m - 1) + meses
  const anio    = Math.floor(total / 12)
  const mes     = (total % 12) + 1
  const ultimo  = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  const dia     = Math.min(d, ultimo)
  const dd      = (n: number) => String(n).padStart(2, '0')
  return `${anio}-${dd(mes)}-${dd(dia)}`
}

/** Rango por defecto de Ventas, Gastos y Tesorería: los últimos `meses` meses.
 *
 *  CxC/CxP **no** lo usan a propósito: una deuda vieja no puede desaparecer del listado
 *  por un filtro que el dueño no ha puesto. Ahí el defecto es «todo».
 */
export function rangoUltimosMeses(meses: number, hoyISO?: string): { desde: string; hasta: string } {
  const ref = hoyISO ?? hoy()
  return { desde: sumarMeses(ref, -meses), hasta: ref }
}

/**
 * El orden de un listado de AGENDA sigue al rango que se está mirando.
 *
 * Reservas y Citas ordenaban `fecha` descendente sobre un rango por defecto que es
 * hoy → +30 días: con paginación de 10, lo de hoy caía en la última página y lo
 * primero que veía el dueño era la reserva de dentro de un mes. Pero invertirlo a
 * secas rompe el otro caso: «Mes pasado» es un histórico, y un histórico se lee de lo
 * más reciente hacia atrás.
 *
 * Regla: si el rango alcanza a hoy o más allá, **ascendente** (lo primero que hay que
 * atender, arriba); si se cierra en el pasado, descendente.
 */
export function ordenDelRango(desde?: string | null, hasta?: string | null, hoyISO?: string): { ascendente: boolean } {
  const ref = hoyISO ?? hoy()
  // Sin tope superior («Todo») el rango incluye el futuro: mira hacia delante.
  if (!hasta) return { ascendente: true }
  void desde
  return { ascendente: hasta >= ref }
}

export type PresetRango =
  | 'mes' | 'mes_pasado' | 'trimestre' | 'anio' | 'todo' | 'personalizado'
  // Presets de FUTURO, para un rango que no mira lo que pasó sino lo que viene: el de
  // Suscripciones se aplica a `fecha_proximo_cobro`. Ahí «Mes pasado» y «Últimos 3 meses»
  // no significan nada, y estaban ofrecidos.
  | 'prox_30' | 'prox_3_meses' | 'vencidos'

/**
 * Vocabulario de los presets de un LISTADO: ventanas abiertas hasta hoy.
 *
 * **No es el de Reportes y no tiene por qué serlo**: un listado responde «¿qué ha pasado
 * hasta ahora?» y un informe «¿cómo cerró el período?». Reportes nombra tramos CERRADOS por
 * su nombre propio («Julio», «2.º trimestre», «2026») justamente para que no se confundan;
 * dos comentarios del repo afirmaban que los dos juegos coincidían, y era falso.
 */
export const PRESETS_RANGO: { id: PresetRango; label: string }[] = [
  { id: 'mes',        label: 'Este mes' },
  { id: 'mes_pasado', label: 'Mes pasado' },
  { id: 'trimestre',  label: 'Últimos 3 meses' },
  { id: 'anio',       label: 'Este año' },
  { id: 'todo',       label: 'Todo' },
  // Futuro (Suscripciones). Van en la misma lista para que `presetDeFechas` y el chip del
  // menú de descarga los reconozcan, y cada pantalla elige los suyos con `presets={[...]}`.
  { id: 'vencidos',     label: 'Vencidos' },
  { id: 'prox_30',      label: 'Próximos 30 días' },
  { id: 'prox_3_meses', label: 'Próximos 3 meses' },
]

/** Los presets de un listado HISTÓRICO, en su orden. Es el juego por defecto. */
export const PRESETS_HISTORICO: PresetRango[] = ['mes', 'mes_pasado', 'trimestre', 'anio', 'todo']

/** Los presets de un listado de cobros FUTUROS, en su orden (Suscripciones). */
export const PRESETS_FUTURO: PresetRango[] = ['vencidos', 'mes', 'prox_30', 'prox_3_meses', 'todo']

/** Fechas de un preset. `todo` devuelve cadenas vacías: sin límites. */
export function fechasDePreset(preset: PresetRango, hoyISO?: string): { desde: string; hasta: string } {
  const ref = hoyISO ?? hoy()
  const [y, m] = ref.split('-').map(Number)
  const dosDigitos = (n: number) => String(n).padStart(2, '0')
  const finDeMes = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().split('T')[0]

  switch (preset) {
    case 'mes':        return { desde: `${y}-${dosDigitos(m)}-01`, hasta: ref }
    case 'mes_pasado': {
      const ym = m === 1 ? y - 1 : y
      const mm = m === 1 ? 12 : m - 1
      return { desde: `${ym}-${dosDigitos(mm)}-01`, hasta: finDeMes(ym, mm) }
    }
    case 'trimestre':  return rangoUltimosMeses(3, ref)
    case 'anio':       return { desde: `${y}-01-01`, hasta: ref }
    case 'todo':       return { desde: '', hasta: '' }
    // ── Futuro ──
    // «Vencidos» es lo que YA tenía que haberse cobrado: sin límite inferior (una deuda de
    // hace dos años sigue siendo deuda) y hasta ayer, porque lo de hoy todavía no ha vencido.
    case 'vencidos':     return { desde: '', hasta: sumarDias(ref, -1) }
    case 'prox_30':      return { desde: ref, hasta: sumarDias(ref, 30) }
    case 'prox_3_meses': return { desde: ref, hasta: sumarMeses(ref, 3) }
    // `personalizado` NO es un rango calculable: son las fechas que escribió el dueño. Caía
    // en el `default` y devolvía `{'',''}`, o sea **«Todo»** — una bomba de relojería para el
    // día que alguien añadiera la píldora a `PRESETS_RANGO` y esperase que abriera el panel.
    case 'personalizado': return { desde: '', hasta: '' }
  }
}

/** ¿A qué preset corresponde este rango? Para que la píldora activa sobreviva a un
 *  refresco y a volver del detalle (el rango viaja en la URL). */
export function presetDeFechas(desde: string, hasta: string, hoyISO?: string): PresetRango {
  if (!desde && !hasta) return 'todo'
  for (const p of PRESETS_RANGO) {
    if (p.id === 'todo') continue
    const f = fechasDePreset(p.id, hoyISO)
    if (f.desde === desde && f.hasta === hasta) return p.id
  }
  return 'personalizado'
}

/**
 * Normaliza el texto de búsqueda para un `ilike` de Postgres.
 *
 * Escapa `%` y `_` (los comodines del patrón) para que buscar «50%» no devuelva media
 * tabla, y `\` porque es el carácter de escape. Devuelve `null` si no queda nada que
 * buscar: la consulta no debe añadir un filtro vacío que no filtra pero cuesta.
 */
export function patronBusqueda(q: string | undefined | null): string | null {
  const t = (q ?? '').trim()
  if (!t) return null
  return `%${t.replace(/[\\%_]/g, c => `\\${c}`)}%`
}

/** ¿El texto buscado es un importe? Entonces también se busca por monto exacto. */
export function importeBuscado(q: string | undefined | null): number | null {
  const t = (q ?? '').trim().replace(',', '.')
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
