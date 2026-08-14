// ── Catálogo de conceptos FIJOS de la nómina — lógica PURA, sin I/O ───────────
//
// La identidad de un ítem de nómina es su CLAVE, no su nombre (mig. 165). El nombre
// es un snapshot que se imprime y que puede cambiar; la clave es con lo que el código
// reconoce el concepto. Antes de esta separación, `confirmarNomina` repartía los
// aportes de empresa comparando cadenas de texto, así que renombrar un tributo dejaba
// de clasificar EN SILENCIO y las deudas con ONAT salían a cero sin fallar nada.
//
// Este módulo vive FUERA de los ficheros `'use server'` porque lo necesitan las dos
// orillas: las acciones al escribir los ítems y la vista de nómina al pintarlos. En
// un fichero de acciones toda exportación tiene que ser una función async, así que un
// `const` ahí rompería el build de Vercel sin que `tsc` dijera nada.
//
// **El nombre canónico vive AQUÍ, junto a su clave.** Es lo que impide que vuelvan a
// divergir: quien escribe un ítem del catálogo no teclea el nombre, lo pide por su
// clave. Los cinco tributos siguen llegando de `nomina-cuba.ts`, que es donde vive el
// motor legal y su vocabulario fiscal; este módulo lo extiende, no lo duplica.

import { NOMBRE_CONCEPTO_FISCAL, type ConceptoFiscal } from './nomina-cuba'
import type { ClaveCategoriaSistema } from '@/lib/gastos-core'

/**
 * Conceptos con identidad de catálogo. Solo los del SISTEMA: una regla del negocio,
 * un concepto del trabajador o un ajuste puntual son del cliente y su nombre es lo
 * único que los define, así que van con clave `null`.
 */
export type ConceptoClave =
  | ConceptoFiscal            // los cinco tributos + la acumulación de vacaciones
  | 'DIAS_NO_TRABAJADOS'      // prorrateo por días (normalmente negativo)
  | 'VACACIONES_PAGADAS'      // los días de vacaciones que se disfrutan este mes
  | 'VACACIONES_LIQUIDACION'  // el saldo de vacaciones que se paga de golpe al causar baja
  | 'PAGO_EXTRA'
  | 'NOCTURNIDAD'
  | 'FERIADOS'
  | 'PENALIZACION'
  | 'OTROS_DESCUENTOS'

/** Nombre canónico de cada clave. Es lo que se graba como snapshot y lo que se imprime. */
export const NOMBRE_CONCEPTO: Record<ConceptoClave, string> = {
  ...NOMBRE_CONCEPTO_FISCAL,
  DIAS_NO_TRABAJADOS:     'Días no trabajados',
  VACACIONES_PAGADAS:     'Vacaciones pagadas',
  VACACIONES_LIQUIDACION: 'Liquidación de vacaciones',
  PAGO_EXTRA:             'Pago extra',
  NOCTURNIDAD:            'Nocturnidad',
  FERIADOS:               'Feriados',
  PENALIZACION:           'Penalización',
  OTROS_DESCUENTOS:       'Otros descuentos',
}

// ── Los conceptos de COSTE de una nómina (mig. 166) ──────────────────────────
//
// Lo que va a Gastos cuando se confirma. NO es la misma lista que los ítems: `SALARIO`
// es un AGREGADO (el devengado menos las vacaciones disfrutadas, porque su coste ya se
// reconoció el mes en que se acumularon), no un ítem con clave propia. Y las dos
// retenciones **no están aquí a propósito**: su coste ya vive dentro del salario
// devengado y llevarlas también a Gastos duplicaría el coste de personal — el agujero
// que cerró la mig. 139, por la puerta contraria. Su único registro es la deuda.

export type ConceptoCoste =
  | 'SALARIO'         // devengado − vacaciones disfrutadas
  | 'VACACIONES'      // la acumulación de ESTE mes
  | 'IUFT'
  | 'SS_EMPRESA_125'
  | 'SS_EMPRESA_15'

