// ── Reportes de personal en Excel (.xlsx) ────────────────────────────────────
//
// SUSTITUYE AL CSV que esta pantalla generaba en el NAVEGADOR, con `;` y coma decimal.
// Contabilidad ya retiró el CSV de sus informes por dos razones que aquí valían igual:
// el asesor recibe los importes como TEXTO y no puede sumarlos sin reescribir la
// columna, y el fichero arrastra los dos destrozos que documentó el importador —los
// acentos rotos por codificación y el «1.500» leído como 1,50—.
//
// Vive en `lib/` y no en el fichero de acciones porque el escritor de .xlsx es
// server-only y en un módulo 'use server' toda exportación es un endpoint HTTP.

import {
  construirXlsxBase64, texto, numero, MARCA,
  type CeldaEstilo, type HojaExcel,
} from './excel'
import type { ReportesRrhh } from '@/lib/rrhh/reportes'
import { formatMesRrhh } from '@/lib/rrhh/reportes'

const cabecera: CeldaEstilo = { fontWeight: 'bold', color: MARCA.blanco, backgroundColor: MARCA.teal, align: 'left', wrap: true }
const titulo:   CeldaEstilo = { fontWeight: 'bold', color: MARCA.tealTexto, fontSize: 16 }
const sub:      CeldaEstilo = { fontWeight: 'bold', color: MARCA.tealTexto }
const fuerte:   CeldaEstilo = { fontWeight: 'bold' }

/** Miles y dos decimales, negativos en rojo. Como en los informes financieros. */
const IMPORTE = '#,##0.00;[Red](#,##0.00)'
const imp = (v: number, e: CeldaEstilo = {}) => numero(v, { format: IMPORTE, align: 'right', ...e })

export interface MetaRrhh {
  negocio: string
  empresa: string
  anio:    string
  /** La moneda de la vista, o '' si el informe va en cada moneda (nativo). */
  ver:     string
  convertido: boolean
  generado: string
}

/** «120.000,00 CUP · 900,00 USD» — dos monedas no se suman en un número. */
function linea(ms: { moneda: string; monto: number }[]): string {
  return ms.length
    ? ms.map(m => `${m.monto.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m.moneda}`).join(' · ')
    : '—'
}

/**
 * Una hoja por informe. El orden es el de lectura: qué es esto, el resumen, el coste
 * mes a mes, el reparto por departamento y por empresa, y al final los dos pasivos —la
 * deuda de vacaciones y lo que se le debe a ONAT— que son lo que nadie tenía a mano.
 */
