// ── Reglas de columna: el arreglo del archivo, escrito una vez y ejecutable ───
//
// Una columna que viene sucia SIEMPRE de la misma forma —fecha en texto con el
// mes en letra, importe con coma decimal, código con un prefijo que sobra— hoy
// se arregla en el Excel y se vuelve a subir. Eso deja una migración que nadie
// puede volver a explicar: el archivo que se importó ya no es el que dio el
// cliente, y lo que se le hizo por el camino vive en la cabeza de quien lo hizo.
//
// Una regla es un dato: `{ columna, transformacion, parametros }`. Viaja en el
// mapeo, se guarda con el lote y la ejecuta el MOTOR —siempre igual, en el
// dry-run y en el commit—. La IA puede proponerla (`lib/ia/equipo`), pero no
// transforma ningún dato: escribe la regla y la ve aplicada quien decide.
//
// El catálogo es CERRADO a propósito. Con una transformación libre (una regex,
// una fórmula) el importador pasaría a ejecutar lo que escriba un modelo; aquí
// lo peor que puede proponer es una de estas nueve, con sus parámetros
// validados, y el efecto se ve sobre tres filas antes de aceptarla.
//
// Regla de oro de la ejecución: **lo que una regla no sabe leer, lo deja como
// está**. Nada de inventarse un valor por defecto — que la fila falle en el
// adaptador con su motivo de siempre es mucho mejor que una fecha o un importe
// silenciosamente cambiados.

import { norm } from './util'

export type Transformacion =
  | 'fecha' | 'numero' | 'quitar_texto' | 'reemplazar' | 'partir'
  | 'limpiar' | 'caja' | 'si_no' | 'vaciar_si'

export interface ReglaColumna {
  /** Cabecera EXACTA del archivo (las reglas son de la columna, no del campo). */
  columna:        string
  transformacion: Transformacion
  /** Siempre texto: viaja a la base dentro del mapeo y vuelve de un JSON. */
  parametros:     Record<string, string>
}

/** Un parámetro del catálogo. Con `opciones`, solo valen esas. */
interface ParamDef {
  nombre:    string
  etiqueta:  string
  opciones?: { valor: string; etiqueta: string }[]
  /** Lo que se usa si no viene. Sin defecto, el parámetro es obligatorio. */
  defecto?:  string
}

interface DefTransformacion {
  etiqueta:    string
  /** Qué hace, en la frase que ve la IA en el catálogo y la persona en el panel. */
  descripcion: string
  params:      ParamDef[]
  aplicar:     (valor: string, p: Record<string, string>) => string
}

// ── Fechas ───────────────────────────────────────────────────────────────────

/** Prefijo de tres letras → mes. Español e inglés: los exports vienen de ambos. */
const MESES: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7,
  ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
}

