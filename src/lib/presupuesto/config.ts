// ── Estructura del presupuesto de instalación ──
//
// Aquí vive lo que NO es un precio: los tipos, el catálogo de formatos y la clave del módulo
// base. Los NÚMEROS —tarifa/hora, horas fijas y el coste de cada línea— ya no están aquí:
// viven en la tabla `presupuesto_parametros` y en `settings` (mig. 168), y se editan en
// /admin/configuracion → Facturación sin tocar código ni desplegar.
//
// Lo que sigue en el código es la ESTRUCTURA, porque está atada a las claves reales de
// `modulos_catalogo` (`base`, `catalogo_qr`, `inventario`, `rrhh`, `caja`, `agenda`,
// `reservas_citas`): qué línea existe y a qué módulo pertenece no es una cifra que el dueño
// ajuste, es una consecuencia de qué módulos vende el producto.

/**
 * Nivel comercial del cliente. Ya NO afecta a la hora de instalación —esa es única
 * y configurable—: solo elige la COLUMNA de precio de los módulos en la cuota
 * mensual. El tipo vive en `lib/niveles.ts`; aquí solo se reexporta para no
 * romper a quien ya lo importaba de este módulo.
 */
export type { Nivel } from '@/lib/niveles'

export type FormatoDatos = 'excel' | 'papel' | 'sistema' | 'cero'

export const FORMATOS: { key: FormatoDatos; label: string }[] = [
  { key: 'excel',   label: 'Ya están en una hoja de cálculo organizada (Excel/Sheets)' },
  { key: 'papel',   label: 'En papel, fotos o dispersos (cuaderno, WhatsApp, memoria)' },
  { key: 'sistema', label: 'Vienen de otro sistema exportable' },
  { key: 'cero',    label: 'No aplica / empieza desde cero' },
]

/**
 * Las cuatro fases de una instalación, con su nombre.
 *
 * Vive aquí, y no como literal dentro del cálculo, porque el mismo texto lo necesitan tres
 * sitios: el desglose que se calcula, los interruptores del formulario y lo que lee el
 * cliente en el PDF. Con el nombre escrito en cada sitio, quitar una fase en la pantalla y
 * quitarla del precio dejaban de referirse a lo mismo.
 *
 * **Una fase se puede excluir**: hay instalaciones sin nada que migrar (un negocio que
 * empieza de cero) y clientes que no quieren formación. Antes no había forma de quitarlas y
 * el presupuesto cobraba una puesta en marcha que nadie iba a hacer.
 */
export const FASES_INSTALACION = [
  { num: 1, etiqueta: 'Alta y configuración base' },
  { num: 2, etiqueta: 'Puesta en marcha' },
  { num: 3, etiqueta: 'Formación' },
  { num: 4, etiqueta: 'Validación y cierre' },
] as const

export type NumeroFase = (typeof FASES_INSTALACION)[number]['num']

/** Nombre de una fase por su número. */
export function etiquetaFase(num: NumeroFase): string {
  return FASES_INSTALACION.find(f => f.num === num)?.etiqueta ?? `Fase ${num}`
}

/** Clave del módulo base de contabilidad: se excluye de las horas extra de formación,
 *  que ya tiene sus horas base. */
export const CLAVE_BASE = 'base'

/** Clave del punto de venta: su formación cuesta distinto que la de un módulo normal. */
export const CLAVE_CAJA = 'caja'

// ── Los parámetros que vienen de la BD ──────────────────────────────────────

/**
 * Una línea presupuestable, con su coste en horas.
 *
 * El precio escala con el volumen, que es lo que antes no pasaba: teclear 20 productos o
 * 5.000 daba exactamente el mismo presupuesto.
 *
 *   horas = horas_base + ceil( max(0, volumen − incluido) / tramo ) × horas_por_tramo
 */
export interface LineaParametro {
  clave:           string
  /** 1 = configuración inicial · 2 = puesta en marcha. */
  fase:            1 | 2
  etiqueta:        string
  /** Clave de `modulos_catalogo` que activa la línea; `null` = siempre. */
  modulo:          string | null
  horas_base:      number
  incluido:        number
  tramo:           number
  horas_por_tramo: number
  orden:           number
}

/** Todo lo que el cálculo necesita saber de precios. Se carga en el servidor y se pasa
 *  ENTERO al cálculo, que es isomórfico: la vista previa del navegador y el recálculo
 *  autoritativo del servidor tienen que partir de los mismos números. */
