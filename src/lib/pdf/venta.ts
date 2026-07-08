// ────────────────────────────────────────────────────────────────────────────
// Constructor vectorial (jsPDF) de facturas y ofertas comerciales.
//
// Diseño: limpio, blanco, sobre A4. Texto nítido de imprenta (no captura de
// HTML), negro sobre blanco con reglas finas; la marca aparece solo en el sello
// discreto del pie. Sin dependencias de red frágiles: el logo del tenant se
// normaliza a PNG vía canvas y, si falla, cae al recuadro con la inicial —
// nunca rompe la descarga (clave para producción y para la conexión de Cuba).
// ────────────────────────────────────────────────────────────────────────────

import {
  MARCA, MARGEN, RESERVA_PIE, texto, trazo, relleno, hexToRgb,
  crearDoc, sellarPie, type JsPdfDoc,
} from './documento'
import {
  AJUSTE_TIPO_LABEL, CONDICION_PAGO_LABEL, formatearMoneda,
} from '@/app/portal/(app)/ventas/_ventas-helpers'
import type { DocumentoLinea, DocumentoAjuste } from '@/app/actions/portal/ventas'

export interface EmpresaPdf {
  nombre:            string
  nombre_fiscal:     string | null
  rif_nit:           string | null
  direccion:         string | null
  ciudad:            string | null
  pais:              string | null
  telefono:          string | null
  email:             string | null
  logo_url:          string | null
  mostrar_logo?:     boolean | null
  letra_facturacion: string | null
  color:             string
}

export interface ClientePdf {
  nombre:         string
  identificacion: string | null
  direccion:      string | null
  ciudad:         string | null
  pais:           string | null
  email:          string | null
  telefono:       string | null
}

