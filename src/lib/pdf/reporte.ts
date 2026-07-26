// ── Cursor de reporte para PDFs vectoriales (jsPDF) ─────────────────────────
//
// Los ayudantes de dibujo de un reporte (ensure/fila/título/total/nota) cierran
// sobre una `y` mutable, así que no salen como funciones libres: necesitan un
// cursor con estado. `crearCursor(doc)` lo encapsula sobre el documento de marca
// de `documento.ts`.
//
// NACE con un solo caller (el estado de resultados del dossier). ReportesView
// tiene helpers idénticos inline; migrará a este cursor en un PR aparte (F7) —
// extraer primero acoplaba la entrega al riesgo de una regresión en los reportes
// de la base. Por eso el comportamiento aquí reproduce el de ReportesView.

import {
  type JsPdfDoc, type RGB, MARCA, MARGEN, RESERVA_PIE, texto, trazo, textoPdfSeguro,
} from './documento'

export interface FilaOpts {
  bold?: boolean
  color?: RGB
  indent?: boolean
  gap?: number
  size?: number
  /**
   * Segunda columna numérica, a la izquierda del importe. Existe para el informe
   * COMPARATIVO: el período anterior y su Δ tienen que caer en su propia vertical,
   * no colgando del texto del concepto — si no, el asesor no puede leer una
   * columna de arriba abajo, que es exactamente lo que hace con una comparativa.
   */
  col2?: string
  col3?: string
}

/** Separación (mm) de las columnas extra respecto al margen derecho. */
const COL2_OFFSET = 62
const COL3_OFFSET = 28

export interface CursorPdf {
  /** Coordenada Y actual (mm). Se puede leer y fijar (p. ej. tras `cabeceraReporte`). */
  y: number
  /** Salta a página nueva si no caben `space` mm antes del pie reservado. */
  ensure(space: number): void
  /** Avanza la Y `mm` milímetros. */
  salto(mm: number): void
  /** Fila etiqueta … importe (importe alineado a la derecha). */
  fila(label: string, amount: string, opts?: FilaOpts): void
  /** Título de sección (grande, oscuro). */
  titulo(text: string): void
  /** Cabecera de tabla: etiqueta izquierda + etiqueta derecha y una regla debajo.
   *  `col2`/`col3` rotulan las columnas extra de `FilaOpts` (informe comparativo). */
  cabeceraTabla(izquierda: string, derecha: string, col2?: string, col3?: string): void
  /** Fila de total: regla superior + etiqueta/importe en teal y negrita. */
  filaTotal(label: string, amount: string): void
  /** Párrafo de nota (envuelve al ancho útil); para la nota de conversión. */
  nota(text: string, opts?: { bold?: boolean; color?: RGB; size?: number; gap?: number }): void
}

export function crearCursor(doc: JsPdfDoc, opts?: { margen?: number }): CursorPdf {
  const M = opts?.margen ?? MARGEN
  const right = doc.internal.pageSize.getWidth() - M
  const pageH = doc.internal.pageSize.getHeight()

  const cur: CursorPdf = {
    y: M,

    ensure(space) {
      if (cur.y + space > pageH - RESERVA_PIE - 2) { doc.addPage(); cur.y = M }
    },

    salto(mm) { cur.y += mm },

    fila(label, amount, o = {}) {
      cur.ensure(7)
      doc.setFont('helvetica', o.bold ? 'bold' : 'normal')
      doc.setFontSize(o.size ?? 10)
      texto(doc, o.color ?? MARCA.dark)
      doc.text(textoPdfSeguro(label), o.indent ? M + 4 : M, cur.y)
      if (o.col2) doc.text(textoPdfSeguro(o.col2), right - COL2_OFFSET, cur.y, { align: 'right' })
      if (o.col3) doc.text(textoPdfSeguro(o.col3), right - COL3_OFFSET, cur.y, { align: 'right' })
      if (amount) doc.text(textoPdfSeguro(amount), right, cur.y, { align: 'right' })
      cur.y += o.gap ?? 6
    },

    titulo(text) {
      cur.ensure(12)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      texto(doc, MARCA.dark)
      doc.text(textoPdfSeguro(text), M, cur.y)
      cur.y += 7
    },

    cabeceraTabla(izquierda, derecha, col2, col3) {
      cur.ensure(9)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      texto(doc, MARCA.muted)
      doc.text(textoPdfSeguro(izquierda), M, cur.y)
      if (col2) doc.text(textoPdfSeguro(col2), right - COL2_OFFSET, cur.y, { align: 'right' })
      if (col3) doc.text(textoPdfSeguro(col3), right - COL3_OFFSET, cur.y, { align: 'right' })
      if (derecha) doc.text(textoPdfSeguro(derecha), right, cur.y, { align: 'right' })
      cur.y += 2
      trazo(doc, MARCA.divider)
      doc.setLineWidth(0.2)
      doc.line(M, cur.y, right, cur.y)
      cur.y += 5
    },

    filaTotal(label, amount) {
      cur.ensure(13)
      // Regla arriba del total y el texto debajo (la línea no atraviesa las letras).
      trazo(doc, MARCA.dark)
      doc.setLineWidth(0.4)
      doc.line(M, cur.y, right, cur.y)
      cur.y += 5
      cur.fila(label, amount, { bold: true, color: MARCA.teal, gap: 9 })
    },

    nota(text, o = {}) {
      doc.setFont('helvetica', o.bold ? 'bold' : 'normal')
      doc.setFontSize(o.size ?? 8.5)
      texto(doc, o.color ?? MARCA.muted)
      for (const ln of doc.splitTextToSize(textoPdfSeguro(text), right - M)) {
        cur.ensure(6)
        doc.text(ln, M, cur.y)
        cur.y += o.gap ?? 4.5
      }
    },
  }

  return cur
}