export interface ParametrosPresupuesto {
  /** $/h base. En el presupuesto se puede ajustar para ese cliente. */
  tarifaHora:           number
  /** €/h base: precio PROPIO, no la tarifa en dólares pasada por el cambio del día. */
  tarifaHoraEur:        number
  horasAlta:            number
  horasFormacionBase:   number
  horasFormacionModulo: number
  horasFormacionCaja:   number
  horasCierre:          number
  lineas:               LineaParametro[]
}

// ── Del volumen tecleado al NIVEL que hace falta ────────────────────────────
//
// `presupuesto_parametros` recoge 14 volúmenes; seis de ellos son exactamente las
// dimensiones que `nivel_limites` limita. Con esos seis se sabe, sin preguntar
// nada más, si el negocio cabe en el nivel elegido.
//
// Los otros ocho NO están aquí a propósito: `monedas`, `turnos_*`, `categorias_*`
// y `config_nomina` no tienen tope comercial, y `productos_catalogo` es el
// catálogo QR —la misma tabla que Inventario, pero el cliente puede tener catálogo
// sin llevar inventario, así que contarlo contra el tope de productos inflaría el
// nivel de quien solo enseña un menú—.

/** Clave en `presupuesto_parametros` → dimensión en `nivel_limites`. */
export const PARAMETRO_A_DIMENSION: Record<string, string> = {
  empresas:             'empresas',
  cuentas_tesoreria:    'cuentas_tesoreria',
  puntos_venta:         'puntos_venta',
  productos_inventario: 'productos',
  almacenes:            'almacenes',
  empleados:            'trabajadores',
}

export interface DimensionApretada {
  dimension: string
  volumen:   number
  tope:      number
}

/**
 * El nivel más bajo de `orden` en el que caben TODOS los volúmenes tecleados, y
 * qué se pasa del nivel elegido.
 *
 * `limitesPorNivel` viene de `nivel_limites` (clave de nivel → dimensión → tope,
 * `null` = sin tope), en el orden comercial. Un nivel sin fila para una dimensión
 * se trata como sin tope: es lo mismo que hace el portal al no encontrarla, y
 * bloquear por una fila que falta sería inventarse un límite.
 */
export function nivelMinimoPorVolumenes(
  ordenNiveles: string[],
  limitesPorNivel: Record<string, Record<string, number | null>>,
  volumenes: Record<string, number>,
): string | null {
  for (const nivel of ordenNiveles) {
    if (dimensionesApretadas(limitesPorNivel[nivel] ?? {}, volumenes).length === 0) return nivel
  }
  return ordenNiveles.length ? ordenNiveles[ordenNiveles.length - 1] : null
}

/** Qué dimensiones NO caben en ese nivel, con su tope, para poder decirlo. */
export function dimensionesApretadas(
  limites: Record<string, number | null>,
  volumenes: Record<string, number>,
): DimensionApretada[] {
  const fuera: DimensionApretada[] = []
  for (const [clave, dimension] of Object.entries(PARAMETRO_A_DIMENSION)) {
    const v = Number(volumenes[clave]) || 0
    const tope = limites[dimension]
    if (v > 0 && typeof tope === 'number' && v > tope) fuera.push({ dimension, volumen: v, tope })
  }
  return fuera
}

/** Claves de `settings` con los escalares. Una sola lista para leerlos y para el formulario
 *  de Configuración, que si no se desincronizan. */
export const AJUSTES_PRESUPUESTO = {
  tarifaHora:           { key: 'tarifa_hora_usd',                    def: '20', label: 'Tarifa por hora (USD)' },
  tarifaHoraEur:        { key: 'tarifa_hora_eur',                    def: '20', label: 'Tarifa por hora (EUR)' },
  horasAlta:            { key: 'presupuesto_horas_alta',             def: '4',  label: 'Horas de alta y configuración base' },
  horasFormacionBase:   { key: 'presupuesto_horas_formacion_base',   def: '2',  label: 'Horas de formación (base)' },
  horasFormacionModulo: { key: 'presupuesto_horas_formacion_modulo', def: '1',  label: 'Horas de formación por módulo' },
  horasFormacionCaja:   { key: 'presupuesto_horas_formacion_caja',   def: '2',  label: 'Horas de formación del punto de venta' },
  horasCierre:          { key: 'presupuesto_horas_cierre',           def: '2',  label: 'Horas de validación y cierre' },
} as const

export type ClaveAjustePresupuesto = keyof typeof AJUSTES_PRESUPUESTO
