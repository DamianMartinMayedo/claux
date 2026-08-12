// ── Motor legal de nómina del modelo MIPYME_CUBA — lógica PURA, sin I/O ────────
//
// Vive fuera de los ficheros `'use server'` a propósito: ahí toda exportación es un
// endpoint HTTP, así que una función que recibiera `client_id` por parámetro dejaría
// calcular en el tenant ajeno. Es la misma razón por la que el núcleo de facturas
// vive en `lib/ventas/factura-core.ts`.
//
// LOS TIPOS SON DATOS. Este archivo sabe RECORRER una escala de tramos y sobre qué
// base aplicarla, pero no conoce ni un porcentaje: todos salen de
// `parametros_fiscales_cuba`, con su vigencia. Cuando ONAT publique un cambio se
// cierra la vigencia de una fila y se inserta otra, sin tocar este código — salvo
// que cambie la ESTRUCTURA del tributo (un tramo con una lógica distinta a
// «porcentaje sobre el exceso»), que sí exigiría tocarlo.
//
// `hayProvisionales()` es un chequeo puro sobre un array de parámetros ya
// resueltos; el guardia real de `confirmarNomina` (rrhh.ts) no la llama —hace su
// propia comprobación mirando los `parametro_id` concretos grabados en cada línea,
// más preciso porque no depende de la vigencia de HOY sino de la que se usó al
// generar—. Se deja exportada por si un futuro caller la necesita.

import { truncar2 } from './importe'

export type ConceptoFiscal =
  | 'IRPF' | 'CESS' | 'IUFT' | 'SS_EMPRESA_125' | 'SS_EMPRESA_15' | 'VACACIONES'

export type BaseFiscal = 'SALARIO_BASE' | 'DEVENGADO' | 'DEVENGADO_MAS_VACACIONES'

export interface TramoFiscal {
  desde:          number
  /** null = sin límite superior (el último tramo). */
  hasta:          number | null
  /** Porcentaje aplicado al EXCESO sobre `desde`. */
  tasa:           number
  /** Importe fijo que arrastran los tramos anteriores. */
  acumulado_base: number
}

export interface ParametroFiscal {
  parametro_id: string
  concepto:     ConceptoFiscal
  tabla_tramos: TramoFiscal[]
  base_calculo: BaseFiscal
  provisional:  boolean
}

/** Lo que el motor necesita saber de la persona y de su mes. */
export interface EntradaCuba {
  salario_base: number
  /** Días del mes que la empresa considera completos. */
  dias_laborables: number
  /** null = mes completo. */
  dias_trabajados: number | null
  /** Se le omite ÚNICAMENTE la CESS. Todo lo demás se le calcula igual. */
  es_socio: boolean
  /** Lo que ya suma al devengado por reglas y conceptos (bonos, nocturnidad…). */
  devengos_previos: number
  /** Días de vacaciones que se le PAGAN este mes. */
  dias_vacaciones: number
}

export interface ResultadoCuba {
  /** R — salario del período, ya prorrateado por días. */
  salario_devengado: number
  /** S — lo que se acumula este mes, NO se paga. */
  vacaciones_acumular: number
  /** T — lo que se paga este mes por vacaciones disfrutadas. */
  vacaciones_pagar: number
  /** U — total devengado. */
  total_devengado: number
  /** Lo que se le retiene al trabajador (reduce su neto). */
  retenciones: { concepto: ConceptoFiscal; monto: number; parametro_id: string }[]
  /** Lo que paga la empresa POR ENCIMA del bruto (no reduce el neto). */
  aportes: { concepto: ConceptoFiscal; monto: number; parametro_id: string }[]
  /** Algún parámetro aplicado es de relleno: no se puede postear a contabilidad. */
  provisional: boolean
}

// Alias local para mantener legible el motor: todos los importes legales pasan por
// la política monetaria común y se truncan a dos decimales, nunca se redondean.
const r2 = truncar2

/** Elige la fila vigente en una fecha. Sin fila, el tributo no se aplica. */
export function parametroVigente(
  params: ParametroFiscal[],
  concepto: ConceptoFiscal,
): ParametroFiscal | null {
  return params.find(p => p.concepto === concepto) ?? null
}

/**
 * Recorre una escala de tramos: importe = acumulado_base + (base − desde) × tasa.
 * Un tipo plano es simplemente un tramo único con `desde: 0` y `acumulado_base: 0`,
 * así que plano y progresivo comparten camino y no hay dos formas de calcular.
 */
export function aplicarTramos(base: number, tramos: TramoFiscal[]): number {
  if (base <= 0 || !tramos.length) return 0
  // El aplicable es el último cuyo `desde` no supera la base. Se ordena aquí y no
  // se confía en el orden del JSON: viene de una tabla que edita una persona.
  const orden = [...tramos].sort((a, b) => a.desde - b.desde)
  let elegido: TramoFiscal | null = null
  for (const t of orden) {
    if (base > t.desde && (t.hasta === null || base <= t.hasta)) { elegido = t; break }
  }
  // Por encima del último tramo cerrado, manda el último de la escala.
  if (!elegido) elegido = orden[orden.length - 1]
  if (base <= elegido.desde) return 0
  return r2(elegido.acumulado_base + ((base - elegido.desde) * elegido.tasa) / 100)
}

