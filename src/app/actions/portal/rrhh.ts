'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import {
  calcularNominaCuba,
  type ConceptoFiscal,
  type ParametroFiscal,
} from '@/lib/rrhh/nomina-cuba'
import {
  NOMBRE_CONCEPTO, claveDeNombre, esConceptoFiscal, type ConceptoClave,
  CONCEPTOS_COSTE, NOMBRE_CONCEPTO_COSTE, CATEGORIA_DEFECTO_COSTE, type ConceptoCoste,
} from '@/lib/rrhh/conceptos'
import {
  construirReportesRrhh,
  type ReportesRrhh, type EmpleadoRrhh, type NominaRrhh,
  type ItemFiscalRrhh, type SaldoVacaciones, type MontoMoneda, type MovFondoSubsidio,
} from '@/lib/rrhh/reportes'
// El techo de filas de un listado se decide con el MISMO helper que el resto del
// portal: RRHH era el único módulo fuera de este contrato y por eso su carga no
// tenía ni rango ni límite.
import { limiteDelFiltro }   from '@/lib/listados'
import { sugerirDiasTrabajados, type SugerenciaDias } from '@/lib/rrhh/dias-trabajados'
import type { PatronResuelto, TurnoHorario } from '@/lib/rrhh/turnos'
import { importe2 }          from '@/lib/rrhh/importe'
import { obtenerEmpresas }   from './empresas'
import { mapaTasas, monedaValida } from '@/lib/tasas'
import type { MonedaOpcion } from './monedas'
import {
  TIPOS_CONTRATO, PERIODICIDADES, generarEmpleadoId, construirCamposEmpleado,
  type TipoContrato as _TipoContrato, type Periodicidad as _Periodicidad,
} from '@/lib/rrhh-core'
import { resolverCategoriaSistema } from '@/lib/gastos-core'
import { tieneModulo }         from '@/lib/modulos'
// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: con `toISOString()` a partir de
// las 20:00 la fecha ya es la de mañana, así que un documento registrado de noche el último
// día del mes caía en el mes siguiente. Una sola fuente: `lib/fecha-tz.ts`.
import { hoyEnTz } from '@/lib/fecha-tz'
import { comprobarLimite } from '@/lib/limites'

// ── Tipos ─────────────────────────────────────────────────────────────────────

// Los tipos y helpers de Personal viven en `@/lib/rrhh-core` (una sola fuente,
// compartida con el importador). Se re-declaran directamente porque el re-export
// agregado `export type { … } from …` rompe el loader de 'use server'.
export type TipoContrato   = _TipoContrato
export type Periodicidad   = _Periodicidad
export type EstadoEmpleado = 'ACTIVO' | 'BAJA'

export interface Empleado {
  empleado_id:   string
  client_id:     string
  empresa_id:    string
  nombre:        string
  apellidos:     string | null
  documento:     string | null
  documento_vencimiento: string | null
  fecha_nacimiento:      string | null
  telefono:      string | null
  email:         string | null
  direccion:     string | null
  cargo:         string | null
  departamento:  string | null
  turno:         string | null
  tipo_contrato: TipoContrato
  fecha_alta:    string
  salario_base:  number
  moneda:        string
  periodicidad:  Periodicidad
  fecha_baja:    string | null
  motivo_baja:   string | null
  notas:         string | null
  /**
   * Vacaciones ya acumuladas ANTES de usar CLAUX (mig. 167), para negocios que migran
   * a mitad de año. Punto de partida inmutable de la derivación del saldo, **no** un
   * total editable: solo lo escribe el importador de Personal. El formulario de la
   * ficha no lo toca — si lo tocara, guardar los datos de contacto pondría el saldo a 0.
   */
  vacaciones_apertura: number
  /**
   * Los dos del modelo cubano (mig. 142). Estaban FUERA de este tipo a propósito
   * mientras solo los leía el cálculo — y esa fue la razón de que nunca llegaran a
   * tener formulario: `es_socio` decide si se le retiene la CESS y `dias_laborables`
   * es la jornada sobre la que se prorratea, los dos usados por el motor y por nadie
   * escribibles. Ahora la ficha los pinta (solo bajo `MIPYME_CUBA`), así que viajan.
   * `dias_laborables` NULL = hereda el de su empresa.
   */
  es_socio:        boolean
  dias_laborables: number | null
  created_at:    string
  updated_at:    string
}

export interface EmpleadoConEstado extends Empleado {
  estado: EstadoEmpleado
}

export interface Contrato {
  contrato_id:   string
  client_id:     string
  empleado_id:   string
  tipo_contrato: TipoContrato
  fecha_inicio:  string
  fecha_fin:     string | null
  salario_base:  number
  moneda:        string
  periodicidad:  Periodicidad
  notas:         string | null
  pdf_url:       string | null
  pdf_nombre:    string | null
  created_at:    string
}

// Vocabulario ÚNICO con los ítems de la línea (mig. 141). Antes los conceptos
// hablaban de BONO/DEDUCCION y los ítems de DEVENGO/RETENCION, así que había que
// traducir en cada frontera — y una traducción es un sitio donde equivocarse.
export type TipoConcepto = 'DEVENGO' | 'RETENCION'
export type ModoConcepto = 'FIJO' | 'PORCENTAJE'
export type BaseCalculo  = 'SALARIO_BASE' | 'DEVENGADO'
export type Recurrencia  = 'RECURRENTE' | 'PUNTUAL'

export interface ConceptoEmpleado {
  concepto_id:       string
  empleado_id:       string
  nombre:            string
  tipo:              TipoConcepto
  modo:              ModoConcepto
  valor:             number
  base:              BaseCalculo
  recurrencia:       Recurrencia
  /** Solo si PUNTUAL: 'YYYY-MM'. Al confirmarse esa nómina, se desactiva solo. */
  periodo_aplicable: string | null
  destino:           DestinoItemLinea | null
  /** Si apunta a una regla, esta fila es su EXCEPCIÓN para este trabajador. */
  regla_id:          string | null
  /** Excepción del tipo «a mí esta regla no se me aplica». */
  excluida:          boolean
  activo:            boolean
}

/**
 * Regla del negocio: se escribe UNA vez y se aplica a toda la plantilla (mig. 141).
 * Antes, una retención igual para todos eran tantas altas a mano como trabajadores,
 * y cambiarla, tantos borrados y tantas altas.
 */
export interface ReglaDeduccion {
  regla_id:   string
  /** NULL = todas las empresas del cliente. */
  empresa_id: string | null
  nombre:     string
  tipo:       TipoItemLinea
  modo:       ModoConcepto
  valor:      number
  base:       BaseCalculo
  destino:    DestinoItemLinea | null
  activa:     boolean
  orden:      number
}

export type EstadoNomina = 'BORRADOR' | 'CONFIRMADA'

export interface NominaLinea {
  linea_id:        string
  nomina_id:       string
  empleado_id:     string
  empleado_nombre: string
  cargo:           string | null
  salario_base:    number
  devengado:       number
  deducciones:     number
  neto:            number
  notas:           string | null
  /**
   * El desglose de la línea (mig. 140): de dónde sale cada importe. Cumple
   * `devengado = salario_base + Σ DEVENGO` y `deducciones = Σ RETENCION`.
   */
  items:           ItemLinea[]
  /** Solo MIPYME_CUBA: lo acumulado y lo pagado de vacaciones en ESTE período. */
  vacaciones_acumuladas_periodo: number
  vacaciones_pagadas_periodo:    number
  /** Subsidio adelantado al trabajador. Suma al neto. Se reparte en dos caras (mig. 212):
   *  la de maternidad la reembolsa el Estado; el resto (enfermedad) sale del fondo del 1,5 %. */
  subsidios:                     number
  /** Porción de `subsidios` que es maternidad (la reembolsa el Estado, mig. 144/212). */
  subsidios_maternidad:          number
  /**
   * La línea NO coincide con los conceptos vigentes del trabajador: le falta (o le
   * sobra) un bono o una deducción. Es lo que decide si sale el aviso de actualizar.
   * También se marca en una nómina CONFIRMADA: ahí actualizarla implica reabrirla
   * (revertir sus gastos), que es un paso más pero es el caso real —cuando uno se
   * acuerda de la retención, la nómina del mes ya está cerrada—.
   */
  desfasada:       boolean
}

export interface Nomina {
  nomina_id:  string
  client_id:  string
  empresa_id: string
  periodo:    string
  fecha:      string
  moneda:     string
  estado:     EstadoNomina
  gasto_id:   string | null
  total:      number
  notas:      string | null
  created_at: string
  updated_at: string
}

export interface NominaConLineas extends Nomina {
  lineas:          NominaLinea[]
  pagado:          number
  saldo_pendiente: number
  /** Alguna de sus líneas está desfasada respecto a los conceptos vigentes. */
  desactualizada:  boolean
}

export interface Turno {
  turno_id:    string
  client_id:   string
  empresa_id:  string
  nombre:      string
  hora_inicio: string | null
  hora_fin:    string | null
  color:       string | null
  activo:      boolean
  /**
   * Turno de DESCANSO (mig. 169): no suma horas ni cuenta como día trabajado. Existe
   * porque la celda vacía significaba a la vez «libra» y «no se le ha asignado nada», y
   * con una sola forma de decirlo ni el total de horas ni la sugerencia de días de la
   * nómina podían distinguir un descanso planificado de un olvido. No se deduce de
   * «no tiene horario»: eso también lo cumple un turno a medio rellenar.
   */
  es_descanso: boolean
}

// ── Rotación (mig. 182): patrón + slots + roster ─────────────────────────────────

export type TipoPatron = 'SEMANAL' | 'QUINCENAL' | 'MENSUAL' | 'CICLO'

export interface TurnoPatron {
  patron_id:     string
  empresa_id:    string
  nombre:        string
  tipo:          TipoPatron
  longitud_dias: number
  /** 'YYYY-MM-DD': día 0 del ciclo. */
  fecha_ancla:   string
  activo:        boolean
}

/** Qué franja toca en cada posición del ciclo de un patrón. `turno_id` null = descanso. */
export interface TurnoPatronSlot {
  slot_id:   string
  patron_id: string
  posicion:  number
  turno_id:  string | null
}

/** Una persona en un patrón, con su desplazamiento dentro del ciclo. */
export interface TurnoMiembro {
  miembro_id:   string
  patron_id:    string
  empleado_id:  string
  offset_ciclo: number
}

/**
 * Lo que comparten las cuatro pantallas del módulo: quién es el negocio y quién
 * trabaja en él. Es barato (una plantilla son decenas de filas, no miles) y no
 * incluye NADA de nómina.
 *
 * Antes existía un único `RrhhPageData` con la historia completa de nómina dentro
 * —todas las líneas, todos sus ítems, las incidencias de todos los períodos— y lo
 * pedían las SEIS entradas del módulo, incluidas Turnos y Reportes, que no usan ni
 * una de esas filas. Peor: se recomponía `componerLinea` (motor fiscal cubano
 * incluido) para cada línea de cada nómina solo para decidir si salía un aviso, y
 * cada `router.refresh()` de una celda de turnos o de nómina lo repetía entero.
 * Con 39 trabajadores eso son ~940 líneas y ~4.700 ítems a los dos años.
 */
export interface RrhhBase {
  empleados:       EmpleadoConEstado[]
  empresas:        { empresa_id: string; nombre: string; moneda_funcional: string | null }[]
  monedas:         MonedaOpcion[]
  /** Factores entre las monedas del cliente ("ORIGEN__DESTINO" → factor). */
  tasas:           Record<string, number>
  cargos:          string[]
  departamentos:   string[]
  turnos:          string[]
  empresa_nombres: Record<string, string>
  /**
   * ¿El cliente tiene el módulo de Contabilidad?
   *
   * RRHH **no** lo exige y eso es correcto (regla de independencia): confirmar escribe
   * sus apuntes igual y aparecen el día que lo contrate. Lo que estaba roto era la
   * interfaz — el botón primario del detalle llevaba a `/portal/cxp`, una página que
   * ese cliente no tiene, y el estado decía «Pendiente de pago» para siempre porque
   * solo se apaga liquidando en Tesorería, que tampoco tiene.
   */
  tieneContabilidad: boolean
}

/** Personal (`/portal/rrhh`) y la ficha del trabajador. Sin nóminas: el aviso de
 *  «aparece en N nóminas» al cambiar la moneda se pide a demanda
 *  (`contarNominasDeEmpleado`), que era la única razón por la que esta pantalla las
 *  traía todas. */
export interface PersonalPageData extends RrhhBase {
  /** Modelo de nómina de cada empresa: decide si la ficha pregunta lo cubano. */
  config_nomina: ConfigNominaEmpresa[]
}

/** Turnos (`/portal/turnos`). Ni una fila de nómina.
 *  `turnos_catalogo` = franjas; la rotación vive en `patrones` + `slots` + `miembros`. */
export interface TurnosPageData extends RrhhBase {
  turnos_catalogo: Turno[]
  patrones:        TurnoPatron[]
  slots:           TurnoPatronSlot[]
  miembros:        TurnoMiembro[]
}