export interface DocumentoVentaPdf {
  titulo:           'OFERTA COMERCIAL' | 'FACTURA'
  numero:           string
  fechaEmision:     string
  fechaSecundaria?: { label: string; valor: string }
  condicionPago?:   string
  empresa:          EmpresaPdf
  cliente:          ClientePdf
  moneda:           string
  lineas:           DocumentoLinea[]
  ajustes:          DocumentoAjuste[]
  subtotal:         number
  total:            number
  notas:            string | null
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

/**
 * Descarga una imagen y la re-codifica a PNG (vía canvas) con sus dimensiones,
 * para que jsPDF la incruste sin importar el formato de origen (png/jpg/webp…).
 * Nunca lanza: cualquier fallo (red, CORS, decodificación) resuelve `null` y el
 * documento se genera igual sin logo.
 */
async function cargarLogoPng(
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

// ── Constructor ───────────────────────────────────────────────────────────────

/**
 * Dibuja el documento completo en `doc`. El llamador añade el sello de pie
 * (`sellarPie`) y guarda — o usa `descargarDocumentoVenta` que lo hace todo.
 */
export async function construirDocumentoVenta(
  doc: JsPdfDoc,
  d: DocumentoVentaPdf,
): Promise<void> {
  const pageH = doc.internal.pageSize.getHeight()
  const M     = MARGEN
  const right = doc.internal.pageSize.getWidth() - M
  const limiteInferior = pageH - RESERVA_PIE - 4
  let y = M

  // ── Cabecera: empresa (izq) · documento (der) ─────────────────────────────
  const logoBox = 16
  const logo = d.empresa.logo_url && d.empresa.mostrar_logo !== false
    ? await cargarLogoPng(d.empresa.logo_url)
    : null

  let logoDibujado = false
  if (logo) {
    try {
      const escala = Math.min(logoBox / logo.w, logoBox / logo.h)
      const w = logo.w * escala
      const h = logo.h * escala
      doc.addImage(logo.dataUrl, 'PNG', M + (logoBox - w) / 2, y + (logoBox - h) / 2, w, h)
      logoDibujado = true
    } catch { logoDibujado = false }
  }
  if (!logoDibujado) {
    const color = hexToRgb(d.empresa.color) ?? MARCA.muted
    relleno(doc, color)
    doc.roundedRect(M, y, logoBox, logoBox, 2, 2, 'F')
    const inicial = (d.empresa.letra_facturacion ?? d.empresa.nombre.charAt(0)).toUpperCase()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
    texto(doc, MARCA.white)
    doc.text(inicial, M + logoBox / 2, y + logoBox / 2 + 2.4, { align: 'center' })
  }

  const infoX = M + logoBox + 5
  let ey = y + 4
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  texto(doc, MARCA.dark)
  doc.text(d.empresa.nombre_fiscal ?? d.empresa.nombre, infoX, ey)
  ey += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  texto(doc, MARCA.faint)
  const empresaLineas = [
    d.empresa.rif_nit ? `NIF/NIT: ${d.empresa.rif_nit}` : null,
    [d.empresa.direccion, d.empresa.ciudad, d.empresa.pais].filter(Boolean).join(', ') || null,
    [d.empresa.telefono, d.empresa.email].filter(Boolean).join('  ·  ') || null,
  ].filter(Boolean) as string[]
  for (const linea of empresaLineas) { doc.text(linea, infoX, ey); ey += 4 }

  // Bloque de documento (derecha)
  let dy = y + 3
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
  texto(doc, MARCA.faint); doc.text(d.titulo, right, dy, { align: 'right' })
  dy += 8
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  texto(doc, MARCA.dark); doc.text(d.numero, right, dy, { align: 'right' })
  dy += 7
  doc.setFontSize(9)
  const meta: [string, string][] = [['Fecha', fmtFecha(d.fechaEmision)]]
  if (d.fechaSecundaria) meta.push([d.fechaSecundaria.label, fmtFecha(d.fechaSecundaria.valor)])
  if (d.condicionPago && d.condicionPago !== 'CONTADO') {
    meta.push(['Pago', CONDICION_PAGO_LABEL[d.condicionPago] ?? d.condicionPago])
  }
  for (const [label, valor] of meta) {
    doc.setFont('helvetica', 'normal'); texto(doc, MARCA.muted)
    const wv = doc.getTextWidth(valor)
    doc.text(valor, right, dy, { align: 'right' })
    doc.setFont('helvetica', 'bold'); texto(doc, MARCA.dark)
    doc.text(`${label}:`, right - wv - 2, dy, { align: 'right' })
    dy += 4.5
  }

  y = Math.max(ey, dy) + 5
  trazo(doc, MARCA.dark); doc.setLineWidth(0.4)
  doc.line(M, y, right, y)
  y += 9

  // ── Cliente (bloque limpio, sin relleno) ──────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
  texto(doc, MARCA.faint); doc.text('CLIENTE', M, y)
  y += 5.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5)
  texto(doc, MARCA.dark); doc.text(d.cliente.nombre, M, y)
  y += 4.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  texto(doc, MARCA.muted)
  const clienteLineas = [
    d.cliente.identificacion ? `ID: ${d.cliente.identificacion}` : null,
    [d.cliente.direccion, d.cliente.ciudad, d.cliente.pais].filter(Boolean).join(', ') || null,
    [d.cliente.email, d.cliente.telefono].filter(Boolean).join('  ·  ') || null,
  ].filter(Boolean) as string[]
  for (const linea of clienteLineas) { doc.text(linea, M, y); y += 4.2 }
  y += 8

  // ── Tabla de líneas (cabecera con regla, sin banda de color) ──────────────
  const conDto  = d.lineas.some(l => Number(l.descuento_pct) > 0)
  const cTotal  = right
  const cDto    = conDto ? cTotal - 30 : cTotal
  const cPrecio = conDto ? cDto - 24 : cTotal - 34
  const cCant   = cPrecio - 26
  const descX   = M
  const descW   = cCant - 20 - descX

  const cabeceraTabla = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    texto(doc, MARCA.faint)
    const th = y + 3
    doc.text('DESCRIPCIÓN', descX, th)
    doc.text('CANTIDAD', cCant, th, { align: 'right' })
    doc.text('PRECIO UNIT.', cPrecio, th, { align: 'right' })
    if (conDto) doc.text('DTO.%', cDto, th, { align: 'right' })
    doc.text('TOTAL', cTotal, th, { align: 'right' })
    y += 6
    trazo(doc, MARCA.dark); doc.setLineWidth(0.4)
    doc.line(M, y, right, y)
    y += 4
  }

