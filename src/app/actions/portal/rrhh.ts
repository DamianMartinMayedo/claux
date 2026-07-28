'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import {
  calcularNominaCuba,
  NOMBRE_CONCEPTO_FISCAL,
  type ConceptoFiscal,
  type ParametroFiscal,
} from '@/lib/rrhh/nomina-cuba'
import { obtenerEmpresas }   from './empresas'
import { mapaTasas, monedaValida } from '@/lib/tasas'
import type { MonedaOpcion } from './monedas'
import {
  TIPOS_CONTRATO, PERIODICIDADES, generarEmpleadoId, construirCamposEmpleado,
  type TipoContrato as _TipoContrato, type Periodicidad as _Periodicidad,
} from '@/lib/rrhh-core'
import { resolverCategoriaSistema } from '@/lib/gastos-core'

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
  /** Adelantado al trabajador, recuperable de la Seguridad Social. Suma al neto. */
  subsidios:                     number
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
}

export interface TurnoAsignacion {
  asignacion_id: string
  empleado_id:   string
  dia_semana:    number   // 1=Lunes … 7=Domingo
  turno_id:      string
}

export interface RrhhPageData {
  empleados:       EmpleadoConEstado[]
  nominas:         NominaConLineas[]
  /** Reglas del negocio, activas o no: la pantalla que las gestiona necesita ambas. */
  reglas:          ReglaDeduccion[]
  /** Modelo de nómina de cada empresa. Sin fila, GENERAL con 24 días. */
  config_nomina:   ConfigNominaEmpresa[]
  /** Tributos cubanos aún sembrados con tipos de relleno. Vacío = todo verificado. */
  fiscales_provisionales: string[]
  turnos_catalogo: Turno[]
  asignaciones:    TurnoAsignacion[]
  cuentas:         { cuenta_id: string; nombre: string; empresa_id: string; moneda: string }[]
  empresas:        { empresa_id: string; nombre: string; moneda_funcional: string | null }[]
  monedas:         MonedaOpcion[]
  /** Factores entre las monedas del cliente ("ORIGEN__DESTINO" → factor). */
  tasas:           Record<string, number>
  cargos:          string[]
  departamentos:   string[]
  turnos:          string[]
  empresa_nombres: Record<string, string>
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
function generarAsignacionId(): string { return `TAS-${corto()}` }
function generarConceptoId():   string { return `CPT-${corto()}` }
function generarItemId():       string { return `NLC-${corto()}` }

function redondear2(n: number): number { return Math.round(n * 100) / 100 }

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
  /** Solo MIPYME_CUBA: lo que se paga por vacaciones disfrutadas. */
  vacaciones_pagadas:    number
  /** Adelantado al trabajador y recuperable de la Seguridad Social. Suma al neto,
   *  NO al coste: por eso viaja aparte y no como ítem DEVENGO. */
  subsidios:             number
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
  /** Días que se PAGAN de vacaciones. Solo bajo MIPYME_CUBA. */
  dias_vacaciones:  number
  pago_extra:       number
  pago_nocturnidad: number
  feriados:         number
  penalizacion:     number
  otros_descuentos: number
  /**
   * Subsidio que la empresa ADELANTA al trabajador y luego recupera de la Seguridad
   * Social. Se le suma al neto —lo cobra— pero NO es coste de la empresa, así que
   * no entra en el gasto de Salarios: genera su propia cuenta por cobrar (mig. 144).
   */
  pago_subsidios:   number
}

/** Los importes de una incidencia, como ítems. Valen en LOS DOS modelos: son datos
 *  del mes, no ley cubana. Los DÍAS sí son del modelo cubano (los aplica el motor),
 *  porque el general nunca ha prorrateado y cambiarlo alteraría lo que ya cobra la
 *  gente. */
function itemsDeIncidencia(inc: IncidenciaMes): ItemLinea[] {
  const out: ItemLinea[] = []
  const add = (nombre: string, tipo: TipoItemLinea, monto: number) => {
    if (!monto || monto <= EPS) return
    out.push({
      nombre, tipo, monto: redondear2(monto),
      origen: 'INCIDENCIA', origen_id: inc.incidencia_id ?? null,
      destino: tipo === 'RETENCION' ? 'TERCERO_FISCAL' : null,
    })
  }
  add('Pago extra',       'DEVENGO',   inc.pago_extra)
  add('Nocturnidad',      'DEVENGO',   inc.pago_nocturnidad)
  add('Feriados',         'DEVENGO',   inc.feriados)
  add('Penalización',     'RETENCION', inc.penalizacion)
  add('Otros descuentos', 'RETENCION', inc.otros_descuentos)
  return out
}

