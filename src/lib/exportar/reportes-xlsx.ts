// ── Reportes financieros en Excel (.xlsx) para el asesor ────────────────────
//
// SUSTITUYE AL CSV, y no por gusto: el asesor abre esto en Excel y lo cruza con
// su contabilidad, así que los dos destrozos del CSV le caen encima enteros —los
// acentos rotos por codificación y el «1.500» leído como 1,50— y encima los
// importes le llegan como TEXTO, que es lo que impide sumarlos sin reescribir la
// columna. Aquí las celdas numéricas son `Number` con formato, no cadenas: se
// suman, se filtran y se pivotan tal cual llegan. Es el mismo argumento que ya
// hizo del .xlsx el formato preferido del importador (CONTEXTO §2).
//
// Vive en `lib/`, no en el fichero de acciones: lo usan el envío al asesor y la
// descarga directa, y en un módulo 'use server' toda exportación es un endpoint.

import {
  construirXlsxBase64, texto, numero, MARCA,
  type CeldaEstilo, type HojaExcel,
} from './excel'
import { construirFilasPL } from '@/lib/pl/comparar'
import type { ReportesData } from '@/app/actions/portal/reportes'
import { LABEL_COMPARACION, etiquetaAnterior, etiquetaMes } from '@/lib/pl/periodo'

const cabecera: CeldaEstilo = { fontWeight: 'bold', color: MARCA.blanco, backgroundColor: MARCA.teal, align: 'left', wrap: true }
const titulo:   CeldaEstilo = { fontWeight: 'bold', color: MARCA.tealTexto, fontSize: 16 }
const sub:      CeldaEstilo = { fontWeight: 'bold', color: MARCA.tealTexto }
const clave:    CeldaEstilo = { fontWeight: 'bold' }
const fuerte:   CeldaEstilo = { fontWeight: 'bold' }

/** Formato de importe: miles y dos decimales, con negativos en rojo y paréntesis. */
const IMPORTE = '#,##0.00;[Red](#,##0.00)'
const PORCEN  = '0.0"%"'

const imp = (v: number | null | undefined, e: CeldaEstilo = {}) =>
  numero(v ?? undefined, { format: IMPORTE, align: 'right', ...e })
const pc = (v: number | null | undefined, e: CeldaEstilo = {}) =>
  numero(v ?? undefined, { format: PORCEN, align: 'right', ...e })

const ORIGEN_LABEL: Record<string, string> = {
  MANUAL: 'Manual', COBRO: 'Cobros', PAGO: 'Pagos', TRANSFERENCIA: 'Transferencias',
}

export interface MetaReportes {
  negocio:  string
  empresa:  string
  generado: string   // fecha legible
}

/**
 * Libro con una hoja por informe. El orden es el de lectura del asesor: primero
 * qué es esto y de qué período, después el resultado, después la caja.
 */