/** Nómina (`/portal/nomina`) y el detalle de una nómina. */
export interface NominaPageData extends RrhhBase {
  nominas:         NominaConLineas[]
  /** Reglas del negocio, activas o no: la pantalla que las gestiona necesita ambas. */
  reglas:          ReglaDeduccion[]
  /** Modelo de nómina de cada empresa. Sin fila, GENERAL con 24 días. */
  config_nomina:   ConfigNominaEmpresa[]
  /** Categorías de gasto ACTIVAS del cliente, para el selector del mapeo (mig. 166). */
  categorias_gasto: { categoria_id: string; nombre: string; parent_id: string | null }[]
  /** Mapeo concepto de coste → categoría, por empresa. Sin fila, el defecto del sistema. */
  mapeo_gasto:     { empresa_id: string; concepto: string; categoria_id: string }[]
  /** Tributos cubanos aún sembrados con tipos de relleno. Vacío = todo verificado. */
  fiscales_provisionales: string[]
  cuentas:         { cuenta_id: string; nombre: string; empresa_id: string; moneda: string }[]
  /** Años con nóminas, para el filtro. Sale de una consulta propia, no de recorrer
   *  las traídas: con rango aplicado, el listado ya no las tiene todas. */
  anios:           string[]
  /** Cuántas hay en total con el filtro puesto, y cuántas caben. Alimenta `<AvisoTope>`. */
  total:           number
  limite:          number
  /** El techo recortó. Lo dice el servidor porque es quien contó, no la vista. */
  hay_mas:         boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EPS = 0.005

function corto(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
}
function generarContratoId():   string { return `CON-${corto()}` }
function generarNominaId():     string { return `NOM-${corto()}` }
function generarLineaId():      string { return `NLN-${corto()}` }
function generarGastoId():      string { return `GAS-${corto()}` }
function generarTurnoId():      string { return `TUR-${corto()}` }
function generarPatronId():     string { return `TPA-${corto()}` }
function generarSlotId():       string { return `TPS-${corto()}` }
function generarMiembroId():    string { return `TMI-${corto()}` }
function generarConceptoId():   string { return `CPT-${corto()}` }
function generarItemId():       string { return `NLC-${corto()}` }

// Alias local: la política monetaria de RRHH (base truncada a 3 dec, redondeo a 2).
const redondear2 = importe2

interface ConceptoAplicable {
  concepto_id?:       string
  nombre?:            string
  tipo:               TipoConcepto
  modo:               ModoConcepto
  valor:              number
  base?:              BaseCalculo
  destino?:           DestinoItemLinea | null
  regla_id?:          string | null
  excluida?:          boolean
  recurrencia?:       Recurrencia
  periodo_aplicable?: string | null
}

/**
 * Un ÍTEM de la línea: el motivo de un importe (mig. 140). La línea guardaba
 * `devengado`/`deducciones` como números opacos, así que no se podía decir qué se
 * retuvo ni por qué, ni repartir el coste por acreedor, ni distinguir un ajuste
 * puesto a mano de un concepto sin aplicar — por eso el recálculo los pisaba todos.
 *
 * `tipo` tiene TRES valores porque son tres cosas distintas, no dos:
 *   DEVENGO        suma al devengado y al coste  (salario extra, bono, vacaciones)
 *   RETENCION      resta del neto, coste NEUTRO  (cambia de acreedor, no de importe)
 *   APORTE_EMPRESA no toca el neto, suma al coste (lo que la empresa paga ENCIMA)
 * El tercero es el hueco que el modelo nunca supo expresar y sin el cual el modelo
 * cubano no cabe. Todavía no se emite: llega con el motor legal.
 */
export type TipoItemLinea    = 'DEVENGO' | 'RETENCION' | 'APORTE_EMPRESA'
export type OrigenItemLinea  = 'LEY' | 'REGLA' | 'CONCEPTO' | 'INCIDENCIA' | 'PUNTUAL' | 'LEGADO'
export type DestinoItemLinea = 'TERCERO_FISCAL' | 'EMPRESA'

export interface ItemLinea {
  item_id?:  string
  nombre:    string
  tipo:      TipoItemLinea
  monto:     number
  /** PUNTUAL sobrevive al recálculo; todo lo demás se reemplaza. */
  origen:    OrigenItemLinea
  origen_id: string | null
  destino:   DestinoItemLinea | null
  /**
   * Identidad del concepto cuando es del catálogo del sistema (mig. 165). El
   * `nombre` es el snapshot que se imprime y puede cambiar; ESTO es lo que compara
   * el código. NULL en lo que define el cliente (REGLA/CONCEPTO/PUNTUAL/LEGADO),
   * donde su nombre sí es la identidad.
   */
  clave?:    ConceptoClave | null
}

/**
 * Los que el recálculo NO puede recomponer y por tanto debe conservar.
 * NO se exporta: en un fichero `'use server'` toda exportación tiene que ser una
 * función async (sería un endpoint HTTP), y una síncrona rompe el build de Vercel
 * sin que `tsc` diga nada. Quien lo necesite fuera compara `origen === 'PUNTUAL'`.
 */
function esPreservable(origen: OrigenItemLinea): boolean {
  return origen === 'PUNTUAL'
}

/**
 * Marca del ítem que representa la edición MANUAL del devengado desde el modal de
 * nómina. Va en `origen_id` (que en un PUNTUAL no apunta a ninguna fila) porque hay
 * que poder reconocerlo entre recálculos sin depender de su nombre, que es texto
 * visible y por tanto puede cambiar.
 */
const AJUSTE_MANUAL = 'AJUSTE_MANUAL'

export interface ComposicionLinea {
  devengado:   number
  deducciones: number
  neto:        number
  /** Las deducciones superaban el devengado y se han recortado a él. */
  recortada:   boolean
  items:       ItemLinea[]
  /** Solo MIPYME_CUBA: lo que se acumula este mes y NO se paga. */
  vacaciones_acumuladas: number
  /** Solo MIPYME_CUBA: lo que se paga por vacaciones (disfrute + liquidación por baja).
   *  Los dos salen del saldo, así que van juntos en esta cifra —la resta del coste y la
   *  derivación del saldo netean ambos—; el ítem del recibo sí los distingue por clave. */
  vacaciones_pagadas:    number
  /** Solo MIPYME_CUBA: gemelos en DÍAS de acumulado y pagado (mig. 194). */
  vacaciones_dias_acumuladas: number
  vacaciones_dias_pagadas:    number
  /** Adelantado al trabajador y recuperable de la Seguridad Social. Suma al neto,
   *  NO al coste: por eso viaja aparte y no como ítem DEVENGO. */
  subsidios:             number
  /** Porción de `subsidios` que es maternidad (la reembolsa el Estado, mig. 144/212);
   *  el resto es enfermedad, que sale del fondo del 1,5 %. */
  subsidios_maternidad:  number
  /** Algún tributo aplicado usa un tipo de relleno: no se puede postear. */
  provisional: boolean
}

/** Lo que el modelo cubano necesita para una línea, más allá de reglas y conceptos. */
export interface ContextoCuba {
  parametros:      ParametroFiscal[]
  dias_laborables: number
  es_socio:        boolean
  dias_trabajados: number | null
  dias_vacaciones: number
  /** Días a liquidar de golpe por causar baja (mig. 194). 0 salvo baja. */
  dias_liquidacion: number
  /** Saldo de vacaciones acumulado ANTES de esta línea (apertura + confirmadas), que
   *  fija el VALOR del día pagado (`saldo_importe ÷ saldo_dias`). Lo consulta el caller
   *  —`componerLinea` es puro— excluyendo la propia nómina. */
  saldo_vac_importe: number
  saldo_vac_dias:    number
  /** Importe MANUAL del disfrute de vacaciones del mes (mig. 202). null = automático. */
  vacaciones_importe_manual: number | null
}

/**
 * Lo variable del mes de un trabajador (mig. 143). Se carga en su ficha ANTES de
 * generar la nómina, que es cuando el dueño tiene los datos delante.
 */
export interface IncidenciaMes {
  incidencia_id?:   string
  empleado_id?:     string
  periodo?:         string
  /** null = mes completo. Solo prorratea bajo MIPYME_CUBA. */
  dias_trabajados:  number | null
  /** Días que se PAGAN de vacaciones disfrutadas. Solo bajo MIPYME_CUBA. */
  dias_vacaciones:  number
  /** Días de vacaciones que se LIQUIDAN de golpe por causar baja (mig. 194). Normalmente
   *  0; lo rellena el aviso de baja de la hoja de nómina, editable a mano. Solo MIPYME_CUBA. */
  dias_liquidacion: number
  /** Importe MANUAL del disfrute de vacaciones (mig. 202). null = automático (promedio del
   *  saldo; 0 si no hay acumulado en importe). Un valor MANDA sobre el cálculo del disfrute.
   *  Es la corrección para clientes que no traen su acumulado. Solo MIPYME_CUBA. */
  vacaciones_importe_manual: number | null
  pago_extra:       number
  pago_nocturnidad: number
  feriados:         number
  penalizacion:     number
  otros_descuentos: number
  /**
   * Subsidio que la empresa le paga al trabajador. Se le suma al neto —lo cobra— pero
   * NO es coste al pagarlo (mig. 144/212). Tiene dos caras según `subsidio_maternidad`:
   * enfermedad (sale del fondo del 1,5 %, no se recupera) o maternidad (cuenta por
   * cobrar contra la Seguridad Social, la reembolsa el Estado).
   */
  pago_subsidios:   number
  /** true = licencia de maternidad (la reembolsa el Estado, mecanismo mig. 144).
   *  false = enfermedad/certificado médico (sale del fondo del 1,5 %, mig. 212). */
  subsidio_maternidad: boolean
}

/** Los importes de una incidencia, como ítems. Valen en LOS DOS modelos: son datos
 *  del mes, no ley cubana. Los DÍAS sí son del modelo cubano (los aplica el motor),
 *  porque el general nunca ha prorrateado y cambiarlo alteraría lo que ya cobra la
 *  gente. */
function itemsDeIncidencia(inc: IncidenciaMes): ItemLinea[] {
  const out: ItemLinea[] = []
  // El nombre NO se teclea aquí: se pide por su clave al catálogo (mig. 165), que es
  // lo que impide que la etiqueta y la identidad se separen.
  const add = (clave: ConceptoClave, tipo: TipoItemLinea, monto: number) => {
    if (!monto || monto <= EPS) return
    out.push({
      nombre: NOMBRE_CONCEPTO[clave], tipo, monto: redondear2(monto), clave,
      origen: 'INCIDENCIA', origen_id: inc.incidencia_id ?? null,
      destino: tipo === 'RETENCION' ? 'TERCERO_FISCAL' : null,
    })
  }
  add('PAGO_EXTRA',       'DEVENGO',   inc.pago_extra)
  add('NOCTURNIDAD',      'DEVENGO',   inc.pago_nocturnidad)
  add('FERIADOS',         'DEVENGO',   inc.feriados)
  add('PENALIZACION',     'RETENCION', inc.penalizacion)
  add('OTROS_DESCUENTOS', 'RETENCION', inc.otros_descuentos)
  return out
}

const SELECT_INCIDENCIAS =
  'incidencia_id, empleado_id, periodo, dias_trabajados, dias_vacaciones, dias_liquidacion, vacaciones_importe_manual, pago_extra, pago_nocturnidad, feriados, penalizacion, otros_descuentos, pago_subsidios, subsidio_maternidad'

/** Los importes llegan como texto (`numeric`): sin esto, todo suma concatenando. */
function normIncidencia(r: IncidenciaMes & { empleado_id: string }): IncidenciaMes {
  return {
    ...r,
    dias_trabajados:  r.dias_trabajados === null ? null : Number(r.dias_trabajados),
    dias_vacaciones:  Number(r.dias_vacaciones),
    dias_liquidacion: Number(r.dias_liquidacion),
    vacaciones_importe_manual: r.vacaciones_importe_manual == null ? null : Number(r.vacaciones_importe_manual),
    pago_extra:       Number(r.pago_extra),
    pago_nocturnidad: Number(r.pago_nocturnidad),
    feriados:         Number(r.feriados),
    penalizacion:     Number(r.penalizacion),
    otros_descuentos: Number(r.otros_descuentos),
    pago_subsidios:   Number(r.pago_subsidios),
    subsidio_maternidad: Boolean(r.subsidio_maternidad),
  }
}

/** Incidencias de un período, por trabajador. Una consulta para toda la página. */
async function leerIncidencias(
  db: DbAdmin, client_id: string, periodo: string,
): Promise<Map<string, IncidenciaMes>> {
  const { data } = await db.from('incidencias_nomina')
    .select(SELECT_INCIDENCIAS)
    .eq('client_id', client_id)
    .eq('periodo', periodo)
  const m = new Map<string, IncidenciaMes>()
  for (const r of (data ?? []) as (IncidenciaMes & { empleado_id: string })[]) {
    m.set(r.empleado_id, normIncidencia(r))
  }
  return m
}

/**
 * Lo mismo pero de VARIOS períodos a la vez, con clave `periodo|empleado_id`: la
 * página de RRHH mide el desfase de todas las nóminas visibles, que pueden ser de
 * meses distintos, y una consulta por nómina no es opción en 3G.
 */
async function leerIncidenciasDeVarios(
  db: DbAdmin, client_id: string, periodos: string[],
): Promise<Map<string, IncidenciaMes>> {
  const m = new Map<string, IncidenciaMes>()
  if (!periodos.length) return m
  const { data } = await db.from('incidencias_nomina')
    .select(SELECT_INCIDENCIAS)
    .eq('client_id', client_id)
    .in('periodo', periodos)
  for (const r of (data ?? []) as (IncidenciaMes & { empleado_id: string })[]) {
    m.set(`${r.periodo}|${r.empleado_id}`, normIncidencia(r))
  }
  return m
}

/**
 * Fórmula ÚNICA de una línea de nómina. La comparten los tres sitios que la
 * necesitan —generar, recalcular y detectar el desfase—: con una copia por sitio,
 * lo que la pantalla avisa y lo que se guarda acabarían discrepando, y en dinero
 * eso no se ve hasta que ya está confirmado.
 *
 * ORDEN DE RESOLUCIÓN (mig. 141):
 *   1. Reglas de la empresa            → salvo excepción o exclusión del trabajador
 *   2. Conceptos propios del trabajador
 *   3. Ítems PUNTUAL ya presentes      → se conservan tal cual (mig. 140)
 *
 * INVARIANTE que mantiene:
 *   devengado = salario_base + Σ ítems DEVENGO   ·   deducciones = Σ ítems RETENCION
 * (`APORTE_EMPRESA` no toca ninguno de los dos: es coste de la empresa por encima
 * del bruto — ni aumenta lo que se le paga al trabajador ni reduce su neto.)
 *
 * LA BASE DEL PORCENTAJE sale de cada regla/concepto (`base`), pero **solo importa
 * en lo que RESTA**: un devengo porcentual solo puede calcularse sobre el salario
 * del período, porque un bono que fuera un % del devengado se incluiría a sí mismo.
 * Por eso los devengos se resuelven primero, se cierra el devengado, y solo entonces
 * se aplican retenciones y aportes, que ya pueden mirar `SALARIO_BASE` o `DEVENGADO`.
 *
 * `preservados` son los ítems que este cálculo no puede recomponer (los PUNTUAL).
 * Entran en el resultado, así que quien pregunte «¿esta línea refleja lo vigente?»
 * obtiene la misma respuesta que dará el recálculo — si no se pasaran, toda línea
 * con un ajuste a mano se marcaría desfasada para siempre y el aviso no se apagaría.
 */
function componerLinea(opts: {
  salario_base: number
  /** Ya filtradas por empresa y por `activa` (lo hace quien las lee). */
  reglas?:      ReglaDeduccion[]
  conceptos?:   ConceptoAplicable[]
  preservados?: ItemLinea[]
  /** 'YYYY-MM' — decide qué conceptos PUNTUAL tocan en esta nómina. */
  periodo?:     string
  /** Presente solo si la empresa está en MIPYME_CUBA. */
  cuba?:        ContextoCuba
  /** Lo variable del mes de este trabajador (mig. 143). */
  incidencia?:  IncidenciaMes
}): ComposicionLinea {
  const { salario_base, reglas = [], conceptos = [], preservados = [], periodo, cuba, incidencia } = opts
  // La foto salarial es la entrada de toda la cadena: porcentajes, ley cubana y
  // totales deben ver el mismo importe ya truncado.
  const salarioBase = redondear2(salario_base)

  // ── Paso 1: qué se aplica ───────────────────────────────────────────────────
  // Las excepciones se indexan por regla: una fila de `conceptos_empleado` con
  // `regla_id` no es un concepto suyo, es su versión de una regla del negocio.
  const excepciones = new Map<string, ConceptoAplicable>()
  for (const c of conceptos) if (c.regla_id) excepciones.set(c.regla_id, c)

  type Aplicable = {
    nombre: string; tipo: TipoItemLinea; modo: ModoConcepto; valor: number
    base: BaseCalculo; destino: DestinoItemLinea | null
    origen: OrigenItemLinea; origen_id: string | null
  }
  const aplicables: Aplicable[] = []

  for (const r of reglas) {
    const exc = excepciones.get(r.regla_id)
    if (exc?.excluida) continue          // «a mí esta regla no se me aplica»
    aplicables.push({
      // El NOMBRE lo pone siempre la regla: la excepción cambia el importe, no de
      // qué se trata, y dos nombres para el mismo concepto harían ilegible el
      // desglose de una plantilla entera.
      nombre:    r.nombre,
      tipo:      r.tipo,
      modo:      exc ? exc.modo  : r.modo,
      valor:     exc ? exc.valor : r.valor,
      base:      exc?.base ?? r.base,
      destino:   r.destino,
      origen:    'REGLA',
      origen_id: r.regla_id,
    })
  }

  for (const c of conceptos) {
    if (c.regla_id) continue             // es excepción, ya se resolvió arriba
    // Un PUNTUAL solo cuenta en SU período. Sin período de referencia (por ejemplo
    // al medir el desfase de una línea antigua) se deja fuera, que es lo prudente:
    // aplicarlo por defecto lo colaría en meses a los que no pertenece.
    if (c.recurrencia === 'PUNTUAL' && c.periodo_aplicable !== periodo) continue
    aplicables.push({
      nombre:    c.nombre ?? '',
      tipo:      c.tipo,
      modo:      c.modo,
      valor:     c.valor,
      base:      c.base ?? 'SALARIO_BASE',
      destino:   c.destino ?? (c.tipo === 'RETENCION' ? 'TERCERO_FISCAL' : null),
      origen:    'CONCEPTO',
      origen_id: c.concepto_id ?? null,
    })
  }

  // ── Paso 2: los devengos, y con ellos se cierra el devengado ────────────────
  // Los preservados van PRIMERO a propósito: si algo hay que recortar por no caber,
  // se recorta por el final, y un ajuste puesto a mano no puede evaporarse porque
  // luego se añadiera un concepto en la ficha.
  const items: ItemLinea[] = preservados.map(p => ({ ...p, monto: redondear2(p.monto) }))

  // Lo que trae la incidencia del mes. Va PRONTO en la lista porque es un hecho
  // concreto de este período —una noche trabajada, una penalización acordada— y si
  // algo hubiera que recortar, tiene más derecho a quedarse que un concepto general.
  const itemsInc = incidencia ? itemsDeIncidencia(incidencia) : []
  for (const it of itemsInc) if (it.tipo === 'DEVENGO') items.push(it)

  const importe = (a: Aplicable, sobre: number) =>
    redondear2(a.modo === 'PORCENTAJE' ? (sobre * a.valor) / 100 : a.valor)

  for (const a of aplicables) {
    if (a.tipo !== 'DEVENGO') continue
    items.push({
      nombre: a.nombre, tipo: 'DEVENGO', monto: importe(a, salarioBase),
      origen: a.origen, origen_id: a.origen_id, destino: null,
    })
  }

  // ── Paso 2 bis: la LEY (solo MIPYME_CUBA) ──────────────────────────────────
  // Va aquí, entre los devengos y las retenciones, porque el motor legal necesita
  // el devengado que traen reglas y conceptos para calcular sus bases, y a la vez
  // APORTA devengo propio (el prorrateo por días y las vacaciones que se pagan).
  // Se llama UNA vez: el motor resuelve el devengo legal y los tributos en la misma
  // pasada, y llamarlo dos veces obligaría a reconstruirle sus propias entradas.
  const legal = cuba
    ? calcularNominaCuba({
        salario_base: salarioBase,
        dias_laborables:  cuba.dias_laborables,
        dias_trabajados:  cuba.dias_trabajados,
        es_socio:         cuba.es_socio,
        devengos_previos: redondear2(
          items.filter(i => i.tipo === 'DEVENGO').reduce((s, i) => s + i.monto, 0)),
        dias_vacaciones:   cuba.dias_vacaciones,
        dias_liquidacion:  cuba.dias_liquidacion,
        saldo_vac_importe: cuba.saldo_vac_importe,
        saldo_vac_dias:    cuba.saldo_vac_dias,
        importe_vacaciones_manual: cuba.vacaciones_importe_manual,
      }, cuba.parametros)
    : null

  const vacaciones_acumuladas = legal?.vacaciones_acumular ?? 0
  // Disfrute + liquidación van juntos en el pagado: los dos salen del saldo y así el
  // coste «Salarios» (devengado − pagado) y la derivación del saldo los netean sin
  // lógica nueva. El recibo los separa por clave (ver los ítems más abajo).
  const vacaciones_pagadas    = redondear2((legal?.vacaciones_pagar ?? 0) + (legal?.vacaciones_liquidar ?? 0))
  const vacaciones_dias_acumuladas = legal?.vacaciones_dias_acumular ?? 0
  const vacaciones_dias_pagadas    = legal?.vacaciones_dias_pagar    ?? 0
  const provisional           = legal?.provisional         ?? false

  if (legal) {
    // El prorrateo por días NO reescribe `salario_base` —que es la foto congelada
    // del salario del período y tiene que seguir siéndolo—, sino que entra como su
    // propio ítem, normalmente NEGATIVO. Así la invariante se mantiene y, sobre
    // todo, el desglose dice POR QUÉ cobra menos, en vez de que el número aparezca
    // cambiado sin explicación.
    const ajusteDias = redondear2(legal.salario_devengado - salarioBase)
    if (Math.abs(ajusteDias) > EPS) {
      items.push({
        nombre: NOMBRE_CONCEPTO.DIAS_NO_TRABAJADOS, tipo: 'DEVENGO', monto: ajusteDias,
        clave: 'DIAS_NO_TRABAJADOS',
        origen: 'LEY', origen_id: null, destino: null,
      })
    }
    if (legal.vacaciones_pagar > EPS) {
      items.push({
        nombre: NOMBRE_CONCEPTO.VACACIONES_PAGADAS, tipo: 'DEVENGO', monto: legal.vacaciones_pagar,
        clave: 'VACACIONES_PAGADAS',
        origen: 'LEY', origen_id: null, destino: null,
      })
    }
    // La liquidación por baja va como ítem PROPIO (clave distinta del disfrute) para que
    // el recibo y los reportes la nombren aparte, aunque en el coste y el saldo cuente
    // igual que unas vacaciones disfrutadas.
    if (legal.vacaciones_liquidar > EPS) {
      items.push({
        nombre: NOMBRE_CONCEPTO.VACACIONES_LIQUIDACION, tipo: 'DEVENGO', monto: legal.vacaciones_liquidar,
        clave: 'VACACIONES_LIQUIDACION',
        origen: 'LEY', origen_id: null, destino: null,
      })
    }
  }

  const devengado = redondear2(
    salarioBase + items.filter(i => i.tipo === 'DEVENGO').reduce((s, i) => s + i.monto, 0))

  // ── Paso 3: lo que resta y lo que cuesta a la empresa, ya con el devengado ──
  // Los tributos van ANTES que reglas y conceptos: si algo hay que recortar por no
  // caber en el devengado, se recorta por el final, y una obligación legal no puede
  // ser lo primero que se sacrifique.
  if (legal) {
    for (const r of legal.retenciones) {
      items.push({
        nombre: NOMBRE_CONCEPTO[r.concepto], tipo: 'RETENCION', monto: r.monto,
        clave: r.concepto,
        origen: 'LEY', origen_id: r.parametro_id, destino: 'TERCERO_FISCAL',
      })
    }
    for (const a of legal.aportes) {
      items.push({
        nombre: NOMBRE_CONCEPTO[a.concepto], tipo: 'APORTE_EMPRESA', monto: a.monto,
        clave: a.concepto,
        origen: 'LEY', origen_id: a.parametro_id, destino: null,
      })
    }
  }

  for (const it of itemsInc) if (it.tipo === 'RETENCION') items.push(it)

  for (const a of aplicables) {
    if (a.tipo === 'DEVENGO') continue
    const sobre = a.base === 'DEVENGADO' ? devengado : salarioBase
    items.push({
      nombre: a.nombre, tipo: a.tipo, monto: importe(a, sobre),
      origen: a.origen, origen_id: a.origen_id,
      destino: a.tipo === 'RETENCION' ? (a.destino ?? 'TERCERO_FISCAL') : null,
    })
  }

  let deducciones = redondear2(
    items.filter(i => i.tipo === 'RETENCION').reduce((s, i) => s + i.monto, 0))

  const recortada = deducciones > devengado + EPS
  if (recortada) {
    // El recorte se reparte sobre los ÍTEMS, no solo sobre el total: recortando el
    // total a secas, el desglose sumaría más que la deducción de la línea y la
    // pantalla enseñaría un desglose que no cuadra con su propio total.
    let sobra = redondear2(deducciones - devengado)
    for (let i = items.length - 1; i >= 0 && sobra > EPS; i--) {
      if (items[i].tipo !== 'RETENCION') continue
      const quita = Math.min(items[i].monto, sobra)
      items[i].monto = redondear2(items[i].monto - quita)
      sobra = redondear2(sobra - quita)
    }
    deducciones = devengado
  }

  // Se descartan los ítems que quedan en cero, PERO nunca un preservado: su fila ya
  // existe en la base, y si desapareciera de aquí nadie actualizaría su importe y el
  // desglose dejaría de sumar lo que dice la línea. Quien pinte esto filtra los ceros.
  // El subsidio SUMA al neto (el trabajador lo cobra) pero NO al devengado: no es
  // trabajo suyo ni coste de la empresa, es dinero que la empresa adelanta y luego
  // recupera. Por eso no es un ítem DEVENGO —lo sería si contara como coste— y por
  // eso al confirmar genera una cuenta por cobrar en vez de engordar el gasto.
  const subsidios = redondear2(incidencia?.pago_subsidios ?? 0)
  // La cara de maternidad la reembolsa el Estado (mig. 144); la de enfermedad sale del
  // fondo del 1,5 % (mig. 212). El booleano de la incidencia enruta TODO su subsidio;
  // la línea guarda la porción como importe para que confirmar reparta sumando.
  const subsidios_maternidad = incidencia?.subsidio_maternidad ? subsidios : 0

  return {
    devengado,
    deducciones,
    subsidios,
    subsidios_maternidad,
    neto:      redondear2(Math.max(0, devengado - deducciones + subsidios)),
    recortada,
    // El ajuste por días es NEGATIVO y tiene que sobrevivir al filtro de ceros, o
    // el devengado dejaría de cuadrar con su desglose.
    items:     items.filter(it => Math.abs(it.monto) > EPS || esPreservable(it.origen)),
    vacaciones_acumuladas,
    vacaciones_pagadas,
    vacaciones_dias_acumuladas,
    vacaciones_dias_pagadas,
    provisional,
  }
}

/**
 * Reglas vigentes del cliente, agrupadas por empresa. Una consulta para toda la
 * página, igual que los conceptos: esta pantalla se abre en 3G y pedirlas por
 * nómina eran tantas consultas como nóminas.
 */
async function leerReglas(
  db: DbAdmin, client_id: string,
): Promise<(empresa_id: string) => ReglaDeduccion[]> {
  const todas = await leerTodasLasReglas(db, client_id)
  const vigentes = todas.filter(r => r.activa)
  // `empresa_id` nulo = la regla es del negocio entero.
  return (empresa_id: string) => vigentes.filter(r => !r.empresa_id || r.empresa_id === empresa_id)
}

export type ModeloNomina = 'GENERAL' | 'MIPYME_CUBA'

export interface ConfigNominaEmpresa {
  empresa_id:              string
  modelo:                  ModeloNomina
  dias_laborables_default: number
  /**
   * Día del mes en que esta empresa paga su nómina (mig. 166). Alimenta el
   * `vencimiento` de las CxP que genera confirmar. NULL = sin fijar, y entonces nacen
   * sin vencimiento, o sea fuera del aging de CxP.
   */
  dia_pago:                number | null
}

/**
 * Configuración de nómina por empresa. Sin fila, GENERAL con 24 días — que es
 * exactamente lo que hacen hoy las empresas en marcha, así que esta tabla no
 * cambia el comportamiento de nadie hasta que alguien la toque.
 */
async function leerConfigNomina(
  db: DbAdmin, client_id: string,
): Promise<Map<string, ConfigNominaEmpresa>> {
  const { data } = await db.from('empresa_config_nomina')
    .select('empresa_id, modelo, dias_laborables_default, dia_pago')
    .eq('client_id', client_id)
  const m = new Map<string, ConfigNominaEmpresa>()
  for (const r of (data ?? []) as ConfigNominaEmpresa[]) {
    m.set(r.empresa_id, {
      ...r,
      dias_laborables_default: Number(r.dias_laborables_default),
      dia_pago: r.dia_pago === null ? null : Number(r.dia_pago),
    })
  }
  return m
}

function configDe(mapa: Map<string, ConfigNominaEmpresa>, empresa_id: string): ConfigNominaEmpresa {
  return mapa.get(empresa_id) ?? {
    empresa_id, modelo: 'GENERAL', dias_laborables_default: 24, dia_pago: null,
  }
}

/**
 * Fecha de vencimiento de las CxP de una nómina: el día de pago de la empresa, en el
 * mes del período. Un 31 configurado en un mes de 30 se ajusta al último día del mes
 * —no se rechaza ni se desborda al mes siguiente—, que es lo que espera quien escribió
 * «pago el último día».
 */
function vencimientoNomina(periodo: string, dia_pago: number | null): string | null {
  if (!dia_pago) return null
  const [a, m] = periodo.split('-').map(Number)
  if (!a || !m) return null
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const dia    = Math.min(dia_pago, ultimo)
  return `${a}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Mapeo concepto de coste → categoría de gasto de una empresa. Sin fila configurada,
 * el concepto usa su categoría de sistema por defecto (`CATEGORIA_DEFECTO_COSTE`), que
 * se resuelve-o-crea por CLAVE — nunca por nombre, o renombrarla crearía un duplicado
 * a espaldas del dueño en la siguiente nómina.
 */
async function resolverMapeoCoste(
  db: DbAdmin, client_id: string, empresa_id: string,
): Promise<Map<ConceptoCoste, { categoria_id: string; nombre: string }>> {
  const { data } = await db.from('nomina_gasto_mapeo')
    .select('concepto, categoria_id')
    .eq('client_id', client_id).eq('empresa_id', empresa_id)
  const elegidas = new Map<string, string>()
  for (const r of (data ?? []) as { concepto: string; categoria_id: string }[]) {
    elegidas.set(r.concepto, r.categoria_id)
  }

  // Los nombres de las categorías elegidas a mano, en UNA consulta: se desnormalizan en
  // `gastos_cobros.categoria` y pedirlos fila a fila serían cinco viajes por nómina.
  const ids = Array.from(new Set(elegidas.values()))
  const nombreDe = new Map<string, string>()
  if (ids.length) {
    const { data: cats } = await db.from('categorias_gastos')
      .select('categoria_id, nombre, estado')
      .eq('client_id', client_id).in('categoria_id', ids)
    for (const c of (cats ?? []) as { categoria_id: string; nombre: string; estado: string }[]) {
      // Una categoría archivada después de configurarla no bloquea la nómina: cae al
      // defecto del concepto. Negarse a confirmar por eso sería castigar al dueño por
      // ordenar sus categorías.
      if (c.estado === 'ACTIVO') nombreDe.set(c.categoria_id, c.nombre)
    }
  }

  const out = new Map<ConceptoCoste, { categoria_id: string; nombre: string }>()
  for (const concepto of CONCEPTOS_COSTE) {
    const elegida = elegidas.get(concepto)
    if (elegida && nombreDe.has(elegida)) {
      out.set(concepto, { categoria_id: elegida, nombre: nombreDe.get(elegida)! })
      continue
    }
    const sistema = await resolverCategoriaSistema(db, client_id, CATEGORIA_DEFECTO_COSTE[concepto])
    if (sistema) out.set(concepto, sistema)
  }
  return out
}

/**
 * Parámetros fiscales vigentes EN UNA FECHA. Tabla global (sin `client_id`): son
 * parámetros de ley, no configuración del negocio. Se resuelve por la fecha de la
 * nómina y no por «hoy», que es lo que hace que una nómina de marzo se recalcule
 * con la ley de marzo aunque estemos en julio.
 */
async function leerParametrosCuba(db: DbAdmin, fecha: string): Promise<ParametroFiscal[]> {
  const { data } = await db.from('parametros_fiscales_cuba').select(SELECT_PARAMETROS)
  return parametrosVigentes((data ?? []) as ParametroConVigencia[], fecha)
}

const SELECT_PARAMETROS =
  'parametro_id, concepto, tabla_tramos, base_calculo, provisional, vigente_desde, vigente_hasta'

type ParametroConVigencia = ParametroFiscal & { vigente_desde: string; vigente_hasta: string | null }

/**
 * Filtro de vigencia EN MEMORIA sobre la tabla entera. Se lee completa (son cuatro
 * filas de ley, no datos del cliente) porque la página de RRHH necesita resolverla
 * para varias fechas a la vez —una nómina por mes— y hacerlo en SQL sería una
 * consulta por nómina.
 */
function parametrosVigentes(todos: ParametroConVigencia[], fecha: string): ParametroFiscal[] {
  const vigentes = todos
    .filter(p => p.vigente_desde <= fecha && (!p.vigente_hasta || p.vigente_hasta >= fecha))
    // Si hubiera dos filas vigentes del mismo tributo (vigencias mal cerradas), gana
    // la más reciente: se queda la primera de cada concepto.
    .sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : -1))
  const vistos = new Set<string>()
  const out: ParametroFiscal[] = []
  for (const p of vigentes) {
    if (vistos.has(p.concepto)) continue
    vistos.add(p.concepto)
    out.push(p)
  }
  return out
}

/**
 * Saldo de vacaciones de un empleado:
 *
 *     apertura + Σ (acumulado − pagado) de sus nóminas CONFIRMADAS
 *
 * Se DERIVA y no se guarda (mig. 142/143): un total mutable se rompía al reabrir o
 * borrar una nómina. La **apertura** (mig. 167) es lo que ya traía acumulado el
 * trabajador antes de usar CLAUX —un negocio que migra a mitad de año arrancaba
 * inevitablemente en cero— y es un punto de partida inmutable, no un total editable:
 * todo lo que se mueve después lo siguen diciendo las nóminas, así que la derivación
 * sigue autocorrigiéndose ante cualquier reversión.
 *
 * Una sola fuente para las dos vistas que lo necesitan: la ficha del empleado
 * (`obtenerEmpleadoDetalle`) y el aviso de tope al guardar una incidencia
 * (`guardarIncidencia`).
 */
async function saldoVacacionesAcumulado(
  db: DbAdmin, client_id: string, empleado_id: string,
): Promise<number> {
  // Se parte de SUS líneas, no de todas las nóminas confirmadas del negocio: la
  // pregunta es de una persona, así que el conjunto lo acota ella (unas dos docenas de
  // filas) y no la historia entera del tenant, que crece sin tope con cada mes.
  const [{ data: ficha }, { data: misLineas }] = await Promise.all([
    db.from('empleados').select('vacaciones_apertura')
      .eq('client_id', client_id).eq('empleado_id', empleado_id).maybeSingle(),
    db.from('nomina_lineas')
      .select('nomina_id, vacaciones_acumuladas_periodo, vacaciones_pagadas_periodo')
      .eq('client_id', client_id).eq('empleado_id', empleado_id),
  ])
  const apertura = Number((ficha as { vacaciones_apertura: number | null } | null)?.vacaciones_apertura ?? 0)

  const lineas = (misLineas ?? []) as {
    nomina_id: string
    vacaciones_acumuladas_periodo: number | null; vacaciones_pagadas_periodo: number | null
  }[]
  if (!lineas.length) return redondear2(apertura)

  // Solo cuentan las CONFIRMADAS: un borrador aún puede cambiar o borrarse, y el saldo
  // se autocorrige justo porque se deriva de lo cerrado.
  const { data: confirmadas } = await db.from('nominas')
    .select('nomina_id').eq('client_id', client_id).eq('estado', 'CONFIRMADA')
    .in('nomina_id', Array.from(new Set(lineas.map(l => l.nomina_id))))
  const cerradas = new Set(((confirmadas ?? []) as { nomina_id: string }[]).map(n => n.nomina_id))

  return redondear2(apertura + lineas
    .filter(l => cerradas.has(l.nomina_id))
    .reduce((s, l) => s + Number(l.vacaciones_acumuladas_periodo ?? 0) - Number(l.vacaciones_pagadas_periodo ?? 0), 0))
}

/** Saldo de vacaciones en DÍAS de una persona. Gemelo exacto de
 *  `saldoVacacionesAcumulado`, sobre las columnas de días (mig. 194/195). Lo usan la
 *  ficha del empleado y el aviso de tope al guardar una incidencia. */
async function saldoVacacionesDiasAcumulado(
  db: DbAdmin, client_id: string, empleado_id: string,
): Promise<number> {
  const [{ data: ficha }, { data: misLineas }] = await Promise.all([
    db.from('empleados').select('vacaciones_apertura_dias')
      .eq('client_id', client_id).eq('empleado_id', empleado_id).maybeSingle(),
    db.from('nomina_lineas')
      .select('nomina_id, vacaciones_dias_acumulados_periodo, vacaciones_dias_pagados_periodo')
      .eq('client_id', client_id).eq('empleado_id', empleado_id),
  ])
  const apertura = Number((ficha as { vacaciones_apertura_dias: number | null } | null)?.vacaciones_apertura_dias ?? 0)

  const lineas = (misLineas ?? []) as {
    nomina_id: string
    vacaciones_dias_acumulados_periodo: number | null; vacaciones_dias_pagados_periodo: number | null
  }[]
  if (!lineas.length) return redondear2(apertura)

  const { data: confirmadas } = await db.from('nominas')
    .select('nomina_id').eq('client_id', client_id).eq('estado', 'CONFIRMADA')
    .in('nomina_id', Array.from(new Set(lineas.map(l => l.nomina_id))))
  const cerradas = new Set(((confirmadas ?? []) as { nomina_id: string }[]).map(n => n.nomina_id))

  return redondear2(apertura + lineas
    .filter(l => cerradas.has(l.nomina_id))
    .reduce((s, l) => s + Number(l.vacaciones_dias_acumulados_periodo ?? 0) - Number(l.vacaciones_dias_pagados_periodo ?? 0), 0))
}

/** Saldo de vacaciones en importe y en días. */
export interface SaldoVac { importe: number; dias: number }

/** El saldo con su DESGLOSE por nómina confirmada, para varias personas a la vez. Hace
 *  falta el desglose —y no solo el total— porque valorar el día de una línea usa el
 *  saldo ANTERIOR a esa línea: hay que poder restar la contribución de SU propia nómina.
 *  Tres consultas para toda la plantilla, no una por persona. */
async function saldosVacacionesDetalle(
  db: DbAdmin, client_id: string, empleadoIds: string[],
): Promise<Map<string, { apertura: SaldoVac; porNomina: Map<string, SaldoVac> }>> {
  const out = new Map<string, { apertura: SaldoVac; porNomina: Map<string, SaldoVac> }>()
  const ids = Array.from(new Set(empleadoIds)).filter(Boolean)
  if (!ids.length) return out

  const [{ data: fichas }, { data: lns }] = await Promise.all([
    db.from('empleados')
      .select('empleado_id, vacaciones_apertura, vacaciones_apertura_dias')
      .eq('client_id', client_id).in('empleado_id', ids),
    db.from('nomina_lineas')
      .select('empleado_id, nomina_id, vacaciones_acumuladas_periodo, vacaciones_pagadas_periodo, vacaciones_dias_acumulados_periodo, vacaciones_dias_pagados_periodo')
      .eq('client_id', client_id).in('empleado_id', ids),
  ])
  for (const f of (fichas ?? []) as {
    empleado_id: string; vacaciones_apertura: number | null; vacaciones_apertura_dias: number | null
  }[]) {
    out.set(f.empleado_id, {
      apertura:  { importe: Number(f.vacaciones_apertura ?? 0), dias: Number(f.vacaciones_apertura_dias ?? 0) },
      porNomina: new Map(),
    })
  }

  const filas = (lns ?? []) as {
    empleado_id: string; nomina_id: string
    vacaciones_acumuladas_periodo: number | null; vacaciones_pagadas_periodo: number | null
    vacaciones_dias_acumulados_periodo: number | null; vacaciones_dias_pagados_periodo: number | null
  }[]
  const nominaIds = Array.from(new Set(filas.map(l => l.nomina_id)))
  const cerradas = new Set<string>()
  if (nominaIds.length) {
    const { data: conf } = await db.from('nominas')
      .select('nomina_id').eq('client_id', client_id).eq('estado', 'CONFIRMADA').in('nomina_id', nominaIds)
    for (const n of (conf ?? []) as { nomina_id: string }[]) cerradas.add(n.nomina_id)
  }
  for (const l of filas) {
    if (!cerradas.has(l.nomina_id)) continue
    let e = out.get(l.empleado_id)
    if (!e) { e = { apertura: { importe: 0, dias: 0 }, porNomina: new Map() }; out.set(l.empleado_id, e) }
    const prev = e.porNomina.get(l.nomina_id) ?? { importe: 0, dias: 0 }
    e.porNomina.set(l.nomina_id, {
      importe: prev.importe + Number(l.vacaciones_acumuladas_periodo ?? 0) - Number(l.vacaciones_pagadas_periodo ?? 0),
      dias:    prev.dias    + Number(l.vacaciones_dias_acumulados_periodo ?? 0) - Number(l.vacaciones_dias_pagados_periodo ?? 0),
    })
  }
  return out
}

/** Saldo total (apertura + Σ nóminas confirmadas), EXCLUYENDO opcionalmente una nómina
 *  —la que se está valorando, para no contar su propia contribución—. */
function saldoVacDe(
  detalle: { apertura: SaldoVac; porNomina: Map<string, SaldoVac> } | undefined,
  excluirNominaId?: string,
): SaldoVac {
  if (!detalle) return { importe: 0, dias: 0 }
  let importe = detalle.apertura.importe, dias = detalle.apertura.dias
  for (const [nid, v] of detalle.porNomina) {
    if (nid === excluirNominaId) continue
    importe += v.importe; dias += v.dias
  }
  return { importe: redondear2(importe), dias: redondear2(dias) }
}

/** El modelo cubano SOLO actúa sobre nóminas en CUP. Ver `crearNomina`. */
const MONEDA_CUBA = 'CUP'

/** Todas, activas o no: es lo que necesita la pantalla que las gestiona. */
async function leerTodasLasReglas(db: DbAdmin, client_id: string): Promise<ReglaDeduccion[]> {
  const { data } = await db.from('deducciones_reglas')
    .select('regla_id, empresa_id, nombre, tipo, modo, valor, base, destino, activa, orden')
    .eq('client_id', client_id)
    .order('orden').order('created_at')
  return ((data ?? []) as ReglaDeduccion[]).map(r => ({ ...r, valor: Number(r.valor) }))
}

/** Fila de `nomina_linea_conceptos` tal y como se escribe en la base. */
function filaItem(item: ItemLinea, linea_id: string, nomina_id: string, client_id: string) {
  return {
    item_id:   item.item_id ?? generarItemId(),
    linea_id,
    nomina_id,
    client_id,
    nombre:    item.nombre,
    tipo:      item.tipo,
    monto:     item.monto,
    origen:    item.origen,
    origen_id: item.origen_id,
    destino:   item.destino,
    concepto_clave: item.clave ?? null,
  }
}

/**
 * Lee los ítems PRESERVABLES (hoy: los PUNTUAL) de un conjunto de líneas, en UNA
 * sola consulta. Los usan el recálculo y la detección de desfase, y por eso van
 * juntos aquí: si cada uno los leyera a su manera, el aviso de «actualizar» diría
 * una cosa y el recálculo haría otra.
 */
async function leerItemsPreservados(
  db:        DbAdmin,
  client_id: string,
  lineaIds:  string[],
): Promise<Map<string, ItemLinea[]>> {
  const porLinea = new Map<string, ItemLinea[]>()
  if (!lineaIds.length) return porLinea
  const { data } = await db.from('nomina_linea_conceptos')
    .select('item_id, linea_id, nombre, tipo, monto, origen, origen_id, destino')
    .eq('client_id', client_id)
    .in('linea_id', lineaIds)
    .eq('origen', 'PUNTUAL')
    .order('created_at')
  for (const r of (data ?? []) as ({ linea_id: string } & ItemLinea)[]) {
    const arr = porLinea.get(r.linea_id) ?? []
    arr.push({
      item_id:   r.item_id,
      nombre:    r.nombre,
      tipo:      r.tipo,
      monto:     Number(r.monto),
      origen:    r.origen,
      origen_id: r.origen_id,
      destino:   r.destino,
    })
    porLinea.set(r.linea_id, arr)
  }
  return porLinea
}

// Copia un empleado a otra empresa como registro INDEPENDIENTE (misma persona, nueva
// relación laboral: cada empresa tiene su contrato/salario/moneda). Se copian los
// datos como punto de partida y queda activo; el salario/moneda se ajustan luego.
export async function copiarEmpleadoAEmpresa(
  empleado_id: string,
  empresa_destino: string,
  moneda?: string | null,
  salario?: number | null,
): Promise<{ ok: boolean; error?: string; empleado_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_destino)) {
    return { ok: false, error: 'Empresa destino no válida.' }
  }

  const db = createAdminClient()
  const { data: src } = await db.from('empleados').select('*')
    .eq('empleado_id', empleado_id).eq('client_id', session.client_id).maybeSingle()
  if (!src) return { ok: false, error: 'No se encontró el empleado a copiar.' }
  if (!empresas.some(e => e.empresa_id === src.empresa_id)) {
    return { ok: false, error: 'Sin acceso al registro original.' }
  }
  if (src.empresa_id === empresa_destino) {
    return { ok: false, error: 'El empleado ya pertenece a esa empresa.' }
  }

  // La copia nace con la moneda de SU empresa (la propone el modal), no con la
  // de origen: el mismo salario en otra moneda no es el mismo salario. El
  // salario llega ya en esa moneda — el modal lo convierte con la tasa vigente
  // y deja corregirlo antes de copiar.
  const monedaFinal = moneda?.trim() || src.moneda
  if (monedaFinal !== src.moneda && !await monedaValida(db, session.client_id, monedaFinal)) {
    return { ok: false, error: `La moneda "${monedaFinal}" no está configurada.` }
  }

  const salario_base = (salario != null && !isNaN(salario) && salario >= 0)
    ? redondear2(salario)
    : redondear2(src.salario_base as number)

  // Copiar a otra empresa es dar de alta un trabajador más: el cupo es del
  // cliente entero, no de cada empresa.
  const tope = await comprobarLimite(db, session.client_id, 'trabajadores')
  if (tope) return { ok: false, error: tope }

  const nuevo_id = generarEmpleadoId()
  const ahora    = new Date().toISOString()

  // Defensivo: aquí la PRIMARY KEY sí es `empleado_id` (que se regenera arriba),
  // así que copiar la fila entera funciona. Pero varias tablas del esquema base
  // llevan además una `id` uuid que SÍ es su PK —third_parties es una, y por eso
  // su copia reventaba—, así que no dependemos de esa diferencia: si algún día
  // `empleados` gana una `id`, esto seguirá copiando bien en vez de romperse.
  const { id: _id, ...datosOrigen } = src as Record<string, unknown>
  void _id

  const { error } = await db.from('empleados').insert({
    ...datosOrigen,
    empleado_id: nuevo_id,
    empresa_id:  empresa_destino,
    moneda:      monedaFinal,
    salario_base,
    fecha_baja:  null,
    motivo_baja: null,
    created_at:  ahora,
    updated_at:  ahora,
  })
  if (error) { console.error('[rrhh] copiar empleado error:', error); return { ok: false, error: `No se pudo copiar: ${error.message}` } }
  revalidatePath('/portal/rrhh')
  return { ok: true, empleado_id: nuevo_id }
}

// ── Copiar a otra empresa en lote (Fase 3 — máximo cuidado, Regla A) ─────────────
// Envuelve la individual (excluye la PK y regenera el código). Añade la DEDUP que la
// individual no trae: por nombre+apellidos en la empresa destino (no hay índice único
// → copiar en lote duplicaría). Un destino por operación; cada uno conserva SU
// moneda/salario (no se convierte a ciegas). Usa el ResultadoLote/loteVacio de abajo.
export async function copiarEmpleadosAEmpresaEnLote(
  ids: string[], empresa_destino: string,
): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!empresa_destino) return loteVacio('Elige una empresa destino.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()
  const { data: origen } = await db.from('empleados')
    .select('empleado_id, nombre, apellidos, empresa_id')
    .eq('client_id', session.client_id).in('empleado_id', ids)
  const { data: enDestino } = await db.from('empleados')
    .select('nombre, apellidos')
    .eq('client_id', session.client_id).eq('empresa_id', empresa_destino)
  const claveDe = (n: string, a: string | null) => `${n.trim().toLowerCase()}|${(a ?? '').trim().toLowerCase()}`
  const existentes = new Set((enDestino ?? []).map((e: { nombre: string; apellidos: string | null }) => claveDe(e.nombre, e.apellidos)))

  const res = loteVacio()
  for (const e of (origen ?? []) as { empleado_id: string; nombre: string; apellidos: string | null; empresa_id: string }[]) {
    const etiqueta = `${e.nombre}${e.apellidos ? ' ' + e.apellidos : ''}`
    const k = claveDe(e.nombre, e.apellidos)
    if (e.empresa_id === empresa_destino) { res.omitidas.push({ etiqueta, motivo: 'ya pertenece a esa empresa' }); continue }
    if (existentes.has(k))                { res.omitidas.push({ etiqueta, motivo: 'ya existe en la empresa destino' }); continue }
    const r = await copiarEmpleadoAEmpresa(e.empleado_id, empresa_destino)   // conserva su moneda/salario
    if (r.ok) { res.hechas++; existentes.add(k) }
    else res.omitidas.push({ etiqueta, motivo: r.error ?? 'No se pudo copiar' })
  }
  revalidatePath('/portal/rrhh')
  return res
}

function hoy(): string {
  return hoyEnTz()
}
function estadoDe(fecha_baja: string | null): EstadoEmpleado {
  return fecha_baja ? 'BAJA' : 'ACTIVO'
}

// ── Acciones en lote — tipo compartido (nómina + personal) ──────────────────────
// Reutilizan las acciones individuales (mismo gating y efectos en cadena). La capa
// de lote decide la ELEGIBILIDAD por estado y reporta lo omitido con su etiqueta.

export interface ResultadoLote {
  hechas:   number
  omitidas: { etiqueta: string; motivo: string }[]
  errores:  { etiqueta: string; error: string }[]
  error?:   string
}
const loteVacio = (error?: string): ResultadoLote => ({ hechas: 0, omitidas: [], errores: [], error })

// ── Cargadores de página ────────────────────────────────────────────────────────
//
// UNO POR PANTALLA, en vez de uno para todo. El monolito anterior (`obtenerRrhh`)
// era la única carga del portal sin rango ni techo: traía la historia completa de
// nómina —todas las líneas, todos sus ítems, las incidencias de todos los períodos—
// y la pedían las SEIS entradas del módulo, incluidas Turnos y Reportes, que no
// pintan ni una de esas filas. Encima recomponía `componerLinea` (motor fiscal
// cubano incluido) para cada línea de cada nómina, y cada `router.refresh()` de una
// celda de turnos o de la hoja de nómina lo repetía entero.
//
// Todos comparten `cargarBase`, que es la parte barata (una plantilla son decenas de
// filas). Lo caro solo lo pide quien lo enseña.

/** Lo común a las cuatro pantallas, más lo que el cálculo necesita de la ficha. */
interface BaseCargada {
  base: RrhhBase
  /**
   * `es_socio` y `dias_laborables` viven en `empleados` (mig. 142) pero NO están en
   * el tipo `Empleado` que consume la pantalla: aquí solo hacen falta para el cálculo.
   */
  fichaCuba: Map<string, { es_socio: boolean | null; dias_laborables: number | null }>
  /** Empresas accesibles, listas para un `.in()`. Nunca vacío. */
  idsFiltro: string[]
}

async function cargarBase(db: DbAdmin, client_id: string): Promise<BaseCargada> {
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [empRes, monRes, cliRes] = await Promise.all([
    db.from('empleados').select('*')
      .eq('client_id', client_id)
      .in('empresa_id', idsFiltro)
      .order('fecha_baja', { ascending: true, nullsFirst: true })
      .order('nombre', { ascending: true }),
    db.from('monedas').select('codigo, nombre')
      .eq('client_id', client_id)
      .eq('activa', true)
      .order('es_consolidacion', { ascending: false })
      .order('codigo'),
    db.from('clients').select('modulos_activos').eq('client_id', client_id).maybeSingle(),
  ])

  const empleados = ((empRes.data ?? []) as Empleado[]).map(e => ({
    ...e,
    salario_base:    Number(e.salario_base),
    es_socio:        !!e.es_socio,
    // `numeric` llega como texto: sin esto el `defaultValue` del formulario sería una
    // cadena y el cálculo sumaría concatenando.
    dias_laborables: e.dias_laborables == null ? null : Number(e.dias_laborables),
    estado:          estadoDe(e.fecha_baja),
  }))

  const fichaCuba = new Map(
    ((empRes.data ?? []) as unknown as
      { empleado_id: string; es_socio: boolean | null; dias_laborables: number | null }[])
      .map(e => [e.empleado_id, { es_socio: e.es_socio, dias_laborables: e.dias_laborables }]))

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  const monedas = (monRes.data ?? []) as MonedaOpcion[]
  const tasas   = await mapaTasas(db, client_id, monedas.map(m => m.codigo))

  const datalist = (vals: (string | null)[]) =>
    Array.from(new Set(vals.filter((v): v is string => !!v))).sort()

  return {
    base: {
      empleados,
      empresas: empresas.map(e => ({
        empresa_id: e.empresa_id, nombre: e.nombre, moneda_funcional: e.moneda_funcional,
      })),
      monedas,
      tasas,
      cargos:        datalist(empleados.map(e => e.cargo)),
      departamentos: datalist(empleados.map(e => e.departamento)),
      turnos:        datalist(empleados.map(e => e.turno)),
      empresa_nombres,
      tieneContabilidad: tieneModulo(cliRes.data?.modulos_activos, 'base'),
    },
    fichaCuba,
    idsFiltro,
  }
}

/**
 * Monta las nóminas con sus líneas, su desglose y su estado de pago.
 *
 * **El desfase se calcula SOLO donde la pantalla ofrece arreglarlo**: BORRADOR, o
 * CONFIRMADA sin pagos (es la condición exacta que miran las dos vistas que enseñan
 * el aviso). En una confirmada y pagada, actualizar exige anular los pagos primero,
 * así que el aviso no se ofrece nunca — y recomponer su línea entera, con el motor
 * cubano dentro, era trabajo para pintar un botón que no aparece.
 */
async function construirNominas(
  db: DbAdmin,
  client_id: string,
  nominasRaw: Nomina[],
  fichaCuba: BaseCargada['fichaCuba'],
  /** Acota las líneas a un trabajador (su ficha) en vez de traer la plantilla entera. */
  soloEmpleado?: string,
): Promise<NominaConLineas[]> {
  if (!nominasRaw.length) return []

  const nominaIds  = nominasRaw.map(n => n.nomina_id)
  const nominaPorId = new Map(nominasRaw.map(n => [n.nomina_id, n]))

  // ── «Pagada» se DERIVA, nunca se guarda (mig. 166) ──────────────────────────
  // Mirando si la CxP del **salario neto** de esa nómina está liquidada en Tesorería
  // (`gasto_id` apunta a ella). Es deliberado que dependa SOLO del salario neto: los
  // impuestos tienen su propio calendario y se pagan días después, y lo que el dueño
  // necesita ver en esta pantalla es si su plantilla ya cobró. Una nómina puede salir
  // «Pagada» con impuestos aún vivos en CxP, y es lo correcto.
  //
  // El importe de referencia es el de LA DEUDA, no `nominas.total`: son distintos —el
  // total es la suma de netos y la deuda del salario incluye lo que no va a un tercero—
  // y comparar el pago contra el total dejaría un saldo residual permanente.
  const gastoIds = nominasRaw.map(n => n.gasto_id).filter((g): g is string => !!g)
  const pagadoPorGasto = new Map<string, number>()
  const deudaPorGasto  = new Map<string, number>()

  let lineasQ = db.from('nomina_lineas').select('*')
    .eq('client_id', client_id)
    // Por las nóminas TRAÍDAS, no por `client_id` a secas: antes venían también las
    // líneas de nóminas de empresas que el usuario no puede ver, para descartarlas
    // después.
    .in('nomina_id', nominaIds)
  if (soloEmpleado) lineasQ = lineasQ.eq('empleado_id', soloEmpleado)

  const [lineasRes, pagosRes] = await Promise.all([
    lineasQ.order('empleado_nombre', { ascending: true }),
    gastoIds.length
      ? Promise.all([
          db.from('movimientos_tesoreria')
            .select('monto, monto_ref, referencia_id')
            .eq('client_id', client_id)
            .in('referencia_id', gastoIds),
          db.from('gastos_cobros')
            .select('registro_id, monto')
            .eq('client_id', client_id)
            .in('registro_id', gastoIds),
        ])
      : Promise.resolve(null),
  ])

  if (pagosRes) {
    const [{ data: movs }, { data: deudas }] = pagosRes
    // Saldo de la nómina en su moneda → se suma monto_ref (importe aplicado)
    for (const m of (movs ?? []) as { monto: number; monto_ref: number | null; referencia_id: string }[]) {
      pagadoPorGasto.set(m.referencia_id, (pagadoPorGasto.get(m.referencia_id) ?? 0) + Number(m.monto_ref ?? m.monto))
    }
    for (const g of (deudas ?? []) as { registro_id: string; monto: number }[]) {
      deudaPorGasto.set(g.registro_id, Number(g.monto))
    }
  }

  const pagadoDe = (n: Nomina) => n.gasto_id ? (pagadoPorGasto.get(n.gasto_id) ?? 0) : 0

  const lineasRaw = (lineasRes.data ?? []) as (NominaLinea & { client_id: string })[]
  const lineaIds  = lineasRaw.map(l => l.linea_id)

  // Los ítems hacen dos cosas: dar el desglose que la pantalla enseña, y —los
  // PUNTUAL— entrar en el cálculo del desfase. Sin ellos, una línea con un ajuste a
  // mano se marcaría desfasada SIEMPRE (el recálculo los conserva, así que nunca
  // «llegaría» a cuadrar) y el aviso de actualizar no se apagaría jamás.
  const itemsRes = lineaIds.length
    ? await db.from('nomina_linea_conceptos')
        .select('item_id, linea_id, nombre, tipo, monto, origen, origen_id, destino, concepto_clave')
        .eq('client_id', client_id)
        .in('linea_id', lineaIds)
        .order('created_at')
    : { data: [] }

  const itemsPorLinea       = new Map<string, ItemLinea[]>()
  const preservadosPorLinea = new Map<string, ItemLinea[]>()
  for (const r of (itemsRes.data ?? []) as
    ({ linea_id: string; concepto_clave: ConceptoClave | null } & ItemLinea)[]) {
    const it: ItemLinea = {
      item_id:   r.item_id,
      nombre:    r.nombre,
      tipo:      r.tipo,
      monto:     Number(r.monto),
      origen:    r.origen,
      origen_id: r.origen_id,
      destino:   r.destino,
      // La vista abrevia por clave, nunca por nombre (Fase 1). El respaldo por nombre
      // es solo para lo escrito antes de la mig. 165.
      clave:     r.concepto_clave ?? claveDeNombre(r.nombre),
    }
    const todos = itemsPorLinea.get(r.linea_id) ?? []
    todos.push(it)
    itemsPorLinea.set(r.linea_id, todos)
    if (esPreservable(it.origen)) {
      const pres = preservadosPorLinea.get(r.linea_id) ?? []
      pres.push(it)
      preservadosPorLinea.set(r.linea_id, pres)
    }
  }

  // ── Qué nóminas merecen que se les mida el desfase ───────────────────────────
  // Solo aquellas donde el botón de «Actualizar» se pinta. Con esto, un histórico de
  // dos años de nóminas confirmadas y pagadas deja de recalcularse en cada visita.
  const midoDesfase = new Set(nominasRaw
    .filter(n => n.estado === 'BORRADOR' || pagadoDe(n) <= EPS)
    .map(n => n.nomina_id))

  const lineasDeInteres = lineasRaw.filter(l => midoDesfase.has(l.nomina_id))
  const periodos = Array.from(new Set(
    lineasDeInteres.map(l => nominaPorId.get(l.nomina_id)?.periodo).filter((p): p is string => !!p)))

  // Lo que alimenta el cálculo del desfase: solo se pide si hay algo que medir.
  const empleadosDeInteres = Array.from(new Set(lineasDeInteres.map(l => l.empleado_id)))
  const [reglasDe, configNomina, incidenciasTodas, cptRes, paramsRes] = lineasDeInteres.length
    ? await Promise.all([
        leerReglas(db, client_id),
        leerConfigNomina(db, client_id),
        leerIncidenciasDeVarios(db, client_id, periodos),
        db.from('conceptos_empleado')
          .select('concepto_id, empleado_id, nombre, tipo, modo, valor, base, destino, regla_id, excluida, recurrencia, periodo_aplicable')
          .eq('client_id', client_id)
          .in('empleado_id', empleadosDeInteres)
          .eq('activo', true)
          .order('created_at'),
        db.from('parametros_fiscales_cuba').select(SELECT_PARAMETROS),
      ])
    : [null, null, null, null, null] as const

  // El saldo (con desglose por nómina) alimenta la valoración del disfrute EXACTAMENTE
  // como lo hará el recálculo: si aquí se valorara con otro criterio, una línea que paga
  // vacaciones saldría «desfasada» sin poder cuadrar jamás.
  const detalleSaldos = lineasDeInteres.length
    ? await saldosVacacionesDetalle(db, client_id, empleadosDeInteres)
    : new Map<string, { apertura: SaldoVac; porNomina: Map<string, SaldoVac> }>()

  const conceptosPorEmpleado = new Map<string, ConceptoAplicable[]>()
  for (const c of (cptRes?.data ?? []) as ({ empleado_id: string } & ConceptoAplicable)[]) {
    const arr = conceptosPorEmpleado.get(c.empleado_id) ?? []
    arr.push({ ...c, valor: Number(c.valor) })
    conceptosPorEmpleado.set(c.empleado_id, arr)
  }

  const parametrosTodos = (paramsRes?.data ?? []) as ParametroConVigencia[]
  // Una nómina por mes son muchas fechas repetidas: se resuelve la ley una vez por
  // fecha distinta, no una por línea.
  const paramsPorFecha = new Map<string, ParametroFiscal[]>()
  const parametrosEn = (fecha: string) => {
    let p = paramsPorFecha.get(fecha)
    if (!p) { p = parametrosVigentes(parametrosTodos, fecha); paramsPorFecha.set(fecha, p) }
    return p
  }

  const lineasPorNomina = new Map<string, NominaLinea[]>()
  for (const l of lineasRaw) {
    const arr = lineasPorNomina.get(l.nomina_id) ?? []
    const devengado   = Number(l.devengado)
    const deducciones = Number(l.deducciones)
    // También en las CONFIRMADAS sin pagos: reabrirlas para meter una retención
    // olvidada es el caso real (la nómina del mes ya está cerrada cuando uno se
    // acuerda), así que ocultar el desfase ahí obligaba a borrar la nómina y
    // regenerarla.
    const nom = nominaPorId.get(l.nomina_id)
    // Se compone con EXACTAMENTE lo mismo que usará el recálculo —incidencias del
    // mes y ley cubana incluidas—. Cuando faltaban, toda línea con una incidencia
    // (o cualquiera bajo MIPYME_CUBA) salía «desfasada» para siempre y actualizar
    // no encontraba nada que cambiar: el aviso mentía.
    const cfg = nom && configNomina ? configDe(configNomina, nom.empresa_id) : null
    const inc = nom && incidenciasTodas ? incidenciasTodas.get(`${nom.periodo}|${l.empleado_id}`) : undefined
    const aplicaCuba = !!nom && !!cfg && cfg.modelo === 'MIPYME_CUBA' && nom.moneda === MONEDA_CUBA
    const ficha = fichaCuba.get(l.empleado_id)
    // Saldo ANTERIOR a esta línea: se excluye SU propia nómina (si ya está confirmada,
    // su contribución no debe contar al valorar su propio disfrute).
    const saldoVac = aplicaCuba ? saldoVacDe(detalleSaldos.get(l.empleado_id), l.nomina_id) : null
    const calc = nom && reglasDe && midoDesfase.has(l.nomina_id)
      ? componerLinea({
          salario_base: Number(l.salario_base),
          reglas:       reglasDe(nom.empresa_id),
          conceptos:    conceptosPorEmpleado.get(l.empleado_id) ?? [],
          preservados:  preservadosPorLinea.get(l.linea_id) ?? [],
          periodo:      nom.periodo,
          incidencia:   inc,
          cuba: aplicaCuba ? {
            parametros:      parametrosEn(nom.fecha),
            dias_laborables: Number(ficha?.dias_laborables ?? cfg!.dias_laborables_default),
            es_socio:        !!ficha?.es_socio,
            dias_trabajados: inc?.dias_trabajados ?? null,
            dias_vacaciones: inc?.dias_vacaciones ?? 0,
            dias_liquidacion: inc?.dias_liquidacion ?? 0,
            saldo_vac_importe: saldoVac!.importe,
            saldo_vac_dias:    saldoVac!.dias,
            vacaciones_importe_manual: inc?.vacaciones_importe_manual ?? null,
          } : undefined,
        })
      : null
    arr.push({
      linea_id:        l.linea_id,
      nomina_id:       l.nomina_id,
      empleado_id:     l.empleado_id,
      empleado_nombre: l.empleado_nombre,
      cargo:           l.cargo,
      salario_base:    Number(l.salario_base),
      devengado,
      deducciones,
      neto:            Number(l.neto),
      notas:           l.notas,
      items:           itemsPorLinea.get(l.linea_id) ?? [],
      vacaciones_acumuladas_periodo: Number(l.vacaciones_acumuladas_periodo ?? 0),
      vacaciones_pagadas_periodo:    Number(l.vacaciones_pagadas_periodo ?? 0),
      subsidios:                     Number(l.subsidios ?? 0),
      subsidios_maternidad:          Number(l.subsidios_maternidad ?? 0),
      desfasada:       !!calc && (Math.abs(devengado - calc.devengado) > EPS
                               || Math.abs(deducciones - calc.deducciones) > EPS),
    })
    lineasPorNomina.set(l.nomina_id, arr)
  }

  return nominasRaw.map(n => {
    const total  = Number(n.total)
    const pagado = pagadoDe(n)
    // Sin fila de deuda (histórico anterior a la mig. 166, donde `gasto_id` apuntaba al
    // gasto de Salarios) se cae al total: así una nómina vieja se sigue viendo igual.
    const deuda  = n.gasto_id ? (deudaPorGasto.get(n.gasto_id) ?? total) : total
    const lineas = lineasPorNomina.get(n.nomina_id) ?? []
    return {
      ...n,
      total,
      lineas,
      pagado,
      saldo_pendiente: Math.max(0, redondear2(deuda - pagado)),
      desactualizada:  lineas.some(l => l.desfasada),
    }
  })
}

/** Años con nóminas, para el filtro. Consulta propia y no un recorrido de las
 *  traídas: con rango aplicado, el listado ya no las tiene todas y el desplegable
 *  se quedaría sin los años que precisamente hay que poder elegir. */
async function aniosConNomina(db: DbAdmin, client_id: string, idsFiltro: string[]): Promise<string[]> {
  const { data } = await db.from('nominas').select('periodo')
    .eq('client_id', client_id).in('empresa_id', idsFiltro)
  const set = new Set<string>()
  for (const n of (data ?? []) as { periodo: string }[]) if (n.periodo) set.add(n.periodo.slice(0, 4))
  return Array.from(set).sort().reverse()
}

// ── Personal (`/portal/rrhh`) y la ficha del trabajador ─────────────────────────

export async function obtenerPersonal(): Promise<PersonalPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const [{ base }, config] = await Promise.all([
    cargarBase(db, session.client_id),
    leerConfigNomina(db, session.client_id),
  ])
  return { ...base, config_nomina: Array.from(config.values()) }
}

/**
 * Cuántas nóminas tiene un trabajador. Se pide A DEMANDA, al cambiarle la moneda en
 * el modal, y era la ÚNICA razón por la que Personal cargaba la historia entera de
 * nómina: un aviso que solo se pinta cuando alguien toca ese selector.
 */
export async function contarNominasDeEmpleado(
  empleado_id: string,
): Promise<{ total: number; borradores: number }> {
  const session = await getPortalSession()
  if (!session) return { total: 0, borradores: 0 }

  const db = createAdminClient()
  const { data } = await db.from('nomina_lineas')
    .select('nomina_id')
    .eq('client_id', session.client_id)
    .eq('empleado_id', empleado_id)
  const ids = Array.from(new Set((data ?? []).map(l => l.nomina_id as string)))
  if (!ids.length) return { total: 0, borradores: 0 }

  const { count } = await db.from('nominas')
    .select('nomina_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .in('nomina_id', ids)
    .eq('estado', 'BORRADOR')
  return { total: ids.length, borradores: count ?? 0 }
}

// ── Turnos (`/portal/turnos`) ───────────────────────────────────────────────────

export async function obtenerTurnos(): Promise<TurnosPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const { base, idsFiltro } = await cargarBase(db, session.client_id)

  const [turRes, patRes, slotRes, miemRes] = await Promise.all([
    db.from('turnos').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('nombre', { ascending: true }),
    db.from('turno_patrones').select('patron_id, empresa_id, nombre, tipo, longitud_dias, fecha_ancla, activo')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('nombre', { ascending: true }),
    db.from('turno_patron_slots').select('slot_id, patron_id, posicion, turno_id')
      .eq('client_id', session.client_id),
    db.from('turno_miembros').select('miembro_id, patron_id, empleado_id, offset_ciclo')
      .eq('client_id', session.client_id),
  ])

  const patrones = ((patRes.data ?? []) as TurnoPatron[]).map(p => ({
    ...p, fecha_ancla: String(p.fecha_ancla).slice(0, 10),
  }))
  const patronIds  = new Set(patrones.map(p => p.patron_id))
  const empleadoIds = new Set(base.empleados.map(e => e.empleado_id))
  return {
    ...base,
    turnos_catalogo: (turRes.data ?? []) as Turno[],
    patrones,
    // slots y miembros se acotan a los patrones visibles (los de las empresas del rol).
    slots:    ((slotRes.data ?? []) as TurnoPatronSlot[]).filter(s => patronIds.has(s.patron_id)),
    miembros: ((miemRes.data ?? []) as TurnoMiembro[])
      .filter(m => patronIds.has(m.patron_id) && empleadoIds.has(m.empleado_id)),
  }
}

// ── Nómina (`/portal/nomina`) ───────────────────────────────────────────────────

export interface FiltroNominas {
  /** 'YYYY', o vacío = todos los años. */
  anio?:   string
  /** Techo pedido desde `<AvisoTope>` («Traer más»). */
  limite?: number
}

export async function obtenerNominas(filtro?: FiltroNominas): Promise<NominaPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const { base, fichaCuba, idsFiltro } = await cargarBase(db, session.client_id)

  const anio = (filtro?.anio ?? '').trim()
  // El techo depende de lo que se pida (`limiteDelFiltro`, el mismo del resto del
  // portal): un año concreto es el primer pintado —el que se paga en 3G—; «todos los
  // años» sube el tope pero no lo quita, porque recortar por fecha descendente se come
  // los registros más VIEJOS y un filtro que se llama «todos» y omite filas miente.
  const limite = limiteDelFiltro({
    limite: filtro?.limite,
    desde:  anio ? `${anio}-01-01` : '',
    hasta:  anio ? `${anio}-12-31` : '',
  })

  let q = db.from('nominas').select('*', { count: 'exact' })
    .eq('client_id', session.client_id)
    .in('empresa_id', idsFiltro)
  if (anio) q = q.gte('periodo', `${anio}-01`).lte('periodo', `${anio}-12`)

  const [nomRes, anios, cuRes, catRes, mapRes, reglasTodas, configNomina, paramsRes] = await Promise.all([
    q.order('periodo', { ascending: false })
     .order('created_at', { ascending: false })
     .limit(limite),
    aniosConNomina(db, session.client_id, idsFiltro),
    db.from('cuentas').select('cuenta_id, nombre, empresa_id, moneda, activa')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .eq('activa', true)
      .eq('es_apertura', false)   // técnica de la migración (mig. 130): no se paga desde ella
      .order('nombre'),
    // Para el selector del mapeo de gastos (mig. 166) y para pintar qué categoría tiene
    // configurada cada concepto. Van aquí, con el resto: la pestaña de configuración se
    // abre desde esta misma página.
    db.from('categorias_gastos')
      .select('categoria_id, nombre, parent_id')
      .eq('client_id', session.client_id).eq('estado', 'ACTIVO')
      .order('nombre'),
    db.from('nomina_gasto_mapeo')
      .select('empresa_id, concepto, categoria_id')
      .eq('client_id', session.client_id),
    leerTodasLasReglas(db, session.client_id),
    leerConfigNomina(db, session.client_id),
    db.from('parametros_fiscales_cuba').select(SELECT_PARAMETROS),
  ])

  const nominas = await construirNominas(
    db, session.client_id, (nomRes.data ?? []) as Nomina[], fichaCuba)

  const cuentas = ((cuRes.data ?? []) as { cuenta_id: string; nombre: string; empresa_id: string; moneda: string; activa: boolean }[])
    .map(c => ({ cuenta_id: c.cuenta_id, nombre: c.nombre, empresa_id: c.empresa_id, moneda: c.moneda }))

  const parametrosTodos = (paramsRes.data ?? []) as ParametroConVigencia[]

  return {
    ...base,
    nominas,
    reglas:           reglasTodas,
    config_nomina:    Array.from(configNomina.values()),
    categorias_gasto: (catRes.data ?? []) as NominaPageData['categorias_gasto'],
    mapeo_gasto:      (mapRes.data ?? []) as NominaPageData['mapeo_gasto'],
    // Los que siguen a la espera del valor real (vigencia abierta). En el modelo
    // general estos tributos no se aplican, pero avisar solo cuesta una línea aquí.
    fiscales_provisionales: Array.from(new Set(
      parametrosTodos.filter(p => p.provisional && !p.vigente_hasta).map(p => p.concepto))),
    cuentas,
    anios,
    total:   nomRes.count ?? nominas.length,
    limite,
    hay_mas: (nomRes.count ?? nominas.length) > nominas.length,
  }
}

// ── Reportes de personal (`/portal/rrhh-reportes`) ──────────────────────────────

export interface ReportesRrhhData {
  reportes: ReportesRrhh
  empresas: RrhhBase['empresas']
  anios:    string[]
  /** Sin plantilla no hay informe que enseñar, y el vacío lo dice mejor que una tabla a cero. */
  sinDatos: boolean
  /** Monedas del cliente, para el control «Ver en [moneda]». */
  monedas:  MonedaOpcion[]
  /** La moneda de la vista, o '' = «Cada moneda» (informe nativo, sin convertir). */
  ver:      string
  /** Alguna cifra se convirtió a la moneda de vista con la tasa vigente. Se DICE. */
  convertido: boolean
  /** Alguna empresa usa el modelo cubano: sin eso, el resumen de ONAT no aplica. */
  hayCuba:  boolean
  /** El negocio, para la cabecera del PDF y del Excel. */
  negocio:  string
}

/**
 * Los reportes se AGREGAN EN SERVIDOR. La vista recibía `RrhhPageData` entero —o sea
 * la historia de nómina con su desglose y su desfase recalculado— para después
 * sumarla en el navegador: la pantalla del módulo que menos filas necesitaba era la
 * que más traía. `construirReportesRrhh` ya era puro y server-safe (lo usa el Excel),
 * así que aquí solo cambia quién lo llama.
 */
export async function obtenerReportesRrhh(
  anio: string, empresaId: string, verMoneda = '',
): Promise<ReportesRrhhData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [empRes, nomRes, anios] = await Promise.all([
    // `cargo` y `nombre` entran por el coste por CARGO y por quién es el de más
    // antigüedad; son dos columnas de texto sobre una tabla que ya se lee entera.
    db.from('empleados').select('empleado_id, empresa_id, nombre, apellidos, cargo, departamento, fecha_alta, fecha_baja')
      .eq('client_id', session.client_id).in('empresa_id', idsFiltro),
    // Solo las CONFIRMADAS del año: el informe no cuenta borradores, y traer el resto
    // era pagar por filas que se descartan en el primer `filter`.
    db.from('nominas').select('nomina_id, empresa_id, estado, periodo, moneda, total')
      .eq('client_id', session.client_id).in('empresa_id', idsFiltro)
      .eq('estado', 'CONFIRMADA')
      .gte('periodo', `${anio}-01`).lte('periodo', `${anio}-12`),
    aniosConNomina(db, session.client_id, idsFiltro),
  ])

  const empleados: EmpleadoRrhh[] = ((empRes.data ?? []) as {
    empleado_id: string; empresa_id: string; nombre: string; apellidos: string | null
    cargo: string | null; departamento: string | null
    fecha_alta: string | null; fecha_baja: string | null
  }[]).map(e => ({
    ...e,
    nombre: [e.nombre, e.apellidos].filter(Boolean).join(' '),
    estado: estadoDe(e.fecha_baja),
  }))

  const cabeceras = (nomRes.data ?? []) as {
    nomina_id: string; empresa_id: string; estado: string; periodo: string; moneda: string; total: number
  }[]

  // Solo lo que el agregado consume: `costeDe` suma DEVENGADOS, no netos (una
  // retención no es un ahorro). Sin ítems, sin desglose y sin desfase.
  const { data: lineasData } = cabeceras.length
    ? await db.from('nomina_lineas').select('nomina_id, empleado_id, neto, devengado')
        .eq('client_id', session.client_id)
        .in('nomina_id', cabeceras.map(n => n.nomina_id))
    : { data: [] }

  const lineasPorNomina = new Map<string, NominaRrhh['lineas']>()
  for (const l of (lineasData ?? []) as { nomina_id: string; empleado_id: string; neto: number; devengado: number }[]) {
    const arr = lineasPorNomina.get(l.nomina_id) ?? []
    arr.push({ empleado_id: l.empleado_id, neto: Number(l.neto), devengado: Number(l.devengado) })
    lineasPorNomina.set(l.nomina_id, arr)
  }

  const nominas: NominaRrhh[] = cabeceras.map(n => ({
    empresa_id: n.empresa_id,
    estado:     n.estado,
    periodo:    n.periodo,
    moneda:     n.moneda,
    total:      Number(n.total),
    lineas:     lineasPorNomina.get(n.nomina_id) ?? [],
  }))

  // ── Lo que se le debe a ONAT y la deuda de vacaciones ─────────────────────────
  // Los dos informes que faltaban, y los dos con el dato ya entero en la base: las
  // retenciones y los aportes viven en los ítems, y el saldo de vacaciones se deriva de
  // `apertura + Σ acumuladas − Σ pagadas`. Hasta ahora el primero había que rebuscarlo
  // en Cuentas por pagar fila por fila, y el segundo no se agregaba en ninguna parte
  // —siendo un pasivo real y cuantificado del negocio—.
  const configs  = await leerConfigNomina(db, session.client_id)
  const hayCuba  = empresas.some(e => configDe(configs, e.empresa_id).modelo === 'MIPYME_CUBA')
  const monedaDeNomina = new Map(cabeceras.map(n => [n.nomina_id, n.moneda]))

  let itemsFiscales: ItemFiscalRrhh[] = []
  if (hayCuba && cabeceras.length) {
    const { data: items } = await db.from('nomina_linea_conceptos')
      .select('nomina_id, tipo, monto, concepto_clave, nombre')
      .eq('client_id', session.client_id)
      .in('nomina_id', cabeceras.map(n => n.nomina_id))
    itemsFiscales = ((items ?? []) as {
      nomina_id: string; tipo: TipoItemLinea; monto: number
      concepto_clave: ConceptoClave | null; nombre: string
    }[])
      // Solo lo que va a un tercero fiscal: un bono o un descuento del trabajador no es
      // deuda con ONAT. La identidad es la CLAVE, no el nombre (mig. 165) — con el
      // nombre, una tilde de más dejaba de clasificar en silencio.
      .filter(i => i.tipo === 'RETENCION' || i.tipo === 'APORTE_EMPRESA')
      .map(i => ({ clave: i.concepto_clave ?? claveDeNombre(i.nombre), ...i }))
      .filter(i => esConceptoFiscal(i.clave))
      .map(i => ({
        concepto: NOMBRE_CONCEPTO[i.clave as ConceptoClave],
        moneda:   monedaDeNomina.get(i.nomina_id) ?? '',
        monto:    Number(i.monto),
      }))
  }

  // El SUBMAYOR de vacaciones de toda la plantilla, en dos consultas y no una por persona.
  // Cada confirmada se reparte a un lado u otro del 1 de enero del año: lo anterior abre el
  // saldo (junto con la apertura), lo del año es el movimiento. En las dos unidades a la
  // vez. Se incluye a los de BAJA (a diferencia de la deuda viva de antes): un trabajador
  // liquidado este año es justo lo que un submayor tiene que mostrar.
  let saldos: SaldoVacaciones[] = []
  let movimientosFondo: MovFondoSubsidio[] = []
  if (hayCuba) {
    const { data: fichas } = await db.from('empleados')
      .select('empleado_id, nombre, apellidos, moneda, vacaciones_apertura, vacaciones_apertura_dias, fecha_baja')
      .eq('client_id', session.client_id).in('empresa_id', idsFiltro)
    const visibles = ((fichas ?? []) as {
      empleado_id: string; nombre: string; apellidos: string | null
      moneda: string; vacaciones_apertura: number | null; vacaciones_apertura_dias: number | null
      fecha_baja: string | null
    }[]).filter(f =>
      !empresaId || empleados.some(e => e.empleado_id === f.empleado_id && e.empresa_id === empresaId))

    // Confirmadas con su PERÍODO: hace falta para saber si la línea abre o mueve el saldo.
    // La moneda y la empresa entran por el fondo del 1,5 %, que se agrega por moneda y
    // respeta el filtro de empresa.
    const { data: confirmadas } = await db.from('nominas')
      .select('nomina_id, periodo, moneda, empresa_id').eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro).eq('estado', 'CONFIRMADA')
    const metaNom = new Map(((confirmadas ?? []) as {
      nomina_id: string; periodo: string; moneda: string; empresa_id: string
    }[]).map(n => [n.nomina_id, n]))
    const periodoDe = new Map(Array.from(metaNom.values()).map(n => [n.nomina_id, n.periodo]))
    const idsConf = Array.from(periodoDe.keys())

    // Cada persona con su cuatro-en-uno: inicial (importe/días) y movimiento del año.
    type Mov = { iniI: number; iniD: number; acuI: number; acuD: number; pagI: number; pagD: number }
    const vacio = (): Mov => ({ iniI: 0, iniD: 0, acuI: 0, acuD: 0, pagI: 0, pagD: 0 })
    const movidoPor = new Map<string, Mov>()
    const enero = `${anio}-01`
    const dic   = `${anio}-12`
    // El fondo del 1,5 %, por moneda: la parte de PAGO (subsidios de enfermedad) sale de
    // las líneas; la provisión, de los conceptos (más abajo). Respeta el filtro de empresa.
    const fondoMov = new Map<string, MovFondoSubsidio>()
    const fondoDe = (moneda: string): MovFondoSubsidio => {
      const f = fondoMov.get(moneda)
        ?? { moneda, iniProvision: 0, iniPagado: 0, provision: 0, pagado: 0 }
      fondoMov.set(moneda, f)
      return f
    }
    if (idsConf.length) {
      const { data: lns } = await db.from('nomina_lineas')
        .select('empleado_id, nomina_id, vacaciones_acumuladas_periodo, vacaciones_pagadas_periodo, vacaciones_dias_acumulados_periodo, vacaciones_dias_pagados_periodo, subsidios, subsidios_maternidad')
        .eq('client_id', session.client_id).in('nomina_id', idsConf)
      for (const l of (lns ?? []) as {
        empleado_id: string; nomina_id: string
        vacaciones_acumuladas_periodo: number | null; vacaciones_pagadas_periodo: number | null
        vacaciones_dias_acumulados_periodo: number | null; vacaciones_dias_pagados_periodo: number | null
        subsidios: number | null; subsidios_maternidad: number | null
      }[]) {
        const periodo = periodoDe.get(l.nomina_id)
        if (!periodo) continue
        const m = movidoPor.get(l.empleado_id) ?? vacio()
        const acuI = Number(l.vacaciones_acumuladas_periodo ?? 0)
        const pagI = Number(l.vacaciones_pagadas_periodo ?? 0)
        const acuD = Number(l.vacaciones_dias_acumulados_periodo ?? 0)
        const pagD = Number(l.vacaciones_dias_pagados_periodo ?? 0)
        if (periodo < enero) {
          // Anterior al año: alimenta el saldo INICIAL (neto acumulado − pagado).
          m.iniI += acuI - pagI; m.iniD += acuD - pagD
        } else if (periodo <= dic) {
          // Dentro del año: es el movimiento del ejercicio.
          m.acuI += acuI; m.acuD += acuD; m.pagI += pagI; m.pagD += pagD
        }
        movidoPor.set(l.empleado_id, m)

        // Fondo: el subsidio de ENFERMEDAD (total − maternidad) rebaja el fondo. La
        // maternidad no, que la reembolsa el Estado. Solo de la empresa mirada.
        const meta = metaNom.get(l.nomina_id)
        if (meta && (!empresaId || meta.empresa_id === empresaId)) {
          const enfermedad = Number(l.subsidios ?? 0) - Number(l.subsidios_maternidad ?? 0)
          if (enfermedad > 0.005) {
            const f = fondoDe(meta.moneda)
            if (periodo < enero) f.iniPagado += enfermedad
            else if (periodo <= dic) f.pagado += enfermedad
          }
        }
      }

      // La PROVISIÓN del 1,5 %: sale de los conceptos (aporte de empresa), por su CLAVE.
      const { data: prov } = await db.from('nomina_linea_conceptos')
        .select('nomina_id, monto, concepto_clave, nombre, tipo')
        .eq('client_id', session.client_id).in('nomina_id', idsConf)
      for (const c of (prov ?? []) as {
        nomina_id: string; monto: number
        concepto_clave: ConceptoClave | null; nombre: string; tipo: TipoItemLinea
      }[]) {
        if (c.tipo !== 'APORTE_EMPRESA') continue
        const clave = c.concepto_clave ?? claveDeNombre(c.nombre)
        if (clave !== 'SS_EMPRESA_15') continue
        const meta = metaNom.get(c.nomina_id)
        if (!meta || (empresaId && meta.empresa_id !== empresaId)) continue
        const periodo = meta.periodo
        const f = fondoDe(meta.moneda)
        if (periodo < enero) f.iniProvision += Number(c.monto)
        else if (periodo <= dic) f.provision += Number(c.monto)
      }
    }
    movimientosFondo = Array.from(fondoMov.values())
    saldos = visibles.map(f => {
      const m = movidoPor.get(f.empleado_id) ?? vacio()
      const iniImporte = Number(f.vacaciones_apertura ?? 0) + m.iniI
      const iniDias    = Number(f.vacaciones_apertura_dias ?? 0) + m.iniD
      return {
        nombre: [f.nombre, f.apellidos].filter(Boolean).join(' '),
        moneda: f.moneda,
        inicialImporte:   redondear2(iniImporte),
        inicialDias:      redondear2(iniDias),
        acumuladoImporte: redondear2(m.acuI),
        acumuladoDias:    redondear2(m.acuD),
        pagadoImporte:    redondear2(m.pagI),
        pagadoDias:       redondear2(m.pagD),
        finalImporte:     redondear2(iniImporte + m.acuI - m.pagI),
        finalDias:        redondear2(iniDias + m.acuD - m.pagD),
      }
    })
  }

  const reportes = construirReportesRrhh(
    empleados, nominas,
    empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    { empresaId, anio },
    itemsFiscales, saldos, movimientosFondo,
    // «Hoy» del NEGOCIO para la antigüedad, nunca el reloj del navegador.
    hoyEnTz(),
  )

  // ── Moneda de la vista ────────────────────────────────────────────────────────
  // Mismo contrato que Reportes financieros: por defecto **«Cada moneda»** = informe
  // NATIVO, sin convertir. Convertir es opt-in, y lo que se convierte SE DICE. Un
  // negocio que paga en CUP y en USD veía «120.000,00 CUP · 900,00 USD» concatenado y
  // no había forma de obtener un total.
  const { data: monData } = await db.from('monedas').select('codigo, nombre')
    .eq('client_id', session.client_id).eq('activa', true)
    .order('es_consolidacion', { ascending: false }).order('codigo')
  const monedas = (monData ?? []) as MonedaOpcion[]
  const ver = monedas.some(m => m.codigo === verMoneda) ? verMoneda : ''

  let convertido = false
  const finales = ver ? await (async () => {
    const tasas = await mapaTasas(db, session.client_id, monedas.map(m => m.codigo))
    // Regla del informe: con datos reales en la moneda vista NO se convierte; se
    // convierte solo lo que falta, y se marca.
    const aVista = (ms: MontoMoneda[]): MontoMoneda[] => {
      let total = 0
      for (const m of ms) {
        if (m.moneda === ver) { total += m.monto; continue }
        const factor = tasas[`${m.moneda}__${ver}`]
        // Sin par ni tasa no se inventa un número: esa moneda se queda fuera y el aviso
        // de conversión lo dice. Un total con una pata a cero es peor que uno incompleto.
        if (!factor) continue
        total += m.monto * factor
        convertido = true
      }
      return [{ moneda: ver, monto: redondear2(total) }]
    }
    return {
      ...reportes,
      costeAnual:  aVista(reportes.costeAnual),
      costePorMes: reportes.costePorMes.map(r => ({ ...r, monedas: aVista(r.monedas) })),
      porDepto:    reportes.porDepto.map(d => ({ ...d, coste: aVista(d.coste) })),
      porEmpresa:  reportes.porEmpresa.map(e => ({ ...e, coste: aVista(e.coste) })),
      vacaciones:  { ...reportes.vacaciones, total: aVista(reportes.vacaciones.total) },
      onat:        reportes.onat.map(o => ({ ...o, monedas: aVista(o.monedas) })),
      costeMedio:  aVista(reportes.costeMedio),
      porCargo:    reportes.porCargo.map(c => ({ ...c, coste: aVista(c.coste) })),
      // `rotacion` y `antiguedad` NO se convierten: son personas, años y un porcentaje.
      // Pasarlos por `aVista` los reetiquetaría con una moneda que no significa nada.
    }
  })() : reportes

  return {
    reportes: finales,
    empresas: empresas.map(e => ({
      empresa_id: e.empresa_id, nombre: e.nombre, moneda_funcional: e.moneda_funcional,
    })),
    anios: anios.includes(anio) ? anios : [anio, ...anios],
    sinDatos: empleados.length === 0,
    monedas, ver, convertido, hayCuba,
    negocio: empresas[0]?.nombre ?? '',
  }
}

/**
 * Los reportes de personal en .xlsx.
 *
 * Se genera en SERVIDOR y baja como base64 → Blob por server action, igual que los
 * informes financieros: el escritor de .xlsx es server-only, y el CSV que esta pantalla
 * armaba en el navegador le llegaba al asesor con los importes como texto (sin poder
 * sumarlos) y con los dos destrozos de codificación que ya documentó el importador.
 *
 * LECTURA: el candado del módulo lo pone la página.
 */
export async function exportarReportesRrhhXlsx(
  anio: string, empresaId: string, verMoneda = '',
): Promise<{ ok: boolean; base64?: string; nombre?: string; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  // Se reusa el mismo cargador que pinta la pantalla: es lo que garantiza que el
  // fichero y lo que el dueño está viendo digan la misma cifra.
  const data = await obtenerReportesRrhh(anio, empresaId, verMoneda)
  if (!data) return { ok: false, error: 'No se pudo preparar el informe.' }

  const { construirXlsxRrhh } = await import('@/lib/exportar/rrhh-xlsx')
  const base64 = await construirXlsxRrhh(data.reportes, {
    negocio:    data.negocio,
    empresa:    empresaId ? (data.empresas.find(e => e.empresa_id === empresaId)?.nombre ?? '') : 'Todas las empresas',
    anio,
    ver:        data.ver,
    convertido: data.convertido,
    generado:   hoy(),
  })
  return { ok: true, base64, nombre: `reportes-personal-${anio}.xlsx` }
}

// ── Guardar empleado (crear / editar) ───────────────────────────────────────────

export async function guardarEmpleado(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const empleado_id  = (formData.get('empleado_id')  as string)?.trim()
  const empresa_id   = (formData.get('empresa_id')   as string)?.trim()
  const nombre       = (formData.get('nombre')       as string)?.trim()
  const moneda       = (formData.get('moneda')       as string)?.trim()

  if (!nombre)      return { ok: false, error: 'El nombre es obligatorio.' }
  if (!empresa_id)  return { ok: false, error: 'Debes seleccionar una empresa.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  // Los dos campos del modelo cubano solo los pinta el formulario si la empresa usa
  // MIPYME_CUBA, así que «no vino en el FormData» significa «no lo toques» y no
  // «ponlo a cero»: editar el teléfono desde una empresa en modelo General no puede
  // desmarcar a un socio en silencio. El checkbox viaja con un hidden gemelo a `0`
  // delante, porque un checkbox desmarcado no se envía y sin él no habría forma de
  // distinguir «desmarcado» de «no estaba en pantalla».
  const es_socio = formData.has('es_socio')
    ? formData.getAll('es_socio').includes('1')
    : undefined
  const diasRaw = formData.get('dias_laborables')
  const dias_laborables = formData.has('dias_laborables')
    ? (String(diasRaw ?? '').trim() === '' ? null : parseFloat(String(diasRaw)))
    : undefined

  // La normalización (contrato, periodicidad, salario, fecha de alta) la hace el
  // núcleo compartido con el importador (`@/lib/rrhh-core`).
  const campos = construirCamposEmpleado({
    nombre,
    es_socio,
    dias_laborables,
    apellidos:             (formData.get('apellidos')             as string) ?? null,
    documento:             (formData.get('documento')             as string) ?? null,
    documento_vencimiento: (formData.get('documento_vencimiento') as string) ?? null,
    fecha_nacimiento:      (formData.get('fecha_nacimiento')      as string) ?? null,
    telefono:              (formData.get('telefono')              as string) ?? null,
    email:                 (formData.get('email')                 as string) ?? null,
    direccion:             (formData.get('direccion')             as string) ?? null,
    cargo:                 (formData.get('cargo')                 as string) ?? null,
    departamento:          (formData.get('departamento')          as string) ?? null,
    turno:                 (formData.get('turno')                 as string) ?? null,
    tipo_contrato:         (formData.get('tipo_contrato')         as string) ?? null,
    fecha_alta:            (formData.get('fecha_alta')            as string) ?? null,
    salario_base:          parseFloat(formData.get('salario_base') as string),
    periodicidad:          (formData.get('periodicidad')          as string) ?? null,
    notas:                 (formData.get('notas')                 as string) ?? null,
  })

  if (!moneda) return { ok: false, error: 'Debes seleccionar una moneda.' }

  if (!empleado_id) {
    if (!await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada en Monedas y Tasas.` }
    }
    const tope = await comprobarLimite(db, session.client_id, 'trabajadores')
    if (tope) return { ok: false, error: tope }

    const nuevoId = generarEmpleadoId()
    const { error } = await db.from('empleados').insert({
      empleado_id: nuevoId,
      client_id:   session.client_id,
      empresa_id,
      moneda,
      ...campos,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    // La moneda SÍ se cambia: un empleado copiado a una empresa que opera en
    // otra moneda nacía con la de origen y, con el campo bloqueado, no había
    // forma de arreglarlo. Las nóminas ya emitidas no se tocan — cada una
    // guarda su moneda y sus líneas son un snapshot cerrado —, así que el
    // cambio solo afecta a las nóminas futuras; el modal avisa antes.
    // El salario llega ya en la moneda nueva: al cambiarla, el formulario lo
    // convierte con la tasa vigente y el dueño puede corregirlo antes de guardar.
    const { data: previo } = await db.from('empleados')
      .select('moneda')
      .eq('empleado_id', empleado_id).eq('client_id', session.client_id).maybeSingle()
    if (!previo) return { ok: false, error: 'Empleado no encontrado.' }

    if (moneda !== previo.moneda && !await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada en Monedas y Tasas.` }
    }

    const { error } = await db.from('empleados')
      .update({ ...campos, moneda })
      .eq('empleado_id', empleado_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

/**
 * Ajusta el saldo de vacaciones de APERTURA (mig. 167): lo que ese trabajador ya tenía
 * acumulado ANTES de usar CLAUX.
 *
 * Acción propia y NO un campo más del formulario, a propósito: `construirCamposEmpleado`
 * escribe todo lo que le llega, así que meter esto ahí haría que guardar el teléfono
 * pusiera el saldo a 0 en silencio. Hasta ahora la única vía era el importador, o sea
 * que un negocio de seis personas que teclea su plantilla no podía cargarlo — y la
 * ficha se lo enseñaba sin dejarle cambiarlo.
 *
 * Es el PUNTO DE PARTIDA de la derivación (`apertura + Σ nóminas confirmadas`), no el
 * saldo actual: ese sigue calculándose solo y no se guarda en ninguna parte.
 */
export async function guardarVacacionesApertura(
  empleado_id: string, importe: number, dias: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  if (isNaN(importe) || importe < 0) return { ok: false, error: 'El importe no puede ser negativo.' }
  if (isNaN(dias)    || dias    < 0) return { ok: false, error: 'Los días no pueden ser negativos.' }

  const db = createAdminClient()
  const { data: emp } = await db.from('empleados').select('empleado_id')
    .eq('empleado_id', empleado_id).eq('client_id', session.client_id).maybeSingle()
  if (!emp) return { ok: false, error: 'Trabajador no encontrado.' }

  const { error } = await db.from('empleados')
    .update({
      vacaciones_apertura:      redondear2(importe),
      vacaciones_apertura_dias: redondear2(dias),
      updated_at: new Date().toISOString(),
    })
    .eq('empleado_id', empleado_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${empleado_id}`)
  return { ok: true }
}

// ── Dar de baja / reactivar ──────────────────────────────────────────────────────

export async function darBajaEmpleado(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empleado_id = (formData.get('empleado_id') as string)?.trim()
  const fecha_baja  = (formData.get('fecha_baja')  as string)?.trim() || hoy()
  const motivo_baja = (formData.get('motivo_baja') as string)?.trim() || null
  if (!empleado_id) return { ok: false, error: 'Empleado no válido.' }

  const db = createAdminClient()
  const { error } = await db.from('empleados')
    .update({ fecha_baja, motivo_baja, updated_at: new Date().toISOString() })
    .eq('empleado_id', empleado_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

export async function reactivarEmpleado(empleado_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  // Reincorporar ocupa plaza igual que contratar. Si no, dar de baja a media
  // plantilla en enero para contratar en febrero y readmitirla en marzo salta el
  // límite sin que nadie lo note.
  const tope = await comprobarLimite(db, session.client_id, 'trabajadores', 1, 'desarchivar')
  if (tope) return { ok: false, error: tope }

  const { error } = await db.from('empleados')
    .update({ fecha_baja: null, motivo_baja: null, updated_at: new Date().toISOString() })
    .eq('empleado_id', empleado_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Eliminar empleado ─────────────────────────────────────────────────────────────
// Bloqueado si aparece en nóminas registradas (conserva el historial → dar de baja).

export async function eliminarEmpleado(empleado_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { count } = await db.from('nomina_lineas')
    .select('linea_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .eq('empleado_id', empleado_id)
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'Aparece en nóminas registradas. Da de baja en su lugar para conservar el historial.' }
  }

  const { error } = await db.from('empleados').delete()
    .eq('empleado_id', empleado_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Personal en lote (Fase 2) ────────────────────────────────────────────────────
// Candado `rrhh` inline (audit-gating). Baja/reactivar son UPDATE atómicos (no tienen
// guarda de negocio, solo el gating); eliminar reutiliza la individual en bucle para
// conservar su guarda (no borra a quien aparece en nóminas → omitido con su motivo).

export async function darBajaEmpleadosEnLote(
  ids: string[], fecha: string, motivo: string,
): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const { data, error } = await createAdminClient().from('empleados')
    .update({ fecha_baja: fecha || hoy(), motivo_baja: motivo?.trim() || null, updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id).in('empleado_id', ids).is('fecha_baja', null)
    .select('empleado_id')
  if (error) return loteVacio(error.message)
  revalidatePath('/portal/rrhh')
  return { ...loteVacio(), hechas: (data ?? []).length }
}

export async function reactivarEmpleadosEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()

  // El lote se comprueba ENTERO antes de tocar nada. Reincorporar a la mitad de
  // los seleccionados y callar cuáles sería peor que no hacerlo: aquí el dueño
  // eligió personas concretas, no un montón intercambiable.
  const { count: aReactivar } = await db.from('empleados')
    .select('empleado_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id).in('empleado_id', ids).not('fecha_baja', 'is', null)
  if (aReactivar) {
    const tope = await comprobarLimite(db, session.client_id, 'trabajadores', aReactivar, 'desarchivar')
    if (tope) return loteVacio(tope)
  }

  const { data, error } = await db.from('empleados')
    .update({ fecha_baja: null, motivo_baja: null, updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id).in('empleado_id', ids).not('fecha_baja', 'is', null)
    .select('empleado_id')
  if (error) return loteVacio(error.message)
  revalidatePath('/portal/rrhh')
  return { ...loteVacio(), hechas: (data ?? []).length }
}

export async function eliminarEmpleadosEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()
  const { data: emps } = await db.from('empleados')
    .select('empleado_id, nombre, apellidos').eq('client_id', session.client_id).in('empleado_id', ids)
  const nombreDe = new Map((emps ?? []).map((e: { empleado_id: string; nombre: string; apellidos: string | null }) =>
    [e.empleado_id, `${e.nombre}${e.apellidos ? ' ' + e.apellidos : ''}`]))

  const res = loteVacio()
  for (const id of ids) {
    if (!nombreDe.has(id)) continue
    const r = await eliminarEmpleado(id)   // conserva la guarda de nóminas
    if (r.ok) res.hechas++
    else res.omitidas.push({ etiqueta: nombreDe.get(id) ?? id, motivo: r.error ?? 'No se pudo eliminar' })
  }
  revalidatePath('/portal/rrhh')
  return res
}

// ════════════════════════════════════════════════════════════════════════════════
// CONTRATOS (historial)
// ════════════════════════════════════════════════════════════════════════════════

// ── Guardar contrato (documento del empleado, PDF opcional) ─────────────────────
// Los contratos son documentos externos: NO cierran a otros ni tocan el salario
// del empleado (la nómina usa empleados.salario_base). Pueden coexistir varios.

const PDF_MAX = 10 * 1024 * 1024

// Sube el PDF de un contrato al bucket (como Blob — el Buffer se corrompe en el
// serverless de Vercel, ver memoria storage-upload-blob-no-buffer) y devuelve
// { url, nombre } o un error de validación.
async function subirContratoPdf(
  db: ReturnType<typeof createAdminClient>,
  file: File,
  path: string,
): Promise<{ url: string; nombre: string } | { error: string }> {
  if (file.type !== 'application/pdf') return { error: 'El contrato debe ser un archivo PDF.' }
  if (file.size > PDF_MAX)             return { error: 'El PDF no puede superar los 10 MB.' }
  const buffer = Buffer.from(await file.arrayBuffer())
  const blob   = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' })
  const { error: upErr } = await db.storage.from('contratos')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true })
  if (upErr) return { error: upErr.message }
  return { url: db.storage.from('contratos').getPublicUrl(path).data.publicUrl, nombre: file.name }
}

export async function guardarContrato(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empleado_id  = (formData.get('empleado_id')  as string)?.trim()
  const tipo_raw     = (formData.get('tipo_contrato') as string)?.trim() as TipoContrato
  const fecha_inicio = (formData.get('fecha_inicio') as string)?.trim() || hoy()
  const fecha_fin    = (formData.get('fecha_fin')    as string)?.trim() || null
  const periodi_raw  = (formData.get('periodicidad') as string)?.trim() as Periodicidad
  const salarioRaw   = parseFloat(formData.get('salario_base') as string)
  const notas        = (formData.get('notas')        as string)?.trim() || null
  const file         = formData.get('pdf') as File | null

  if (!empleado_id) return { ok: false, error: 'Empleado no válido.' }

  const tipo_contrato = TIPOS_CONTRATO.includes(tipo_raw)    ? tipo_raw    : 'INDEFINIDO'
  const periodicidad  = PERIODICIDADES.includes(periodi_raw) ? periodi_raw : 'MENSUAL'
  const salario_base  = isNaN(salarioRaw) || salarioRaw < 0 ? 0 : redondear2(salarioRaw)

  const db = createAdminClient()

  const { data: empleado } = await db.from('empleados')
    .select('moneda')
    .eq('empleado_id', empleado_id)
    .eq('client_id', session.client_id)
    .single()
  if (!empleado) return { ok: false, error: 'Empleado no encontrado.' }

  const contrato_id = generarContratoId()

  // PDF adjunto (opcional)
  let pdf_url:    string | null = null
  let pdf_nombre: string | null = null
  if (file && file.size > 0) {
    const sub = await subirContratoPdf(db, file, `${session.client_id}/${empleado_id}/${contrato_id}.pdf`)
    if ('error' in sub) return { ok: false, error: sub.error }
    pdf_url = sub.url; pdf_nombre = sub.nombre
  }

  const { error } = await db.from('contratos').insert({
    contrato_id,
    client_id:   session.client_id,
    empleado_id,
    tipo_contrato,
    fecha_inicio,
    fecha_fin,
    salario_base,
    moneda:      empleado.moneda,
    periodicidad,
    notas,
    pdf_url,
    pdf_nombre,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${empleado_id}`)
  return { ok: true }
}

// ── Actualizar contrato (editar campos y/o adjuntar/reemplazar el PDF) ───────────
export async function actualizarContrato(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const contrato_id  = (formData.get('contrato_id')  as string)?.trim()
  const tipo_raw     = (formData.get('tipo_contrato') as string)?.trim() as TipoContrato
  const fecha_inicio = (formData.get('fecha_inicio') as string)?.trim() || hoy()
  const fecha_fin    = (formData.get('fecha_fin')    as string)?.trim() || null
  const periodi_raw  = (formData.get('periodicidad') as string)?.trim() as Periodicidad
  const notas        = (formData.get('notas')        as string)?.trim() || null
  const file         = formData.get('pdf') as File | null

  if (!contrato_id) return { ok: false, error: 'Contrato no válido.' }

  const tipo_contrato = TIPOS_CONTRATO.includes(tipo_raw)    ? tipo_raw    : 'INDEFINIDO'
  const periodicidad  = PERIODICIDADES.includes(periodi_raw) ? periodi_raw : 'MENSUAL'

  const db = createAdminClient()

  const { data: contrato } = await db.from('contratos')
    .select('empleado_id, pdf_url, pdf_nombre')
    .eq('contrato_id', contrato_id)
    .eq('client_id', session.client_id)
    .single()
  if (!contrato) return { ok: false, error: 'Contrato no encontrado.' }

  // PDF: si adjunta uno nuevo, reemplaza (mismo path, upsert); si no, conserva el actual.
  let pdf_url:    string | null = contrato.pdf_url as string | null
  let pdf_nombre: string | null = contrato.pdf_nombre as string | null
  if (file && file.size > 0) {
    const sub = await subirContratoPdf(db, file, `${session.client_id}/${contrato.empleado_id}/${contrato_id}.pdf`)
    if ('error' in sub) return { ok: false, error: sub.error }
    pdf_url = sub.url; pdf_nombre = sub.nombre
  }

  const { error } = await db.from('contratos')
    .update({ tipo_contrato, fecha_inicio, fecha_fin, periodicidad, notas, pdf_url, pdf_nombre })
    .eq('contrato_id', contrato_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${contrato.empleado_id}`)
  return { ok: true }
}

// ── Eliminar contrato ────────────────────────────────────────────────────────────

export async function eliminarContrato(contrato_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { data: contrato } = await db.from('contratos')
    .select('empleado_id')
    .eq('contrato_id', contrato_id)
    .eq('client_id', session.client_id)
    .single()
  if (!contrato) return { ok: false, error: 'Contrato no encontrado.' }

  // Borra el PDF adjunto si existe (best-effort)
  await db.storage.from('contratos')
    .remove([`${session.client_id}/${contrato.empleado_id}/${contrato_id}.pdf`])

  const { error } = await db.from('contratos').delete()
    .eq('contrato_id', contrato_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${contrato.empleado_id}`)
  return { ok: true }
}

// ── Detalle de un empleado (datos + sus contratos) ──────────────────────────────

export interface EmpleadoDetalleData {
  data:      PersonalPageData
  empleado:  EmpleadoConEstado
  /** SUS nóminas, no las del negocio: la ficha solo pinta la línea de esta persona.
   *  Antes salían de `RrhhPageData.nominas`, o sea de traer la historia completa para
   *  quedarse con una fila de cada una. */
  nominas:   NominaConLineas[]
  contratos: Contrato[]
  conceptos: ConceptoEmpleado[]
  /** Incidencias cargadas, de más reciente a más antigua (mig. 143). */
  incidencias: (IncidenciaMes & { incidencia_id: string; periodo: string })[]
  /**
   * Saldo de vacaciones, DERIVADO de las nóminas confirmadas — no se guarda en
   * ninguna parte. Un total mutable en la ficha se rompía al reabrir o borrar una
   * nómina: nada lo decrementaba y al reconfirmar se acumulaba dos veces.
   */
  vacaciones: {
    importe: number
    /** Saldo derivado también EN DÍAS (mig. 194/195): el derecho legal real, en paralelo
     *  al importe. */
    dias:    number
    moneda:  string
    /**
     * Lo que ya traía acumulado al empezar a usar CLAUX (mig. 167). Se enseña aparte
     * cuando no es cero: si no, un saldo que arranca en 1.363,50 sin ninguna nómina
     * detrás parece un error del sistema.
     */
    apertura:      number
    /** La apertura también en días (mig. 195). */
    apertura_dias: number
  }
}

export async function obtenerEmpleadoDetalle(empleado_id: string): Promise<EmpleadoDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const [{ base, fichaCuba, idsFiltro }, configNomina] = await Promise.all([
    cargarBase(db, session.client_id),
    leerConfigNomina(db, session.client_id),
  ])
  const empleado = base.empleados.find(e => e.empleado_id === empleado_id)
  if (!empleado) return null
  const data: PersonalPageData = { ...base, config_nomina: Array.from(configNomina.values()) }

  // Las nóminas donde ESTA persona tiene línea. Se resuelven en dos pasos —sus líneas
  // primero, sus nóminas después— en vez de traerlas todas y filtrar: con dos años de
  // histórico, «todas» son cientos de filas para pintar una tabla de doce.
  const { data: misLineas } = await db.from('nomina_lineas')
    .select('nomina_id')
    .eq('client_id', session.client_id)
    .eq('empleado_id', empleado_id)
  const misNominaIds = Array.from(new Set((misLineas ?? []).map(l => l.nomina_id as string)))
  const { data: misNominas } = misNominaIds.length
    ? await db.from('nominas').select('*')
        .eq('client_id', session.client_id)
        .in('empresa_id', idsFiltro)
        .in('nomina_id', misNominaIds)
        .order('periodo', { ascending: false })
    : { data: [] }
  const nominas = await construirNominas(
    db, session.client_id, (misNominas ?? []) as Nomina[], fichaCuba, empleado_id)

  const [consRes, cptRes] = await Promise.all([
    db.from('contratos').select('*')
      .eq('client_id', session.client_id)
      .eq('empleado_id', empleado_id)
      .order('fecha_inicio', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('conceptos_empleado').select('*')
      .eq('client_id', session.client_id)
      .eq('empleado_id', empleado_id)
      .order('created_at', { ascending: true }),
  ])
  const contratos = ((consRes.data ?? []) as Contrato[]).map(c => ({ ...c, salario_base: Number(c.salario_base) }))
  const conceptos = ((cptRes.data ?? []) as ConceptoEmpleado[]).map(c => ({ ...c, valor: Number(c.valor) }))

  const { data: incData } = await db.from('incidencias_nomina')
    .select(SELECT_INCIDENCIAS)
    .eq('client_id', session.client_id)
    .eq('empleado_id', empleado_id)
    .order('periodo', { ascending: false })
  const incidencias = ((incData ?? []) as (IncidenciaMes & { incidencia_id: string; periodo: string })[])
    .map(i => ({
      ...i,
      dias_trabajados:  i.dias_trabajados === null ? null : Number(i.dias_trabajados),
      dias_vacaciones:  Number(i.dias_vacaciones),
      dias_liquidacion: Number(i.dias_liquidacion),
      vacaciones_importe_manual: i.vacaciones_importe_manual == null ? null : Number(i.vacaciones_importe_manual),
      pago_extra:       Number(i.pago_extra),
      pago_nocturnidad: Number(i.pago_nocturnidad),
      feriados:         Number(i.feriados),
      penalizacion:     Number(i.penalizacion),
      otros_descuentos: Number(i.otros_descuentos),
      pago_subsidios:   Number(i.pago_subsidios),
    }))

  // Saldo de vacaciones DERIVADO: lo acumulado menos lo pagado, sobre las nóminas
  // CONFIRMADAS. Se autocorrige ante cualquier reversión —reabrir o borrar una
  // nómina lo recalcula solo—, que es justo lo que un total guardado no hacía.
  // Misma derivación que usa el aviso de tope en `guardarIncidencia`. Se lleva EN
  // PARALELO en importe y en días: son dos cadenas con la misma mecánica (mig. 194/195).
  const [acumuladas, acumuladasDias] = await Promise.all([
    saldoVacacionesAcumulado(db, session.client_id, empleado_id),
    saldoVacacionesDiasAcumulado(db, session.client_id, empleado_id),
  ])

  // El desfase de cada línea ya viene marcado desde `construirNominas`
  // (`NominaLinea.desfasada`): la vista filtra por ahí, sin consultas extra.
  return {
    data, empleado, nominas, contratos, conceptos, incidencias,
    vacaciones: {
      importe:  redondear2(acumuladas),
      dias:     redondear2(acumuladasDias),
      moneda:   empleado.moneda,
      apertura:      redondear2(Number((empleado as { vacaciones_apertura?: number | null }).vacaciones_apertura ?? 0)),
      apertura_dias: redondear2(Number((empleado as { vacaciones_apertura_dias?: number | null }).vacaciones_apertura_dias ?? 0)),
    },
  }
}

// ── Recibo de nómina de un trabajador ───────────────────────────────────────────
//
// Devuelve solo DATOS: el PDF lo dibuja `lib/pdf/recibo-nomina.ts` en el navegador,
// igual que la factura, la oferta y el dossier. Generarlo en servidor sería una
// segunda tecnología de PDF para un único documento, y obligaría a navegar para
// descargarlo —justo lo que la conexión de Cuba no perdona—.
//
// Es una LECTURA: no lleva `puedeEditarModulo`. El candado del módulo lo pone la
// página (`requireModulo('rrhh')`), y quien tiene solo-lectura debe poder imprimir
// el recibo de su plantilla.
//
// Los datos fiscales de la empresa (NIT, dirección, logo) NO viajan en
// `RrhhPageData.empresas` a propósito: se piden aquí, al pulsar, en vez de cargarlos
// en cada visita a la página de Personal.

export interface ReciboNominaData {
  periodo:         string
  moneda:          string
  esBorrador:      boolean
  esCuba:          boolean
  empresa: {
    nombre: string; nombre_fiscal: string | null; rif_nit: string | null
    direccion: string | null; ciudad: string | null; pais: string | null
    telefono: string | null; email: string | null
    logo_url: string | null; mostrar_logo: boolean | null
    letra_facturacion: string | null; color: string
  }
  trabajador: {
    nombre: string; documento: string | null; cargo: string | null
    departamento: string | null; email: string | null; fecha_alta: string | null
  }
  dias_laborables: number
  dias_trabajados: number | null
  dias_vacaciones: number
  salario_base:    number
  devengos:        { nombre: string; monto: number }[]
  retenciones:     { nombre: string; monto: number }[]
  aportes:         { nombre: string; monto: number }[]
  devengado:       number
  deducciones:     number
  subsidios:       number
  neto:            number
  vacaciones_acumuladas: number
  vacaciones_pagadas:    number
}

/**
 * Los recibos de TODA la nómina, en una llamada.
 *
 * Hasta ahora el recibo solo se descargaba desde la ficha de cada trabajador: para una
 * plantilla de 39 personas eran 39 navegaciones y 39 descargas. Aquí los datos comunes
 * —la empresa, su logo, la configuración del modelo, las incidencias del mes— se piden
 * **una vez** para las N, que es exactamente lo contrario de lo que conviene cuando se
 * pide uno solo (por eso `obtenerReciboNomina` sigue existiendo tal cual: cargar el logo
 * en cada visita a Personal era lo que se quería evitar).
 *
 * LECTURA: sin `puedeEditarModulo`, como su hermana. El candado lo pone la página.
 */
export async function obtenerRecibosNomina(
  nomina_id: string,
): Promise<{ ok: true; recibos: { empleado_id: string; nombre: string; recibo: ReciboNominaData }[] }
         | { ok: false; error: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  const db = createAdminClient()
  const { data: lineas } = await db.from('nomina_lineas')
    .select('empleado_id, empleado_nombre')
    .eq('nomina_id', nomina_id).eq('client_id', session.client_id)
    .order('empleado_nombre')
  if (!lineas?.length) return { ok: false, error: 'Esa nómina no tiene líneas.' }

  // En serie y reusando la acción individual: es la MISMA función que ya está
  // verificada, y duplicar su lógica para ahorrar consultas es cómo el recibo de uno y
  // el de todos acabarían diciendo cifras distintas.
  const recibos: { empleado_id: string; nombre: string; recibo: ReciboNominaData }[] = []
  for (const l of lineas as { empleado_id: string; empleado_nombre: string }[]) {
    const r = await obtenerReciboNomina(nomina_id, l.empleado_id)
    if (r.ok) recibos.push({ empleado_id: l.empleado_id, nombre: l.empleado_nombre, recibo: r.recibo })
  }
  if (!recibos.length) return { ok: false, error: 'No se pudo generar ningún recibo.' }
  return { ok: true, recibos }
}

export async function obtenerReciboNomina(
  nomina_id: string, empleado_id: string,
): Promise<{ ok: true; recibo: ReciboNominaData } | { ok: false; error: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  const db = createAdminClient()

  const { data: nomina } = await db.from('nominas')
    .select('nomina_id, empresa_id, periodo, moneda, estado')
    .eq('nomina_id', nomina_id).eq('client_id', session.client_id).maybeSingle()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }

  // La empresa se resuelve contra las ACCESIBLES para este usuario, no contra la
  // tabla: sin esto, un usuario con una sola empresa asignada podría imprimir el
  // recibo de la nómina de otra con solo su id.
  const empresas = await obtenerEmpresas()
  const empresa  = empresas.find(e => e.empresa_id === nomina.empresa_id)
  if (!empresa) return { ok: false, error: 'No tienes acceso a esta empresa.' }

  const [{ data: linea }, { data: empleado }, configs] = await Promise.all([
    db.from('nomina_lineas')
      .select('linea_id, salario_base, devengado, deducciones, neto, subsidios, vacaciones_acumuladas_periodo, vacaciones_pagadas_periodo')
      .eq('nomina_id', nomina_id).eq('empleado_id', empleado_id)
      .eq('client_id', session.client_id).maybeSingle(),
    db.from('empleados')
      .select('nombre, apellidos, documento, cargo, departamento, email, fecha_alta, dias_laborables')
      .eq('empleado_id', empleado_id).eq('client_id', session.client_id).maybeSingle(),
    leerConfigNomina(db, session.client_id),
  ])
  if (!linea)    return { ok: false, error: 'Este trabajador no está en esa nómina.' }
  if (!empleado) return { ok: false, error: 'Trabajador no encontrado.' }

  const l = linea as {
    linea_id: string; salario_base: number; devengado: number; deducciones: number
    neto: number; subsidios: number | null
    vacaciones_acumuladas_periodo: number | null; vacaciones_pagadas_periodo: number | null
  }
  const e = empleado as {
    nombre: string; apellidos: string | null; documento: string | null
    cargo: string | null; departamento: string | null; email: string | null
    fecha_alta: string | null; dias_laborables: number | null
  }

  const { data: items } = await db.from('nomina_linea_conceptos')
    .select('nombre, tipo, monto')
    .eq('linea_id', l.linea_id).eq('client_id', session.client_id)
    .order('created_at')

  // Solo lo que tiene valor (la regla del recibo). El nombre va COMPLETO: las siglas
  // son de la tabla en pantalla, no de un documento que lee el trabajador.
  const conValor = ((items ?? []) as { nombre: string; tipo: TipoItemLinea; monto: number }[])
    .filter(i => Math.abs(Number(i.monto)) > EPS)
  const de = (tipo: TipoItemLinea) => conValor
    .filter(i => i.tipo === tipo)
    .map(i => ({ nombre: i.nombre, monto: Number(i.monto) }))

  const config = configDe(configs, nomina.empresa_id)
  const inc    = (await leerIncidencias(db, session.client_id, nomina.periodo)).get(empleado_id)

  return {
    ok: true,
    recibo: {
      periodo:    nomina.periodo,
      moneda:     nomina.moneda,
      esBorrador: nomina.estado === 'BORRADOR',
      esCuba:     config.modelo === 'MIPYME_CUBA' && nomina.moneda === MONEDA_CUBA,
      empresa: {
        nombre:            empresa.nombre,
        nombre_fiscal:     empresa.nombre_fiscal,
        rif_nit:           empresa.rif_nit,
        direccion:         empresa.direccion,
        ciudad:            empresa.ciudad,
        pais:              empresa.pais,
        telefono:          empresa.telefono,
        email:             empresa.email,
        logo_url:          empresa.logo_url,
        mostrar_logo:      empresa.mostrar_logo,
        letra_facturacion: empresa.letra_facturacion,
        color:             empresa.color,
      },
      trabajador: {
        nombre:       [e.nombre, e.apellidos].filter(Boolean).join(' '),
        documento:    e.documento,
        cargo:        e.cargo,
        departamento: e.departamento,
        email:        e.email,
        fecha_alta:   e.fecha_alta,
      },
      dias_laborables: Number(e.dias_laborables ?? config.dias_laborables_default),
      dias_trabajados: inc?.dias_trabajados ?? null,
      dias_vacaciones: inc?.dias_vacaciones ?? 0,
      salario_base:    Number(l.salario_base),
      devengos:        de('DEVENGO'),
      retenciones:     de('RETENCION'),
      aportes:         de('APORTE_EMPRESA'),
      devengado:       Number(l.devengado),
      deducciones:     Number(l.deducciones),
      subsidios:       Number(l.subsidios ?? 0),
      neto:            Number(l.neto),
      vacaciones_acumuladas: Number(l.vacaciones_acumuladas_periodo ?? 0),
      vacaciones_pagadas:    Number(l.vacaciones_pagadas_periodo ?? 0),
    },
  }
}

// ── Conceptos recurrentes del empleado (bonos/deducciones fijos) ─────────────────

/**
 * Alta Y edición (mig. 141). Hasta ahora esta acción solo hacía `insert`, así que
 * «cambiar el importe» era borrarlo y crear otro — con 39 trabajadores, 39 borrados
 * y 39 altas. Editar es seguro porque cada nómina generada guarda su propia foto
 * congelada: cambiar el concepto mira hacia adelante, nunca reescribe el pasado.
 */
export async function guardarConceptoEmpleado(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const concepto_id = (formData.get('concepto_id') as string)?.trim() || null
  const empleado_id = (formData.get('empleado_id') as string)?.trim()
  const nombre      = (formData.get('nombre')      as string)?.trim()
  const tipo        = (formData.get('tipo')        as string)?.trim() as TipoConcepto
  const modo        = (formData.get('modo')        as string)?.trim() as ModoConcepto
  const base        = ((formData.get('base')       as string)?.trim() || 'SALARIO_BASE') as BaseCalculo
  const recurrencia = ((formData.get('recurrencia') as string)?.trim() || 'RECURRENTE') as Recurrencia
  const periodo     = (formData.get('periodo_aplicable') as string)?.trim() || null
  const valorRaw    = parseFloat(formData.get('valor') as string)

  if (!empleado_id)                              return { ok: false, error: 'Empleado no válido.' }
  if (!nombre)                                   return { ok: false, error: 'El nombre del concepto es obligatorio.' }
  if (tipo !== 'DEVENGO' && tipo !== 'RETENCION')  return { ok: false, error: 'Tipo no válido.' }
  if (modo !== 'FIJO' && modo !== 'PORCENTAJE')    return { ok: false, error: 'Modo no válido.' }
  if (base !== 'SALARIO_BASE' && base !== 'DEVENGADO') return { ok: false, error: 'Base de cálculo no válida.' }
  if (isNaN(valorRaw) || valorRaw <= 0)          return { ok: false, error: 'El valor debe ser positivo.' }
  // Un «10 %» tecleado como «1000» retenía el salario entero, se recortaba y el neto
  // quedaba a cero sin que nada lo avisara. Ahora se rechaza al escribirlo.
  if (modo === 'PORCENTAJE' && valorRaw > 100)   return { ok: false, error: 'Un porcentaje no puede pasar del 100 %.' }
  if (recurrencia !== 'RECURRENTE' && recurrencia !== 'PUNTUAL') return { ok: false, error: 'Recurrencia no válida.' }
  if (recurrencia === 'PUNTUAL' && !/^\d{4}-\d{2}$/.test(periodo ?? '')) {
    return { ok: false, error: 'Un concepto puntual necesita el mes al que se aplica.' }
  }

  const db = createAdminClient()
  const { data: emp } = await db.from('empleados').select('empleado_id')
    .eq('empleado_id', empleado_id).eq('client_id', session.client_id).single()
  if (!emp) return { ok: false, error: 'Empleado no encontrado.' }

  const campos = {
    nombre,
    tipo,
    modo,
    valor:             valorRaw,
    base,
    recurrencia,
    periodo_aplicable: recurrencia === 'PUNTUAL' ? periodo : null,
    destino:           tipo === 'RETENCION' ? 'TERCERO_FISCAL' : null,
    updated_at:        new Date().toISOString(),
  }

  const { error } = concepto_id
    ? await db.from('conceptos_empleado').update(campos)
        .eq('concepto_id', concepto_id).eq('client_id', session.client_id)
    : await db.from('conceptos_empleado').insert({
        concepto_id: generarConceptoId(),
        client_id:   session.client_id,
        empleado_id,
        activo:      true,
        ...campos,
      })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${empleado_id}`)
  revalidarNomina()
  return { ok: true }
}

/**
 * Activa o desactiva un concepto. La columna `activo` existía desde la mig. 034 y
 * **nunca se ponía a `false`**: no había ni UI ni acción que lo hiciera, así que
 * dejar de aplicar algo obligaba a borrarlo y perder el rastro de que existió.
 */
export async function alternarConceptoEmpleado(
  concepto_id: string, activo: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: cpt } = await db.from('conceptos_empleado').select('empleado_id')
    .eq('concepto_id', concepto_id).eq('client_id', session.client_id).maybeSingle()
  if (!cpt) return { ok: false, error: 'Concepto no encontrado.' }

  const { error } = await db.from('conceptos_empleado')
    .update({ activo, updated_at: new Date().toISOString() })
    .eq('concepto_id', concepto_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${cpt.empleado_id}`)
  revalidarNomina()
  return { ok: true }
}

export async function eliminarConceptoEmpleado(concepto_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: cpt } = await db.from('conceptos_empleado').select('empleado_id')
    .eq('concepto_id', concepto_id).eq('client_id', session.client_id).single()
  if (!cpt) return { ok: false, error: 'Concepto no encontrado.' }

  const { error } = await db.from('conceptos_empleado').delete()
    .eq('concepto_id', concepto_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${cpt.empleado_id}`)
  return { ok: true }
}

// ── Exportar una nómina a Excel ─────────────────────────────────────────────────
// Se genera en SERVIDOR (el escritor de .xlsx es server-only) y baja como Blob
// desde el cliente: un clic → archivo, sin abrir pestaña ni recargar.

export async function exportarNominaXlsx(
  nomina_id: string,
): Promise<{ ok: boolean; error?: string; base64?: string; nombre?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  // Solo LEE: el candado de módulo de la página basta y no hace falta permiso de
  // escritura para llevarse un informe de lo que ya se ve en pantalla.

  const db = createAdminClient()
  const { data: nomina } = await db.from('nominas')
    .select('nomina_id, empresa_id, periodo, moneda, estado')
    .eq('nomina_id', nomina_id).eq('client_id', session.client_id).maybeSingle()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }

  const empresas = await obtenerEmpresas()
  const empresa  = empresas.find(e => e.empresa_id === nomina.empresa_id)
  if (!empresa) return { ok: false, error: 'Empresa no válida.' }

  const [{ data: lineas }, { data: items }, configs, incidencias] = await Promise.all([
    db.from('nomina_lineas')
      .select('linea_id, empleado_id, empleado_nombre, cargo, salario_base, devengado, deducciones, neto, vacaciones_acumuladas_periodo, vacaciones_pagadas_periodo, subsidios')
      .eq('nomina_id', nomina_id).eq('client_id', session.client_id)
      .order('empleado_nombre'),
    db.from('nomina_linea_conceptos')
      .select('linea_id, nombre, tipo, monto, origen, concepto_clave')
      .eq('nomina_id', nomina_id).eq('client_id', session.client_id),
    leerConfigNomina(db, session.client_id),
    leerIncidencias(db, session.client_id, nomina.periodo),
  ])

  const filas = (lineas ?? []) as Record<string, unknown>[]
  const { data: fichas } = await db.from('empleados')
    .select('empleado_id, documento, dias_laborables')
    .eq('client_id', session.client_id)
    .in('empleado_id', Array.from(new Set(filas.map(f => f.empleado_id as string))))
  const fichaDe = new Map(((fichas ?? []) as
    { empleado_id: string; documento: string | null; dias_laborables: number | null }[])
    .map(f => [f.empleado_id, f]))

  // El importe de cada tributo se reconstruye desde los ítems `LEY` por su CLAVE
  // (mig. 165): es lo que quedó congelado en la línea, no un recálculo. Antes se
  // buscaba por nombre, así que una tilde de más dejaba la columna fiscal en blanco.
  const porLinea = new Map<string, Partial<Record<ConceptoFiscal, number>>>()
  for (const it of (items ?? []) as {
    linea_id: string; nombre: string; origen: string; monto: number
    concepto_clave: ConceptoClave | null
  }[]) {
    if (it.origen !== 'LEY') continue
    const clave = it.concepto_clave ?? claveDeNombre(it.nombre)
    // Solo los tributos tienen columna propia en la hoja; el prorrateo y las
    // vacaciones pagadas ya están dentro del devengado.
    if (!esConceptoFiscal(clave)) continue
    const m = porLinea.get(it.linea_id) ?? {}
    m[clave] = redondear2((m[clave] ?? 0) + Number(it.monto))
    porLinea.set(it.linea_id, m)
  }

  const config = configDe(configs, nomina.empresa_id)
  const esCuba = config.modelo === 'MIPYME_CUBA' && nomina.moneda === MONEDA_CUBA
  // Sin incidencia, los días trabajados son los laborables del trabajador: se
  // exporta ese número y no un «Completo», que en una hoja de cálculo no suma.
  const diasDe = (empleado_id: string) =>
    Number(fichaDe.get(empleado_id)?.dias_laborables ?? config.dias_laborables_default)

  const { nominaAXlsx } = await import('@/lib/rrhh/nomina-xlsx')
  const { base64, nombre } = await nominaAXlsx({
    periodo: nomina.periodo,
    moneda:  nomina.moneda,
    empresa: empresa.nombre,
    estado:  nomina.estado,
    esCuba,
    lineas: filas.map(f => ({
      empleado_nombre: f.empleado_nombre as string,
      documento:       fichaDe.get(f.empleado_id as string)?.documento ?? null,
      cargo:           (f.cargo as string) ?? null,
      salario_base:    Number(f.salario_base),
      devengado:       Number(f.devengado),
      deducciones:     Number(f.deducciones),
      neto:            Number(f.neto),
      vacaciones_acumuladas_periodo: Number(f.vacaciones_acumuladas_periodo ?? 0),
      vacaciones_pagadas_periodo:    Number(f.vacaciones_pagadas_periodo ?? 0),
      subsidios:       Number(f.subsidios ?? 0),
      dias_trabajados:  incidencias.get(f.empleado_id as string)?.dias_trabajados
                          ?? diasDe(f.empleado_id as string),
      dias_vacaciones:  incidencias.get(f.empleado_id as string)?.dias_vacaciones ?? 0,
      pago_extra:       incidencias.get(f.empleado_id as string)?.pago_extra ?? 0,
      pago_nocturnidad: incidencias.get(f.empleado_id as string)?.pago_nocturnidad ?? 0,
      feriados:         incidencias.get(f.empleado_id as string)?.feriados ?? 0,
      penalizacion:     incidencias.get(f.empleado_id as string)?.penalizacion ?? 0,
      otros_descuentos: incidencias.get(f.empleado_id as string)?.otros_descuentos ?? 0,
      porConcepto:     porLinea.get(f.linea_id as string) ?? {},
    })),
  })

  return { ok: true, base64, nombre }
}

// ── Incidencias del mes (mig. 143) ──────────────────────────────────────────────

export async function guardarIncidencia(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; aviso?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empleado_id = (formData.get('empleado_id') as string)?.trim()
  const periodo     = (formData.get('periodo')     as string)?.trim()
  if (!empleado_id)                             return { ok: false, error: 'Trabajador no válido.' }
  if (!/^\d{4}-\d{2}$/.test(periodo ?? ''))     return { ok: false, error: 'El mes debe tener formato AAAA-MM.' }

  const num = (k: string): number => {
    const v = parseFloat(formData.get(k) as string)
    return isNaN(v) || v < 0 ? 0 : redondear2(v)
  }
  const diasRaw = (formData.get('dias_trabajados') as string)?.trim()
  const dias_trabajados = diasRaw === '' || diasRaw == null ? null : parseFloat(diasRaw)
  if (dias_trabajados !== null && (isNaN(dias_trabajados) || dias_trabajados < 0 || dias_trabajados > 31)) {
    return { ok: false, error: 'Los días trabajados deben estar entre 0 y 31, o vacío para el mes completo.' }
  }
  const dias_vacaciones = num('dias_vacaciones')
  if (dias_vacaciones > 31) return { ok: false, error: 'Los días de vacaciones no pueden pasar de 31.' }
  // La liquidación por baja paga TODO el saldo acumulado, que puede ser de varios años:
  // no lleva el tope de 31 del disfrute mensual, solo un límite defensivo.
  const dias_liquidacion = num('dias_liquidacion')
  if (dias_liquidacion > 366) return { ok: false, error: 'Los días a liquidar no pueden pasar de 366.' }
  // Importe MANUAL del disfrute (mig. 202): OPCIONAL. Ausente o vacío = automático (null);
  // un valor MANDA sobre el cálculo del disfrute. Negativo o no numérico → sin corregir.
  const vimRaw = (formData.get('vacaciones_importe_manual') as string | null)?.trim()
  const vacaciones_importe_manual = vimRaw == null || vimRaw === ''
    ? null
    : (() => { const n = parseFloat(vimRaw); return isNaN(n) || n < 0 ? null : redondear2(n) })()

  const db = createAdminClient()
  const { data: emp } = await db.from('empleados')
    .select('empleado_id, empresa_id, salario_base, dias_laborables')
    .eq('empleado_id', empleado_id).eq('client_id', session.client_id).maybeSingle()
  if (!emp) return { ok: false, error: 'Trabajador no encontrado.' }

  // Upsert por (client, empleado, período): la incidencia es DATO DEL PERÍODO, así
  // que volver a guardarla es corregirla, no crear una segunda.
  const { error } = await db.from('incidencias_nomina').upsert({
    incidencia_id:    `INC-${corto()}`,
    client_id:        session.client_id,
    empleado_id,
    periodo,
    dias_trabajados,
    dias_vacaciones,
    dias_liquidacion,
    vacaciones_importe_manual,
    pago_extra:       num('pago_extra'),
    pago_nocturnidad: num('pago_nocturnidad'),
    feriados:         num('feriados'),
    penalizacion:     num('penalizacion'),
    otros_descuentos: num('otros_descuentos'),
    pago_subsidios:   num('pago_subsidios'),
    subsidio_maternidad: formData.get('subsidio_maternidad') === 'on',
    updated_at:       new Date().toISOString(),
  }, { onConflict: 'client_id,empleado_id,periodo' })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${empleado_id}`)
  revalidarNomina()

  // Avisos que NO bloquean —la incidencia ya se guardó—: solo aplican bajo el
  // modelo cubano, que es el único que prorratea por días y paga vacaciones
  // por incidencia (Claudia, 2026-07-28).
  const avisos: string[] = []
  const config = configDe(await leerConfigNomina(db, session.client_id), emp.empresa_id as string)
  if (config.modelo === 'MIPYME_CUBA') {
    const efectivo = Number(emp.dias_laborables ?? config.dias_laborables_default)
    if (dias_trabajados !== null && dias_trabajados > efectivo) {
      avisos.push(
        `Trabajó más días (${dias_trabajados}) que los laborables de su ficha (${efectivo}). ` +
        'Si es su jornada real, sube «Días laborables» en su ficha; si fue un turno extra ' +
        'puntual, mételo como «Pago extra» en vez de aquí.')
    }
    if (dias_vacaciones > 0 || dias_liquidacion > 0) {
      // El valor del día es el promedio del saldo (`importe ÷ días`), el mismo criterio
      // que aplica el motor; sin promedio válido —sin días de saldo o sin importe
      // acumulado— es 0: NO se inventa un valor contra el salario del período (mig. 202).
      const [saldoImporte, saldoDias] = await Promise.all([
        saldoVacacionesAcumulado(db, session.client_id, empleado_id),
        saldoVacacionesDiasAcumulado(db, session.client_id, empleado_id),
      ])
      const valorDia = saldoDias > 0 && saldoImporte > 0 ? saldoImporte / saldoDias : 0
      // El disfrute usa la corrección manual si está puesta; la liquidación por baja
      // siempre sale del saldo (mismo trato que el motor).
      const pagoDisfrute    = dias_vacaciones <= 0
        ? 0
        : (vacaciones_importe_manual != null
            ? vacaciones_importe_manual
            : redondear2(valorDia * dias_vacaciones))
      const pagoLiquidacion = redondear2(valorDia * dias_liquidacion)
      const pago            = redondear2(pagoDisfrute + pagoLiquidacion)
      const diasPagados     = dias_vacaciones + dias_liquidacion

      // Sin acumulado en importe y sin corregir a mano: el disfrute saldría 0. Se avisa
      // aquí para que el dueño marque «Corregir importe» en vez de descubrir el 0 al
      // generar la nómina.
      if (dias_vacaciones > 0 && vacaciones_importe_manual == null && valorDia <= 0) {
        avisos.push(
          'Este trabajador no tiene saldo de vacaciones acumulado en importe, así que el pago ' +
          'de los días de vacaciones saldría 0. Marca «Corregir importe de vacaciones» en la ' +
          'incidencia para fijar a mano cuánto pagarle.')
      }
      if (diasPagados > saldoDias + EPS) {
        avisos.push(
          `Se pagan ${diasPagados} días de vacaciones y el saldo acumulado es de ${saldoDias.toFixed(2)} ` +
          `(${saldoImporte.toFixed(2)}). El pago (${pago.toFixed(2)}) supera lo acumulado — se guarda igual, ` +
          'conviene revisarlo.')
      }
    }
  }

  return { ok: true, aviso: avisos.length ? avisos.join(' ') : undefined }
}

export async function eliminarIncidencia(incidencia_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: inc } = await db.from('incidencias_nomina').select('empleado_id')
    .eq('incidencia_id', incidencia_id).eq('client_id', session.client_id).maybeSingle()
  if (!inc) return { ok: false, error: 'Incidencia no encontrada.' }

  // Borrarla NO toca las nóminas ya generadas: su línea guarda congelado el
  // resultado. Solo cambia lo que se calculará de aquí en adelante.
  const { error } = await db.from('incidencias_nomina').delete()
    .eq('incidencia_id', incidencia_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${inc.empleado_id}`)
  revalidarNomina()
  return { ok: true }
}

// ── Página de detalle de una nómina (tabla) ─────────────────────────────────────

export interface NominaDetalleData {
  /** Lo compartido (empresas, monedas, plantilla) más la config del modelo. NO la
   *  historia de nómina: esta pantalla enseña UNA, y traerlas todas para encontrarla
   *  era lo que hacía que cada `onBlur` de una celda recargara el módulo entero. */
  data:        PersonalPageData
  nomina:      NominaConLineas
  /** Lo variable del mes de cada trabajador (mig. 143), por `empleado_id`: son
   *  los valores CRUDOS que rellenan las celdas editables — hoy nadie los
   *  exponía fuera de `crearNomina`/`planificarRecalculo`. */
  incidencias: Record<string, IncidenciaMes>
  /** Días laborables ya resueltos por trabajador (los suyos o los de la empresa).
   *  Es lo que vale un mes completo para él: la tabla enseña ese número en la
   *  celda de días trabajados en vez de un «Completo» que no dice cuántos son. */
  diasLaborables: Record<string, number>
  esCuba:      boolean
  /**
   * Qué días le tocaban a cada trabajador este mes, según su alta/baja o su semana tipo
   * (`lib/rrhh/dias-trabajados.ts`). Solo aparece quien tiene algo que sugerir y su
   * línea no lo refleja todavía: el aviso sale si hay desfase real, nunca «por si acaso».
   *
   * Es una PROPUESTA. El dueño la aplica con un botón o teclea otra cosa: es dinero de
   * una persona concreta y la rejilla es una semana tipo, no un registro de asistencia.
   */
  sugerenciaDias: Record<string, SugerenciaDias>
  /**
   * Días de vacaciones a LIQUIDAR que se le proponen a quien causa baja ESTE mes y aún
   * tiene saldo pendiente (solo modelo cubano). Es el saldo derivado en días —excluida
   * esta misma nómina para no morderse la cola— y el aviso de la hoja lo ofrece con un
   * botón que rellena `dias_liquidacion`. Como los días sugeridos: es una propuesta, el
   * dueño la acepta o teclea otra cosa. Solo aparece si el saldo es positivo y la línea
   * no lo liquida todavía.
   */
  sugerenciaLiquidacion: Record<string, { dias: number; importe: number }>
}

export async function obtenerNominaDetalle(nomina_id: string): Promise<NominaDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const [{ base, fichaCuba, idsFiltro }, configs] = await Promise.all([
    cargarBase(db, session.client_id),
    leerConfigNomina(db, session.client_id),
  ])

  // La nómina se pide POR SU ID, no se busca dentro de todas.
  const { data: cabecera } = await db.from('nominas').select('*')
    .eq('client_id', session.client_id)
    .in('empresa_id', idsFiltro)
    .eq('nomina_id', nomina_id)
    .maybeSingle()
  if (!cabecera) return null

  const [nomina] = await construirNominas(db, session.client_id, [cabecera as Nomina], fichaCuba)
  if (!nomina) return null

  const data: PersonalPageData = { ...base, config_nomina: Array.from(configs.values()) }

  const empIds = nomina.lineas.map(l => l.empleado_id)
  const [incidenciasMap, { data: fichas }, { data: miembros }, { data: patronesRaw }, { data: slotsRaw }, { data: turnosCat }] = await Promise.all([
    leerIncidencias(db, session.client_id, nomina.periodo),
    // `fecha_alta`/`fecha_baja` entran aquí para la sugerencia de días: son lo que dice
    // que alguien no trabajó el mes entero, y hasta ahora nadie lo miraba al generar.
    db.from('empleados').select('empleado_id, dias_laborables, fecha_alta, fecha_baja')
      .eq('client_id', session.client_id)
      .in('empleado_id', empIds),
    // Rotación (mig. 182): roster + patrones + slots + catálogo de franjas. De los tres se
    // derivan los días que le tocaban a cada uno (`sugerirDiasTrabajados`).
    db.from('turno_miembros').select('empleado_id, patron_id, offset_ciclo')
      .eq('client_id', session.client_id)
      .in('empleado_id', empIds.length ? empIds : ['__none__']),
    db.from('turno_patrones').select('patron_id, longitud_dias, fecha_ancla')
      .eq('client_id', session.client_id).eq('empresa_id', nomina.empresa_id).eq('activo', true),
    db.from('turno_patron_slots').select('patron_id, posicion, turno_id')
      .eq('client_id', session.client_id),
    db.from('turnos').select('turno_id, hora_inicio, hora_fin, es_descanso')
      .eq('client_id', session.client_id).eq('empresa_id', nomina.empresa_id),
  ])
  const config  = configDe(configs, nomina.empresa_id)
  const esCuba  = config.modelo === 'MIPYME_CUBA' && nomina.moneda === MONEDA_CUBA

  const propios = new Map(((fichas ?? []) as {
    empleado_id: string; dias_laborables: number | null
    fecha_alta: string | null; fecha_baja: string | null
  }[]).map(f => [f.empleado_id, f]))
  const diasLaborables: Record<string, number> = {}
  for (const l of nomina.lineas) {
    diasLaborables[l.empleado_id] = Number(propios.get(l.empleado_id)?.dias_laborables ?? config.dias_laborables_default)
  }

  // ── Qué días le tocaban a cada uno ─────────────────────────────────────────────
  // Solo bajo el modelo cubano: es el único que prorratea, así que en el General la
  // sugerencia no tendría dónde aplicarse.
  const sugerenciaDias: Record<string, SugerenciaDias> = {}
  if (esCuba) {
    // Resolver los patrones a lo que entiende el puente: cada slot del ciclo con el
    // HORARIO de su franja (null = descanso), y por empleado la lista de sus patrones con
    // offset. Un turno de DESCANSO o un slot vacío no cuentan como día trabajado.
    const horarioDe = new Map(((turnosCat ?? []) as { turno_id: string; hora_inicio: string | null; hora_fin: string | null; es_descanso: boolean }[])
      .map(t => [t.turno_id, { hora_inicio: t.hora_inicio, hora_fin: t.hora_fin, es_descanso: t.es_descanso } as TurnoHorario]))
    const slotsDe = new Map<string, (TurnoHorario | null)[]>()
    for (const p of (patronesRaw ?? []) as { patron_id: string; longitud_dias: number }[]) {
      slotsDe.set(p.patron_id, new Array(p.longitud_dias).fill(null))
    }
    for (const sl of (slotsRaw ?? []) as { patron_id: string; posicion: number; turno_id: string | null }[]) {
      const arr = slotsDe.get(sl.patron_id)
      if (!arr || sl.posicion < 0 || sl.posicion >= arr.length) continue
      arr[sl.posicion] = sl.turno_id ? (horarioDe.get(sl.turno_id) ?? null) : null
    }
    const resueltoDe = new Map<string, PatronResuelto>()
    for (const p of (patronesRaw ?? []) as { patron_id: string; longitud_dias: number; fecha_ancla: string }[]) {
      resueltoDe.set(p.patron_id, {
        longitud_dias: p.longitud_dias,
        fecha_ancla:   String(p.fecha_ancla).slice(0, 10),
        slots:         slotsDe.get(p.patron_id) ?? [],
      })
    }
    const patronesDe = new Map<string, { patron: PatronResuelto; offset: number }[]>()
    for (const m of (miembros ?? []) as { empleado_id: string; patron_id: string; offset_ciclo: number }[]) {
      const pr = resueltoDe.get(m.patron_id)
      if (!pr) continue
      const arr = patronesDe.get(m.empleado_id) ?? []
      arr.push({ patron: pr, offset: m.offset_ciclo ?? 0 })
      patronesDe.set(m.empleado_id, arr)
    }
    for (const l of nomina.lineas) {
      const ficha = propios.get(l.empleado_id)
      const s = sugerirDiasTrabajados({
        periodo:         nomina.periodo,
        fecha_alta:      ficha?.fecha_alta ?? null,
        fecha_baja:      ficha?.fecha_baja ?? null,
        dias_laborables: diasLaborables[l.empleado_id],
        patrones:        patronesDe.get(l.empleado_id),
      })
      if (!s) continue
      // El aviso sale si hay desfase REAL, nunca «por si acaso»: si la línea ya lleva
      // esos días —los tecleó el dueño o los aplicó antes—, no hay nada que proponer.
      const actual = incidenciasMap.get(l.empleado_id)?.dias_trabajados
      const vigente = actual ?? diasLaborables[l.empleado_id]
      if (Math.abs(vigente - s.dias) < 0.05) continue
      sugerenciaDias[l.empleado_id] = s
    }
  }

  // ── A quién liquidarle las vacaciones ──────────────────────────────────────────
  // Solo cubano y solo quien causa baja ESTE mes: es cuando se salda lo pendiente. El
  // saldo se deriva en días excluyendo esta nómina (si no, la línea recién generada se
  // contaría a sí misma) y se ofrece con un botón, nunca se aplica solo.
  const sugerenciaLiquidacion: Record<string, { dias: number; importe: number }> = {}
  if (esCuba) {
    const bajasEsteMes = nomina.lineas.filter(l =>
      (propios.get(l.empleado_id)?.fecha_baja ?? '').slice(0, 7) === nomina.periodo)
    if (bajasEsteMes.length) {
      const detalleSaldos = await saldosVacacionesDetalle(db, session.client_id, bajasEsteMes.map(l => l.empleado_id))
      for (const l of bajasEsteMes) {
        const saldo = saldoVacDe(detalleSaldos.get(l.empleado_id), nomina.nomina_id)
        const yaLiquida = incidenciasMap.get(l.empleado_id)?.dias_liquidacion ?? 0
        // Positivo y sin liquidar todavía: si ya teclearon los días, no hay nada que proponer.
        if (saldo.dias > 0.05 && yaLiquida < 0.05) {
          sugerenciaLiquidacion[l.empleado_id] = {
            dias:    Math.round(saldo.dias * 100) / 100,
            importe: Math.round(saldo.importe * 100) / 100,
          }
        }
      }
    }
  }

  return {
    data, nomina, esCuba, diasLaborables, sugerenciaDias, sugerenciaLiquidacion,
    incidencias: Object.fromEntries(incidenciasMap),
  }
}

/**
 * Guarda una incidencia desde la tabla de la nómina y recalcula SOLO esa
 * línea: `guardarIncidencia` únicamente toca `incidencias_nomina`, nunca
 * `nomina_lineas`, así que sin este paso la fila seguiría enseñando el
 * importe de antes. Reusa `recalcularNomina`/`reabrirYActualizarNomina` tal
 * cual —el mismo motor que ya usa «Actualizar con los conceptos»— para que
 * no exista una segunda forma de que el total deje de cuadrar con sus líneas.
 *
 * Si la nómina ya está CONFIRMADA, reabrirla es un paso previo y SOLO bajo
 * impersonación: es la vía para corregir un dato del cliente sin tocar la
 * base a mano, no una edición normal de portal. La guardia de pagos ya
 * registrados en Tesorería (dentro de `reabrirYActualizarNomina`) se respeta
 * igual bajo impersonación — eso no es un dato mal cargado, es dinero ya
 * movido.
 */
export async function guardarIncidenciaDeLinea(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; aviso?: string; reabierta?: boolean }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const nomina_id   = (formData.get('nomina_id')   as string)?.trim()
  const empleado_id = (formData.get('empleado_id') as string)?.trim()
  if (!nomina_id)   return { ok: false, error: 'Nómina no válida.' }
  if (!empleado_id) return { ok: false, error: 'Trabajador no válido.' }

  const db = createAdminClient()
  const { data: nomina } = await db.from('nominas').select('estado')
    .eq('nomina_id', nomina_id).eq('client_id', session.client_id).maybeSingle()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }

  let reabierta = false
  if (nomina.estado === 'CONFIRMADA') {
    if (!session.imp) {
      return { ok: false, error: 'Esta nómina ya está confirmada. Solo se puede corregir desde el modo de configuración.' }
    }
    const r = await reabrirYActualizarNomina(nomina_id, empleado_id)
    if (!r.ok) return { ok: false, error: r.error }
    reabierta = true
  }

  const res = await guardarIncidencia(formData)
  if (!res.ok) return res

  const rec = await recalcularNomina(nomina_id, empleado_id)
  if (!rec.ok) return { ok: false, error: rec.error }

  return { ok: true, aviso: res.aviso, reabierta }
}