/** Orden estable para la pantalla de configuración y para escribir las filas. */
export const CONCEPTOS_COSTE: ConceptoCoste[] = [
  'SALARIO', 'VACACIONES', 'IUFT', 'SS_EMPRESA_125', 'SS_EMPRESA_15',
]

/** Etiqueta del concepto de coste en la pantalla de configuración. */
export const NOMBRE_CONCEPTO_COSTE: Record<ConceptoCoste, string> = {
  SALARIO:        'Salario devengado (sin vacaciones)',
  VACACIONES:     'Acumulación de vacaciones del mes',
  IUFT:           NOMBRE_CONCEPTO_FISCAL.IUFT,
  SS_EMPRESA_125: NOMBRE_CONCEPTO_FISCAL.SS_EMPRESA_125,
  SS_EMPRESA_15:  NOMBRE_CONCEPTO_FISCAL.SS_EMPRESA_15,
}

/**
 * Categoría de sistema que recibe cada concepto **si el dueño no ha configurado otra**.
 * Las claves son las de `ClaveCategoriaSistema` (`lib/gastos-core.ts`): se resuelven o
 * se crean por clave, nunca por nombre, para que renombrarlas no cree un duplicado.
 *
 * Los tres aportes caen por defecto en categorías distintas para que el estado de
 * resultados los pueda separar; el dueño puede mandarlos todos a la misma si prefiere
 * verlo agregado, y aun así **se escribe una fila por concepto**: agrupar en el informe
 * es reversible, fusionar las filas destruiría la separación de la deuda.
 */
export const CATEGORIA_DEFECTO_COSTE: Record<ConceptoCoste, ClaveCategoriaSistema> = {
  SALARIO:        'salarios',
  VACACIONES:     'vacaciones_acumuladas',
  IUFT:           'impuestos_salario',
  SS_EMPRESA_125: 'contribucion_ss_empresa',
  SS_EMPRESA_15:  'contribucion_ss_empresa',
}

/**
 * Abreviatura para la TABLA de nómina en pantalla, donde el espacio por fila es
 * escaso y cinco nombres fiscales completos no caben en el desglose de una plantilla.
 *
 * Es una **lista cerrada de cinco**, no la regla «lo que sea largo se acorta»: todo lo
 * demás —Salario Básico, los devengos del motor, las incidencias y cualquier concepto
 * que el dueño configure— se pinta con su nombre entero.
 *
 * **NO se usa en el recibo en PDF ni en el Excel**: ahí siempre va el nombre completo,
 * porque es lo que lee el trabajador o un inspector y no hay restricción de espacio.
 */
export const SIGLA_CONCEPTO: Partial<Record<ConceptoClave, string>> = {
  CESS:           'CESS',
  IRPF:           'IRPF',
  IUFT:           'UFT 5 %',
  SS_EMPRESA_125: 'SS 12,5 %',
  SS_EMPRESA_15:  'SS 1,5 %',
}

/** Lo que se pinta en la tabla: la sigla si la tiene, y si no el nombre tal cual. */
export function etiquetaEnTabla(
  clave: ConceptoClave | null | undefined, nombre: string,
): string {
  return (clave && SIGLA_CONCEPTO[clave]) || nombre
}

/**
 * Resuelve la clave de un ítem que no la tiene grabada. Solo para lo escrito ANTES
 * de la mig. 165 que el backfill no alcanzara: es la red de seguridad, no el camino
 * normal. Nada nuevo debe depender de esto.
 */
export function claveDeNombre(nombre: string): ConceptoClave | null {
  const claves = Object.keys(NOMBRE_CONCEPTO) as ConceptoClave[]
  return claves.find(k => NOMBRE_CONCEPTO[k] === nombre) ?? null
}

/**
 * ¿La clave es uno de los tributos del motor legal? Distingue lo que tiene columna
 * fiscal propia (y, desde la Fase 3, acreedor propio) de los devengos que el motor
 * aporta —el prorrateo y las vacaciones pagadas— que ya viven dentro del devengado.
 */
export function esConceptoFiscal(clave: ConceptoClave | null): clave is ConceptoFiscal {
  return clave !== null && clave in NOMBRE_CONCEPTO_FISCAL
}
