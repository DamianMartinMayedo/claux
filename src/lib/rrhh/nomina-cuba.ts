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

import { importe2 } from './importe'

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
  /** Días de vacaciones que se le PAGAN este mes (disfrute normal). */
  dias_vacaciones: number
  /**
   * Días de vacaciones que se LIQUIDAN de golpe por causar baja. Es el mismo
   * mecanismo que `dias_vacaciones`, pero con clave propia para el recibo y los
   * reportes; normalmente 0. Su importe entra en el devengado igual que el disfrute,
   * y —criterio de Claudia (2026-08-13)— NO entra en la base del IUFT ni de la SS de
   * empresa.
   */
  dias_liquidacion: number
  /**
   * Saldo de vacaciones acumulado ANTES de esta línea (apertura + nóminas
   * confirmadas), en importe y en días. Es lo que fija el VALOR del día que se paga:
   * `valor_dia = saldo_importe ÷ saldo_dias` (promedio del saldo, no el salario del
   * mes en que se disfruta). Sin promedio válido —`saldo_vac_dias = 0` o
   * `saldo_vac_importe = 0`— el valor del día es 0: NO se inventa un valor contra el
   * salario del período (eso enmascaraba al cliente que no trae su acumulado). Con el
   * pago a 0, el dueño lo corrige mano a mano vía `importe_vacaciones_manual`.
   */
  saldo_vac_importe: number
  saldo_vac_dias: number
  /**
   * Importe MANUAL del disfrute de vacaciones de ESTE mes (mig. 202). Cuando no es null,
   * MANDA sobre el cálculo automático y fija directamente `vacaciones_pagar`, sin pasar
   * por el valor del día. Es la salida para clientes sin acumulado registrado: el
   * automático daría 0 y aquí se teclea cuánto pagar. NO toca la liquidación por baja
   * (`dias_liquidacion`), que sigue saliendo del saldo, ni los días acumulados/pagados.
   */
  importe_vacaciones_manual: number | null
}

export interface ResultadoCuba {
  /** R — salario del período, ya prorrateado por días. */
  salario_devengado: number
  /** S — lo que se acumula este mes, NO se paga. */
  vacaciones_acumular: number
  /** T — lo que se paga este mes por vacaciones disfrutadas. */
  vacaciones_pagar: number
  /** T' — lo que se liquida de golpe por baja (0 salvo baja). Mismo trato que T en
   *  el devengado y en la base de aportes; clave propia para el recibo. */
  vacaciones_liquidar: number
  /** Días acumulados este mes (1/11 de los días trabajados efectivos). Gemelo en DÍAS
   *  de `vacaciones_acumular`, para derivar el saldo también en días (mig. 194). */
  vacaciones_dias_acumular: number
  /** Días pagados este mes: disfrute + liquidación. Gemelo en DÍAS de lo que sale del
   *  saldo, para congelarlo en la línea. */
  vacaciones_dias_pagar: number
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
// la política monetaria común (base truncada a 3 decimales y redondeo a 2).
const r2 = importe2

// Los DÍAS no son dinero: no pasan por la política monetaria (truncar a 3, redondear a
// 2). Se redondean a CUATRO decimales, solo para que no arrastren cola binaria.
// Cuatro y no dos porque la acumulación es `días ÷ 11` y casi nunca cae en dos: un mes
// de 26 días trabajados da 2,363636…, que guardado como 2,36 se come 0,0036 días del
// derecho del trabajador. Un recorte pequeño cada mes, sobre un saldo que dura años.
// Las columnas de días son `numeric` SIN escala (mig. 194/195): guardan los cuatro.
const r2dias = (n: number) => Math.round(n * 10000) / 10000

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