/**
 * Igual que `guardarIncidenciaDeLinea` pero para el modelo GENERAL: el
 * devengado se teclea directo (`guardarLineaNomina`), así que no hace falta
 * un recálculo después — el valor tecleado YA es el definitivo. Mismo
 * candado: sobre una CONFIRMADA, reabrir es previo y solo bajo impersonación.
 */
export async function guardarDevengadoDeLinea(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; reabierta?: boolean }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const linea_id = (formData.get('linea_id') as string)?.trim()
  if (!linea_id) return { ok: false, error: 'Línea no válida.' }

  const db = createAdminClient()
  const { data: linea } = await db.from('nomina_lineas').select('nomina_id, empleado_id')
    .eq('linea_id', linea_id).eq('client_id', session.client_id).maybeSingle()
  if (!linea) return { ok: false, error: 'Línea no encontrada.' }

  const { data: nomina } = await db.from('nominas').select('estado')
    .eq('nomina_id', linea.nomina_id).eq('client_id', session.client_id).maybeSingle()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }

  let reabierta = false
  if (nomina.estado === 'CONFIRMADA') {
    if (!session.imp) {
      return { ok: false, error: 'Esta nómina ya está confirmada. Solo se puede corregir desde el modo de configuración.' }
    }
    const r = await reabrirYActualizarNomina(linea.nomina_id, linea.empleado_id)
    if (!r.ok) return { ok: false, error: r.error }
    reabierta = true
  }

  const res = await guardarLineaNomina(formData)
  if (!res.ok) return res
  return { ok: true, reabierta }
}