export async function construirXlsxRrhh(r: ReportesRrhh, meta: MetaRrhh): Promise<string> {
  const hojas: HojaExcel[] = []

  // ── Resumen ──────────────────────────────────────────────────────────────────
  const resumen: HojaExcel['filas'] = [
    [texto('Reportes de personal', titulo)],
    [texto('Negocio', fuerte), texto(meta.negocio)],
    [texto('Empresa', fuerte), texto(meta.empresa)],
    [texto('Año', fuerte),     texto(meta.anio)],
    [texto('Moneda', fuerte),  texto(meta.ver ? `Convertido a ${meta.ver}` : 'Cada moneda (sin convertir)')],
    [texto('Generado', fuerte), texto(meta.generado)],
    [],
    [texto('RESUMEN', sub)],
    [texto('Plantilla activa'), numero(r.plantilla, { align: 'right' })],
    [texto(`Altas en ${meta.anio}`), numero(r.altas, { align: 'right' })],
    [texto(`Bajas en ${meta.anio}`), numero(r.bajas, { align: 'right' })],
  ]
  for (const c of r.costeAnual) {
    resumen.push([texto(`Coste de personal (${c.moneda})`, fuerte), imp(c.monto, fuerte)])
  }
  // Coste medio, rotación y antigüedad: las tres cifras que convierten «cuánto gasto» en
  // «cómo está mi plantilla». Van con las piezas del cálculo delante, no solo el índice —
  // un 66 % de rotación asusta hasta que se ve que el negocio tiene tres personas.
  for (const c of r.costeMedio) {
    resumen.push([texto(`Coste medio por persona (${c.moneda})`), imp(c.monto)])
  }
  resumen.push(
    [],
    [texto('PLANTILLA', sub)],
    [texto(`Al empezar ${meta.anio}`), numero(r.rotacion.plantillaInicio, { align: 'right' })],
    [texto(`Al acabar ${meta.anio}`),  numero(r.rotacion.plantillaFin,    { align: 'right' })],
    [texto('Plantilla media'),         numero(r.rotacion.plantillaMedia,  { align: 'right' })],
  )
  if (r.rotacion.indice !== null) {
    resumen.push([texto('Rotación (bajas ÷ plantilla media)'), texto(`${r.rotacion.indice} %`)])
  }
  if (r.antiguedad.mediaAnios !== null) {
    resumen.push([texto('Antigüedad media (años)'), numero(r.antiguedad.mediaAnios, { align: 'right' })])
  }
  if (r.antiguedad.veterano) {
    resumen.push([texto('Más antiguo'), texto(`${r.antiguedad.veterano.nombre} (${r.antiguedad.veterano.anios} años)`)])
  }
  if (meta.convertido) {
    resumen.push([], [texto('Hay importes convertidos a la moneda de vista con la tasa vigente.')])
  }
  hojas.push({ nombre: 'Resumen', filas: resumen, columnas: [{ width: 38 }, { width: 22 }] })

  // ── Coste por mes ────────────────────────────────────────────────────────────
  hojas.push({
    nombre: 'Coste por mes',
    filas: [
      [texto('Mes', cabecera), texto('Moneda', cabecera), texto('Importe', cabecera)],
      ...r.costePorMes.flatMap(m => m.monedas.map(x => [
        texto(formatMesRrhh(m.periodo)), texto(x.moneda), imp(x.monto),
      ])),
    ],
    columnas: [{ width: 20 }, { width: 12 }, { width: 18 }],
  })

  // ── Por departamento y por empresa ───────────────────────────────────────────
  hojas.push({
    nombre: 'Por departamento',
    filas: [
      [texto('Departamento', cabecera), texto('Activos', cabecera), texto('Coste', cabecera)],
      ...r.porDepto.map(d => [texto(d.departamento), numero(d.activos, { align: 'right' }), texto(linea(d.coste))]),
    ],
    columnas: [{ width: 28 }, { width: 10 }, { width: 30 }],
  })
  // Por CARGO responde otra pregunta que por departamento: «Cocina» no dice cuánto cuesta
  // tener tres cocineros y un friegaplatos.
  hojas.push({
    nombre: 'Por cargo',
    filas: [
      [texto('Cargo', cabecera), texto('Activos', cabecera), texto('Coste', cabecera)],
      ...r.porCargo.map(c => [texto(c.cargo), numero(c.activos, { align: 'right' }), texto(linea(c.coste))]),
    ],
    columnas: [{ width: 28 }, { width: 10 }, { width: 30 }],
  })
  if (r.porEmpresa.length) {
    hojas.push({
      nombre: 'Por empresa',
      filas: [
        [texto('Empresa', cabecera), texto('Activos', cabecera), texto('Coste', cabecera)],
        ...r.porEmpresa.map(e => [texto(e.nombre), numero(e.activos, { align: 'right' }), texto(linea(e.coste))]),
      ],
      columnas: [{ width: 28 }, { width: 10 }, { width: 30 }],
    })
  }

  // ── Los dos pasivos ──────────────────────────────────────────────────────────
  if (r.vacaciones.porTrabajador.length) {
    const dia = (v: number, e: CeldaEstilo = {}) => numero(v, { align: 'right', ...e })
    hojas.push({
      nombre: 'Submayor de vacaciones',
      filas: [
        [texto(`Submayor de vacaciones · ${meta.anio}`, titulo)],
        [texto('Saldo inicial + acumulado − pagado (disfrute y liquidación) = saldo final. '
          + 'El día se valora al promedio del saldo; el final es el pasivo vivo.')],
        [],
        [texto('Trabajador', cabecera), texto('Moneda', cabecera),
          texto('Inicial', cabecera), texto('Inicial (d.)', cabecera),
          texto('Acumulado', cabecera), texto('Acum. (d.)', cabecera),
          texto('Pagado/liq.', cabecera), texto('Pag. (d.)', cabecera),
          texto('Final', cabecera), texto('Final (d.)', cabecera)],
        ...r.vacaciones.porTrabajador.map(v => [
          texto(v.nombre), texto(v.moneda),
          imp(v.inicialImporte),   dia(v.inicialDias),
          imp(v.acumuladoImporte), dia(v.acumuladoDias),
          imp(v.pagadoImporte),    dia(v.pagadoDias),
          imp(v.finalImporte, fuerte), dia(v.finalDias, fuerte),
        ]),
        [],
        ...r.vacaciones.total.map(t => [texto('TOTAL (saldo final)', fuerte), texto(t.moneda, fuerte),
          texto(''), texto(''), texto(''), texto(''), texto(''), texto(''),
          imp(t.monto, fuerte), texto('')]),
      ],
      columnas: [{ width: 26 }, { width: 8 }, { width: 14 }, { width: 10 }, { width: 14 },
        { width: 10 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 10 }],
    })
  }
  if (r.onat.length) {
    hojas.push({
      nombre: 'Deuda con ONAT',
      filas: [
        [texto(`Tributos de nómina · ${meta.anio}`, titulo)],
        [texto('Retenido al trabajador y aportado por la empresa, de las nóminas confirmadas.')],
        [],
        [texto('Concepto', cabecera), texto('Moneda', cabecera), texto('Importe', cabecera)],
        ...r.onat.flatMap(o => o.monedas.map(m => [texto(o.concepto), texto(m.moneda), imp(m.monto)])),
      ],
      columnas: [{ width: 46 }, { width: 12 }, { width: 18 }],
    })
  }

  return construirXlsxBase64(hojas)
}
