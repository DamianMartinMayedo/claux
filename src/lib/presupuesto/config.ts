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

/** Tarifa comercial del cliente. Ya NO afecta a la hora de instalación —esa es única y
 *  configurable—: solo elige el precio de los módulos en la cuota mensual. */
export type TarifaTipo = 'fundador' | 'estandar'

export type FormatoDatos = 'excel' | 'papel' | 'sistema' | 'cero'

export const FORMATOS: { key: FormatoDatos; label: string }[] = [
  { key: 'excel',   label: 'Ya están en una hoja de cálculo organizada (Excel/Sheets)' },
  { key: 'papel',   label: 'En papel, fotos o dispersos (cuaderno, WhatsApp, memoria)' },
  { key: 'sistema', label: 'Vienen de otro sistema exportable' },
  { key: 'cero',    label: 'No aplica / empieza desde cero' },
]

/** Umbral orientativo para sugerir tarifa "fundador" (primeros N clientes). */
export const LIMITE_FUNDADOR = 20

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
  /** 1 = configuración inicial · 2 = migración de datos. */
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
  horasAlta:            number
  horasFormacionBase:   number
  horasFormacionModulo: number
  horasFormacionCaja:   number
  horasCierre:          number
  lineas:               LineaParametro[]
}

/** Claves de `settings` con los escalares. Una sola lista para leerlos y para el formulario
 *  de Configuración, que si no se desincronizan. */
export const AJUSTES_PRESUPUESTO = {
  tarifaHora:           { key: 'tarifa_hora_usd',                    def: '20', label: 'Tarifa por hora (USD)' },
  horasAlta:            { key: 'presupuesto_horas_alta',             def: '4',  label: 'Horas de alta y configuración base' },
  horasFormacionBase:   { key: 'presupuesto_horas_formacion_base',   def: '2',  label: 'Horas de formación (base)' },
  horasFormacionModulo: { key: 'presupuesto_horas_formacion_modulo', def: '1',  label: 'Horas de formación por módulo' },
  horasFormacionCaja:   { key: 'presupuesto_horas_formacion_caja',   def: '2',  label: 'Horas de formación del punto de venta' },
  horasCierre:          { key: 'presupuesto_horas_cierre',           def: '2',  label: 'Horas de validación y cierre' },
} as const

export type ClaveAjustePresupuesto = keyof typeof AJUSTES_PRESUPUESTO