// ── Configuración de nómina por empresa (mig. 142) ──────────────────────────────

export async function guardarConfigNomina(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresa_id = (formData.get('empresa_id') as string)?.trim()
  const modelo     = (formData.get('modelo')     as string)?.trim() as ModeloNomina
  const diasRaw    = parseFloat(formData.get('dias_laborables_default') as string)

  if (!empresa_id) return { ok: false, error: 'Empresa no válida.' }
  if (modelo !== 'GENERAL' && modelo !== 'MIPYME_CUBA') return { ok: false, error: 'Modelo no válido.' }
  if (isNaN(diasRaw) || diasRaw <= 0 || diasRaw > 31) {
    return { ok: false, error: 'Los días laborables deben estar entre 1 y 31.' }
  }

  // Día de pago (mig. 166). En blanco es válido y significa «sin fijar»: las CxP de la
  // nómina nacen sin vencimiento, como hasta ahora. No se rechaza un 31 en un mes de
  // 30: al calcular el vencimiento se ajusta al último día del mes, que es lo que
  // espera quien escribió «pago el último día».
  const diaPagoRaw = (formData.get('dia_pago') as string ?? '').trim()
  const dia_pago   = diaPagoRaw === '' ? null : parseInt(diaPagoRaw, 10)
  if (dia_pago !== null && (isNaN(dia_pago) || dia_pago < 1 || dia_pago > 31)) {
    return { ok: false, error: 'El día de pago debe estar entre 1 y 31, o quedar en blanco.' }
  }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) return { ok: false, error: 'Empresa no válida.' }

  const db = createAdminClient()
  // Cambiar el modelo NO reescribe nada: `crearNomina` lee esta tabla al generar,
  // así que solo afecta a las nóminas que se hagan a partir de ahora. Las ya
  // confirmadas no se tocan nunca.
  const { error } = await db.from('empresa_config_nomina').upsert({
    empresa_id,
    client_id:               session.client_id,
    modelo,
    dias_laborables_default: diasRaw,
    dia_pago,
    updated_at:              new Date().toISOString(),
  }, { onConflict: 'empresa_id' })
  if (error) return { ok: false, error: error.message }

  revalidarNomina()
  return { ok: true }
}

