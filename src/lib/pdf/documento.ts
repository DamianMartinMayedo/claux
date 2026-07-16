// ────────────────────────────────────────────────────────────────────────────
// Generación de PDFs vectoriales de marca (jsPDF).
//
// Módulo cliente-only: `jspdf` se importa de forma dinámica dentro de las
// funciones para no engordar el bundle del portal. Todos los documentos
// descargables (facturas, ofertas, reportes) comparten esta plantilla:
//   · paleta CLAUX (tokens de 01-tokens.css, en RGB — el PDF es siempre blanco)
//   · cabecera de marca opcional
//   · sello discreto de pie en TODAS las páginas (la "marca de agua")
//
// Nota de color: el PDF no tiene modo oscuro. Su espejo son los tokens `--paper-*`
// de 01-tokens.css, NO los `--color-*`: una hoja impresa es siempre clara y no
// cambia cuando cambia la marca. Ojo con el ámbar en particular — `--color-amber`
// es cromo de marca y ya se ha movido dos veces; `--paper-amber` no se ha movido
// nunca y no debe. Si algún día quieres recolorear el papel, cambia `--paper-*` y
// refleja ESO aquí.
// ────────────────────────────────────────────────────────────────────────────

export type RGB = [number, number, number]

/** Paleta CLAUX en RGB — reflejo de los tokens `--paper-*` de `01-tokens.css`. */
export const MARCA = {
  teal:     [  0, 175, 170] as RGB,  // --paper-teal        #00AFAA
  tealText: [  0, 113, 109] as RGB,  // --paper-teal-ink    #00716D
  dark:     [ 28,  27,  22] as RGB,  // --paper-ink         #1C1B16
  muted:    [ 92,  91,  82] as RGB,  // --paper-ink-muted   #5C5B52
  faint:    [118, 116, 106] as RGB,  // --paper-ink-faint   #76746A
  divider:  [199, 197, 188] as RGB,  // #C7C5BC — sin equivalente en --paper-*; es el divisor fuerte
  border:   [217, 215, 208] as RGB,  // --paper-line        #D9D7D0
  surface:  [239, 237, 232] as RGB,  // --paper-surface     #EFEDE8
  amber:    [201, 122,  12] as RGB,  // --paper-amber       #C97A0C (≠ --color-amber, a propósito)
  amberBg:  [254, 243, 199] as RGB,  // --paper-amber-bg    #FEF3C7
  amberTxt: [120,  53,  15] as RGB,  // --paper-amber-ink   #78350F
  white:    [255, 255, 255] as RGB,  // --paper-bg          #FFFFFF
}

/** Margen A4 estándar (mm) del documento. */
export const MARGEN = 16
/** Espacio reservado en el borde inferior para el sello de pie (mm). */
export const RESERVA_PIE = 18

// Interfaz mínima de jsPDF: su .d.ts empaquetado no es un módulo ES y TS lo
// rechaza, así que declaramos solo lo que usamos.
export interface JsPdfDoc {
  internal: { pageSize: { getWidth(): number; getHeight(): number } }
  setFont(family: string, style: string): void
  setFontSize(n: number): void
  setTextColor(r: number, g: number, b: number): void
  setDrawColor(r: number, g: number, b: number): void
  setFillColor(r: number, g: number, b: number): void
  setLineWidth(w: number): void
  text(text: string | string[], x: number, y: number, opts?: { align?: string }): void
  line(x1: number, y1: number, x2: number, y2: number): void
  rect(x: number, y: number, w: number, h: number, style?: string): void
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style?: string): void
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void
  addPage(): void
  setPage(n: number): void
  getNumberOfPages(): number
  splitTextToSize(text: string, maxWidth: number): string[]
  getTextWidth(text: string): number
  save(filename: string): void
}

interface JsPdfCtor { new (o: object): JsPdfDoc }

/** Crea un documento A4 en milímetros. */
export async function crearDoc(): Promise<JsPdfDoc> {
  const mod = (await import('jspdf')) as unknown as { jsPDF: JsPdfCtor }
  return new mod.jsPDF({ unit: 'mm', format: 'a4' })
}

// ── Atajos de color con tupla RGB ──────────────────────────────────────────────
export const texto   = (d: JsPdfDoc, c: RGB) => d.setTextColor(c[0], c[1], c[2])
export const trazo   = (d: JsPdfDoc, c: RGB) => d.setDrawColor(c[0], c[1], c[2])
export const relleno = (d: JsPdfDoc, c: RGB) => d.setFillColor(c[0], c[1], c[2])

/** Convierte un hex (#RGB o #RRGGBB) a tupla RGB; `null` si no es válido. */
export function hexToRgb(hex: string | null | undefined): RGB | null {
  if (!hex) return null
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/**
 * Cabecera de marca para documentos de reporte: acento teal + título grande y
 * un subtítulo con dato a izquierda y a derecha, cerrado por una divisoria.
 * Devuelve la coordenada Y donde continúa el contenido.
 */
export function cabeceraReporte(
  doc: JsPdfDoc,
  opts: { titulo: string; izquierda?: string; derecha?: string },
): number {
  const pageW = doc.internal.pageSize.getWidth()
  const right = pageW - MARGEN
  let y = MARGEN + 1

  relleno(doc, MARCA.teal)
  doc.rect(MARGEN, y, 12, 1.6, 'F')
  y += 8

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
  texto(doc, MARCA.dark); doc.text(opts.titulo, MARGEN, y)
  y += 7

  if (opts.izquierda || opts.derecha) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    texto(doc, MARCA.muted)
    if (opts.izquierda) doc.text(opts.izquierda, MARGEN, y)
    if (opts.derecha)   doc.text(opts.derecha, right, y, { align: 'right' })
    y += 3
  }

  trazo(doc, MARCA.divider); doc.setLineWidth(0.3)
  doc.line(MARGEN, y, right, y)
  return y + 9
}

/**
 * Sella el pie de marca —la "marca de agua" discreta— en TODAS las páginas:
 * fina divisoria, wordmark CLAUX en teal, la nota de origen y la numeración.
 * Llamar al final, justo antes de `doc.save()`.
 */
export function sellarPie(doc: JsPdfDoc, nota = 'Documento generado con CLAUX'): void {
  const total = doc.getNumberOfPages()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const yLinea = pageH - 12
  const yTexto = pageH - 7

  for (let i = 1; i <= total; i++) {
    doc.setPage(i)

    trazo(doc, MARCA.border); doc.setLineWidth(0.2)
    doc.line(MARGEN, yLinea, pageW - MARGEN, yLinea)

    doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    texto(doc, MARCA.teal); doc.text('CLAUX', MARGEN, yTexto)
    const wMark = doc.getTextWidth('CLAUX')

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    texto(doc, MARCA.faint)
    doc.text('· ' + nota, MARGEN + wMark + 1.5, yTexto)

    doc.text(`Página ${i} de ${total}`, pageW - MARGEN, yTexto, { align: 'right' })
  }
}
