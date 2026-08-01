// Contrato común de los listados del módulo Contabilidad (Ventas, Gastos y cobros,
// Tesorería, CxC/CxP). Sin 'use server': tipos y helpers que usan las server actions y
// las vistas.
//
// El problema que resuelve: las cuatro funciones de listado traían la HISTORIA COMPLETA
// del negocio y filtraban en el cliente. Con dos años de datos eso son miles de filas por
// pantalla en una conexión de 3G, y encima los totales de cabecera sumaban todo mientras
// la tabla enseñaba un filtro — dos cifras que no cuadran y ninguna pista de por qué.
//
// Se agravó solo: una nómina confirmada pasó de escribir 2 filas a 5 (mig. 142-144), así
// que un negocio con dos empresas y nómina mensual añade ~120 filas al año únicamente por
// ahí, todas en Gastos y cobros.

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

export interface FiltroListado {
  /** ISO `YYYY-MM-DD`. Ausente = sin límite inferior. */
  desde?: string
  hasta?: string
  /** Texto libre: número de documento, tercero, concepto o importe exacto. */
  q?: string
  /** Cuántas filas traer. Por defecto `LIMITE_LISTADO`. */
  limite?: number
}

/** Rango por defecto de Ventas, Gastos y Tesorería: los últimos `meses` meses.
 *
 *  CxC/CxP **no** lo usan a propósito: una deuda vieja no puede desaparecer del listado
 *  por un filtro que el dueño no ha puesto. Ahí el defecto es «todo».
 */
export function rangoUltimosMeses(meses: number, hoyISO?: string): { desde: string; hasta: string } {
  const hoy = hoyISO ?? new Date().toISOString().split('T')[0]
  const [y, m, d] = hoy.split('-').map(Number)
  const inicio = new Date(Date.UTC(y, m - 1 - meses, d))
  return { desde: inicio.toISOString().split('T')[0], hasta: hoy }
}

export type PresetRango = 'mes' | 'mes_pasado' | 'trimestre' | 'anio' | 'todo' | 'personalizado'

export const PRESETS_RANGO: { id: PresetRango; label: string }[] = [
  { id: 'mes',        label: 'Este mes' },
  { id: 'mes_pasado', label: 'Mes pasado' },
  { id: 'trimestre',  label: 'Últimos 3 meses' },
  { id: 'anio',       label: 'Este año' },
  { id: 'todo',       label: 'Todo' },
]

/** Fechas de un preset. `todo` devuelve cadenas vacías: sin límites. */
export function fechasDePreset(preset: PresetRango, hoyISO?: string): { desde: string; hasta: string } {
  const hoy = hoyISO ?? new Date().toISOString().split('T')[0]
  const [y, m] = hoy.split('-').map(Number)
  const dosDigitos = (n: number) => String(n).padStart(2, '0')
  const finDeMes = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().split('T')[0]

  switch (preset) {
    case 'mes':        return { desde: `${y}-${dosDigitos(m)}-01`, hasta: hoy }
    case 'mes_pasado': {
      const ym = m === 1 ? y - 1 : y
      const mm = m === 1 ? 12 : m - 1
      return { desde: `${ym}-${dosDigitos(mm)}-01`, hasta: finDeMes(ym, mm) }
    }
    case 'trimestre':  return rangoUltimosMeses(3, hoy)
    case 'anio':       return { desde: `${y}-01-01`, hasta: hoy }
    case 'todo':       return { desde: '', hasta: '' }
    default:           return { desde: '', hasta: '' }
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