/** Incidencias de un período, por trabajador. Una consulta para toda la página. */
async function leerIncidencias(
  db: DbAdmin, client_id: string, periodo: string,
): Promise<Map<string, IncidenciaMes>> {
  const { data } = await db.from('incidencias_nomina')
    .select('incidencia_id, empleado_id, periodo, dias_trabajados, dias_vacaciones, pago_extra, pago_nocturnidad, feriados, penalizacion, otros_descuentos, pago_subsidios')
    .eq('client_id', client_id)
    .eq('periodo', periodo)
  const m = new Map<string, IncidenciaMes>()
  for (const r of (data ?? []) as (IncidenciaMes & { empleado_id: string })[]) {
    m.set(r.empleado_id, {
      ...r,
      dias_trabajados:  r.dias_trabajados === null ? null : Number(r.dias_trabajados),
      dias_vacaciones:  Number(r.dias_vacaciones),
      pago_extra:       Number(r.pago_extra),
      pago_nocturnidad: Number(r.pago_nocturnidad),
      feriados:         Number(r.feriados),
      penalizacion:     Number(r.penalizacion),
      otros_descuentos: Number(r.otros_descuentos),
      pago_subsidios:   Number(r.pago_subsidios),
    })
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
  const items: ItemLinea[] = preservados.map(p => ({ ...p }))

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
      nombre: a.nombre, tipo: 'DEVENGO', monto: importe(a, salario_base),
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
        salario_base,
        dias_laborables:  cuba.dias_laborables,
        dias_trabajados:  cuba.dias_trabajados,
        es_socio:         cuba.es_socio,
        devengos_previos: redondear2(
          items.filter(i => i.tipo === 'DEVENGO').reduce((s, i) => s + i.monto, 0)),
        dias_vacaciones:  cuba.dias_vacaciones,
      }, cuba.parametros)
    : null

  const vacaciones_acumuladas = legal?.vacaciones_acumular ?? 0
  const vacaciones_pagadas    = legal?.vacaciones_pagar    ?? 0
  const provisional           = legal?.provisional         ?? false

  if (legal) {
    // El prorrateo por días NO reescribe `salario_base` —que es la foto congelada
    // del salario del período y tiene que seguir siéndolo—, sino que entra como su
    // propio ítem, normalmente NEGATIVO. Así la invariante se mantiene y, sobre
    // todo, el desglose dice POR QUÉ cobra menos, en vez de que el número aparezca
    // cambiado sin explicación.
    const ajusteDias = redondear2(legal.salario_devengado - salario_base)
    if (Math.abs(ajusteDias) > EPS) {
      items.push({
        nombre: 'Días no trabajados', tipo: 'DEVENGO', monto: ajusteDias,
        origen: 'LEY', origen_id: null, destino: null,
      })
    }
    if (legal.vacaciones_pagar > EPS) {
      items.push({
        nombre: 'Vacaciones pagadas', tipo: 'DEVENGO', monto: legal.vacaciones_pagar,
        origen: 'LEY', origen_id: null, destino: null,
      })
    }
  }

  const devengado = redondear2(
    salario_base + items.filter(i => i.tipo === 'DEVENGO').reduce((s, i) => s + i.monto, 0))

  // ── Paso 3: lo que resta y lo que cuesta a la empresa, ya con el devengado ──
  // Los tributos van ANTES que reglas y conceptos: si algo hay que recortar por no
  // caber en el devengado, se recorta por el final, y una obligación legal no puede
  // ser lo primero que se sacrifique.
  if (legal) {
    for (const r of legal.retenciones) {
      items.push({
        nombre: NOMBRE_CONCEPTO_FISCAL[r.concepto], tipo: 'RETENCION', monto: r.monto,
        origen: 'LEY', origen_id: r.parametro_id, destino: 'TERCERO_FISCAL',
      })
    }
    for (const a of legal.aportes) {
      items.push({
        nombre: NOMBRE_CONCEPTO_FISCAL[a.concepto], tipo: 'APORTE_EMPRESA', monto: a.monto,
        origen: 'LEY', origen_id: a.parametro_id, destino: null,
      })
    }
  }

  for (const it of itemsInc) if (it.tipo === 'RETENCION') items.push(it)

  for (const a of aplicables) {
    if (a.tipo === 'DEVENGO') continue
    const sobre = a.base === 'DEVENGADO' ? devengado : salario_base
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

  return {
    devengado,
    deducciones,
    subsidios,
    neto:      redondear2(Math.max(0, devengado - deducciones + subsidios)),
    recortada,
    // El ajuste por días es NEGATIVO y tiene que sobrevivir al filtro de ceros, o
    // el devengado dejaría de cuadrar con su desglose.
    items:     items.filter(it => Math.abs(it.monto) > EPS || esPreservable(it.origen)),
    vacaciones_acumuladas,
    vacaciones_pagadas,
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
    .select('empresa_id, modelo, dias_laborables_default')
    .eq('client_id', client_id)
  const m = new Map<string, ConfigNominaEmpresa>()
  for (const r of (data ?? []) as ConfigNominaEmpresa[]) {
    m.set(r.empresa_id, { ...r, dias_laborables_default: Number(r.dias_laborables_default) })
  }
  return m
}

function configDe(mapa: Map<string, ConfigNominaEmpresa>, empresa_id: string): ConfigNominaEmpresa {
  return mapa.get(empresa_id) ?? {
    empresa_id, modelo: 'GENERAL', dias_laborables_default: 24,
  }
}

/**
 * Parámetros fiscales vigentes EN UNA FECHA. Tabla global (sin `client_id`): son
 * parámetros de ley, no configuración del negocio. Se resuelve por la fecha de la
 * nómina y no por «hoy», que es lo que hace que una nómina de marzo se recalcule
 * con la ley de marzo aunque estemos en julio.
 */
async function leerParametrosCuba(db: DbAdmin, fecha: string): Promise<ParametroFiscal[]> {
  const { data } = await db.from('parametros_fiscales_cuba')
    .select('parametro_id, concepto, tabla_tramos, base_calculo, provisional, vigente_desde, vigente_hasta')
    .lte('vigente_desde', fecha)
    .or(`vigente_hasta.is.null,vigente_hasta.gte.${fecha}`)
    .order('vigente_desde', { ascending: false })
  // Si hubiera dos filas vigentes del mismo tributo (vigencias mal cerradas), gana
  // la más reciente: se queda la primera de cada concepto.
  const vistos = new Set<string>()
  const out: ParametroFiscal[] = []
  for (const p of (data ?? []) as ParametroFiscal[]) {
    if (vistos.has(p.concepto)) continue
    vistos.add(p.concepto)
    out.push(p)
  }
  return out
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
    ? salario
    : (src.salario_base as number)

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
  return new Date().toISOString().split('T')[0]
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

// ── Obtener datos de RRHH ───────────────────────────────────────────────────────

export async function obtenerRrhh(): Promise<RrhhPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [empRes, monRes, nomRes, nlnRes, turRes, tasRes, cuRes, cptRes, itmRes] = await Promise.all([
    db.from('empleados').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('fecha_baja', { ascending: true, nullsFirst: true })
      .order('nombre', { ascending: true }),
    db.from('monedas').select('codigo, nombre')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('es_consolidacion', { ascending: false })
      .order('codigo'),
    db.from('nominas').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('periodo', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('nomina_lineas').select('*')
      .eq('client_id', session.client_id)
      .order('empleado_nombre', { ascending: true }),
    db.from('turnos').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('nombre', { ascending: true }),
    db.from('turno_asignaciones').select('*')
      .eq('client_id', session.client_id),
    db.from('cuentas').select('cuenta_id, nombre, empresa_id, moneda, activa')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .eq('activa', true)
      .eq('es_apertura', false)   // técnica de la migración (mig. 130): no se paga desde ella
      .order('nombre'),
    // Conceptos activos de TODO el cliente en una sola consulta: con ellos se marca
    // el desfase de cada línea sin pedir nada por nómina (eran 3 consultas por
    // borrador, y esta pantalla se abre en 3G).
    db.from('conceptos_empleado')
      .select('concepto_id, empleado_id, nombre, tipo, modo, valor, base, destino, regla_id, excluida, recurrencia, periodo_aplicable')
      .eq('client_id', session.client_id)
      .eq('activo', true)
      .order('created_at'),
    // Ítems de las líneas, también en UNA consulta para toda la página, por lo mismo.
    // Hacen dos cosas: dar el desglose que la pantalla enseña, y —los PUNTUAL— entrar
    // en el cálculo del desfase. Sin ellos, una línea con un ajuste a mano se marcaría
    // desfasada SIEMPRE (el recálculo los conserva, así que nunca «llegaría» a
    // cuadrar) y el aviso de actualizar no se apagaría jamás.
    db.from('nomina_linea_conceptos')
      .select('item_id, linea_id, nombre, tipo, monto, origen, origen_id, destino')
      .eq('client_id', session.client_id)
      .order('created_at'),
  ])

  const empleados = ((empRes.data ?? []) as Empleado[]).map(e => ({
    ...e,
    salario_base: Number(e.salario_base),
    estado:       estadoDe(e.fecha_baja),
  }))
  const empleadoIds = new Set(empleados.map(e => e.empleado_id))

  // Turnos (catálogo) y asignaciones de los empleados accesibles
  const turnos_catalogo = (turRes.data ?? []) as Turno[]
  const asignaciones = ((tasRes.data ?? []) as TurnoAsignacion[])
    .filter(a => empleadoIds.has(a.empleado_id))

  // Nóminas con sus líneas y el estado de pago del gasto enlazado
  const nominasRaw = (nomRes.data ?? []) as Nomina[]
  const lineasRaw  = (nlnRes.data ?? []) as (NominaLinea & { client_id: string })[]

  // Conceptos vigentes por trabajador → sirven para marcar qué línea de borrador
  // NO los refleja (el aviso de «actualizar» solo aparece si hay desfase real).
  const conceptosPorEmpleado = new Map<string, ConceptoAplicable[]>()
  for (const c of (cptRes.data ?? []) as ({ empleado_id: string } & ConceptoAplicable)[]) {
    const arr = conceptosPorEmpleado.get(c.empleado_id) ?? []
    arr.push({ ...c, valor: Number(c.valor) })
    conceptosPorEmpleado.set(c.empleado_id, arr)
  }
  // La nómina da la empresa (qué reglas le tocan) y el período (qué conceptos
  // PUNTUAL cuentan): sin ambos, el desfase se mediría contra otra cosa.
  const nominaPorId = new Map(nominasRaw.map(n => [n.nomina_id, n]))
  const reglasDe    = await leerReglas(db, session.client_id)

  // Ítems por línea: los del desglose que se pinta, y aparte los PUNTUAL, que son
  // los que el recálculo conservará y por tanto deben contar al medir el desfase.
  const itemsPorLinea      = new Map<string, ItemLinea[]>()
  const preservadosPorLinea = new Map<string, ItemLinea[]>()
  for (const r of (itmRes.data ?? []) as ({ linea_id: string } & ItemLinea)[]) {
    const it: ItemLinea = {
      item_id:   r.item_id,
      nombre:    r.nombre,
      tipo:      r.tipo,
      monto:     Number(r.monto),
      origen:    r.origen,
      origen_id: r.origen_id,
      destino:   r.destino,
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

  const lineasPorNomina = new Map<string, NominaLinea[]>()
  for (const l of lineasRaw) {
    const arr = lineasPorNomina.get(l.nomina_id) ?? []
    const devengado   = Number(l.devengado)
    const deducciones = Number(l.deducciones)
    // También en las CONFIRMADAS: reabrirlas para meter una retención olvidada es
    // el caso real (la nómina del mes ya está cerrada cuando uno se acuerda), así
    // que ocultar el desfase ahí obligaba a borrar la nómina y regenerarla.
    const nom  = nominaPorId.get(l.nomina_id)
    const calc = nom
      ? componerLinea({
          salario_base: Number(l.salario_base),
          reglas:       reglasDe(nom.empresa_id),
          conceptos:    conceptosPorEmpleado.get(l.empleado_id) ?? [],
          preservados:  preservadosPorLinea.get(l.linea_id) ?? [],
          periodo:      nom.periodo,
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
      desfasada:       !!calc && (Math.abs(devengado - calc.devengado) > EPS
                               || Math.abs(deducciones - calc.deducciones) > EPS),
    })
    lineasPorNomina.set(l.nomina_id, arr)
  }

  // Pagos del gasto enlazado (liquidación unificada en Tesorería)
  const gastoIds = nominasRaw.map(n => n.gasto_id).filter((g): g is string => !!g)
  const pagadoPorGasto = new Map<string, number>()
  if (gastoIds.length) {
    const { data: movs } = await db.from('movimientos_tesoreria')
      .select('monto, monto_ref, referencia_id')
      .eq('client_id', session.client_id)
      .in('referencia_id', gastoIds)
    // Saldo de la nómina en su moneda → se suma monto_ref (importe aplicado)
    for (const m of (movs ?? []) as { monto: number; monto_ref: number | null; referencia_id: string }[]) {
      pagadoPorGasto.set(m.referencia_id, (pagadoPorGasto.get(m.referencia_id) ?? 0) + Number(m.monto_ref ?? m.monto))
    }
  }

  const nominas: NominaConLineas[] = nominasRaw.map(n => {
    const total  = Number(n.total)
    const pagado = n.gasto_id ? (pagadoPorGasto.get(n.gasto_id) ?? 0) : 0
    const lineas = lineasPorNomina.get(n.nomina_id) ?? []
    return {
      ...n,
      total,
      lineas,
      pagado,
      saldo_pendiente: Math.max(0, total - pagado),
      desactualizada:  lineas.some(l => l.desfasada),
    }
  })

  const datalist = (vals: (string | null)[]) =>
    Array.from(new Set(vals.filter((v): v is string => !!v))).sort()

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  const cuentas = ((cuRes.data ?? []) as { cuenta_id: string; nombre: string; empresa_id: string; moneda: string; activa: boolean }[])
    .map(c => ({ cuenta_id: c.cuenta_id, nombre: c.nombre, empresa_id: c.empresa_id, moneda: c.moneda }))

  const monedas = (monRes.data ?? []) as MonedaOpcion[]
  const tasas   = await mapaTasas(db, session.client_id, monedas.map(m => m.codigo))

  const [reglasTodas, configNomina, provisionales] = await Promise.all([
    leerTodasLasReglas(db, session.client_id),
    leerConfigNomina(db, session.client_id),
    // Solo interesa si alguna empresa está en el modelo cubano: en el general estos
    // tributos no se aplican y avisar de ellos sería ruido.
    db.from('parametros_fiscales_cuba')
      .select('concepto').eq('provisional', true).is('vigente_hasta', null),
  ])

  return {
    empleados,
    nominas,
    reglas:        reglasTodas,
    config_nomina: Array.from(configNomina.values()),
    fiscales_provisionales: Array.from(new Set(
      ((provisionales.data ?? []) as { concepto: string }[]).map(p => p.concepto))),
    turnos_catalogo,
    asignaciones,
    cuentas,
    empresas:       empresas.map(e => ({
      empresa_id: e.empresa_id, nombre: e.nombre, moneda_funcional: e.moneda_funcional,
    })),
    monedas,
    tasas,
    cargos:         datalist(empleados.map(e => e.cargo)),
    departamentos:  datalist(empleados.map(e => e.departamento)),
    turnos:         datalist(empleados.map(e => e.turno)),
    empresa_nombres,
  }
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

  // La normalización (contrato, periodicidad, salario, fecha de alta) la hace el
  // núcleo compartido con el importador (`@/lib/rrhh-core`).
  const campos = construirCamposEmpleado({
    nombre,
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

  const { data, error } = await createAdminClient().from('empleados')
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
  const salario_base  = isNaN(salarioRaw) || salarioRaw < 0 ? 0 : salarioRaw

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
  data:      RrhhPageData
  empleado:  EmpleadoConEstado
  contratos: Contrato[]
  conceptos: ConceptoEmpleado[]
  /** Incidencias cargadas, de más reciente a más antigua (mig. 143). */
  incidencias: (IncidenciaMes & { incidencia_id: string; periodo: string })[]
  /**
   * Saldo de vacaciones, DERIVADO de las nóminas confirmadas — no se guarda en
   * ninguna parte. Un total mutable en la ficha se rompía al reabrir o borrar una
   * nómina: nada lo decrementaba y al reconfirmar se acumulaba dos veces.
   */
  vacaciones: { importe: number; moneda: string }
}

export async function obtenerEmpleadoDetalle(empleado_id: string): Promise<EmpleadoDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const data = await obtenerRrhh()
  if (!data) return null
  const empleado = data.empleados.find(e => e.empleado_id === empleado_id)
  if (!empleado) return null

  const db = createAdminClient()
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
    .select('incidencia_id, empleado_id, periodo, dias_trabajados, dias_vacaciones, pago_extra, pago_nocturnidad, feriados, penalizacion, otros_descuentos, pago_subsidios')
    .eq('client_id', session.client_id)
    .eq('empleado_id', empleado_id)
    .order('periodo', { ascending: false })
  const incidencias = ((incData ?? []) as (IncidenciaMes & { incidencia_id: string; periodo: string })[])
    .map(i => ({
      ...i,
      dias_trabajados:  i.dias_trabajados === null ? null : Number(i.dias_trabajados),
      dias_vacaciones:  Number(i.dias_vacaciones),
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
  const confirmadas = new Set(
    data.nominas.filter(n => n.estado === 'CONFIRMADA').map(n => n.nomina_id))
  let acumuladas = 0
  for (const n of data.nominas) {
    if (!confirmadas.has(n.nomina_id)) continue
    for (const l of n.lineas) {
      if (l.empleado_id !== empleado_id) continue
      acumuladas += (l.vacaciones_acumuladas_periodo ?? 0) - (l.vacaciones_pagadas_periodo ?? 0)
    }
  }

  // El desfase de cada línea ya viene marcado desde `obtenerRrhh`
  // (`NominaLinea.desfasada`): la vista filtra por ahí, sin consultas extra.
  return {
    data, empleado, contratos, conceptos, incidencias,
    vacaciones: { importe: redondear2(acumuladas), moneda: empleado.moneda },
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

  const [{ data: lineas }, { data: items }, configs] = await Promise.all([
    db.from('nomina_lineas')
      .select('linea_id, empleado_id, empleado_nombre, cargo, salario_base, devengado, deducciones, neto, vacaciones_acumuladas_periodo, vacaciones_pagadas_periodo, subsidios')
      .eq('nomina_id', nomina_id).eq('client_id', session.client_id)
      .order('empleado_nombre'),
    db.from('nomina_linea_conceptos')
      .select('linea_id, nombre, tipo, monto, origen')
      .eq('nomina_id', nomina_id).eq('client_id', session.client_id),
    leerConfigNomina(db, session.client_id),
  ])

  const filas = (lineas ?? []) as Record<string, unknown>[]
  const { data: fichas } = await db.from('empleados')
    .select('empleado_id, documento')
    .eq('client_id', session.client_id)
    .in('empleado_id', Array.from(new Set(filas.map(f => f.empleado_id as string))))
  const docDe = new Map(((fichas ?? []) as { empleado_id: string; documento: string | null }[])
    .map(f => [f.empleado_id, f.documento]))

  // El importe de cada tributo se reconstruye desde los ítems `LEY`, buscándolos por
  // su nombre canónico: es lo que quedó congelado en la línea, no un recálculo.
  const porLinea = new Map<string, Partial<Record<ConceptoFiscal, number>>>()
  for (const it of (items ?? []) as { linea_id: string; nombre: string; origen: string; monto: number }[]) {
    if (it.origen !== 'LEY') continue
    const clave = (Object.keys(NOMBRE_CONCEPTO_FISCAL) as ConceptoFiscal[])
      .find(k => NOMBRE_CONCEPTO_FISCAL[k] === it.nombre)
    if (!clave) continue
    const m = porLinea.get(it.linea_id) ?? {}
    m[clave] = redondear2((m[clave] ?? 0) + Number(it.monto))
    porLinea.set(it.linea_id, m)
  }

  const esCuba = configDe(configs, nomina.empresa_id).modelo === 'MIPYME_CUBA'
    && nomina.moneda === MONEDA_CUBA

  const { nominaAXlsx } = await import('@/lib/rrhh/nomina-xlsx')
  const { base64, nombre } = await nominaAXlsx({
    periodo: nomina.periodo,
    moneda:  nomina.moneda,
    empresa: empresa.nombre,
    estado:  nomina.estado,
    esCuba,
    lineas: filas.map(f => ({
      empleado_nombre: f.empleado_nombre as string,
      documento:       docDe.get(f.empleado_id as string) ?? null,
      cargo:           (f.cargo as string) ?? null,
      salario_base:    Number(f.salario_base),
      devengado:       Number(f.devengado),
      deducciones:     Number(f.deducciones),
      neto:            Number(f.neto),
      vacaciones_acumuladas_periodo: Number(f.vacaciones_acumuladas_periodo ?? 0),
      vacaciones_pagadas_periodo:    Number(f.vacaciones_pagadas_periodo ?? 0),
      subsidios:       Number(f.subsidios ?? 0),
      porConcepto:     porLinea.get(f.linea_id as string) ?? {},
    })),
  })

  return { ok: true, base64, nombre }
}

// ── Incidencias del mes (mig. 143) ──────────────────────────────────────────────

export async function guardarIncidencia(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
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

  const db = createAdminClient()
  const { data: emp } = await db.from('empleados').select('empleado_id')
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
    pago_extra:       num('pago_extra'),
    pago_nocturnidad: num('pago_nocturnidad'),
    feriados:         num('feriados'),
    penalizacion:     num('penalizacion'),
    otros_descuentos: num('otros_descuentos'),
    pago_subsidios:   num('pago_subsidios'),
    updated_at:       new Date().toISOString(),
  }, { onConflict: 'client_id,empleado_id,periodo' })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${empleado_id}`)
  revalidarNomina()
  return { ok: true }
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
    updated_at:              new Date().toISOString(),
  }, { onConflict: 'empresa_id' })
  if (error) return { ok: false, error: error.message }

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

  // Una nómina recién creada no tiene ítems que preservar: nace de cero.
  const items: ReturnType<typeof filaItem>[] = []
  const lineas = activos.map(e => {
    const base     = Number(e.salario_base)
    const linea_id = generarLineaId()
    const inc      = incidencias.get(e.empleado_id)
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
      subsidios:                     calc.subsidios,
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

  const devengado = redondear2(Number(linea.salario_base)
    + filas.filter(i => i.tipo === 'DEVENGO').reduce((s, i) => s + Number(i.monto), 0))
  const deducciones = redondear2(
    filas.filter(i => i.tipo === 'RETENCION').reduce((s, i) => s + Number(i.monto), 0))

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
  subsidios:             number
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

  const lineas = enFoco.map(f => {
    const base  = Number(f.salario_base)
    const ficha = fichaDe.get(f.empleado_id)
    const inc   = incidencias.get(f.empleado_id)
    // El recorte lo hace la fórmula compartida, pero aquí NO se queda en silencio:
    // `recortada` viaja a la previsualización para que el dueño vea que su
    // deducción no cabe entera antes de aplicar nada.
    const { devengado, deducciones, neto, recortada, items,
            vacaciones_acumuladas, vacaciones_pagadas, subsidios } = componerLinea({
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
      subsidios,
      recortada,
      cambia: Math.abs(devAntes - devengado) > EPS || Math.abs(dedAntes - deducciones) > EPS,
    }
  })

  return { estado, lineas, total_otras }
}

export async function previsualizarRecalculoNomina(
  nomina_id:    string,
  empleado_id?: string,
): Promise<RecalculoNomina> {
  const nada = { lineas: [] as RecalculoLineaNomina[], total_antes: 0, total_despues: 0 }
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.', ...nada }

  // Solo lee (la página ya pasa por requireModulo('rrhh')); el candado de
  // escritura vive en `recalcularNomina`.
  const db   = createAdminClient()
  const plan = await planificarRecalculo(db, session.client_id, nomina_id, empleado_id)
  if (plan.error) return { ok: false, error: plan.error, ...nada }

  return {
    ok:            true,
    lineas:        plan.lineas,
    total_antes:   redondear2(plan.total_otras + plan.lineas.reduce((s, l) => s + l.neto_antes, 0)),
    total_despues: redondear2(plan.total_otras + plan.lineas.reduce((s, l) => s + l.neto_despues, 0)),
  }
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
        devengado:   l.devengado_despues,
        deducciones: l.deducciones_despues,
        neto:        l.neto_despues,
        vacaciones_acumuladas_periodo: l.vacaciones_acumuladas,
        vacaciones_pagadas_periodo:    l.vacaciones_pagadas,
        subsidios:                     l.subsidios,
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
// Crea un GASTO "Salarios" en gastos_cobros (fluye a CxP / Tesorería / Reportes)
// y enlaza su id. La nómina queda CONFIRMADA y deja de ser editable.

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
    .select('devengado, deducciones, neto, subsidios')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  const filas       = (lineas ?? []) as { devengado: number; deducciones: number; neto: number; subsidios: number }[]
  const devengado   = redondear2(filas.reduce((s, l) => s + Number(l.devengado), 0))
  const retenido    = redondear2(filas.reduce((s, l) => s + Number(l.deducciones), 0))
  const total       = redondear2(filas.reduce((s, l) => s + Number(l.neto), 0))
  const subsidios   = redondear2(filas.reduce((s, l) => s + Number(l.subsidios ?? 0), 0))
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
    .select('tipo, monto, destino, origen, origen_id, nombre')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  const itemsFilas = (itemsNom ?? []) as {
    tipo: TipoItemLinea; monto: number; destino: DestinoItemLinea | null
    origen: OrigenItemLinea; origen_id: string | null; nombre: string
  }[]

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

  const retenidoTercero = redondear2(itemsFilas
    .filter(i => i.tipo === 'RETENCION' && i.destino === 'TERCERO_FISCAL')
    .reduce((s, i) => s + Number(i.monto), 0))
  const importeSalarios = redondear2(devengado - retenidoTercero)

  // Lo que paga la EMPRESA por encima del bruto (mig. 142). No reduce el neto de
  // nadie, pero es coste de personal: son el tercer y el cuarto acreedor.
  const sumaAporte = (conceptos: string[]) => redondear2(itemsFilas
    .filter(i => i.tipo === 'APORTE_EMPRESA'
      && conceptos.some(c => i.nombre === NOMBRE_CONCEPTO_FISCAL[c as ConceptoFiscal]))
    .reduce((s, i) => s + Number(i.monto), 0))
  const importeIuft  = sumaAporte(['IUFT'])
  const importeSsEmp = sumaAporte(['SS_EMPRESA_125', 'SS_EMPRESA_15'])

  // Categorías del sistema. Se RESUELVEN-O-CREAN (mig. 133): buscarlas por nombre
  // dejaba sin `categoria_id` a todo cliente dado de alta después de la mig. 074,
  // que nunca tuvo las categorías sembradas. El `rol_pl` lo pone la RPC (mig. 139).
  const [catSalarios, catRetenciones, catIuft, catSsEmp] = await Promise.all([
    resolverCategoriaSistema(db, session.client_id, 'salarios'),
    retenidoTercero > EPS
      ? resolverCategoriaSistema(db, session.client_id, 'retenciones_nomina')
      : Promise.resolve(null),
    importeIuft > EPS
      ? resolverCategoriaSistema(db, session.client_id, 'impuestos_salario')
      : Promise.resolve(null),
    importeSsEmp > EPS
      ? resolverCategoriaSistema(db, session.client_id, 'contribucion_ss_empresa')
      : Promise.resolve(null),
  ])

  // DOS gastos que suman el devengado (mig. 139): el coste de personal es el bruto,
  // y lo retenido no se evapora — sigue debiéndose, pero a otro acreedor y con otro
  // vencimiento, así que va en su propia fila de Cuentas por pagar.
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
  const gasto_id = generarGastoId()
  const aInsertar: Record<string, unknown>[] = [{
    ...base,
    registro_id:  gasto_id,
    categoria:    catSalarios?.nombre ?? 'Salarios',
    categoria_id: catSalarios?.categoria_id ?? null,
    descripcion:  `Nómina ${nomina.periodo}`,
    monto:        importeSalarios,
    notas:        `Nómina ${nomina_id}`,
  }]
  const retencion_id = retenidoTercero > EPS ? generarGastoId() : null
  if (retencion_id) {
    aInsertar.push({
      ...base,
      registro_id:  retencion_id,
      categoria:    catRetenciones?.nombre ?? 'Retenciones de nómina',
      categoria_id: catRetenciones?.categoria_id ?? null,
      descripcion:  `Retenciones nómina ${nomina.periodo}`,
      monto:        retenidoTercero,
      notas:        `Nómina ${nomina_id} · retenido del salario, a ingresar a la agencia tributaria`,
    })
  }

  // Tercer y cuarto acreedor (mig. 142), solo si el modelo cubano los generó. Van
  // en filas SEPARADAS y no sumados a las retenciones porque cada uno se liquida
  // ante un organismo distinto y con su propio vencimiento — y porque pagarle a
  // ONAT no puede pagar de paso a la Seguridad Social.
  if (importeIuft > EPS) {
    aInsertar.push({
      ...base,
      registro_id:  generarGastoId(),
      categoria:    catIuft?.nombre ?? 'Impuestos de salario',
      categoria_id: catIuft?.categoria_id ?? null,
      descripcion:  `Impuestos de salario ${nomina.periodo}`,
      monto:        importeIuft,
      notas:        `Nómina ${nomina_id} · a cargo de la empresa, a ingresar a ONAT`,
    })
  }
  if (importeSsEmp > EPS) {
    aInsertar.push({
      ...base,
      registro_id:  generarGastoId(),
      categoria:    catSsEmp?.nombre ?? 'Contribución a la Seguridad Social',
      categoria_id: catSsEmp?.categoria_id ?? null,
      descripcion:  `Contribución a la Seguridad Social ${nomina.periodo}`,
      monto:        importeSsEmp,
      notas:        `Nómina ${nomina_id} · a cargo de la empresa`,
    })
  }

  // ── El subsidio NO es un gasto: es un ACTIVO (mig. 144) ──────────────────────
  // La empresa se lo adelanta al trabajador —va dentro de su neto— y luego se lo
  // cobra a la Seguridad Social. Meterlo en el gasto de Salarios inflaría el coste
  // de personal del estado de resultados por un dinero que la empresa recupera; por
  // eso el gasto de Salarios se calcula sobre el DEVENGADO (que no lo incluye) y el
  // subsidio va en su propia fila de COBRO pendiente, liquidable en Tesorería el día
  // que llegue el reembolso.
  //
  // Va SIN `categoria_id` porque no es una línea del P&L sino un saldo por cobrar.
  //
  // OJO — eso NO es lo que lo mantiene fuera del estado de resultados, y creerlo fue
  // un error real: la categoría solo se consulta en las filas de tipo GASTO (para su
  // `rol_pl`); un COBRO entraba en ingresos por su importe, con categoría o sin ella.
  // Lo que lo mantiene fuera es `cobroEsIngreso()` (`lib/gastos-core.ts`), aplicado en
  // los tres sitios que suman ingresos. Si algún día se añade un cuarto consumidor de
  // `gastos_cobros` que sume ingresos, tiene que usar ese predicado.
  if (subsidios > EPS) {
    aInsertar.push({
      ...base,
      tipo:         'COBRO',
      registro_id:  generarGastoId(),
      categoria:    'Subsidios por cobrar',
      categoria_id: null,
      descripcion:  `Subsidios adelantados ${nomina.periodo}`,
      monto:        subsidios,
      notas:        `Nómina ${nomina_id} · adelantado a la plantilla, a recuperar de la Seguridad Social`,
    })
  }

  const { error: gErr } = await db.from('gastos_cobros').insert(aInsertar)
  if (gErr) return { ok: false, error: gErr.message }

  // `gasto_id` sigue apuntando al de Salarios: es el que gobierna el saldo con la
  // plantilla, y de él salen `pagado`/`saldo_pendiente` y el botón «Pagar».
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
  const hora_inicio = (formData.get('hora_inicio') as string)?.trim() || null
  const hora_fin    = (formData.get('hora_fin')    as string)?.trim() || null
  const color       = (formData.get('color')       as string)?.trim() || null

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
      empresa_id, nombre, hora_inicio, hora_fin, color,
      activo: true,
      updated_at: new Date().toISOString(),
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('turnos')
      .update({ nombre, hora_inicio, hora_fin, color, updated_at: new Date().toISOString() })
      .eq('turno_id', turno_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Eliminar turno (borra también sus asignaciones) ─────────────────────────────

export async function eliminarTurno(turno_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  await db.from('turno_asignaciones').delete()
    .eq('client_id', session.client_id).eq('turno_id', turno_id)
  const { error } = await db.from('turnos').delete()
    .eq('turno_id', turno_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Asignar turno a (empleado, día) ─────────────────────────────────────────────
// turno_id vacío → libera la celda. Un turno por empleado y día (reemplaza).

export async function asignarTurno(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empleado_id = (formData.get('empleado_id') as string)?.trim()
  const diaRaw      = parseInt(formData.get('dia_semana') as string, 10)
  const turno_id    = (formData.get('turno_id')    as string)?.trim() || ''

  if (!empleado_id)                       return { ok: false, error: 'Empleado no válido.' }
  if (isNaN(diaRaw) || diaRaw < 1 || diaRaw > 7) return { ok: false, error: 'Día no válido.' }

  const db = createAdminClient()

  // Reemplazo: borra la asignación previa de esa celda
  await db.from('turno_asignaciones').delete()
    .eq('client_id', session.client_id)
    .eq('empleado_id', empleado_id)
    .eq('dia_semana', diaRaw)

  if (turno_id) {
    const { data: turno } = await db.from('turnos')
      .select('turno_id')
      .eq('turno_id', turno_id)
      .eq('client_id', session.client_id)
      .single()
    if (!turno) return { ok: false, error: 'Turno no encontrado.' }

    const { error } = await db.from('turno_asignaciones').insert({
      asignacion_id: generarAsignacionId(),
      client_id:     session.client_id,
      empleado_id,
      dia_semana:    diaRaw,
      turno_id,
    })
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}