  cabeceraTabla()
  doc.setFontSize(9.5)
  for (const l of d.lineas) {
    const desc = doc.splitTextToSize(String(l.descripcion ?? ''), descW)
    const filaH = Math.max(8, desc.length * 4.4 + 3.5)
    if (y + filaH > limiteInferior) { doc.addPage(); y = M; cabeceraTabla(); doc.setFontSize(9.5) }

    const ty = y + 4.5
    doc.setFont('helvetica', 'normal'); texto(doc, MARCA.dark)
    doc.text(desc, descX, ty)
    texto(doc, MARCA.muted)
    doc.text(String(Number(l.cantidad)), cCant, ty, { align: 'right' })
    doc.text(formatearMoneda(Number(l.precio_unitario), d.moneda), cPrecio, ty, { align: 'right' })
    if (conDto) {
      doc.text(Number(l.descuento_pct) > 0 ? `${Number(l.descuento_pct)}%` : '', cDto, ty, { align: 'right' })
    }
    texto(doc, MARCA.dark)
    doc.text(formatearMoneda(Number(l.total), d.moneda), cTotal, ty, { align: 'right' })

    y += filaH
    trazo(doc, MARCA.border); doc.setLineWidth(0.15)
    doc.line(M, y, right, y)
  }
  y += 8

  // ── Totales (bloque derecho) ──────────────────────────────────────────────
  const totX = right - 78
  const filaTotal = (label: string, valor: string) => {
    if (y + 7 > limiteInferior) { doc.addPage(); y = M }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    texto(doc, MARCA.muted)
    doc.text(label, totX, y)
    doc.text(valor, right, y, { align: 'right' })
    y += 6
  }

  filaTotal('Subtotal', formatearMoneda(d.subtotal, d.moneda))
  for (const a of d.ajustes) {
    const signo = a.tipo === 'DESCUENTO' ? '−' : '+'
    filaTotal(
      `${signo} ${a.nombre || AJUSTE_TIPO_LABEL[a.tipo]}`,
      `${signo} ${formatearMoneda(Number(a.monto_calculado), d.moneda)}`,
    )
  }
  y += 1
  trazo(doc, MARCA.dark); doc.setLineWidth(0.4)
  doc.line(totX, y, right, y)
  y += 6.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  texto(doc, MARCA.dark)
  doc.text('Total', totX, y)
  doc.text(formatearMoneda(d.total, d.moneda), right, y, { align: 'right' })
  y += 11

  // ── Notas (bloque limpio, sin relleno) ────────────────────────────────────
  if (d.notas) {
    doc.setFontSize(9)
    const notasLineas = doc.splitTextToSize(d.notas, right - M)
    const bloqueH = 10 + notasLineas.length * 4.2
    if (y + bloqueH > limiteInferior) { doc.addPage(); y = M }
    trazo(doc, MARCA.border); doc.setLineWidth(0.2)
    doc.line(M, y, right, y)
    y += 5.5
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    texto(doc, MARCA.faint); doc.text('NOTAS', M, y)
    y += 5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    texto(doc, MARCA.muted); doc.text(notasLineas, M, y)
  }
}

/**
 * Genera y descarga el PDF de una factura/oferta en un solo paso, en cliente,
 * a partir de los datos que la vista ya tiene cargados: un clic → archivo, sin
 * navegar ni recargar (principio de descargas directas del proyecto).
 */
export async function descargarDocumentoVenta(
  d: DocumentoVentaPdf,
  filename?: string,
): Promise<void> {
  const doc = await crearDoc()
  await construirDocumentoVenta(doc, d)
  sellarPie(doc)
  doc.save(filename ?? `${d.numero}.pdf`)
}
