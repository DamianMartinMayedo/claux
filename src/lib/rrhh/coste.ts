// ── Coste de personal — lógica PURA, sin I/O ──────────────────────────────────
//
// La fórmula vivía SOLO dentro del generador del recibo en PDF (`lib/pdf/recibo-nomina.ts`),
// que es el único sitio donde se imprimía. La hoja de nómina —la pantalla en la que el
// dueño decide si confirma— no enseñaba el número que de verdad le importa: lo que le
// cuesta esa nómina.
//
// Sale aquí para que la use el recibo Y la pantalla. Una copia por sitio es cómo lo que
// se imprime y lo que se ve acaban discrepando, que es la misma razón por la que
// `aplicarConceptos` y `construirReportesRrhh` viven fuera de sus consumidores.

import { truncar2 } from './importe'

export interface PiezasCoste {
  devengado:             number
  /** Lo que se paga este mes por vacaciones disfrutadas. */
  vacaciones_pagadas:    number
  /** Lo que se acumula este mes y NO se paga. */
  vacaciones_acumuladas: number
  /** Lo que la empresa paga POR ENCIMA del bruto (IUFT, SS 12,5 %, SS 1,5 %). */
  aportes:               number
}

/**
 * Lo que la nómina le cuesta a la empresa:
 *
 *   (devengado − vacaciones disfrutadas) + acumulación del mes + aportes
 *
 * Las vacaciones disfrutadas se RESTAN porque su coste ya se reconoció el mes en que se
 * acumularon; sumarlas otra vez las contaría dos veces (mig. 166).
 *
 * Y **no es «neto + aportes»**: eso deja fuera las retenciones, que no son un ahorro
 * sino el mismo coste con un segundo acreedor — el agujero que la mig. 139 cerró en la
 * contabilidad y que este cálculo no puede volver a abrir.
 */
export function costeEmpresa(p: PiezasCoste): number {
  return truncar2(p.devengado - p.vacaciones_pagadas + p.vacaciones_acumuladas + p.aportes)
}