function baseDe(b: BaseFiscal, v: { salario: number; devengado: number; devengadoMasVacaciones: number }): number {
  switch (b) {
    case 'SALARIO_BASE':             return v.salario
    case 'DEVENGADO_MAS_VACACIONES': return v.devengadoMasVacaciones
    default:                         return v.devengado
  }
}

/**
 * Calcula la parte LEGAL de una línea del modelo cubano.
 *
 * Orden, y no es casual: primero el salario del período prorrateado por días, luego
 * la acumulación de vacaciones y lo que se pague de ellas, con eso se cierra el
 * devengado, y solo entonces se calculan retenciones y aportes — que necesitan el
 * devengado ya cerrado para tener una base sobre la que aplicarse.
 */
export function calcularNominaCuba(
  entrada: EntradaCuba,
  params:  ParametroFiscal[],
): ResultadoCuba {
  // La base entra truncada: ningún impuesto, aporte o valor diario puede calcularse
  // sobre los céntimos que luego desaparecerían al guardar el resultado.
  const salario_base = r2(entrada.salario_base)
  const devengos_previos = r2(entrada.devengos_previos)
  const { dias_laborables, dias_trabajados, es_socio } = entrada

  // R — prorrateo por días. Sin días cargados se asume el mes completo, que es como
  // se ha comportado el sistema siempre: quien no cargue incidencias no ve cambios.
  const factor = dias_trabajados === null || dias_laborables <= 0
    ? 1
    : Math.min(dias_trabajados / dias_laborables, 1)
  const salario_devengado = r2(salario_base * factor)

  // Devengado antes de vacaciones: el salario del período más lo que ya sumaron las
  // reglas y los conceptos del trabajador.
  const devengadoSinVacaciones = r2(salario_devengado + devengos_previos)

  // S — se ACUMULA, no se paga. Entra en la base del IUFT y de la SS de empresa,
  // pero no en el neto: es un derecho que se cobra cuando se disfruta.
  const pVac = parametroVigente(params, 'VACACIONES')
  const vacaciones_acumular = pVac
    ? aplicarTramos(devengadoSinVacaciones, pVac.tabla_tramos)
    : 0

  // T — lo que se paga por los días de vacaciones disfrutados este mes, al valor
  // del día del período.
  const valorDia = dias_laborables > 0 ? salario_base / dias_laborables : 0
  const vacaciones_pagar = r2(valorDia * (entrada.dias_vacaciones || 0))

  const total_devengado = r2(devengadoSinVacaciones + vacaciones_pagar)

  // Base de IUFT y de la Contribución SS de empresa: devengado + acumulación de
  // vacaciones del MES — sin el pago de vacaciones disfrutadas (`vacaciones_pagar`),
  // que sí entra en `total_devengado` pero no en esta base (criterio de Claudia,
  // validado contra un caso real). Van separadas a propósito: reutilizar
  // `total_devengado` aquí coló ese término de más.
  const devengadoMasVacaciones = r2(devengadoSinVacaciones + vacaciones_acumular)
  const vistas = { salario: salario_base, devengado: total_devengado, devengadoMasVacaciones }

  const retenciones: ResultadoCuba['retenciones'] = []
  const aportes:     ResultadoCuba['aportes']     = []
  let provisional = false

  const aplicar = (
    concepto: ConceptoFiscal,
    destino: 'retencion' | 'aporte',
  ) => {
    const p = parametroVigente(params, concepto)
    if (!p) return                       // sin fila vigente, el tributo no existe
    const monto = aplicarTramos(baseDe(p.base_calculo, vistas), p.tabla_tramos)
    if (monto <= 0) return
    if (p.provisional) provisional = true
    const fila = { concepto, monto, parametro_id: p.parametro_id }
    if (destino === 'retencion') retenciones.push(fila)
    else                         aportes.push(fila)
  }

  // El socio se salta ÚNICAMENTE la CESS. El IRPF, el IUFT y la Contribución SS de
  // empresa se le calculan igual que a cualquier trabajador.
  if (!es_socio) aplicar('CESS', 'retencion')
  aplicar('IRPF', 'retencion')

  // A cargo de la EMPRESA, por encima del bruto: no reducen el neto pero sí son
  // coste de personal. Es el tercer cubo que el modelo no sabía expresar.
  aplicar('IUFT',           'aporte')
  aplicar('SS_EMPRESA_125', 'aporte')
  aplicar('SS_EMPRESA_15',  'aporte')

  return {
    salario_devengado,
    vacaciones_acumular,
    vacaciones_pagar,
    total_devengado,
    retenciones,
    aportes,
    provisional,
  }
}

/** ¿Alguno de los parámetros aplicables es de relleno? Bloquea confirmar. */
export function hayProvisionales(params: ParametroFiscal[]): boolean {
  return params.some(p => p.provisional)
}

/** Nombre legible de cada tributo, para el desglose y el recibo. */
export const NOMBRE_CONCEPTO_FISCAL: Record<ConceptoFiscal, string> = {
  IRPF:           'Impuesto sobre ingresos personales',
  CESS:           'Contribución Especial a la Seguridad Social',
  IUFT:           'Impuesto por la Utilización de la Fuerza de Trabajo',
  SS_EMPRESA_125: 'Contribución a la Seguridad Social (12,5 %)',
  SS_EMPRESA_15:  'Contribución a la Seguridad Social (1,5 %)',
  VACACIONES:     'Acumulación de vacaciones',
}