// ── Mapeo concepto de coste → categoría de gasto (mig. 166) ─────────────────────
//
// Qué categoría recibe cada concepto de coste de la nómina, por empresa. Antes el
// reparto estaba fijo en código («Salarios» y «Retenciones de nómina») y el dueño no
// podía ver su coste de personal como lo lleva su contabilidad.
//
// Mandar dos conceptos a la MISMA categoría es legítimo —un estado de resultados más
// agregado— y aun así se escribe **una fila de gasto por concepto**: agrupar en el
// informe es reversible, fusionar las filas no. Vaciar el selector borra la fila y el
// concepto vuelve a su categoría de sistema por defecto.

export async function guardarMapeoGastoNomina(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresa_id = (formData.get('empresa_id') as string)?.trim()
  if (!empresa_id) return { ok: false, error: 'Empresa no válida.' }
  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) return { ok: false, error: 'Empresa no válida.' }

  const db = createAdminClient()
  // Las categorías ACTIVAS del cliente: una elección tiene que ser una categoría suya
  // y viva, o el mapeo apuntaría a una fila archivada que la nómina ignoraría después
  // en silencio.
  const { data: cats } = await db.from('categorias_gastos')
    .select('categoria_id').eq('client_id', session.client_id).eq('estado', 'ACTIVO')
  const validas = new Set(((cats ?? []) as { categoria_id: string }[]).map(c => c.categoria_id))

  for (const concepto of CONCEPTOS_COSTE) {
    const elegida = ((formData.get(`cat_${concepto}`) as string) ?? '').trim()
    if (!elegida) {
      await db.from('nomina_gasto_mapeo').delete()
        .eq('client_id', session.client_id).eq('empresa_id', empresa_id).eq('concepto', concepto)
      continue
    }
    if (!validas.has(elegida)) {
      return { ok: false, error: `La categoría elegida para «${NOMBRE_CONCEPTO_COSTE[concepto]}» no existe o está archivada.` }
    }
    const { error } = await db.from('nomina_gasto_mapeo').upsert({
      mapeo_id:     `NGM-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`,
      client_id:    session.client_id,
      empresa_id,
      concepto,
      categoria_id: elegida,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'client_id,empresa_id,concepto' })
    if (error) return { ok: false, error: error.message }
  }

  revalidarNomina()
  return { ok: true }
}