export async function construirXlsxReportes(
  data: ReportesData,
  meta: MetaReportes,
  incluirConsolidado: boolean,
): Promise<string> {
  const antPorMoneda = new Map(data.anterior.map(a => [a.moneda, a]))
  const comparando   = data.comparar !== 'no' && data.anterior.length > 0
  const etqAnterior  = data.comparar === 'anterior'
    ? etiquetaAnterior(data.desde, data.hasta)
    : LABEL_COMPARACION[data.comparar]

  // Nota de conversión de la portada, honesta con la tasa congelada (mig. 199):
  // dice si las cifras salen de la tasa que el cliente registró por fila
  // (histórica), de la vigente (hoy), o de ambas. Misma semántica que la nota de
  // pantalla y PDF (fraseConversion en ReportesView), en el estilo compacto de la
  // portada.
  const cv = data.convertido
  const cvCongeladas = (cv?.congeladas?.length ?? 0) > 0
  const cvVigente    = (cv?.convertidas.length ?? 0) > 0
  const notaVer = cvCongeladas && cvVigente
    ? ` · convertido: la tasa registrada por fila y la vigente donde falta`
    : cvCongeladas
    ? ` · convertido con la tasa registrada por fila`
    : cvVigente
    ? ` · convertido a la tasa vigente`
    : ''

  // ── Hoja 1: portada ──────────────────────────────────────────────────────
  const portada: HojaExcel = {
    nombre: 'Informe',
    filas: [
      [texto('CLAUX · Reportes financieros', titulo)],
      [texto('')],
      [texto('Negocio', clave),  texto(meta.negocio)],
      [texto('Alcance', clave),  texto(meta.empresa)],
      [texto('Período', clave),  texto(`${data.desde} — ${data.hasta}`)],
      [texto('Moneda', clave), texto(
        data.ver
          ? `Todo en ${data.ver}${notaVer}${data.convertido?.excluidas.length ? ` · sin tasa hacia ${data.ver} (no incluidas): ${data.convertido.excluidas.join(', ')}` : ''}`
          : 'Cada moneda por separado (sin convertir)',
      )],
      [texto('Comparado con', clave), texto(
        data.periodo_comparado
          ? `${data.periodo_comparado.desde} — ${data.periodo_comparado.hasta} (${etqAnterior.toLowerCase()})`
          : 'No se compara',
      )],
      [texto('Generado', clave), texto(meta.generado)],
      [texto('')],
      [texto('Qué contiene', sub)],
      [texto('Estado de resultados'), texto('Devengado: por fecha de factura y de gasto. Un renglón por concepto, con su peso sobre los ingresos.', { wrap: true })],
      [texto('Evolución mensual'),    texto('El mismo resultado, mes a mes.', { wrap: true })],
      [texto('Del resultado a la caja'), texto('Por qué el resultado y el dinero cobrado no coinciden.', { wrap: true })],
      [texto('Flujo de caja'),        texto('Efectivo real. Excluye transferencias internas y cuentas de saldo inicial.', { wrap: true })],
      [texto('')],
      [texto('Cifras operativas generadas por CLAUX a partir de la actividad del negocio; no constituyen un cierre contable oficial.', { wrap: true, color: MARCA.ejemploTx })],
    ],
    columnas: [{ width: 24 }, { width: 74 }],
  }

  // Consolidado de referencia: siempre en la moneda de configuración, sea cual
  // sea la moneda de la vista. Entra solo si el dueño lo tiene visible.
  if (incluirConsolidado && data.consolidado) {
    const c = data.consolidado
    portada.filas.push([texto('')])
    portada.filas.push([texto(`Consolidado en ${c.moneda}`, sub), texto('Convertido a la tasa vigente')])
    if (c.resultado) {
      portada.filas.push([texto('Ingresos'), imp(c.resultado.total_ingresos)])
      portada.filas.push([texto('Gastos'), imp(c.resultado.total_gastos)])
      portada.filas.push([texto('Resultado neto', clave), imp(c.resultado.neto, fuerte)])
    }
    if (c.flujo) {
      portada.filas.push([texto('Flujo neto de caja', clave), imp(c.flujo.neto, fuerte)])
    }
    if (c.monedasExcluidas.length) {
      portada.filas.push([texto('Sin tasa, no incluidas'), texto(c.monedasExcluidas.join(', '))])
    }
  }

  // ── Hoja 2: estado de resultados ─────────────────────────────────────────
  // Una fila por renglón, con `Nivel` como columna propia: así el asesor puede
  // filtrar solo los totales, o solo el detalle, sin deshacer la jerarquía.
  const cabER = ['Moneda', 'Nivel', 'Concepto', 'Importe', '% ingresos']
  if (comparando) cabER.push(etqAnterior, 'Variación %')

  const filasER: (ReturnType<typeof texto> | ReturnType<typeof numero>)[][] = [cabER.map(t => texto(t, cabecera))]

  const NIVEL_LABEL: Record<string, string> = {
    grupo: 'Grupo', cat: 'Categoría', hija: 'Subcategoría', subtotal: 'Subtotal', final: 'Total',
  }

  for (const r of data.resultado) {
    const ant = comparando ? (antPorMoneda.get(r.moneda) ?? null) : null
    for (const f of construirFilasPL(r, ant)) {
      const destacada = f.nivel === 'grupo' || f.nivel === 'subtotal' || f.nivel === 'final'
      const est: CeldaEstilo = destacada ? fuerte : {}
      const fila = [
        texto(r.moneda, est), texto(NIVEL_LABEL[f.nivel] ?? f.nivel, est),
        texto(f.concepto.replace(/^[−=]\s*/, ''), est),
        imp(f.monto, est), pc(f.pct, est),
      ]
      if (comparando) { fila.push(imp(f.anterior, est), pc(f.variacion, est)) }
      filasER.push(fila)

      for (const h of f.hijos ?? []) {
        const fh = [
          texto(r.moneda), texto(NIVEL_LABEL.hija), texto(`${f.concepto} · ${h.concepto}`),
          imp(h.monto), pc(h.pct),
        ]
        if (comparando) { fh.push(imp(h.anterior), pc(h.variacion)) }
        filasER.push(fh)
      }
    }
  }

  const hojaER: HojaExcel = {
    nombre: 'Estado de resultados',
    filas: filasER,
    columnas: [{ width: 10 }, { width: 14 }, { width: 42 }, { width: 16 }, { width: 12 },
               ...(comparando ? [{ width: 16 }, { width: 13 }] : [])],
  }

  const hojas: HojaExcel[] = [portada, hojaER]

  // ── Hoja 3: evolución mensual ────────────────────────────────────────────
  const filasEv = data.resultado.flatMap(r =>
    r.evolucion.map(m => [
      texto(r.moneda), texto(m.mes), texto(etiquetaMes(m.mes)),
      imp(m.ingresos), imp(m.gastos), imp(m.neto),
    ]))
  if (filasEv.length) {
    hojas.push({
      nombre: 'Evolución mensual',
      filas: [
        ['Moneda', 'Mes', 'Etiqueta', 'Ingresos', 'Gastos', 'Resultado'].map(t => texto(t, cabecera)),
        ...filasEv,
      ],
      columnas: [{ width: 10 }, { width: 10 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 16 }],
    })
  }

  // ── Hoja 4: del resultado a la caja ──────────────────────────────────────
  if (data.puente.length) {
    hojas.push({
      nombre: 'Resultado vs caja',
      filas: [
        ['Moneda', 'Concepto', 'Importe'].map(t => texto(t, cabecera)),
        ...data.puente.flatMap(p => [
          [texto(p.moneda, fuerte), texto('Resultado devengado', fuerte), imp(p.resultado, fuerte)],
          [texto(p.moneda), texto('Cobrado en caja'),   imp(p.cobrado)],
          [texto(p.moneda), texto('Pagado desde caja'), imp(-p.pagado)],
          [texto(p.moneda), texto('Pendiente de cobro'), imp(p.pendiente_cobro)],
          [texto(p.moneda), texto('Pendiente de pago'),  imp(p.pendiente_pago)],
          [texto(p.moneda, fuerte), texto('Flujo neto de caja', fuerte), imp(p.flujo, fuerte)],
        ]),
      ],
      columnas: [{ width: 10 }, { width: 30 }, { width: 16 }],
    })
  }

  // ── Hoja 5: flujo de caja ────────────────────────────────────────────────
  if (data.flujo.length) {
    hojas.push({
      nombre: 'Flujo de caja',
      filas: [
        ['Moneda', 'Movimiento', 'Origen', 'Importe'].map(t => texto(t, cabecera)),
        ...data.flujo.flatMap(f => [
          ...f.detalle_entradas.map(e => [texto(f.moneda), texto('Entrada'), texto(ORIGEN_LABEL[e.origen] ?? e.origen), imp(e.monto)]),
          [texto(f.moneda, fuerte), texto('Total entradas', fuerte), texto(''), imp(f.entradas, fuerte)],
          ...f.detalle_salidas.map(s => [texto(f.moneda), texto('Salida'), texto(ORIGEN_LABEL[s.origen] ?? s.origen), imp(s.monto)]),
          [texto(f.moneda, fuerte), texto('Total salidas', fuerte), texto(''), imp(f.salidas, fuerte)],
          [texto(f.moneda, fuerte), texto('Flujo neto', fuerte), texto(''), imp(f.neto, fuerte)],
        ]),
      ],
      columnas: [{ width: 10 }, { width: 18 }, { width: 20 }, { width: 16 }],
    })
  }

  return construirXlsxBase64(hojas)
}
