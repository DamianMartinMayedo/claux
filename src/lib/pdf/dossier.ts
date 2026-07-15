// ── Estado de resultados del dossier en PDF (jsPDF, vectorial) ──────────────
//
// Un clic → archivo, sin abrir otra página ni recargar: en Cuba descargar solo
// para revisar cuesta datos. El PDF se DIBUJA en coordenadas sobre la plantilla
// de marca de `documento.ts`; no es una captura del HTML.
//
// Bebe del MISMO snapshot congelado que alimenta el deck, así que este PDF no
// puede contradecir el enlace que el dueño acaba de enseñar: los dos leen una
// serie que solo cambia cuando él confirma la actualización.

import {
  crearDoc, cabeceraReporte, sellarPie, texto, trazo,
  MARCA, MARGEN, type JsPdfDoc,
} from './documento'
import { crearCursor } from './reporte'
import { estadoDeResultados, notaConversion, congeladoA, type CategoriaMonto } from '@/lib/dossier/estado'
import { etiquetaMes, type FilaSerie } from '@/lib/dossier/snapshot'
import type { LineaDesglose } from '@/lib/dossier/base'

export interface TasaPdf { tasa: number; fecha: string | null }

export interface EstadoResultadosPdf {
  /** Nombre de la empresa, o "Todas las empresas" en el consolidado. */
  empresa: string
  moneda: string
  periodoDesde: string | null
  periodoHasta: string | null
  snapshotAt: string | null
  serie: FilaSerie[]
  lineas: LineaDesglose[]
  tasas: Record<string, TasaPdf>
  faltantes: string[]
}

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (n: number) => nf.format(n)
const fmtPct = (n: number) => `${n.toFixed(1).replace('.', ',')} %`

function fechaLarga(f: string | null): string {
  if (!f) return ''
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function construirEstadoResultados(doc: JsPdfDoc, d: EstadoResultadosPdf): void {
  const er  = estadoDeResultados(d.serie, d.lineas)
  const cur = crearCursor(doc)

  const right = doc.internal.pageSize.getWidth() - MARGEN
  const periodo = d.periodoDesde && d.periodoHasta
    ? `${fechaLarga(d.periodoDesde)} — ${fechaLarga(d.periodoHasta)}`
    : ''

  cur.y = cabeceraReporte(doc, {
    titulo:    'Estado de resultados',
    izquierda: d.empresa,
    derecha:   periodo,
  })

  cur.nota(`${congeladoA(d.snapshotAt)} · Importes en ${d.moneda}.`)
  cur.salto(4)

  // Un grupo: cabecera en negrita + su desglose por categoría indentado.
  const grupo = (label: string, total: number, cats: CategoriaMonto[]) => {
    cur.fila(label, fmt(total), { bold: true })
    if (cats.length === 0) {
      cur.fila('Sin desglose por categoría', '', { indent: true, color: MARCA.faint, size: 9 })
      return
    }
    for (const c of cats) cur.fila(c.concepto, fmt(c.monto), { indent: true })
  }

  grupo('Ingresos', er.ingresos, er.ingresosPorCategoria)
  grupo('Coste de ventas', er.costoVentas, er.costoPorCategoria)
  cur.filaTotal(`Margen bruto (${fmtPct(er.margenBrutoPct)})`, fmt(er.margenBruto))

  grupo('Gastos operativos', er.gastosOperativos, er.gastosPorCategoria)
  cur.filaTotal(`Resultado neto (${fmtPct(er.margenNetoPct)})`, fmt(er.resultadoNeto))

  // ── Evolución mensual ──
  // Rejilla mes × concepto: el cursor genérico es etiqueta+importe y esta tabla
  // de 5 columnas solo existe aquí, así que se dibuja en local sobre su misma `y`.
  if (er.evolucion.length > 0) {
    cur.salto(2)
    cur.titulo('Evolución mensual')

    const xIni  = MARGEN + 26
    const ancho = (right - xIni) / 4
    const colX  = (i: number) => xIni + ancho * (i + 1)

    const filaMes = (mes: string, vals: string[], head = false) => {
      cur.ensure(head ? 9 : 6)
      doc.setFont('helvetica', head ? 'bold' : 'normal')
      doc.setFontSize(head ? 8 : 9)
      texto(doc, head ? MARCA.muted : MARCA.dark)
      doc.text(mes, MARGEN, cur.y)
      vals.forEach((v, i) => doc.text(v, colX(i), cur.y, { align: 'right' }))
      if (head) {
        cur.y += 2
        trazo(doc, MARCA.divider); doc.setLineWidth(0.2)
        doc.line(MARGEN, cur.y, right, cur.y)
        cur.y += 4
      } else {
        cur.y += 5
      }
    }

    filaMes('Mes', ['Ingresos', 'Coste de ventas', 'Gastos operativos', 'Neto'], true)
    for (const e of er.evolucion) {
      filaMes(etiquetaMes(e.mes), [fmt(e.ingresos), fmt(e.costoVentas), fmt(e.gastosOperativos), fmt(e.neto)])
    }
  }

  // ── Nota de conversión: la tasa aplicada y su fecha, impresas ──
  const nota = notaConversion(d.moneda, d.tasas, d.faltantes)
  if (nota) {
    cur.salto(4)
    cur.nota(nota)
  }
}

/**
 * Genera y descarga el PDF en un solo paso, en cliente, con los datos que la
 * vista ya tiene cargados (principio de descargas directas del proyecto).
 */
export async function descargarEstadoResultados(
  d: EstadoResultadosPdf,
  filename?: string,
): Promise<void> {
  const doc = await crearDoc()
  construirEstadoResultados(doc, d)
  sellarPie(doc)
  doc.save(filename ?? 'estado_de_resultados.pdf')
}