// ── Reglas del negocio (mig. 141) ───────────────────────────────────────────────
// Se escriben UNA vez y se aplican a toda la plantilla. Antes, una retención igual
// para todos eran tantas altas a mano como trabajadores, y cambiarla, tantos
// borrados y tantas altas. Viven en Nómina y no en la ficha porque son
// configuración del NEGOCIO, no de una persona.

export async function guardarReglaDeduccion(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const regla_id   = (formData.get('regla_id')   as string)?.trim() || null
  const nombre     = (formData.get('nombre')     as string)?.trim()
  const tipo       = (formData.get('tipo')       as string)?.trim() as TipoItemLinea
  const modo       = (formData.get('modo')       as string)?.trim() as ModoConcepto
  const base       = ((formData.get('base')      as string)?.trim() || 'SALARIO_BASE') as BaseCalculo
  const empresaRaw = (formData.get('empresa_id') as string)?.trim() || ''
  const valorRaw   = parseFloat(formData.get('valor') as string)

  if (!nombre)                                   return { ok: false, error: 'El nombre de la regla es obligatorio.' }
  if (tipo !== 'DEVENGO' && tipo !== 'RETENCION')  return { ok: false, error: 'Tipo no válido.' }
  if (modo !== 'FIJO' && modo !== 'PORCENTAJE')    return { ok: false, error: 'Modo no válido.' }
  if (base !== 'SALARIO_BASE' && base !== 'DEVENGADO') return { ok: false, error: 'Base de cálculo no válida.' }
  if (isNaN(valorRaw) || valorRaw <= 0)          return { ok: false, error: 'El valor debe ser positivo.' }
  if (modo === 'PORCENTAJE' && valorRaw > 100)   return { ok: false, error: 'Un porcentaje no puede pasar del 100 %.' }

  // Vacío = todas las empresas. Si viene una, tiene que ser del cliente.
  let empresa_id: string | null = null
  if (empresaRaw) {
    const empresas = await obtenerEmpresas()
    if (!empresas.some(e => e.empresa_id === empresaRaw)) return { ok: false, error: 'Empresa no válida.' }
    empresa_id = empresaRaw
  }

  const db = createAdminClient()
  const campos = {
    nombre, tipo, modo, base,
    valor:      valorRaw,
    empresa_id,
    destino:    tipo === 'RETENCION' ? 'TERCERO_FISCAL' : null,
    updated_at: new Date().toISOString(),
  }

  const { error } = regla_id
    ? await db.from('deducciones_reglas').update(campos)
        .eq('regla_id', regla_id).eq('client_id', session.client_id)
    : await db.from('deducciones_reglas').insert({
        regla_id:  `DRG-${corto()}`,
        client_id: session.client_id,
        activa:    true,
        ...campos,
      })
  if (error) return { ok: false, error: error.message }

  revalidarNomina()
  return { ok: true }
}