function iso(a: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  if (a < 100) a += a < 70 ? 2000 : 1900
  const f = new Date(Date.UTC(a, m - 1, d))
  if (f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null   // 31 de febrero
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** «12 de enero de 2025», «12-ene-25», «Enero 12, 2025». */
function fechaEnLetra(raw: string): string | null {
  const s = norm(raw)
  const mes = Object.keys(MESES).find(p => new RegExp(`(^|[^a-z])${p}`, 'i').test(s))
  if (!mes) return null
  const nums = s.match(/\d+/g) ?? []
  if (nums.length < 2) return null
  // El año es el número de cuatro cifras; si el archivo lo escribe con dos, es
  // el último (nadie escribe «2025 de enero de 12»).
  const iAno = nums.findIndex(n => n.length === 4)
  const posAno = iAno >= 0 ? iAno : nums.length - 1
  const dia = nums.find((_, i) => i !== posAno)
  return dia ? iso(+nums[posAno], MESES[mes], +dia) : null
}

const ORDENES: Record<string, [number, number, number]> = {
  // [posición del día, del mes, del año] entre los tres números de la celda
  dia_primero: [0, 1, 2],
  mes_primero: [1, 0, 2],
  ano_primero: [2, 1, 0],
}

function fechaConOrden(raw: string, orden: string): string | null {
  const nums = raw.trim().match(/^(\d{1,4})[-/. ](\d{1,2})[-/. ](\d{1,4})/)
  if (!nums) return null
  const [d, m, a] = ORDENES[orden] ?? ORDENES.dia_primero
  return iso(+nums[a + 1], +nums[m + 1], +nums[d + 1])
}

// ── Números ──────────────────────────────────────────────────────────────────

/**
 * Formato declarado, no adivinado. `parseNumero` (util.ts) decide por la FORMA
 * del número y acierta casi siempre; casi. «1.234» son mil doscientos treinta y
 * cuatro o uno coma doscientos treinta y cuatro según el archivo, y solo lo sabe
 * quien lo mira. Cuando una columna entera viene así, esta regla lo zanja.
 */
function numeroConDecimal(raw: string, decimal: string): string | null {
  const limpio = raw.replace(/[\s ]/g, '').replace(/^[^\d,.\-(]+/, '').replace(/[^\d,.)]+$/, '')
  // Negativo entre paréntesis: (1.234,56) es lo que escupen los contables.
  const negativo = /^\(.*\)$/.test(limpio)
  const cuerpo = negativo ? limpio.slice(1, -1) : limpio
  if (!/^-?[\d.,]+$/.test(cuerpo) || !/\d/.test(cuerpo)) return null
  const miles = decimal === 'coma' ? '.' : ','
  const n = Number(
    cuerpo.split(miles).join('').replace(decimal === 'coma' ? ',' : '.', '.'),
  )
  if (!Number.isFinite(n)) return null
  // Se devuelve en formato máquina: lo relee `parseNumero` sin ambigüedad posible.
  return String(negativo ? -n : n)
}

// ── El catálogo ──────────────────────────────────────────────────────────────

export const TRANSFORMACIONES: Record<Transformacion, DefTransformacion> = {
  fecha: {
    etiqueta: 'Arreglar la fecha',
    descripcion: 'Convierte la fecha al formato del sistema (aaaa-mm-dd). Úsala cuando la columna trae el mes en letra, el mes delante del día (formato de EE.UU.) o la fecha con la hora pegada.',
    params: [{
      nombre: 'formato', etiqueta: 'Cómo viene', defecto: 'dia_primero',
      opciones: [
        { valor: 'dia_primero', etiqueta: 'Día, mes, año (12/03/2025 = 12 de marzo)' },
        { valor: 'mes_primero', etiqueta: 'Mes, día, año (03/12/2025 = 12 de marzo)' },
        { valor: 'ano_primero', etiqueta: 'Año, mes, día (2025/03/12)' },
        { valor: 'texto',       etiqueta: 'Con el mes en letra (12 de marzo de 2025)' },
      ],
    }],
    aplicar: (v, p) => {
      const f = p.formato === 'texto' ? fechaEnLetra(v) : fechaConOrden(v, p.formato)
      return f ?? v
    },
  },
  numero: {
    etiqueta: 'Arreglar el número',
    descripcion: 'Lee el importe con el separador decimal que le digas y lo deja en formato del sistema. Úsala solo si la columna es ambigua (miles y decimales con el mismo signo) o trae negativos entre paréntesis.',
    params: [{
      nombre: 'decimal', etiqueta: 'Separador decimal', defecto: 'coma',
      opciones: [
        { valor: 'coma',  etiqueta: 'Coma decimal (1.234,56)' },
        { valor: 'punto', etiqueta: 'Punto decimal (1,234.56)' },
      ],
    }],
    aplicar: (v, p) => numeroConDecimal(v, p.decimal) ?? v,
  },
  quitar_texto: {
    etiqueta: 'Quitar un texto',
    descripcion: 'Quita un texto fijo del valor (un prefijo como "PROV-", un sufijo como " CUP", o todas sus apariciones).',
    params: [
      { nombre: 'texto', etiqueta: 'Texto que sobra' },
      {
        nombre: 'donde', etiqueta: 'Dónde', defecto: 'inicio',
        opciones: [
          { valor: 'inicio',     etiqueta: 'Al principio' },
          { valor: 'fin',        etiqueta: 'Al final' },
          { valor: 'cualquiera', etiqueta: 'En cualquier sitio' },
        ],
      },
    ],
    aplicar: (v, p) => {
      const t = p.texto
      if (!t) return v
      if (p.donde === 'fin')    return v.endsWith(t)   ? v.slice(0, -t.length).trim() : v
      if (p.donde === 'inicio') return v.startsWith(t) ? v.slice(t.length).trim()     : v
      return v.split(t).join('').trim()
    },
  },
  reemplazar: {
    etiqueta: 'Cambiar un texto por otro',
    descripcion: 'Sustituye todas las apariciones de un texto literal por otro. No es una expresión regular: se busca tal cual.',
    params: [
      { nombre: 'buscar', etiqueta: 'Buscar' },
      { nombre: 'poner',  etiqueta: 'Poner',  defecto: '' },
    ],
    aplicar: (v, p) => (p.buscar ? v.split(p.buscar).join(p.poner ?? '').trim() : v),
  },
  partir: {
    etiqueta: 'Quedarse con un trozo',
    descripcion: 'Parte el valor por un separador y se queda con un trozo. Para columnas como "Categoría > Subcategoría" o "Nombre (código)".',
    params: [
      { nombre: 'separador', etiqueta: 'Separador' },
      {
        nombre: 'parte', etiqueta: 'Trozo', defecto: '1',
        opciones: [
          { valor: '1',      etiqueta: 'El primero' },
          { valor: '2',      etiqueta: 'El segundo' },
          { valor: 'ultima', etiqueta: 'El último' },
        ],
      },
    ],
    aplicar: (v, p) => {
      if (!p.separador) return v
      const trozos = v.split(p.separador).map(t => t.trim()).filter(Boolean)
      if (trozos.length < 2) return v
      const t = p.parte === 'ultima' ? trozos[trozos.length - 1] : trozos[Number(p.parte) - 1]
      return t ?? v
    },
  },
  limpiar: {
    etiqueta: 'Limpiar espacios',
    descripcion: 'Quita los espacios de sobra: los de los extremos, los repetidos de en medio y los espacios duros que arrastra Excel.',
    params: [],
    aplicar: v => v.replace(/[\s ]+/g, ' ').trim(),
  },
  caja: {
    etiqueta: 'Cambiar mayúsculas',
    descripcion: 'Pasa el texto a MAYÚSCULAS, a minúsculas o a Primera Letra De Cada Palabra. Para archivos que traen los nombres gritados.',
    params: [{
      nombre: 'caja', etiqueta: 'Cómo', defecto: 'primera',
      opciones: [
        { valor: 'primera',    etiqueta: 'Primera Letra De Cada Palabra' },
        { valor: 'mayusculas', etiqueta: 'TODO EN MAYÚSCULAS' },
        { valor: 'minusculas', etiqueta: 'todo en minúsculas' },
      ],
    }],
    aplicar: (v, p) => {
      if (p.caja === 'mayusculas') return v.toUpperCase()
      if (p.caja === 'minusculas') return v.toLowerCase()
      // El punto y la coma cuentan como separador: sin eso «CARNICOS S.A.» sale
      // «Carnicos S.a.», que es peor que dejarlo como estaba.
      return v.toLowerCase().replace(/(^|[\s(/.,'-])(\p{L})/gu, (_, a, b: string) => a + b.toUpperCase())
    },
  },
  si_no: {
    etiqueta: 'Normalizar Sí/No',
    descripcion: 'Convierte a "Sí" o "No" las marcas del archivo (X, 1, 0, TRUE, VERDADERO…). Lo que no reconoce lo deja igual.',
    params: [],
    aplicar: v => {
      const s = norm(v)
      if (['si', 'sí', 's', 'x', '1', 'true', 'verdadero', 'yes', 'y'].includes(s)) return 'Sí'
      if (['no', 'n', '0', 'false', 'falso'].includes(s)) return 'No'
      return v
    },
  },
  vaciar_si: {
    etiqueta: 'Tratar como vacío',
    descripcion: 'Deja la celda en blanco cuando dice una de estas marcas de "sin dato" (N/A, --, null, sin datos…). Sepáralas con punto y coma.',
    params: [{ nombre: 'valores', etiqueta: 'Marcas de vacío', defecto: 'N/A;NA;--;-;null;sin datos' }],
    aplicar: (v, p) => {
      const marcas = (p.valores ?? '').split(';').map(m => norm(m)).filter(Boolean)
      return marcas.includes(norm(v)) ? '' : v
    },
  },
}

export const CLAVES_TRANSFORMACION = Object.keys(TRANSFORMACIONES) as Transformacion[]

export function esTransformacion(v: unknown): v is Transformacion {
  return typeof v === 'string' && v in TRANSFORMACIONES
}

/**
 * Valida una regla que viene de fuera (del modelo o del propio lote guardado) y
 * la deja con sus parámetros completos. Devuelve null si no se sostiene: una
 * transformación que no existe, una opción que no está en la lista o un
 * parámetro obligatorio en blanco. Nada de arreglarla a medias — una regla mal
 * entendida transforma bien tres filas y mal las otras cuatrocientas.
 */
export function normalizarRegla(bruto: unknown, cabeceras?: string[]): ReglaColumna | null {
  if (!bruto || typeof bruto !== 'object') return null
  const o = bruto as Record<string, unknown>
  const columna = String(o.columna ?? '').trim()
  const clave = String(o.transformacion ?? '').trim()
  if (!columna || !esTransformacion(clave)) return null
  if (cabeceras && !cabeceras.includes(columna)) return null   // columna inventada

  const entrada = (o.parametros && typeof o.parametros === 'object' ? o.parametros : {}) as Record<string, unknown>
  const parametros: Record<string, string> = {}
  for (const def of TRANSFORMACIONES[clave].params) {
    // Los de texto NO se recortan: el espacio puede ser el valor —quitar « CUP»
    // del final, partir por « - »— y recortarlo convierte la regla en otra.
    const crudo = String(entrada[def.nombre] ?? '')
    const valor = (def.opciones ? crudo.trim() : crudo) || def.defecto
    if (valor === undefined) return null                                    // obligatorio sin valor
    if (def.opciones && !def.opciones.some(x => x.valor === valor)) return null
    parametros[def.nombre] = valor
  }
  return { columna, transformacion: clave, parametros }
}

/** Las reglas de cada columna, en el orden en que se escribieron. */
export function indiceReglas(reglas?: ReglaColumna[]): Map<string, ReglaColumna[]> {
  const mapa = new Map<string, ReglaColumna[]>()
  for (const r of reglas ?? []) {
    const ya = mapa.get(r.columna)
    if (ya) ya.push(r)
    else    mapa.set(r.columna, [r])
  }
  return mapa
}

/** Aplica las reglas de una columna, en orden. Ver la regla de oro de arriba. */
export function aplicarReglas(valor: string, reglas: ReglaColumna[] | undefined): string {
  let v = valor
  for (const r of reglas ?? []) {
    try {
      v = TRANSFORMACIONES[r.transformacion].aplicar(v, r.parametros)
    } catch {
      // Una transformación no puede romper la importación entera: si algo se le
      // atraganta, esa celda sigue como estaba y el adaptador dirá lo suyo.
    }
  }
  return v
}

/** «Fecha · Arreglar la fecha (con el mes en letra)» — para el panel y la traza. */
export function etiquetaRegla(r: ReglaColumna): string {
  const def = TRANSFORMACIONES[r.transformacion]
  const detalle = def.params
    .map(p => {
      const v = r.parametros[p.nombre]
      if (!v) return null
      const op = p.opciones?.find(x => x.valor === v)
      return op ? op.etiqueta.replace(/\s*\(.*\)$/, '') : `${p.etiqueta.toLowerCase()}: «${v}»`
    })
    .filter(Boolean)
    .join(' · ')
  return detalle ? `${def.etiqueta} (${detalle})` : def.etiqueta
}

/**
 * El catálogo en la forma en que lo lee la IA. Se genera desde `TRANSFORMACIONES`
 * a propósito: escrito a mano en el prompt, una transformación nueva quedaría
 * fuera del catálogo que ve el modelo sin que nadie se entere.
 */
export function catalogoParaIa(): string {
  return CLAVES_TRANSFORMACION.map(clave => {
    const def = TRANSFORMACIONES[clave]
    const params = def.params.map(p => {
      const ops = p.opciones ? ` (uno de: ${p.opciones.map(o => o.valor).join(', ')})` : ''
      return `${p.nombre}${ops}${p.defecto !== undefined ? ' [opcional]' : ''}`
    })
    return `- ${clave}: ${def.descripcion}${params.length ? ` Parámetros: ${params.join('; ')}.` : ' Sin parámetros.'}`
  }).join('\n')
}
