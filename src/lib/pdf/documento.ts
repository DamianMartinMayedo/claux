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
  // 'datauristring' → "data:application/pdf;...;base64,XXXX" (para adjuntar el PDF
  // en el envío al asesor sin volver a generarlo en servidor).
  output(type: string): string
}

interface JsPdfCtor { new (o: object): JsPdfDoc }

/** Crea un documento A4 en milímetros. */
export async function crearDoc(): Promise<JsPdfDoc> {
  const mod = (await import('jspdf')) as unknown as { jsPDF: JsPdfCtor }
  return new mod.jsPDF({ unit: 'mm', format: 'a4' })
}

// ── Atajos de color con tupla RGB ──────────────────────────────────────────────
/**
 * Sanea un texto para las fuentes ESTÁNDAR de jsPDF (helvetica), que codifican en
 * WinAnsi: un carácter fuera de esa tabla no se omite, se pinta como OTRO glifo.
 *
 * El caso que nos mordió: el signo menos tipográfico `−` (U+2212) —el que usa la
 * UI, y con razón, porque el guion ASCII es más corto y no alinea— salía en el PDF
 * como una comilla doble: «Coste de ventas "150.000,00». Un importe negativo que
 * parece llevar comillas es exactamente la clase de detalle que hace desconfiar de
 * todo el documento.
 *
 * Se aplica en el CURSOR (`lib/pdf/reporte.ts`), no en cada llamada: es una
 * propiedad de la fuente, no de quien escribe. Si algún día se incrusta una fuente
 * TTF con Unicode completo, esto se borra de un sitio.
 */
export function textoPdfSeguro(s: string): string {
  return s
    .replace(/[−‒–]/g, '-')   // menos, figure dash, en dash
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
}

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
 * Descarga una imagen y la re-codifica a PNG (vía canvas) con sus dimensiones,
 * para que jsPDF la incruste sin importar el formato de origen (png/jpg/webp…).
 * Nunca lanza: cualquier fallo (red, CORS, decodificación) resuelve `null` y el
 * documento se genera igual sin logo.
 *
 * Vive aquí, con el resto de la plantilla de marca, porque la usan TODOS los
 * documentos con cabecera de empresa (factura, oferta, recibo de nómina). Nació
 * dentro de `venta.ts` y se movió al aparecer el segundo consumidor: copiarla
 * habría dejado dos cargadores que se degradan distinto ante el mismo fallo de red.
 */
export async function cargarLogoPng(
  url: string,
): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    const srcUrl = await new Promise<string | null>(resolve => {
      const fr = new FileReader()
      fr.onload  = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
    if (!srcUrl) return null
    return await new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width  = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx || !canvas.width || !canvas.height) { resolve(null); return }
          ctx.drawImage(img, 0, 0)
          resolve({ dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height })
        } catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = srcUrl
    })
  } catch {
    return null
  }
}

/**
 * Cabecera de empresa compartida por los documentos de negocio (factura, oferta,
 * recibo de nómina): logo —o recuadro con la inicial si no hay o falla— y los datos
 * fiscales a su derecha. Devuelve la Y donde acaba el bloque.
 *
 * El recuadro con la inicial NO es un caso de error: es el aspecto normal de una
 * empresa que no ha subido logo, y es lo que garantiza que la descarga nunca se
 * rompa por una imagen inalcanzable (decisivo con la conexión de Cuba).
 */
export async function cabeceraEmpresa(
  doc: JsPdfDoc,
  e: {
    nombre: string; nombre_fiscal?: string | null; rif_nit?: string | null
    direccion?: string | null; ciudad?: string | null; pais?: string | null
    telefono?: string | null; email?: string | null
    logo_url?: string | null; mostrar_logo?: boolean | null
    letra_facturacion?: string | null; color: string
  },
  y: number,
): Promise<number> {
  const logoBox = 16
  const logo = e.logo_url && e.mostrar_logo !== false ? await cargarLogoPng(e.logo_url) : null

  let logoDibujado = false
  if (logo) {
    try {
      const escala = Math.min(logoBox / logo.w, logoBox / logo.h)
      const w = logo.w * escala
      const h = logo.h * escala
      doc.addImage(logo.dataUrl, 'PNG', MARGEN + (logoBox - w) / 2, y + (logoBox - h) / 2, w, h)
      logoDibujado = true
    } catch { logoDibujado = false }
  }
  if (!logoDibujado) {
    relleno(doc, hexToRgb(e.color) ?? MARCA.muted)
    doc.roundedRect(MARGEN, y, logoBox, logoBox, 2, 2, 'F')
    const inicial = (e.letra_facturacion ?? e.nombre.charAt(0)).toUpperCase()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
    texto(doc, MARCA.white)
    doc.text(inicial, MARGEN + logoBox / 2, y + logoBox / 2 + 2.4, { align: 'center' })
  }

  const infoX = MARGEN + logoBox + 5
  let ey = y + 4
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  texto(doc, MARCA.dark)
  doc.text(e.nombre_fiscal ?? e.nombre, infoX, ey)
  ey += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  texto(doc, MARCA.faint)
  const lineas = [
    e.rif_nit ? `NIF/NIT: ${e.rif_nit}` : null,
    [e.direccion, e.ciudad, e.pais].filter(Boolean).join(', ') || null,
    [e.telefono, e.email].filter(Boolean).join('  ·  ') || null,
  ].filter(Boolean) as string[]
  for (const linea of lineas) { doc.text(linea, infoX, ey); ey += 4 }
  return ey
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