  // Días que se ACUMULAN este mes: 1/11 de los días trabajados efectivos, el gemelo
  // en días de `vacaciones_acumular`. Sin incidencia se asume el mes completo; nunca
  // por encima de los laborables (un turno extra se paga como «Pago extra», no engorda
  // el derecho de vacaciones).
  const diasTrabajadosEfectivos = dias_trabajados === null
    ? dias_laborables
    : Math.min(dias_trabajados, dias_laborables)
  const vacaciones_dias_acumular = dias_laborables > 0 ? r2dias(diasTrabajadosEfectivos / 11) : 0

  // T — lo que se paga por los días de vacaciones. El VALOR del día es el promedio del
  // saldo acumulado (`saldo_importe ÷ saldo_dias`, criterio de Claudia 2026-08-13), NO
  // el salario del mes en que se disfruta. Sin promedio válido —sin días de saldo o sin
  // importe acumulado— el valor del día es 0: NO se inventa un valor contra el salario
  // del período. Ese pago a 0 es el síntoma que el dueño resuelve con el importe manual.
  const valorDia = entrada.saldo_vac_dias > 0 && entrada.saldo_vac_importe > 0
    ? entrada.saldo_vac_importe / entrada.saldo_vac_dias
    : 0
  // Corrección manual del disfrute (mig. 202): cuando está puesta MANDA sobre el cálculo
  // automático. Es la salida para clientes sin acumulado —el automático daría 0—. Se
  // aplica SOLO si hay días de disfrute este mes: pagar un importe con 0 días no es un
  // disfrute y descuadraría el saldo en días frente al importe. No afecta a la
  // liquidación por baja, que sigue saliendo del saldo.
  const diasVac = entrada.dias_vacaciones || 0
  const vacaciones_pagar    = diasVac <= 0
    ? 0
    : (entrada.importe_vacaciones_manual != null
        ? r2(entrada.importe_vacaciones_manual)
        : r2(valorDia * diasVac))
  // T' — liquidación por baja: mismo valor del día. Una liquidación COMPLETA lleva
  // `dias_liquidacion = saldo_dias`, así que sale exactamente `saldo_importe` —se paga
  // justo lo acumulado, sin cálculo extra—.
  const vacaciones_liquidar = r2(valorDia * (entrada.dias_liquidacion || 0))

  // Días pagados este mes: disfrute + liquidación, que es lo que sale del saldo-días.
  const vacaciones_dias_pagar = r2dias((entrada.dias_vacaciones || 0) + (entrada.dias_liquidacion || 0))

  const total_devengado = r2(devengadoSinVacaciones + vacaciones_pagar + vacaciones_liquidar)

  // Base de IUFT y de la Contribución SS de empresa: devengado + acumulación de
  // vacaciones del MES — sin el pago de vacaciones disfrutadas (`vacaciones_pagar`) ni
  // la liquidación por baja (`vacaciones_liquidar`), que sí entran en `total_devengado`
  // pero no en esta base (criterio de Claudia, validado contra un caso real y ratificado
  // para la liquidación el 2026-08-13). Van separadas a propósito: reutilizar
  // `total_devengado` aquí colaría esos términos de más.
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

  // El socio no cotiza a la Seguridad Social: se salta la CESS del trabajador y,
  // por el mismo motivo, las dos Contribuciones SS de empresa (12,5 % y 1,5 %). El
  // IRPF y el IUFT se le calculan igual que a cualquier trabajador.
  if (!es_socio) aplicar('CESS', 'retencion')
  aplicar('IRPF', 'retencion')

  // A cargo de la EMPRESA, por encima del bruto: no reducen el neto pero sí son
  // coste de personal. Es el tercer cubo que el modelo no sabía expresar.
  aplicar('IUFT', 'aporte')
  if (!es_socio) {
    aplicar('SS_EMPRESA_125', 'aporte')
    aplicar('SS_EMPRESA_15',  'aporte')
  }

  return {
    salario_devengado,
    vacaciones_acumular,
    vacaciones_pagar,
    vacaciones_liquidar,
    vacaciones_dias_acumular,
    vacaciones_dias_pagar,
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
