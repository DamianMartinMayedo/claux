// ── Lo que el motor de la propuesta produce ─────────────────────────────────
//
// Una `PropuestaResuelta` es la presentación entera ya decidida: qué
// diapositivas hay, en qué orden y con qué dentro. La página pública solo
// recorre `slides` y pinta; no consulta nada ni decide nada.
//
// REGLA DURA, y es el motivo de que esto sea un tipo cerrado: si un dato no
// está, la diapositiva NO se emite. Nunca se pinta un importe en blanco ni un
// «[completar]» — la propuesta de AUGE se entregó con «9 X hrs en 2 fases»
// dentro, con los marcadores de la plantilla sin sustituir, y eso no se arregla
// recordándolo: se arregla haciendo que no exista un estado «diapositiva a
// medias». Por eso cada `Slide` trae sus datos ya resueltos y no opcionales.

import type { MonedaClaux } from '@/lib/moneda-claux'
import type { Nivel } from '@/lib/niveles'

export interface Comercial {
  nombre: string
  email:  string | null
  /** El WhatsApp que se pinta en la última diapositiva. De `admin_users`, no
   *  tecleado: en las dos propuestas de agosto sale distinto en cada una. */
  tel:    string | null
}

export interface Tarjeta {
  titulo: string
  cuerpo: string
}

export interface BloqueModulo {
  clave:     string
  nombre:    string
  /** `propuesta_textos['modulo:<clave>']` ?? `beneficio` ?? `descripcion`. */
  cuerpo:    string
  /** true si el comercial lo escribió para ESTE negocio. Lo usa el admin para
   *  saber qué está personalizado y qué viene del catálogo. */
  a_medida:  boolean
}

export interface Captura {
  id:      number
  modulo:  string
  vista:   string
  url:     string
  alt:     string
  /** Medidas reales del fichero. Van al <img> para reservar el hueco antes de
   *  que la imagen llegue: son ocho por presentación y en 3G el texto saltaría
   *  ocho veces. Nulas solo en capturas anteriores a que la subida las midiera. */
  ancho:   number | null
  alto:    number | null
  /** Vacío = vale para cualquier negocio. Con valor, es la variante de esos
   *  sectores: un restaurante ve la caja de un restaurante. */
  sector:  string[]
}

/** Una fila de la tabla de precios y del configurador. */
export interface OpcionModulo {
  clave:       string
  nombre:      string
  descripcion: string
  precio:      number
  /** Viene en la propuesta: arranca marcada. */
  propuesto:   boolean
}

export interface LineaFase {
  num:      number
  etiqueta: string
  /** Null cuando no hay presupuesto vinculado: la diapositiva «Cómo se
   *  configura» explica el proceso y se puede enseñar sin cotizar nada (es lo
   *  que hace Fangio). Lo que no se hace nunca es pintar un cero por un hueco. */
  horas:    number | null
  subtotal: number | null
}

export interface LineaModuloCotizado {
  clave:  string
  nombre: string
  precio: number
}

export type Slide =
  | { clave: 'portada'; tipo: 'portada'
      titulo: string; nombreNegocio: string; comercial: Comercial | null; fecha: string | null }
  | { clave: 'entendimos'; tipo: 'lista'; titulo: string; puntos: string[] }
  | { clave: 'que_es'; tipo: 'tarjetas'; titulo: string; tarjetas: Tarjeta[] }
  | { clave: 'problema'; tipo: 'problema'
      titulo: string; rotuloHoy: string; rotuloClaux: string; hoy: string[]; conClaux: string[] }
  | { clave: string; tipo: 'pensado'
      titulo: string; modulos: BloqueModulo[]; pagina: number; paginas: number }
  | { clave: string; tipo: 'captura'; titulo: string; pie: string | null; captura: Captura }
  | { clave: 'precios'; tipo: 'precios'
      titulo: string; opciones: OpcionModulo[]; moneda: MonedaClaux
      /** Cuota de lo propuesto: la referencia contra la que se compara la selección. */
      cuotaPropuesta: number; diasPrueba: number; descuentoAnualPct: number }
  | { clave: 'tu_propuesta'; tipo: 'tu_propuesta'
      titulo: string; moneda: MonedaClaux
      fases: LineaFase[]; horasTotal: number; tarifaHora: number
      costeInstalacion: number; descuentoPct: number; totalFinal: number
      modulos: LineaModuloCotizado[]; cuotaMensual: number
      /** Cuota anual con el descuento aplicado; null si no hay descuento anual. */
      cuotaAnual: number | null; descuentoAnualPct: number }
  | { clave: 'como_se_configura'; tipo: 'fases'
      titulo: string; fases: LineaFase[]; pago: string }
  | { clave: 'confianza'; tipo: 'tarjetas'; titulo: string; tarjetas: Tarjeta[] }
  | { clave: 'empecemos'; tipo: 'empecemos'
      titulo: string; pasos: Tarjeta[]; comercial: Comercial | null }

export interface PropuestaResuelta {
  id:            number
  /** El token del enlace publicado, o null en borrador. Lo necesita el botón del
   *  configurador para saber por qué puerta guarda: la pública la autoriza el
   *  token; la de la vista previa, el permiso del comercial. */
  token:         string | null
  titulo:        string
  nombreNegocio: string
  nivel:         Nivel
  moneda:        MonedaClaux
  comercial:     Comercial | null
  /** Fecha de publicación, ya formateada. null en borrador. */
  fecha:         string | null
  slides:        Slide[]
}

/**
 * Lo que la propuesta diría con todas las cajas del editor en blanco.
 *
 * No se pinta en la presentación: es lo que el editor enseña de marca de agua
 * en cada caja para que el comercial vea lo que va a leer el cliente sin
 * abrirla. Sale del motor —no lo recalcula el editor— porque son las mismas
 * reglas que arman las diapositivas.
 */
export interface Prefill {
  /** Las cuatro viñetas de «Lo que entendimos». `null` donde el diagnóstico no
   *  llega: el mayor reto no está en ningún formulario. */
  entendimos: (string | null)[]
  /** La columna de hoy, entera, cuando las tres cajas están vacías. */
  hoy:        string[]
  /** Cuerpo del catálogo por módulo (`beneficio`, y si no, `descripcion`). */
  modulos:    Record<string, string>
  pago:       string
}