export async function alternarReglaDeduccion(
  regla_id: string, activa: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db.from('deducciones_reglas')
    .update({ activa, updated_at: new Date().toISOString() })
    .eq('regla_id', regla_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidarNomina()
  return { ok: true }
}

export async function eliminarReglaDeduccion(regla_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  // Las excepciones cuelgan de la regla: si la regla desaparece, dejan de tener
  // sentido (serían filas con un `regla_id` que no apunta a nada) y se van con ella.
  // Las nóminas ya generadas no se tocan: su desglose es una foto congelada.
  await db.from('conceptos_empleado').delete()
    .eq('client_id', session.client_id).eq('regla_id', regla_id)

  const { error } = await db.from('deducciones_reglas').delete()
    .eq('regla_id', regla_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidarNomina()
  return { ok: true }
}

/**
 * Excepción de un trabajador a una regla: o se le aplica OTRO valor, o no se le
 * aplica. Vive en `conceptos_empleado` con `regla_id`, no en una tabla aparte: es
 * «lo que este trabajador tiene de particular», que es exactamente esa tabla.
 */
export async function guardarExcepcionRegla(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empleado_id = (formData.get('empleado_id') as string)?.trim()
  const regla_id    = (formData.get('regla_id')    as string)?.trim()
  const excluida    = (formData.get('excluida')    as string) === 'true'
  const valorRaw    = parseFloat(formData.get('valor') as string)

  if (!empleado_id || !regla_id) return { ok: false, error: 'Datos incompletos.' }

  const db = createAdminClient()
  const { data: regla } = await db.from('deducciones_reglas')
    .select('regla_id, nombre, tipo, modo')
    .eq('regla_id', regla_id).eq('client_id', session.client_id).maybeSingle()
  if (!regla) return { ok: false, error: 'Regla no encontrada.' }

  if (!excluida) {
    if (isNaN(valorRaw) || valorRaw <= 0)  return { ok: false, error: 'El valor debe ser positivo.' }
    if (regla.modo === 'PORCENTAJE' && valorRaw > 100) return { ok: false, error: 'Un porcentaje no puede pasar del 100 %.' }
  }

  const { data: previa } = await db.from('conceptos_empleado').select('concepto_id')
    .eq('client_id', session.client_id).eq('empleado_id', empleado_id).eq('regla_id', regla_id).maybeSingle()

  const campos = {
    // El nombre y el tipo los manda la REGLA: la excepción cambia el importe, no de
    // qué se trata. Se copian para que la fila se lea sola en la ficha.
    nombre:      regla.nombre,
    tipo:        regla.tipo === 'APORTE_EMPRESA' ? 'RETENCION' : regla.tipo,
    modo:        regla.modo,
    valor:       excluida ? 0 : valorRaw,
    excluida,
    regla_id,
    destino:     regla.tipo === 'RETENCION' ? 'TERCERO_FISCAL' : null,
    recurrencia: 'RECURRENTE',
    updated_at:  new Date().toISOString(),
  }

  const { error } = previa
    ? await db.from('conceptos_empleado').update(campos)
        .eq('concepto_id', previa.concepto_id).eq('client_id', session.client_id)
    : await db.from('conceptos_empleado').insert({
        concepto_id: generarConceptoId(),
        client_id:   session.client_id,
        empleado_id,
        activo:      true,
        base:        'SALARIO_BASE',
        ...campos,
      })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${empleado_id}`)
  revalidarNomina()
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════════
// NÓMINA
// ════════════════════════════════════════════════════════════════════════════════

// ── Crear nómina ────────────────────────────────────────────────────────────────
// Genera una nómina BORRADOR y precarga una línea por cada empleado ACTIVO de la
// empresa cuya moneda coincide (devengado = neto = salario_base).

export async function crearNomina(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresa_id = (formData.get('empresa_id') as string)?.trim()
  const periodo    = (formData.get('periodo')    as string)?.trim()   // YYYY-MM
  const moneda     = (formData.get('moneda')     as string)?.trim()
  const fecha      = (formData.get('fecha')      as string)?.trim() || hoy()
  const notas      = (formData.get('notas')      as string)?.trim() || null

  if (!empresa_id)                 return { ok: false, error: 'Debes seleccionar una empresa.' }
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return { ok: false, error: 'El período debe tener formato AAAA-MM.' }
  if (!moneda)                     return { ok: false, error: 'Debes seleccionar una moneda.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  const db = createAdminClient()

  // Evitar duplicados: una nómina por empresa y período
  const { count: yaExiste } = await db.from('nominas')
    .select('nomina_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .eq('empresa_id', empresa_id)
    .eq('periodo', periodo)
  if ((yaExiste ?? 0) > 0) {
    return { ok: false, error: `Ya existe una nómina de ${periodo} para esta empresa.` }
  }

  // Incluir a quien trabajó (aunque sea parte) en el período: alta ≤ fin del mes
  // y (sigue activo o se dio de baja dentro/después del inicio del período).
  const [yy, mm]    = periodo.split('-').map(Number)
  const periodStart = `${periodo}-01`
  const periodEnd   = `${periodo}-${String(new Date(yy, mm, 0).getDate()).padStart(2, '0')}`

  const { data: empData } = await db.from('empleados')
    .select('empleado_id, nombre, apellidos, cargo, salario_base, es_socio, dias_laborables')
    .eq('client_id', session.client_id)
    .eq('empresa_id', empresa_id)
    .eq('moneda', moneda)
    .lte('fecha_alta', periodEnd)
    .or(`fecha_baja.is.null,fecha_baja.gte.${periodStart}`)
    .order('nombre')
  const activos = (empData ?? []) as {
    empleado_id: string; nombre: string; apellidos: string | null; cargo: string | null
    salario_base: number; es_socio: boolean; dias_laborables: number | null
  }[]

  if (!activos.length) {
    return { ok: false, error: `No hay personal en esa empresa con salario en ${moneda} para ${periodo}.` }
  }

  const nomina_id = generarNominaId()

  // Reglas del negocio + conceptos del trabajador: las dos fuentes que alimentan la
  // línea al generar. Las reglas se aplican solas a todos; el concepto solo hace
  // falta cuando esa persona es la excepción.
  const empIds = activos.map(e => e.empleado_id)
  const [reglasDe, configs, incidencias, { data: cptData }] = await Promise.all([
    leerReglas(db, session.client_id),
    leerConfigNomina(db, session.client_id),
    leerIncidencias(db, session.client_id, periodo),
    db.from('conceptos_empleado')
      .select('concepto_id, empleado_id, nombre, tipo, modo, valor, base, destino, regla_id, excluida, recurrencia, periodo_aplicable')
      .eq('client_id', session.client_id)
      .in('empleado_id', empIds.length ? empIds : ['__none__'])
      .eq('activo', true)
      .order('created_at'),
  ])
  const reglasEmpresa = reglasDe(empresa_id)
  const config        = configDe(configs, empresa_id)

  // El motor legal cubano SOLO actúa sobre la nómina en CUP. La restricción va aquí
  // y no al activar el modelo porque una nómina ya es por (empresa, moneda): un
  // negocio que paga en CUP y en USD hace DOS nóminas del mismo mes para la misma
  // empresa, y bloquear la activación por una ficha en divisa le impediría usar el
  // modelo cubano en absoluto. La nómina en otra moneda se comporta como GENERAL.
  const aplicaCuba = config.modelo === 'MIPYME_CUBA' && moneda === MONEDA_CUBA
  const parametros = aplicaCuba ? await leerParametrosCuba(db, fecha) : []
  const cptPorEmp = new Map<string, ConceptoAplicable[]>()
  for (const c of (cptData ?? []) as ({ empleado_id: string } & ConceptoAplicable)[]) {
    const arr = cptPorEmp.get(c.empleado_id) ?? []
    arr.push({ ...c, valor: Number(c.valor) })
    cptPorEmp.set(c.empleado_id, arr)
  }

  // Saldo de vacaciones para valorar el disfrute: es una nómina NUEVA (aún no existe),
  // así que el saldo es el de todas las confirmadas anteriores, sin nada que excluir.
  const detalleSaldos = aplicaCuba
    ? await saldosVacacionesDetalle(db, session.client_id, activos.map(e => e.empleado_id as string))
    : new Map<string, { apertura: SaldoVac; porNomina: Map<string, SaldoVac> }>()

  // Una nómina recién creada no tiene ítems que preservar: nace de cero.
  const items: ReturnType<typeof filaItem>[] = []
  const lineas = activos.map(e => {
    const base     = redondear2(Number(e.salario_base))
    const linea_id = generarLineaId()
    const inc      = incidencias.get(e.empleado_id)
    const saldoVac = aplicaCuba ? saldoVacDe(detalleSaldos.get(e.empleado_id as string)) : null
    const calc     = componerLinea({
      salario_base: base,
      reglas:       reglasEmpresa,
      conceptos:    cptPorEmp.get(e.empleado_id) ?? [],
      periodo,
      incidencia:   inc,
      cuba: aplicaCuba ? {
        parametros,
        dias_laborables: Number(e.dias_laborables ?? config.dias_laborables_default),
        es_socio:        !!e.es_socio,
        // Sin incidencia cargada: mes completo y sin vacaciones disfrutadas, que es
        // como se ha comportado el sistema siempre.
        dias_trabajados: inc?.dias_trabajados ?? null,
        dias_vacaciones: inc?.dias_vacaciones ?? 0,
        dias_liquidacion: inc?.dias_liquidacion ?? 0,
        saldo_vac_importe: saldoVac!.importe,
        saldo_vac_dias:    saldoVac!.dias,
        vacaciones_importe_manual: inc?.vacaciones_importe_manual ?? null,
      } : undefined,
    })
    for (const it of calc.items) items.push(filaItem(it, linea_id, nomina_id, session.client_id))
    return {
      linea_id,
      nomina_id,
      client_id:       session.client_id,
      empleado_id:     e.empleado_id,
      empleado_nombre: [e.nombre, e.apellidos].filter(Boolean).join(' '),
      cargo:           e.cargo,
      salario_base:    base,
      devengado:       calc.devengado,
      deducciones:     calc.deducciones,
      neto:            calc.neto,
      vacaciones_acumuladas_periodo: calc.vacaciones_acumuladas,
      vacaciones_pagadas_periodo:    calc.vacaciones_pagadas,
      vacaciones_dias_acumulados_periodo: calc.vacaciones_dias_acumuladas,
      vacaciones_dias_pagados_periodo:    calc.vacaciones_dias_pagadas,
      subsidios:                     calc.subsidios,
      subsidios_maternidad:          calc.subsidios_maternidad,
    }
  })
  const total = redondear2(lineas.reduce((s, l) => s + l.neto, 0))

  const { error: nomErr } = await db.from('nominas').insert({
    nomina_id,
    client_id:  session.client_id,
    empresa_id,
    periodo,
    fecha,
    moneda,
    estado:     'BORRADOR',
    total,
    notas,
    updated_at: new Date().toISOString(),
  })
  if (nomErr) return { ok: false, error: nomErr.message }
  const { error: linErr } = await db.from('nomina_lineas').insert(lineas)
  if (linErr) {
    await db.from('nominas').delete().eq('nomina_id', nomina_id).eq('client_id', session.client_id)
    return { ok: false, error: linErr.message }
  }
  // Los ítems van DESPUÉS de las líneas (la clave ajena las exige creadas). Si
  // fallan, se deshace la nómina entera: una línea sin desglose es justo el estado
  // que esta migración vino a eliminar.
  if (items.length) {
    const { error: itErr } = await db.from('nomina_linea_conceptos').insert(items)
    if (itErr) {
      await db.from('nomina_lineas').delete().eq('nomina_id', nomina_id).eq('client_id', session.client_id)
      await db.from('nominas').delete().eq('nomina_id', nomina_id).eq('client_id', session.client_id)
      return { ok: false, error: itErr.message }
    }
  }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Editar el DEVENGADO de una línea de nómina (solo BORRADOR) ──────────────────
// Solo el devengado. Las deducciones NO se editan aquí: salen de los conceptos del
// trabajador y se mantienen tal cual. Se retiró el campo suelto de deducciones del
// modal porque un importe sin concepto no se puede explicar a nadie, no se puede
// clasificar como impuesto o no, no puede ir a un acreedor concreto en contabilidad
// y lo borraba el primer recálculo (que no podía distinguirlo de un concepto sin
// aplicar). Además su guardado dependía de un botón de check por fila y el importe
// tecleado se perdía en silencio al cerrar el modal: le pasó a un cliente real.
//
// El importe deducido se LEE de la base y no se toca: si llegara vacío por
// formulario, tomarlo como 0 borraría la retención al guardar el devengado.

export async function guardarLineaNomina(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const linea_id     = (formData.get('linea_id') as string)?.trim()
  const devengadoRaw = parseFloat(formData.get('devengado') as string)
  if (!linea_id) return { ok: false, error: 'Línea no válida.' }
  const devengado = isNaN(devengadoRaw) || devengadoRaw < 0 ? 0 : redondear2(devengadoRaw)

  const db = createAdminClient()

  const { data: linea } = await db.from('nomina_lineas')
    .select('nomina_id, deducciones, salario_base')
    .eq('linea_id', linea_id)
    .eq('client_id', session.client_id)
    .single()
  if (!linea) return { ok: false, error: 'Línea no encontrada.' }

  const { data: nomina } = await db.from('nominas')
    .select('estado, empresa_id, moneda')
    .eq('nomina_id', linea.nomina_id)
    .eq('client_id', session.client_id)
    .single()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }
  if (nomina.estado !== 'BORRADOR') return { ok: false, error: 'La nómina ya está confirmada y no se puede editar.' }

  // Bajo el modelo cubano el devengado NO se teclea: la CESS y el IRPF son funciones
  // suyas, así que cambiarlo a mano los dejaría mintiendo —enseñarían una retención
  // calculada sobre otro importe—. Los ajustes entran por incidencias del mes o como
  // concepto puntual, y el motor recalcula todo lo que dependa de ellos.
  const configs = await leerConfigNomina(db, session.client_id)
  if (configDe(configs, nomina.empresa_id).modelo === 'MIPYME_CUBA' && nomina.moneda === MONEDA_CUBA) {
    return {
      ok: false,
      error: 'En el modelo MIPYME cubana el devengado se calcula, no se teclea: los impuestos dependen de él. Carga los días o el pago extra en «Incidencias del mes» de su ficha, o añade un concepto puntual a la línea.',
    }
  }

  // Bajar el devengado por debajo de lo ya deducido no se recorta en silencio: se
  // rechaza diciendo el importe, porque el arreglo está en el concepto, no aquí.
  const deducciones = Number(linea.deducciones)
  if (deducciones > devengado + EPS) {
    return {
      ok: false,
      error: `Esta línea tiene ${deducciones.toLocaleString('es-ES', { minimumFractionDigits: 2 })} de deducciones y no pueden superar el devengado. Ajusta primero los conceptos del trabajador en su ficha.`,
    }
  }
  const neto = redondear2(devengado - deducciones)

  const { error } = await db.from('nomina_lineas')
    .update({ devengado, neto })
    .eq('linea_id', linea_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  // Editar el devengado a mano tiene que DEJAR RASTRO (mig. 140). Antes no lo dejaba,
  // y por eso el recálculo lo borraba sin poder saber que había sido deliberado. Se
  // materializa como un ítem PUNTUAL por la diferencia contra lo que explican los
  // demás ítems de devengo, de modo que la invariante
  //     devengado = salario_base + Σ ítems DEVENGO
  // sigue cumpliéndose después de tocar la cifra.
  const { data: itemsAct } = await db.from('nomina_linea_conceptos')
    .select('item_id, tipo, monto, origen, origen_id')
    .eq('linea_id', linea_id)
    .eq('client_id', session.client_id)
  const itemsLinea = (itemsAct ?? []) as { item_id: string; tipo: TipoItemLinea; monto: number; origen: OrigenItemLinea; origen_id: string | null }[]

  const ajuste   = itemsLinea.find(i => i.origen === 'PUNTUAL' && i.origen_id === AJUSTE_MANUAL)
  const otrosDev = itemsLinea
    .filter(i => i.tipo === 'DEVENGO' && i.item_id !== ajuste?.item_id)
    .reduce((s, i) => s + Number(i.monto), 0)
  // Puede salir NEGATIVO (bajar el devengado por debajo del salario del período es
  // legítimo hoy y no se va a prohibir en esta fase): el ítem lo dice tal cual, que
  // es más honesto que esconderlo.
  const necesario = redondear2(devengado - Number(linea.salario_base) - otrosDev)

  if (Math.abs(necesario) > EPS) {
    if (ajuste) {
      await db.from('nomina_linea_conceptos')
        .update({ monto: necesario })
        .eq('item_id', ajuste.item_id)
        .eq('client_id', session.client_id)
    } else {
      await db.from('nomina_linea_conceptos').insert(filaItem({
        nombre:    'Ajuste manual',
        tipo:      'DEVENGO',
        monto:     necesario,
        origen:    'PUNTUAL',
        origen_id: AJUSTE_MANUAL,
        destino:   null,
      }, linea_id, linea.nomina_id, session.client_id))
    }
  } else if (ajuste) {
    // Vuelve a cuadrar sin ajuste: se retira en vez de dejarlo a cero, para que el
    // desglose no arrastre una línea que ya no explica nada.
    await db.from('nomina_linea_conceptos')
      .delete()
      .eq('item_id', ajuste.item_id)
      .eq('client_id', session.client_id)
  }

  // Recalcular total de la nómina
  const { data: todas } = await db.from('nomina_lineas')
    .select('neto')
    .eq('nomina_id', linea.nomina_id)
    .eq('client_id', session.client_id)
  const total = redondear2((todas ?? []).reduce((s, l) => s + Number(l.neto), 0))
  await db.from('nominas')
    .update({ total, updated_at: new Date().toISOString() })
    .eq('nomina_id', linea.nomina_id)
    .eq('client_id', session.client_id)

  revalidatePath('/portal/nomina')
  return { ok: true }
}

// ── Conceptos PUNTUALES de una línea (mig. 140) ─────────────────────────────────
// El hueco que no tenía sitio: el hecho de UN mes (una rotura, un descuento pactado
// una vez, un extra). Antes la única vía era editar el devengado a mano, que perdía
// el motivo y lo borraba el primer recálculo. Ahora es un ítem con nombre propio, y
// el recálculo lo respeta: recompone lo que sale de la ficha y deja esto intacto.

/**
 * Reescribe los agregados de la línea desde sus ítems y el total de su nómina.
 * Es la ÚNICA vía por la que se tocan `devengado`/`deducciones`/`neto` cuando cambia
 * un ítem: si cada acción los recalculara a su manera, la línea y su desglose
 * acabarían discrepando, que es exactamente lo que la tabla de ítems vino a evitar.
 */
async function recomputarLineaDesdeItems(
  db:        DbAdmin,
  client_id: string,
  linea_id:  string,
): Promise<{ error?: string }> {
  const { data: linea } = await db.from('nomina_lineas')
    .select('nomina_id, salario_base')
    .eq('linea_id', linea_id).eq('client_id', client_id).single()
  if (!linea) return { error: 'Línea no encontrada.' }

  const { data: items } = await db.from('nomina_linea_conceptos')
    .select('tipo, monto').eq('linea_id', linea_id).eq('client_id', client_id)
  const filas = (items ?? []) as { tipo: TipoItemLinea; monto: number }[]

  const salarioBase = redondear2(Number(linea.salario_base))
  const devengado = redondear2(salarioBase
    + filas.filter(i => i.tipo === 'DEVENGO').reduce((s, i) => s + redondear2(Number(i.monto)), 0))
  const deducciones = redondear2(
    filas.filter(i => i.tipo === 'RETENCION').reduce((s, i) => s + redondear2(Number(i.monto)), 0))

  const { error } = await db.from('nomina_lineas')
    .update({ devengado, deducciones, neto: redondear2(Math.max(0, devengado - deducciones)) })
    .eq('linea_id', linea_id).eq('client_id', client_id)
  if (error) return { error: error.message }

  const { data: todas } = await db.from('nomina_lineas')
    .select('neto').eq('nomina_id', linea.nomina_id).eq('client_id', client_id)
  await db.from('nominas')
    .update({ total: redondear2((todas ?? []).reduce((s, l) => s + Number(l.neto), 0)), updated_at: new Date().toISOString() })
    .eq('nomina_id', linea.nomina_id).eq('client_id', client_id)
  return {}
}

/** Comprueba que la línea es de una nómina en BORRADOR y devuelve su nómina. */
async function lineaEditable(
  db: DbAdmin, client_id: string, linea_id: string,
): Promise<{ error?: string; nomina_id?: string; salario_base?: number }> {
  const { data: linea } = await db.from('nomina_lineas')
    .select('nomina_id, salario_base')
    .eq('linea_id', linea_id).eq('client_id', client_id).maybeSingle()
  if (!linea) return { error: 'Línea no encontrada.' }
  const { data: nomina } = await db.from('nominas')
    .select('estado').eq('nomina_id', linea.nomina_id).eq('client_id', client_id).maybeSingle()
  if (!nomina) return { error: 'Nómina no encontrada.' }
  if (nomina.estado !== 'BORRADOR') return { error: 'La nómina ya está confirmada y no se puede editar.' }
  return { nomina_id: linea.nomina_id, salario_base: Number(linea.salario_base) }
}

export async function anadirItemPuntual(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const linea_id = (formData.get('linea_id') as string)?.trim()
  const nombre   = (formData.get('nombre')   as string)?.trim()
  const tipo     = (formData.get('tipo')     as string)?.trim() as TipoItemLinea
  const montoRaw = parseFloat(formData.get('monto') as string)

  if (!linea_id)                          return { ok: false, error: 'Línea no válida.' }
  if (!nombre)                            return { ok: false, error: 'Ponle un nombre: es lo que explicará este importe después.' }
  if (tipo !== 'DEVENGO' && tipo !== 'RETENCION') return { ok: false, error: 'Tipo no válido.' }
  if (isNaN(montoRaw) || montoRaw <= 0)   return { ok: false, error: 'El importe debe ser mayor que cero.' }
  const monto = redondear2(montoRaw)

  const db  = createAdminClient()
  const chk = await lineaEditable(db, session.client_id, linea_id)
  if (chk.error) return { ok: false, error: chk.error }

  // Una retención que no cabe en el devengado se RECHAZA diciendo el importe, no se
  // recorta en silencio: aquí el dueño acaba de teclear la cifra y puede corregirla.
  if (tipo === 'RETENCION') {
    const { data: items } = await db.from('nomina_linea_conceptos')
      .select('tipo, monto').eq('linea_id', linea_id).eq('client_id', session.client_id)
    const filas   = (items ?? []) as { tipo: TipoItemLinea; monto: number }[]
    const devengado = redondear2((chk.salario_base ?? 0)
      + filas.filter(i => i.tipo === 'DEVENGO').reduce((s, i) => s + Number(i.monto), 0))
    const yaRetenido = redondear2(filas.filter(i => i.tipo === 'RETENCION').reduce((s, i) => s + Number(i.monto), 0))
    if (yaRetenido + monto > devengado + EPS) {
      const cabe = redondear2(Math.max(0, devengado - yaRetenido))
      return { ok: false, error: `No cabe: esta línea devenga ${devengado.toLocaleString('es-ES', { minimumFractionDigits: 2 })} y ya tiene ${yaRetenido.toLocaleString('es-ES', { minimumFractionDigits: 2 })} retenido. Como mucho puedes descontar ${cabe.toLocaleString('es-ES', { minimumFractionDigits: 2 })}.` }
    }
  }

  const { error } = await db.from('nomina_linea_conceptos').insert(filaItem({
    nombre, tipo, monto,
    origen:    'PUNTUAL',
    origen_id: null,
    destino:   tipo === 'RETENCION' ? 'TERCERO_FISCAL' : null,
  }, linea_id, chk.nomina_id!, session.client_id))
  if (error) return { ok: false, error: error.message }

  const res = await recomputarLineaDesdeItems(db, session.client_id, linea_id)
  if (res.error) return { ok: false, error: res.error }

  revalidarNomina()
  return { ok: true }
}

export async function eliminarItemPuntual(item_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: item } = await db.from('nomina_linea_conceptos')
    .select('linea_id, origen').eq('item_id', item_id).eq('client_id', session.client_id).maybeSingle()
  if (!item) return { ok: false, error: 'Concepto no encontrado.' }
  // Solo lo puntual se borra a mano. Lo que sale de la ficha del trabajador se quita
  // desde la ficha, o el recálculo volvería a ponerlo y parecería que no se guardó.
  if (item.origen !== 'PUNTUAL') {
    return { ok: false, error: 'Este concepto sale de la ficha del trabajador. Quítalo desde su ficha.' }
  }

  const chk = await lineaEditable(db, session.client_id, item.linea_id)
  if (chk.error) return { ok: false, error: chk.error }

  const { error } = await db.from('nomina_linea_conceptos')
    .delete().eq('item_id', item_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  const res = await recomputarLineaDesdeItems(db, session.client_id, item.linea_id)
  if (res.error) return { ok: false, error: res.error }

  revalidarNomina()
  return { ok: true }
}

// RETIRADO: «Aplicar a todas» (`aplicarConceptoNomina`), que sumaba el mismo bono o
// deducción a cada línea de la nómina. Aplicaba un importe suelto SIN concepto que
// lo explicara —ni nombre, ni rastro, ni forma de saber después de dónde salía—, y
// una retención de impuestos no es igual para todos: es del trabajador. Las
// deducciones se llevan por trabajador, desde su ficha (`conceptos_empleado`), y
// entran en la nómina al generarla o con `recalcularNomina`. Sin datos huérfanos:
// no llegó a usarse en producción. Recuperable en git (llegó en `620ef85`).

// ── Actualizar una nómina BORRADOR con los conceptos vigentes ────────────────────
// El olvido normal: se genera la nómina y DESPUÉS se recuerda una retención. Los
// conceptos solo se aplican al crear (`crearNomina`), así que hasta ahora la única
// salida era borrar la nómina entera y volver a generarla.
//
// Es un RECÁLCULO desde el `salario_base` de la línea —el del período, congelado
// al generar— más los conceptos activos del trabajador. No es un añadido: la línea
// guarda `deducciones` como un número sin desglose, así que no hay forma de saber
// qué conceptos la formaron y "sumar solo lo que falta" sería inventarse el punto
// de partida (y duplicar lo ya aplicado). Por eso pisa lo escrito a mano en las
// líneas que toca, y por eso se previsualiza antes de aplicar en vez de confiar.
//
// `empleado_id` acota el recálculo a un solo trabajador (su ficha, o la vista
// individual del modal); sin él va la nómina completa.

export interface RecalculoLineaNomina {
  linea_id:            string
  empleado_id:         string
  empleado_nombre:     string
  salario_base:        number
  devengado_antes:     number
  deducciones_antes:   number
  neto_antes:          number
  devengado_despues:   number
  deducciones_despues: number
  neto_despues:        number
  /** Los ítems exactos que quedarán en la línea, incluidos los PUNTUAL preservados. */
  items:                 ItemLinea[]
  vacaciones_acumuladas: number
  vacaciones_pagadas:    number
  vacaciones_dias_acumuladas: number
  vacaciones_dias_pagadas:    number
  subsidios:             number
  /** Porción de `subsidios` que es maternidad (la reembolsa el Estado, mig. 212). */
  subsidios_maternidad:  number
  /** Las deducciones superaban el devengado y se recortan a él. */
  recortada:           boolean
  cambia:              boolean
}

export interface RecalculoNomina {
  ok:            boolean
  error?:        string
  lineas:        RecalculoLineaNomina[]
  /** Totales de la nómina COMPLETA (las líneas fuera del foco cuentan igual). */
  total_antes:   number
  total_despues: number
}

type DbAdmin = ReturnType<typeof createAdminClient>

async function planificarRecalculo(
  db:          DbAdmin,
  client_id:   string,
  nomina_id:   string,
  empleado_id?: string,
): Promise<{ error?: string; estado?: EstadoNomina; lineas: RecalculoLineaNomina[]; total_otras: number }> {
  const vacio = { lineas: [] as RecalculoLineaNomina[], total_otras: 0 }

  // Planifica en CUALQUIER estado: previsualizar no escribe, y una CONFIRMADA sí
  // se puede actualizar reabriéndola. Quién puede ESCRIBIR lo decide cada acción.
  const { data: nomina, error: nErr } = await db.from('nominas')
    .select('estado, empresa_id, periodo, moneda, fecha')
    .eq('nomina_id', nomina_id)
    .eq('client_id', client_id)
    .maybeSingle()
  if (nErr)    return { ...vacio, error: nErr.message }
  if (!nomina) return { ...vacio, error: 'Nómina no encontrada.' }
  const estado = nomina.estado as EstadoNomina

  const { data: todas, error: lErr } = await db.from('nomina_lineas')
    .select('linea_id, empleado_id, empleado_nombre, salario_base, devengado, deducciones, neto')
    .eq('nomina_id', nomina_id)
    .eq('client_id', client_id)
    .order('empleado_nombre')
  if (lErr) return { ...vacio, estado, error: lErr.message }

  const filas = (todas ?? []) as {
    linea_id: string; empleado_id: string; empleado_nombre: string
    salario_base: number; devengado: number; deducciones: number; neto: number
  }[]

  // Datos del trabajador que solo necesita el modelo cubano (socio y días propios).
  const { data: fichas } = await db.from('empleados')
    .select('empleado_id, es_socio, dias_laborables')
    .eq('client_id', client_id)
    .in('empleado_id', Array.from(new Set(filas.map(f => f.empleado_id))))
  const fichaDe = new Map(
    ((fichas ?? []) as { empleado_id: string; es_socio: boolean; dias_laborables: number | null }[])
      .map(f => [f.empleado_id, f]))
  const enFoco   = empleado_id ? filas.filter(f => f.empleado_id === empleado_id) : filas
  const idsFoco  = new Set(enFoco.map(f => f.linea_id))
  // Las líneas fuera del foco no se tocan, pero sí suman en el total de la nómina.
  const total_otras = filas
    .filter(f => !idsFoco.has(f.linea_id))
    .reduce((s, f) => s + Number(f.neto), 0)

  if (!enFoco.length) {
    return { ...vacio, estado, total_otras, error: 'Ese trabajador no tiene línea en esta nómina.' }
  }

  const { data: cptData, error: cErr } = await db.from('conceptos_empleado')
    .select('concepto_id, empleado_id, nombre, tipo, modo, valor')
    .eq('client_id', client_id)
    .in('empleado_id', Array.from(new Set(enFoco.map(f => f.empleado_id))))
    .eq('activo', true)
    .order('created_at')
  if (cErr) return { ...vacio, estado, total_otras, error: cErr.message }

  const porEmpleado = new Map<string, ConceptoAplicable[]>()
  for (const c of (cptData ?? []) as ({ empleado_id: string } & ConceptoAplicable)[]) {
    const arr = porEmpleado.get(c.empleado_id) ?? []
    arr.push({ ...c, valor: Number(c.valor) })
    porEmpleado.set(c.empleado_id, arr)
  }

  // Lo escrito a mano en la línea (ítems PUNTUAL) SOBREVIVE al recálculo. Es lo que
  // el modelo viejo no podía hacer: como la línea guardaba un número sin desglose,
  // no había forma de distinguir un ajuste deliberado de un concepto sin aplicar, y
  // recalcular los borraba a los dos por igual.
  const [preservados, reglasDe, configs, incidencias] = await Promise.all([
    leerItemsPreservados(db, client_id, enFoco.map(f => f.linea_id)),
    leerReglas(db, client_id),
    leerConfigNomina(db, client_id),
    leerIncidencias(db, client_id, nomina.periodo as string),
  ])
  const reglasEmpresa = reglasDe(nomina.empresa_id as string)
  const config        = configDe(configs, nomina.empresa_id as string)
  // Los parámetros se resuelven por la FECHA DE LA NÓMINA, no por hoy: recalcular
  // una nómina de marzo tiene que usar la ley de marzo aunque estemos en julio.
  const aplicaCuba = config.modelo === 'MIPYME_CUBA' && nomina.moneda === MONEDA_CUBA
  const parametros = aplicaCuba ? await leerParametrosCuba(db, nomina.fecha as string) : []

  // Saldo para valorar el disfrute, EXCLUYENDO esta misma nómina: si está confirmada, su
  // propia contribución no debe contar al valorar el disfrute que ella misma paga.
  const detalleSaldos = aplicaCuba
    ? await saldosVacacionesDetalle(db, client_id, enFoco.map(f => f.empleado_id))
    : new Map<string, { apertura: SaldoVac; porNomina: Map<string, SaldoVac> }>()

  const lineas = enFoco.map(f => {
    const base  = redondear2(Number(f.salario_base))
    const ficha = fichaDe.get(f.empleado_id)
    const inc   = incidencias.get(f.empleado_id)
    const saldoVac = aplicaCuba ? saldoVacDe(detalleSaldos.get(f.empleado_id), nomina_id) : null
    // El recorte lo hace la fórmula compartida, pero aquí NO se queda en silencio:
    // `recortada` viaja a la previsualización para que el dueño vea que su
    // deducción no cabe entera antes de aplicar nada.
    const { devengado, deducciones, neto, recortada, items,
            vacaciones_acumuladas, vacaciones_pagadas,
            vacaciones_dias_acumuladas, vacaciones_dias_pagadas, subsidios,
            subsidios_maternidad } = componerLinea({
      salario_base: base,
      reglas:       reglasEmpresa,
      conceptos:    porEmpleado.get(f.empleado_id) ?? [],
      preservados:  preservados.get(f.linea_id) ?? [],
      periodo:      nomina.periodo as string,
      incidencia:   inc,
      cuba: aplicaCuba ? {
        parametros,
        dias_laborables: Number(ficha?.dias_laborables ?? config.dias_laborables_default),
        es_socio:        !!ficha?.es_socio,
        dias_trabajados: inc?.dias_trabajados ?? null,
        dias_vacaciones: inc?.dias_vacaciones ?? 0,
        dias_liquidacion: inc?.dias_liquidacion ?? 0,
        saldo_vac_importe: saldoVac!.importe,
        saldo_vac_dias:    saldoVac!.dias,
        vacaciones_importe_manual: inc?.vacaciones_importe_manual ?? null,
      } : undefined,
    })

    const devAntes = Number(f.devengado)
    const dedAntes = Number(f.deducciones)
    return {
      linea_id:            f.linea_id,
      empleado_id:         f.empleado_id,
      empleado_nombre:     f.empleado_nombre,
      salario_base:        base,
      devengado_antes:     devAntes,
      deducciones_antes:   dedAntes,
      neto_antes:          Number(f.neto),
      devengado_despues:   devengado,
      deducciones_despues: deducciones,
      neto_despues:        neto,
      items,
      vacaciones_acumuladas,
      vacaciones_pagadas,
      vacaciones_dias_acumuladas,
      vacaciones_dias_pagadas,
      subsidios,
      subsidios_maternidad,
      recortada,
      cambia: Math.abs(Number(f.salario_base) - base) > EPS
        || Math.abs(devAntes - devengado) > EPS || Math.abs(dedAntes - deducciones) > EPS,
    }
  })

  return { estado, lineas, total_otras }
}


// Escribe el plan en las líneas y recalcula el total. Lo comparten `recalcularNomina`
// (borrador) y `reabrirYActualizarNomina` (confirmada): una segunda copia de este
// bucle sería una segunda forma de que el total dejara de cuadrar con sus líneas.
async function aplicarRecalculo(
  db:          DbAdmin,
  client_id:   string,
  nomina_id:   string,
  empleado_id?: string,
): Promise<{ error?: string; actualizadas: number; total: number }> {
  const plan = await planificarRecalculo(db, client_id, nomina_id, empleado_id)
  if (plan.error) return { error: plan.error, actualizadas: 0, total: 0 }

  const cambian = plan.lineas.filter(l => l.cambia)
  for (const l of cambian) {
    const { error } = await db.from('nomina_lineas')
      .update({
        salario_base: l.salario_base,
        devengado:   l.devengado_despues,
        deducciones: l.deducciones_despues,
        neto:        l.neto_despues,
        vacaciones_acumuladas_periodo: l.vacaciones_acumuladas,
        vacaciones_pagadas_periodo:    l.vacaciones_pagadas,
        vacaciones_dias_acumulados_periodo: l.vacaciones_dias_acumuladas,
        vacaciones_dias_pagados_periodo:    l.vacaciones_dias_pagadas,
        subsidios:                     l.subsidios,
        subsidios_maternidad:          l.subsidios_maternidad,
      })
      .eq('linea_id', l.linea_id)
      .eq('client_id', client_id)
    if (error) return { error: error.message, actualizadas: 0, total: 0 }

    // Los ítems se REEMPLAZAN, salvo los PUNTUAL, que ya vienen dentro de
    // `l.items` con su `item_id` original: se borra todo lo recomponible y se
    // reinserta el resultado completo. Borrar por «distinto de PUNTUAL» y no por
    // línea entera es lo que impide que un ajuste hecho a mano se pierda aquí.
    const { error: delErr } = await db.from('nomina_linea_conceptos')
      .delete()
      .eq('linea_id', l.linea_id)
      .eq('client_id', client_id)
      .neq('origen', 'PUNTUAL')
    if (delErr) return { error: delErr.message, actualizadas: 0, total: 0 }

    const nuevos = l.items
      .filter(it => !esPreservable(it.origen))
      .map(it => filaItem(it, l.linea_id, nomina_id, client_id))
    if (nuevos.length) {
      const { error: insErr } = await db.from('nomina_linea_conceptos').insert(nuevos)
      if (insErr) return { error: insErr.message, actualizadas: 0, total: 0 }
    }

    // Un PUNTUAL puede haber quedado recortado por no caber en el devengado; si es
    // así, su importe en la base tiene que reflejarlo o el desglose no cuadraría.
    for (const it of l.items) {
      if (!esPreservable(it.origen) || !it.item_id) continue
      await db.from('nomina_linea_conceptos')
        .update({ monto: it.monto })
        .eq('item_id', it.item_id)
        .eq('client_id', client_id)
    }
  }

  // El total se relee de la base, no se toma del plan: entre previsualizar y
  // aplicar, otra pestaña puede haber tocado una línea fuera del foco.
  const { data: todas, error: tErr } = await db.from('nomina_lineas')
    .select('neto')
    .eq('nomina_id', nomina_id)
    .eq('client_id', client_id)
  if (tErr) return { error: tErr.message, actualizadas: 0, total: 0 }
  const total = redondear2((todas ?? []).reduce((s, l) => s + Number(l.neto), 0))
  await db.from('nominas')
    .update({ total, updated_at: new Date().toISOString() })
    .eq('nomina_id', nomina_id)
    .eq('client_id', client_id)

  return { actualizadas: cambian.length, total }
}

function revalidarNomina(empleado_id?: string) {
  revalidatePath('/portal/nomina')
  revalidatePath('/portal/rrhh')
  if (empleado_id) revalidatePath(`/portal/rrhh/${empleado_id}`)
}

export async function recalcularNomina(
  nomina_id:    string,
  empleado_id?: string,
): Promise<{ ok: boolean; error?: string; actualizadas?: number; total?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: nomina } = await db.from('nominas')
    .select('estado').eq('nomina_id', nomina_id).eq('client_id', session.client_id).maybeSingle()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }
  // Una confirmada ya posteó su gasto: se actualiza por `reabrirYActualizarNomina`,
  // que lo revierte primero. Aquí cambiaría las líneas dejando el gasto obsoleto.
  if (nomina.estado !== 'BORRADOR') {
    return { ok: false, error: 'La nómina está confirmada. Hay que reabrirla para actualizarla.' }
  }

  const res = await aplicarRecalculo(db, session.client_id, nomina_id, empleado_id)
  if (res.error) return { ok: false, error: res.error }

  revalidarNomina(empleado_id)
  return { ok: true, actualizadas: res.actualizadas, total: res.total }
}

// ── Reabrir una nómina CONFIRMADA y actualizarla de una vez ──────────────────────
// El caso real: la nómina del mes ya está cerrada y se recuerda una retención. Sin
// esto había que BORRAR la nómina entera y regenerarla.
//
// Reabrir = revertir los gastos que posteó al confirmar (Salarios + Retenciones) y
// volver a BORRADOR. No se ajusta el gasto en caliente a propósito: al reconfirmar
// se regenera de cero, así que es imposible dejarlo descuadrado con sus líneas.
//
// Se NIEGA si algún gasto tiene pagos en Tesorería: ahí ya hay dinero movido contra
// un importe concreto y cambiarlo por debajo rompe la conciliación (podrías haber
// pagado más de lo que el gasto acabaría diciendo que se debe).
//
// Deja la nómina en BORRADOR con los números puestos, SIN reconfirmar: si el
// recálculo saca algo raro —una deducción que no cabe en el devengado— el dueño
// tiene que verlo antes de que vuelva a contabilidad.
export async function reabrirYActualizarNomina(
  nomina_id:    string,
  empleado_id?: string,
): Promise<{ ok: boolean; error?: string; actualizadas?: number; total?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: nomina } = await db.from('nominas')
    .select('estado, gasto_id')
    .eq('nomina_id', nomina_id).eq('client_id', session.client_id).maybeSingle()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }
  if (nomina.estado !== 'CONFIRMADA') {
    // Ya es editable: el recálculo normal basta y no hay gasto que revertir.
    return recalcularNomina(nomina_id, empleado_id)
  }

  // Los dos gastos de la nómina: el de Salarios por `gasto_id`, el de Retenciones
  // por su origen (mig. 139).
  const { data: porOrigen } = await db.from('gastos_cobros')
    .select('registro_id')
    .eq('client_id', session.client_id)
    .eq('origen_tipo', 'NOMINA')
    .eq('origen_id', nomina_id)
  const gastoIds = Array.from(new Set([
    ...(nomina.gasto_id ? [nomina.gasto_id] : []),
    ...((porOrigen ?? []) as { registro_id: string }[]).map(g => g.registro_id),
  ]))

  if (gastoIds.length) {
    const { count } = await db.from('movimientos_tesoreria')
      .select('movimiento_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id)
      .in('referencia_id', gastoIds)
    if ((count ?? 0) > 0) {
      return { ok: false, error: 'Esta nómina ya tiene pagos registrados. Anúlalos en Tesorería y vuelve a intentarlo.' }
    }
    const { error: delErr } = await db.from('gastos_cobros').delete()
      .eq('client_id', session.client_id).in('registro_id', gastoIds)
    if (delErr) return { ok: false, error: delErr.message }
  }

  const { error: reErr } = await db.from('nominas')
    .update({ estado: 'BORRADOR', gasto_id: null, updated_at: new Date().toISOString() })
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  if (reErr) return { ok: false, error: reErr.message }

  const res = await aplicarRecalculo(db, session.client_id, nomina_id, empleado_id)
  if (res.error) {
    // La nómina ya está reabierta y sin gastos: es un estado válido (un borrador
    // sin tocar), así que se informa en vez de intentar deshacer a medias.
    revalidarNomina(empleado_id)
    revalidarFinanzas()
    return { ok: false, error: `La nómina se reabrió, pero no se pudo actualizar: ${res.error}` }
  }

  revalidarNomina(empleado_id)
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/tesoreria')
  revalidarFinanzas()
  return { ok: true, actualizadas: res.actualizadas, total: res.total }
}

// ── Confirmar nómina ────────────────────────────────────────────────────────────
//
// Escribe en `gastos_cobros`, en UNA operación, los DOS repartos del mismo dinero
// (mig. 166) —que no son el mismo número, y no por un detalle técnico sino porque el
// coste de las vacaciones se reconoce cuando se ACUMULAN y el pago sale cuando se
// DISFRUTAN—:
//
//   COSTE (`naturaleza='COSTE'`, va al estado de resultados, no genera deuda)
//     · Salario devengado − vacaciones disfrutadas   → categoría configurable
//     · Acumulación de vacaciones del mes            → categoría configurable
//     · UFT · SS 12,5 % · SS 1,5 %                   → una fila cada uno
//
//   DEUDA (`naturaleza='DEUDA'`, va a CxP/Tesorería, no cuenta como coste)
//     · Salario neto a pagar (incluye las vacaciones disfrutadas)
//     · Cada retención, en su propia fila y con su propio nombre
//
// Los TRES APORTES no se desdoblan: son coste y deuda por el mismo importe y con un
// acreedor real, igual que comprar mercancía a un proveedor, así que van con
// `naturaleza='AMBAS'` y una sola fila hace las dos funciones. Solo el bloque salarial
// se parte, y no por diseño sino porque sus dos importes son distintos.
//
// Las RETENCIONES son deuda SIN coste, y el motivo importa: su coste ya está dentro
// del salario devengado. Llevarlas también a Gastos duplicaría el coste de personal —
// el agujero de la mig. 139, por la puerta contraria.
//
// Invariantes que valida el guardia de abajo:
//   COSTE = (devengado − vac. disfrutadas) + acumulación + aportes
//   DEUDA = neto + retenciones a terceros + aportes
//   COSTE − DEUDA = acumulación − vac. disfrutadas
//
// `nominas.gasto_id` apunta a la CxP del **salario neto**: es la que gobierna el estado
// «Pagada», que se DERIVA de si está liquidada y no se guarda en ninguna parte.

export async function confirmarNomina(nomina_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { data: nomina } = await db.from('nominas')
    .select('*')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
    .single()
  if (!nomina)                       return { ok: false, error: 'Nómina no encontrada.' }
  if (nomina.estado !== 'BORRADOR')  return { ok: false, error: 'La nómina ya está confirmada.' }

  const { data: lineas } = await db.from('nomina_lineas')
    .select('devengado, deducciones, neto, subsidios, subsidios_maternidad, vacaciones_acumuladas_periodo, vacaciones_pagadas_periodo')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  const filas = (lineas ?? []) as {
    devengado: number; deducciones: number; neto: number
    subsidios: number; subsidios_maternidad: number | null
    vacaciones_acumuladas_periodo: number | null; vacaciones_pagadas_periodo: number | null
  }[]
  // Las columnas de vacaciones son nullables en el histórico, así que el extractor
  // devuelve `number | null` y el `?? 0` va DENTRO del reduce, no en cada llamada.
  const suma = (f: (l: typeof filas[number]) => number | null) =>
    redondear2(filas.reduce((s, l) => s + Number(f(l) ?? 0), 0))
  const devengado   = suma(l => l.devengado)
  const retenido    = suma(l => l.deducciones)
  const total       = suma(l => l.neto)
  const subsidios   = suma(l => l.subsidios)
  // El subsidio tiene dos caras (mig. 212): la de MATERNIDAD la reembolsa el Estado
  // (cuenta por cobrar, mig. 144); la de ENFERMEDAD sale del fondo del 1,5 % —dinero
  // que la empresa paga y no recupera de nadie, cuyo coste ya se reconoció al acumular
  // el 1,5 %—. Se reparte aquí para postear cada cara donde le toca.
  const subsMaternidad = suma(l => l.subsidios_maternidad)
  const subsEnfermedad = redondear2(subsidios - subsMaternidad)
  // Las dos piezas que separan el coste de la deuda (mig. 166): lo que se acumula este
  // mes es coste sin pago, y lo que se disfruta es pago cuyo coste ya se reconoció.
  const vacAcumuladas = suma(l => l.vacaciones_acumuladas_periodo)
  const vacPagadas    = suma(l => l.vacaciones_pagadas_periodo)
  // El guardia mira el DEVENGADO, no el neto: una nómina en la que se retuvo todo
  // tiene coste (y una deuda con la agencia tributaria) aunque no salga efectivo
  // hacia el trabajador — con el neto, esa nómina no se podía confirmar.
  if (devengado <= EPS) return { ok: false, error: 'La nómina no tiene importe que registrar.' }

  // ── Reparto por acreedor, CALCULADO desde los ítems (mig. 140) ────────────────
  // Hasta ahora se ASUMÍA que toda deducción es un impuesto que se le debe a la
  // agencia tributaria. Con el desglose ya no hace falta suponerlo: cada retención
  // dice a quién va. Lo que NO va a un tercero (un anticipo que la empresa ya
  // adelantó) no genera deuda con nadie y por tanto se queda dentro del gasto de
  // Salarios — si se restara del coste, volvería el agujero que cerró la mig. 139.
  const { data: itemsNom } = await db.from('nomina_linea_conceptos')
    .select('tipo, monto, destino, origen, origen_id, nombre, concepto_clave')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  const itemsFilas = ((itemsNom ?? []) as {
    tipo: TipoItemLinea; monto: number; destino: DestinoItemLinea | null
    origen: OrigenItemLinea; origen_id: string | null; nombre: string
    concepto_clave: ConceptoClave | null
  }[]).map(i => ({
    // La clave manda; el nombre solo se consulta en lo escrito antes de la mig. 165
    // que el backfill no alcanzara. Es la red de seguridad, no el camino normal.
    ...i, clave: i.concepto_clave ?? claveDeNombre(i.nombre),
  }))

  // ── Guardia de provisionalidad ────────────────────────────────────────────────
  // Mientras un tributo esté sembrado con un tipo de RELLENO, confirmar crearía una
  // deuda real con ONAT y con la Seguridad Social por un importe inventado. Ver el
  // borrador y trabajar con él, sí; postearlo a contabilidad, no.
  const idsLey = Array.from(new Set(
    itemsFilas.filter(i => i.origen === 'LEY' && i.origen_id).map(i => i.origen_id as string)))
  if (idsLey.length) {
    const { data: usados } = await db.from('parametros_fiscales_cuba')
      .select('concepto, provisional')
      .in('parametro_id', idsLey)
    const flojos = ((usados ?? []) as { concepto: string; provisional: boolean }[])
      .filter(p => p.provisional).map(p => p.concepto)
    if (flojos.length) {
      return {
        ok: false,
        error: `Esta nómina usa tipos impositivos aún sin verificar (${flojos.join(', ')}), así que no se puede registrar en contabilidad: crearía una deuda con ONAT por un importe provisional. Puedes seguir trabajando el borrador; en cuanto se carguen los tipos reales, se confirma sin tocar nada más.`,
      }
    }
  }

  const retencionesTodas = redondear2(itemsFilas
    .filter(i => i.tipo === 'RETENCION')
    .reduce((s, i) => s + Number(i.monto), 0))

  // Red de seguridad: si el desglose no reproduce lo que dice la línea, no se postea
  // NADA. Confirmar es lo único irreversible de este flujo (crea deuda en Cuentas por
  // pagar), así que ante un descuadre es preferible negarse a registrar un importe
  // que nadie podría explicar después.
  if (Math.abs(retencionesTodas - retenido) > EPS) {
    return {
      ok: false,
      error: 'El desglose de esta nómina no cuadra con sus totales. Actualízala antes de confirmarla.',
    }
  }

  // Una retención que la empresa YA adelantó (`destino='EMPRESA'`, un anticipo) reduce
  // el neto pero no se le debe a nadie: no genera CxP. El modelo lo distingue desde la
  // mig. 140 y hay que seguir distinguiéndolo, no volver a asumir que toda retención
  // tiene un acreedor detrás.
  const retencionesTerceros = itemsFilas
    .filter(i => i.tipo === 'RETENCION' && i.destino === 'TERCERO_FISCAL' && Number(i.monto) > EPS)
  const retenidoTercero = redondear2(
    retencionesTerceros.reduce((s, i) => s + Number(i.monto), 0))

  // Lo que paga la EMPRESA por encima del bruto (mig. 142): coste Y deuda por el mismo
  // importe, así que una sola fila hace las dos funciones. Por CLAVE, nunca por nombre
  // (mig. 165): comparando el texto visible, renombrar un tributo dejaba estos importes
  // a cero y la deuda con ONAT fuera de los libros, sin que nada fallara.
  const aportePorClave = (clave: ConceptoFiscal) => redondear2(itemsFilas
    .filter(i => i.tipo === 'APORTE_EMPRESA' && i.clave === clave)
    .reduce((s, i) => s + Number(i.monto), 0))

  // ── Los dos repartos ─────────────────────────────────────────────────────────
  const costeSalario = redondear2(devengado - vacPagadas)
  const mapeo        = await resolverMapeoCoste(db, session.client_id, nomina.empresa_id as string)
  const vencimiento  = vencimientoNomina(
    nomina.periodo as string,
    configDe(await leerConfigNomina(db, session.client_id), nomina.empresa_id as string).dia_pago)

  const base = {
    client_id:   session.client_id,
    empresa_id:  nomina.empresa_id,
    tipo:        'GASTO',
    fecha:       nomina.fecha,
    moneda:      nomina.moneda,
    origen_tipo: 'NOMINA',
    origen_id:   nomina_id,
    updated_at:  new Date().toISOString(),
  }
  const aInsertar: Record<string, unknown>[] = []

  /** Fila de COSTE: va al estado de resultados y no genera deuda con nadie. */
  const filaCoste = (concepto: ConceptoCoste, monto: number, etiqueta: string, nota: string) => {
    if (monto <= EPS) return
    const cat = mapeo.get(concepto)
    aInsertar.push({
      ...base,
      registro_id:  generarGastoId(),
      naturaleza:   'COSTE',
      categoria:    cat?.nombre ?? NOMBRE_CONCEPTO_COSTE[concepto],
      categoria_id: cat?.categoria_id ?? null,
      descripcion:  `${etiqueta} ${nomina.periodo}`,
      monto,
      notas:        `Nómina ${nomina_id} · ${nota}`,
    })
  }

  /**
   * Fila de DEUDA: se paga desde Tesorería y NO cuenta como coste. Sin `categoria_id`
   * a propósito —no es una línea del P&L— y con `vencimiento`, que es lo que la mete
   * en el aging de CxP.
   */
  const filaDeuda = (monto: number, etiqueta: string, nota: string): string | null => {
    if (monto <= EPS) return null
    const id = generarGastoId()
    aInsertar.push({
      ...base,
      registro_id:  id,
      naturaleza:   'DEUDA',
      categoria:    etiqueta,
      categoria_id: null,
      descripcion:  `${etiqueta} ${nomina.periodo}`,
      monto,
      vencimiento,
      notas:        `Nómina ${nomina_id} · ${nota}`,
    })
    return id
  }

  // COSTE. El salario excluye las vacaciones disfrutadas porque su coste ya se
  // reconoció el mes en que se acumularon; contarlas otra vez las duplicaría.
  filaCoste('SALARIO', costeSalario, 'Nómina',
    'salario devengado del período, sin las vacaciones disfrutadas')
  filaCoste('VACACIONES', vacAcumuladas, 'Vacaciones acumuladas',
    'provisión del período; se paga cuando se disfruten')
  // IUFT y 12,5 % en filas SEPARADAS aunque el mapeo los mande a la misma categoría:
  // agrupar en el informe es reversible, fusionar las filas destruiría la separación de
  // la deuda — y cada uno se liquida ante un organismo distinto. Van AMBAS: son coste
  // Y deuda por el mismo importe, con un acreedor real (el Estado).
  for (const clave of ['IUFT', 'SS_EMPRESA_125'] as const) {
    const monto = aportePorClave(clave)
    if (monto <= EPS) continue
    const cat = mapeo.get(clave)
    aInsertar.push({
      ...base,
      registro_id:  generarGastoId(),
      naturaleza:   'AMBAS',
      categoria:    cat?.nombre ?? NOMBRE_CONCEPTO[clave],
      categoria_id: cat?.categoria_id ?? null,
      descripcion:  `${NOMBRE_CONCEPTO[clave]} ${nomina.periodo}`,
      monto,
      vencimiento,
      notas:        `Nómina ${nomina_id} · a cargo de la empresa`,
    })
  }
  // El 1,5 % NO es un impuesto que se ingrese al Estado (mig. 212): es una PROVISIÓN.
  // Va como COSTE puro —como la acumulación de vacaciones—, sin generar deuda con
  // nadie. De ese fondo salen los subsidios por enfermedad cuando se pagan.
  filaCoste('SS_EMPRESA_15', aportePorClave('SS_EMPRESA_15'), NOMBRE_CONCEPTO.SS_EMPRESA_15,
    'provisión del 1,5 %; fondo para subsidios por enfermedad')

  // DEUDA. El salario neto incluye las vacaciones disfrutadas: es dinero que el
  // trabajador cobra ahora, aunque su coste sea de otro mes.
  const gasto_id = filaDeuda(redondear2(devengado - retenidoTercero), 'Salario neto a pagar',
    'a pagar a la plantilla')
  // Cada retención en SU fila y con SU nombre: el objetivo es que en el desplegable de
  // Tesorería cada línea se identifique y se concilie por sí misma, no que se agrupen
  // por a quién se le paga (varias van al mismo organismo y aun así van separadas).
  for (const r of retencionesTerceros) {
    filaDeuda(redondear2(Number(r.monto)), r.nombre, 'retenido del salario, a ingresar')
  }

  // ── Subsidio por ENFERMEDAD: sale del fondo del 1,5 % (mig. 212) ─────────────
  // Es dinero que el trabajador cobra ahora (va en su neto) pero que la empresa NO
  // recupera de nadie: su coste ya se reconoció al acumular el 1,5 %. Por eso es DEUDA
  // pura —cash que sale, sin coste nuevo y sin cuenta por cobrar—, como una retención
  // por el signo contrario. Va en su propia fila, identificable en Tesorería, y así el
  // fondo se puede auditar (acumulado del 1,5 % − pagos por enfermedad). El fondo puede
  // quedar negativo: la empresa asume el diferencial y lo compensa a futuro (Claudia).
  filaDeuda(subsEnfermedad, 'Subsidio por enfermedad',
    'pagado al trabajador, con cargo al fondo del 1,5 %')

  // ── Subsidio por MATERNIDAD: lo reembolsa el ESTADO, es un ACTIVO (mig. 144) ──
  // La empresa se lo adelanta al trabajador —va dentro de su neto— y luego se lo
  // cobra a la Seguridad Social. Meterlo en el gasto de Salarios inflaría el coste
  // de personal del estado de resultados por un dinero que la empresa recupera; por
  // eso el gasto de Salarios se calcula sobre el DEVENGADO (que no lo incluye) y el
  // subsidio va en su propia fila de COBRO pendiente, liquidable en Tesorería el día
  // que llegue el reembolso.
  //
  // Va SIN `categoria_id` porque no es una línea del P&L sino un saldo por cobrar.
  //
  // OJO — eso NO es lo que lo mantiene fuera del estado de resultados, y creerlo fue un
  // error real: la categoría solo se consulta en las filas de tipo GASTO (para su
  // `rol_pl`); un COBRO entraba en ingresos por su importe, con categoría o sin ella.
  // Desde la mig. 166 lo que lo mantiene fuera es su `naturaleza='DEUDA'`, y con eso el
  // subsidio deja de ser una excepción escrita a mano —una lista de orígenes que todo
  // consumidor nuevo tenía que recordar— y pasa a ser el primer caso normal de la regla
  // general que aplican `computaEnResultados`/`generaSaldo`.
  if (subsMaternidad > EPS) {
    aInsertar.push({
      ...base,
      tipo:         'COBRO',
      registro_id:  generarGastoId(),
      naturaleza:   'DEUDA',
      categoria:    'Subsidios por cobrar',
      categoria_id: null,
      descripcion:  `Subsidios de maternidad ${nomina.periodo}`,
      monto:        subsMaternidad,
      notas:        `Nómina ${nomina_id} · maternidad adelantada a la plantilla, a recuperar de la Seguridad Social`,
    })
  }

  // ── Guardia de las invariantes del reparto (mig. 166) ────────────────────────
  // Confirmar es lo único irreversible de este flujo, y ahora escribe DOS repartos del
  // mismo dinero. Si alguno no cuadra con lo que dicen las líneas, no se postea NADA:
  // un descuadre aquí sale como coste de personal duplicado o como una deuda que no se
  // corresponde con ningún salario, y las dos cosas se descubren semanas después.
  const sumaPor = (n: string) => redondear2(aInsertar
    .filter(g => g.tipo === 'GASTO' && (g.naturaleza === n || g.naturaleza === 'AMBAS'))
    .reduce((s, g) => s + Number(g.monto), 0))
  // COSTE lleva los tres aportes: los tres son coste de personal (el 1,5 % como
  // provisión, mig. 212). La DEUDA solo lleva los DOS que se le pagan al Estado —el
  // 1,5 % ya no genera deuda— más el subsidio por enfermedad, que es cash sin coste.
  const totalAportes  = redondear2(
    aportePorClave('IUFT') + aportePorClave('SS_EMPRESA_125') + aportePorClave('SS_EMPRESA_15'))
  const aportesDeuda  = redondear2(aportePorClave('IUFT') + aportePorClave('SS_EMPRESA_125'))
  const costeEsperado = redondear2(devengado - vacPagadas + vacAcumuladas + totalAportes)
  const deudaEsperada = redondear2(devengado - retenidoTercero + retenidoTercero + subsEnfermedad + aportesDeuda)
  if (Math.abs(sumaPor('COSTE') - costeEsperado) > EPS
      || Math.abs(sumaPor('DEUDA') - deudaEsperada) > EPS) {
    return {
      ok: false,
      error: 'El reparto de esta nómina entre coste y deuda no cuadra con sus totales. No se ha registrado nada; avisa al soporte de CLAUX.',
    }
  }

  // El `concepto` (mig. 152) es la etiqueta que cada fila ya lleva: «Nómina 2026-03»,
  // «Retenciones nómina 2026-03»… Se rellena aquí, en el insert, y no fila a fila, para
  // que añadir un quinto acreedor mañana no se olvide de la columna. Sin esto, las cinco
  // filas de cada nómina saldrían en la columna nueva con la etiqueta de su categoría y
  // dos «Salarios» del mismo mes volverían a ser indistinguibles — exactamente el
  // problema que la columna viene a arreglar.
  const { error: gErr } = await db.from('gastos_cobros')
    .insert(aInsertar.map(g => ({ ...g, concepto: g.descripcion })))
  if (gErr) return { ok: false, error: gErr.message }

  // `gasto_id` apunta a la CxP del **salario neto** (mig. 166), no al gasto de coste:
  // es la deuda con la plantilla, la única que se liquida en Tesorería a nombre de la
  // nómina, y de ella se DERIVA el estado «Pagada». Apuntar al coste dejaría «Pagada»
  // mirando una fila que nadie liquida nunca, así que jamás lo estaría. El resto de las
  // filas se resuelven por `origen_tipo`+`origen_id`, como ya hace `eliminarNomina`.
  const { error: nErr } = await db.from('nominas')
    .update({ estado: 'CONFIRMADA', gasto_id, total, updated_at: new Date().toISOString() })
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  if (nErr) {
    await db.from('gastos_cobros').delete()
      .eq('client_id', session.client_id)
      .in('registro_id', aInsertar.map(g => g.registro_id as string))
    return { ok: false, error: nErr.message }
  }

  // Un concepto PUNTUAL se aplica UNA vez: al cerrarse la nómina de su período, se
  // desactiva solo. Si no, volvería el mes siguiente, que es justo lo contrario de
  // lo que el dueño pidió al marcarlo como puntual. Va después de confirmar y no
  // puede tumbarla: la nómina ya está registrada y su desglose es una foto.
  await db.from('conceptos_empleado')
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id)
    .eq('recurrencia', 'PUNTUAL')
    .eq('periodo_aplicable', nomina.periodo)
    .eq('activo', true)

  revalidatePath('/portal/rrhh')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/tesoreria')
  revalidarFinanzas()
  return { ok: true }
}

// ── Eliminar nómina ──────────────────────────────────────────────────────────────
// Si está confirmada, solo si NINGUNO de sus gastos tiene pagos en Tesorería.

export async function eliminarNomina(nomina_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { data: nomina } = await db.from('nominas')
    .select('estado, gasto_id')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
    .single()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }

  if (nomina.estado === 'CONFIRMADA') {
    // Confirmar escribe DOS gastos (mig. 139): Salarios y Retenciones. El de
    // Salarios se localiza por `gasto_id`; el de retenciones por su origen —
    // borrar solo el primero dejaba la deuda con la agencia tributaria viva y
    // huérfana, sin nómina que la explicara.
    const { data: porOrigen } = await db.from('gastos_cobros')
      .select('registro_id')
      .eq('client_id', session.client_id)
      .eq('origen_tipo', 'NOMINA')
      .eq('origen_id', nomina_id)
    const gastoIds = Array.from(new Set([
      ...(nomina.gasto_id ? [nomina.gasto_id] : []),
      ...((porOrigen ?? []) as { registro_id: string }[]).map(g => g.registro_id),
    ]))

    if (gastoIds.length) {
      const { count } = await db.from('movimientos_tesoreria')
        .select('movimiento_id', { count: 'exact', head: true })
        .eq('client_id', session.client_id)
        .in('referencia_id', gastoIds)
      if ((count ?? 0) > 0) {
        // Configurador (modo configuración): se lleva también los pagos. El usuario
        // normal debe anularlos en Tesorería antes.
        if (!session.imp) return { ok: false, error: 'Los gastos de esta nómina tienen pagos registrados. Anúlalos en Tesorería antes de eliminar.' }
        await db.from('movimientos_tesoreria').delete()
          .eq('client_id', session.client_id).in('referencia_id', gastoIds)
      }
      await db.from('gastos_cobros').delete()
        .eq('client_id', session.client_id).in('registro_id', gastoIds)
    }
  }

  await db.from('nomina_lineas').delete().eq('nomina_id', nomina_id).eq('client_id', session.client_id)
  const { error } = await db.from('nominas').delete()
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  return { ok: true }
}

// ── Nóminas en lote (Fase 2) ─────────────────────────────────────────────────────
// Candado `rrhh` inline. Confirmar es SECUENCIAL (cada una postea su gasto de
// Salarios). Reutilizan las individuales; la elegibilidad filtra por estado.

export async function confirmarNominasEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()
  const { data: noms } = await db.from('nominas')
    .select('nomina_id, periodo, estado').eq('client_id', session.client_id).in('nomina_id', ids)

  const res = loteVacio()
  for (const n of (noms ?? []) as { nomina_id: string; periodo: string; estado: string }[]) {
    if (n.estado !== 'BORRADOR') { res.omitidas.push({ etiqueta: n.periodo, motivo: 'ya confirmada' }); continue }
    const r = await confirmarNomina(n.nomina_id)   // secuencial: postea gasto de Salarios
    if (r.ok) res.hechas++
    else res.errores.push({ etiqueta: n.periodo, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/rrhh')
  revalidarFinanzas()
  return res
}

export async function eliminarNominasEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()
  const { data: noms } = await db.from('nominas')
    .select('nomina_id, periodo').eq('client_id', session.client_id).in('nomina_id', ids)
  const periodoDe = new Map((noms ?? []).map((n: { nomina_id: string; periodo: string }) => [n.nomina_id, n.periodo]))

  const res = loteVacio()
  for (const id of ids) {
    if (!periodoDe.has(id)) continue
    const r = await eliminarNomina(id)   // conserva la guarda (pagos en tesorería)
    if (r.ok) res.hechas++
    else res.omitidas.push({ etiqueta: periodoDe.get(id) ?? id, motivo: r.error ?? 'No se pudo eliminar' })
  }
  revalidatePath('/portal/rrhh')
  revalidarFinanzas()
  return res
}

// ════════════════════════════════════════════════════════════════════════════════
// TURNOS (catálogo + planificador semanal)
// ════════════════════════════════════════════════════════════════════════════════

// ── Guardar turno (crear / editar catálogo) ─────────────────────────────────────

export async function guardarTurno(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const turno_id    = (formData.get('turno_id')    as string)?.trim()
  const empresa_id  = (formData.get('empresa_id')  as string)?.trim()
  const nombre      = (formData.get('nombre')      as string)?.trim()
  const color       = (formData.get('color')       as string)?.trim() || null
  // Un turno de DESCANSO no tiene horario: guardarle uno y no contarlo sería un dato
  // que dice una cosa y hace otra.
  const es_descanso = formData.getAll('es_descanso').includes('1')
  const hora_inicio = es_descanso ? null : ((formData.get('hora_inicio') as string)?.trim() || null)
  const hora_fin    = es_descanso ? null : ((formData.get('hora_fin')    as string)?.trim() || null)

  if (!nombre)     return { ok: false, error: 'El nombre del turno es obligatorio.' }
  if (!empresa_id) return { ok: false, error: 'Debes seleccionar una empresa.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  const db = createAdminClient()

  if (!turno_id) {
    const { error } = await db.from('turnos').insert({
      turno_id: generarTurnoId(),
      client_id: session.client_id,
      empresa_id, nombre, hora_inicio, hora_fin, color, es_descanso,
      activo: true,
      updated_at: new Date().toISOString(),
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('turnos')
      .update({ nombre, hora_inicio, hora_fin, color, es_descanso, updated_at: new Date().toISOString() })
      .eq('turno_id', turno_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/turnos')
  return { ok: true }
}

/**
 * Activa o desactiva un turno del catálogo.
 *
 * `turnos.activo` existía desde el principio y la UI **nunca lo ponía a `false`**: la
 * única salida era eliminar, que se lleva por delante todas las asignaciones. Un turno
 * que ya no se usa pero que sigue en la historia del cuadrante no es un turno que haya
 * que borrar. Mismo patrón que `alternarConceptoEmpleado`.
 */
export async function alternarTurno(
  turno_id: string, activo: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db.from('turnos')
    .update({ activo, updated_at: new Date().toISOString() })
    .eq('turno_id', turno_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/turnos')
  return { ok: true }
}

// ── Eliminar turno (borra también sus asignaciones) ─────────────────────────────

export async function eliminarTurno(turno_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  // Los slots de rotación que usaban esta franja pasan a descanso (turno_id null) en vez
  // de quedar apuntando a una franja que ya no existe.
  await db.from('turno_patron_slots').update({ turno_id: null })
    .eq('client_id', session.client_id).eq('turno_id', turno_id)
  const { error } = await db.from('turnos').delete()
    .eq('turno_id', turno_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/turnos')
  return { ok: true }
}

// ── Patrones de rotación (mig. 182) ──────────────────────────────────────────────

const LONGITUD_POR_TIPO: Record<TipoPatron, number | null> = {
  SEMANAL: 7, QUINCENAL: 14, MENSUAL: 28, CICLO: null,  // CICLO: la longitud la fija N+M
}

/** Una posición del ciclo con su franja (`turno_id` vacío = descanso). */
export interface SlotPatron { posicion: number; turno_id: string | null }

/**
 * Crea o edita un patrón de rotación **con sus slots** en una sola llamada. Los slots se
 * reemplazan enteros (borrar + reinsertar): la secuencia de un ciclo se edita como un
 * bloque, igual que la rejilla se guardaba de una vez.
 *
 * Valida que todas las franjas de los slots sean de la **misma empresa** que el patrón:
 * sin esto se podía meter una franja de la empresa A en un patrón de la B, y la vista
 * —que filtra por empresa— ni lo enseñaría.
 */
export async function guardarPatron(
  fd: FormData,
): Promise<{ ok: boolean; error?: string; patron_id?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const patron_id  = (fd.get('patron_id')  as string)?.trim() || ''
  const empresa_id = (fd.get('empresa_id') as string)?.trim() || ''
  const nombre     = (fd.get('nombre')     as string)?.trim() || ''
  const tipo       = (fd.get('tipo')       as string)?.trim() as TipoPatron
  const fecha_ancla = (fd.get('fecha_ancla') as string)?.trim() || ''

  if (!empresa_id) return { ok: false, error: 'Falta la empresa del patrón.' }
  if (!nombre)     return { ok: false, error: 'El nombre del patrón es obligatorio.' }
  if (!(tipo in LONGITUD_POR_TIPO)) return { ok: false, error: 'Tipo de rotación no válido.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_ancla)) return { ok: false, error: 'La fecha de inicio del ciclo no es válida.' }

  // Longitud: la fija el tipo, salvo CICLO, que la trae del formulario (N+M).
  const longitud_dias = LONGITUD_POR_TIPO[tipo] ?? Number((fd.get('longitud_dias') as string) ?? '')
  if (!Number.isInteger(longitud_dias) || longitud_dias < 1 || longitud_dias > 366) {
    return { ok: false, error: 'La longitud del ciclo debe estar entre 1 y 366 días.' }
  }

  // Slots: JSON [{ posicion, turno_id }]. Se validan aquí, no se confía en la UI.
  let slots: SlotPatron[]
  try {
    slots = JSON.parse((fd.get('slots') as string) ?? '[]') as SlotPatron[]
  } catch { return { ok: false, error: 'Secuencia del ciclo no válida.' } }
  if (!Array.isArray(slots)) return { ok: false, error: 'Secuencia del ciclo no válida.' }
  for (const s of slots) {
    if (!Number.isInteger(s.posicion) || s.posicion < 0 || s.posicion >= longitud_dias) {
      return { ok: false, error: 'La secuencia tiene un día fuera del ciclo.' }
    }
  }

  const db = createAdminClient()

  // La empresa del patrón es del cliente; y las franjas usadas, de esa empresa.
  const { data: emp } = await db.from('empresas').select('empresa_id')
    .eq('empresa_id', empresa_id).eq('client_id', session.client_id).maybeSingle()
  if (!emp) return { ok: false, error: 'Empresa no encontrada.' }

  const turnoIds = Array.from(new Set(slots.map(s => s.turno_id).filter(Boolean))) as string[]
  if (turnoIds.length) {
    const { data: fr } = await db.from('turnos').select('turno_id, empresa_id')
      .eq('client_id', session.client_id).in('turno_id', turnoIds)
    const ajenas = (fr ?? []).filter(t => t.empresa_id !== empresa_id)
    if (ajenas.length || (fr ?? []).length !== turnoIds.length) {
      return { ok: false, error: 'Alguna franja de la secuencia no es de esta empresa.' }
    }
  }

  const id = patron_id || generarPatronId()
  if (!patron_id) {
    const { error } = await db.from('turno_patrones').insert({
      patron_id: id, client_id: session.client_id, empresa_id, nombre, tipo,
      longitud_dias, fecha_ancla, activo: true,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('turno_patrones')
      .update({ nombre, tipo, longitud_dias, fecha_ancla, updated_at: new Date().toISOString() })
      .eq('patron_id', id).eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  // Reemplazo de slots: fuera los viejos, dentro los nuevos con franja.
  await db.from('turno_patron_slots').delete().eq('client_id', session.client_id).eq('patron_id', id)
  const altas = slots.map(s => ({
    slot_id: generarSlotId(), client_id: session.client_id, patron_id: id,
    posicion: s.posicion, turno_id: s.turno_id || null,
  }))
  if (altas.length) {
    const { error } = await db.from('turno_patron_slots').insert(altas)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/turnos')
  return { ok: true, patron_id: id }
}

/** Activa/desactiva un patrón sin borrarlo (deja de contar para el cuadrante y la nómina). */
export async function alternarPatron(
  patron_id: string, activo: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db.from('turno_patrones')
    .update({ activo, updated_at: new Date().toISOString() })
    .eq('patron_id', patron_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/turnos')
  return { ok: true }
}

/** Borra un patrón con sus slots y su roster. */
export async function eliminarPatron(patron_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  await db.from('turno_miembros').delete().eq('client_id', session.client_id).eq('patron_id', patron_id)
  await db.from('turno_patron_slots').delete().eq('client_id', session.client_id).eq('patron_id', patron_id)
  const { error } = await db.from('turno_patrones').delete()
    .eq('patron_id', patron_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/turnos')
  return { ok: true }
}

/** Un miembro del roster de un patrón. */
export interface MiembroRoster { empleado_id: string; offset_ciclo: number }

/**
 * Reemplaza el roster de un patrón en una sola llamada (borrar + reinsertar por patrón).
 * Valida que el patrón y todos los empleados sean de la **misma empresa** (la comprobación
 * de pertenencia de siempre).
 */
export async function guardarRoster(
  patron_id: string, miembros: MiembroRoster[],
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!patron_id) return { ok: false, error: 'Patrón no válido.' }

  const db = createAdminClient()
  const { data: patron } = await db.from('turno_patrones').select('patron_id, empresa_id')
    .eq('patron_id', patron_id).eq('client_id', session.client_id).maybeSingle()
  if (!patron) return { ok: false, error: 'Patrón no encontrado.' }

  const empIds = Array.from(new Set(miembros.map(m => m.empleado_id).filter(Boolean)))
  if (empIds.length) {
    const { data: emps } = await db.from('empleados').select('empleado_id, empresa_id')
      .eq('client_id', session.client_id).in('empleado_id', empIds)
    const mapa = new Map((emps ?? []).map(e => [e.empleado_id as string, e.empresa_id as string]))
    for (const id of empIds) {
      const empresaEmp = mapa.get(id)
      if (!empresaEmp) return { ok: false, error: 'Trabajador no encontrado.' }
      if (empresaEmp !== patron.empresa_id) {
        return { ok: false, error: 'Ese trabajador es de otra empresa: no entra en este patrón.' }
      }
    }
  }

  await db.from('turno_miembros').delete().eq('client_id', session.client_id).eq('patron_id', patron_id)
  const altas = miembros.filter(m => m.empleado_id).map(m => ({
    miembro_id: generarMiembroId(), client_id: session.client_id, patron_id,
    empleado_id: m.empleado_id, offset_ciclo: Number.isInteger(m.offset_ciclo) ? m.offset_ciclo : 0,
  }))
  if (altas.length) {
    const { error } = await db.from('turno_miembros').insert(altas)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/turnos')
  return { ok: true }
}

// La rejilla semanal (`turno_asignaciones` + `guardarAsignaciones`) se retiró con el
// modelo de rotación (migs. 182-183). Su sustituto es `guardarPatron` + `guardarRoster`.

// ── Turno UNIFICADO (fusión franja + patrón + roster en un solo objeto) ───────────
//
// A partir de aquí un «turno» es UNA sola cosa para el dueño: un horario con color, los
// días que se trabaja y quién lo cubre. Por debajo sigue siendo lo de la mig. 182 —una
// franja (`turnos`), un patrón (`turno_patrones` + `slots`) y su roster (`turno_miembros`)—
// para que el puente de nómina (`dias-trabajados.ts`) lea EXACTAMENTE lo mismo y no se
// toque. La fusión es de interfaz: un turno posee UNA banda horaria; «mezclar mañana unos
// días y tarde otros» se hace con dos turnos que comparten a la persona (la nómina une sus
// días sin duplicar). Las franjas/patrones sueltos del formato anterior siguen leyéndose
// en el cuadrante; al editarlos aquí quedan con una sola banda.

/** Un turno unificado a guardar: la banda, la frecuencia y quién lo trabaja. */
export interface MiembroTurno { empleado_id: string; offset_ciclo: number }

/**
 * Crea o edita un turno completo en una sola llamada: su banda horaria (franja), su
 * frecuencia (patrón + slots) y su equipo (roster). Reemplaza a la pareja `guardarTurno`
 * + `guardarPatron` + `guardarRoster` desde la UI fusionada; las tres siguen existiendo
 * para el formato anterior y para código que las use.
 */
export async function guardarTurnoUnificado(
  fd: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const patron_id  = (fd.get('patron_id')  as string)?.trim() || ''
  const franja_id  = (fd.get('franja_id')  as string)?.trim() || ''   // banda existente al editar
  const empresa_id = (fd.get('empresa_id') as string)?.trim() || ''
  const nombre     = (fd.get('nombre')     as string)?.trim() || ''
  const color      = (fd.get('color')      as string)?.trim() || null
  const hora_inicio = (fd.get('hora_inicio') as string)?.trim() || null
  const hora_fin    = (fd.get('hora_fin')    as string)?.trim() || null
  const tipo        = (fd.get('tipo')        as string)?.trim() as TipoPatron
  const fecha_ancla = (fd.get('fecha_ancla') as string)?.trim() || ''

  if (!nombre)     return { ok: false, error: 'El nombre del turno es obligatorio.' }
  if (!empresa_id) return { ok: false, error: 'Debes seleccionar una empresa.' }
  if (!(tipo in LONGITUD_POR_TIPO)) return { ok: false, error: 'Tipo de rotación no válido.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_ancla)) return { ok: false, error: 'La fecha de inicio del ciclo no es válida.' }

  const longitud_dias = LONGITUD_POR_TIPO[tipo] ?? Number((fd.get('longitud_dias') as string) ?? '')
  if (!Number.isInteger(longitud_dias) || longitud_dias < 1 || longitud_dias > 366) {
    return { ok: false, error: 'La longitud del ciclo debe estar entre 1 y 366 días.' }
  }

  // Posiciones del ciclo que se trabajan (el resto es descanso). Una sola banda: cada
  // posición apunta a la franja de este turno.
  let posiciones: number[]
  try {
    posiciones = JSON.parse((fd.get('posiciones') as string) ?? '[]') as number[]
  } catch { return { ok: false, error: 'Días del turno no válidos.' } }
  if (!Array.isArray(posiciones) || !posiciones.length) {
    return { ok: false, error: 'El turno no tiene ningún día de trabajo.' }
  }
  posiciones = Array.from(new Set(posiciones.map(Number)))
  for (const p of posiciones) {
    if (!Number.isInteger(p) || p < 0 || p >= longitud_dias) {
      return { ok: false, error: 'El turno tiene un día fuera del ciclo.' }
    }
  }

  // Roster: [{ empleado_id, offset_ciclo }]. Se valida contra la empresa del turno.
  let miembros: MiembroTurno[]
  try {
    miembros = JSON.parse((fd.get('roster') as string) ?? '[]') as MiembroTurno[]
  } catch { return { ok: false, error: 'Equipo del turno no válido.' } }
  if (!Array.isArray(miembros)) miembros = []

  const db = createAdminClient()

  const { data: emp } = await db.from('empresas').select('empresa_id')
    .eq('empresa_id', empresa_id).eq('client_id', session.client_id).maybeSingle()
  if (!emp) return { ok: false, error: 'Empresa no encontrada.' }

  // ── 1) La banda horaria (franja) ──────────────────────────────────────────────
  // Al editar reutiliza la banda del turno (si sigue siendo de esta empresa); si no, o al
  // crear, nace una nueva. El nombre y color de la franja son los del turno: es su banda.
  let bandaId = ''
  if (franja_id) {
    const { data: fr } = await db.from('turnos').select('turno_id, empresa_id')
      .eq('turno_id', franja_id).eq('client_id', session.client_id).maybeSingle()
    if (fr && fr.empresa_id === empresa_id) bandaId = fr.turno_id
  }
  if (bandaId) {
    const { error } = await db.from('turnos')
      .update({ nombre, hora_inicio, hora_fin, color, es_descanso: false, activo: true, updated_at: new Date().toISOString() })
      .eq('turno_id', bandaId).eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  } else {
    bandaId = generarTurnoId()
    const { error } = await db.from('turnos').insert({
      turno_id: bandaId, client_id: session.client_id, empresa_id,
      nombre, hora_inicio, hora_fin, color, es_descanso: false, activo: true,
      updated_at: new Date().toISOString(),
    })
    if (error) return { ok: false, error: error.message }
  }

  // ── 2) El patrón (frecuencia + ancla) ───────────────────────────────────────────
  const id = patron_id || generarPatronId()
  if (!patron_id) {
    const { error } = await db.from('turno_patrones').insert({
      patron_id: id, client_id: session.client_id, empresa_id, nombre, tipo,
      longitud_dias, fecha_ancla, activo: true,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('turno_patrones')
      .update({ nombre, tipo, longitud_dias, fecha_ancla, updated_at: new Date().toISOString() })
      .eq('patron_id', id).eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  // ── 3) Slots: reemplazo completo, todas las posiciones a la banda del turno ──────
  await db.from('turno_patron_slots').delete().eq('client_id', session.client_id).eq('patron_id', id)
  const altasSlots = posiciones.map(pos => ({
    slot_id: generarSlotId(), client_id: session.client_id, patron_id: id,
    posicion: pos, turno_id: bandaId,
  }))
  if (altasSlots.length) {
    const { error } = await db.from('turno_patron_slots').insert(altasSlots)
    if (error) return { ok: false, error: error.message }
  }

  // ── 4) Roster: reemplazo completo, validando pertenencia a la empresa ────────────
  const empIds = Array.from(new Set(miembros.map(m => m.empleado_id).filter(Boolean)))
  if (empIds.length) {
    const { data: emps } = await db.from('empleados').select('empleado_id, empresa_id')
      .eq('client_id', session.client_id).in('empleado_id', empIds)
    const mapa = new Map((emps ?? []).map(e => [e.empleado_id as string, e.empresa_id as string]))
    for (const eid of empIds) {
      const empresaEmp = mapa.get(eid)
      if (!empresaEmp) return { ok: false, error: 'Trabajador no encontrado.' }
      if (empresaEmp !== empresa_id) {
        return { ok: false, error: 'Ese trabajador es de otra empresa: no entra en este turno.' }
      }
    }
  }
  await db.from('turno_miembros').delete().eq('client_id', session.client_id).eq('patron_id', id)
  const altasRoster = miembros.filter(m => m.empleado_id).map(m => ({
    miembro_id: generarMiembroId(), client_id: session.client_id, patron_id: id,
    empleado_id: m.empleado_id, offset_ciclo: Number.isInteger(m.offset_ciclo) ? m.offset_ciclo : 0,
  }))
  if (altasRoster.length) {
    const { error } = await db.from('turno_miembros').insert(altasRoster)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/turnos')
  return { ok: true }
}

/**
 * Borra un turno unificado: su patrón (con slots y roster) y su banda horaria, salvo que
 * esa banda la use algún OTRO patrón (formato anterior con franjas compartidas), en cuyo
 * caso se conserva para no romper esos turnos.
 */
export async function eliminarTurnoUnificado(
  patron_id: string, franja_id?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!patron_id) return { ok: false, error: 'Turno no válido.' }

  const db = createAdminClient()
  await db.from('turno_miembros').delete().eq('client_id', session.client_id).eq('patron_id', patron_id)
  await db.from('turno_patron_slots').delete().eq('client_id', session.client_id).eq('patron_id', patron_id)
  const { error } = await db.from('turno_patrones').delete()
    .eq('patron_id', patron_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  // La banda solo se borra si ya no la usa ningún otro patrón.
  const banda = (franja_id ?? '').trim()
  if (banda) {
    const { data: enUso } = await db.from('turno_patron_slots').select('slot_id')
      .eq('client_id', session.client_id).eq('turno_id', banda).limit(1)
    if (!enUso?.length) {
      await db.from('turnos').delete().eq('turno_id', banda).eq('client_id', session.client_id)
    }
  }

  revalidatePath('/portal/turnos')
  return { ok: true }
}
