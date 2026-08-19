// ── El documento legal firmado, en PDF ──
//
// Misma plantilla de marca que la factura/presupuesto (`documento.ts`): filete
// teal, helvetica saneada por `textoPdfSeguro` y el pie sellado en cada página.
// Renderiza un `DocumentoResuelto` (el MISMO que ve el cliente en pantalla y
// sobre el que se calculó el hash) y añade el sello de firma electrónica: lado
// CLAUX con los datos del proveedor, lado Cliente con quién firmó, cuándo y el
// hash del contenido aceptado.
//
// Cliente-only, como el resto de `lib/pdf/*`: jsPDF se importa dinámicamente
// dentro de `crearDoc()` y `doc.save()` descarga sin abrir pestaña (conexión de
// Cuba). El mismo Blob se puede subir al bucket privado sin regenerarlo.

import {
  crearDoc, cabeceraReporte, sellarPie, texto, trazo, textoPdfSeguro,
  MARCA, MARGEN, RESERVA_PIE, type JsPdfDoc,
} from './documento'
import type { DatosProveedor, DocumentoResuelto } from '@/lib/documentos/render'

export interface SelloFirma {
  firmadoPorNombre: string
  firmadoPorEmail:  string
  firmadoAt:        string   // ISO
  docHash:          string
}

function fechaLarga(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export async function construirDocumentoFirmado(
  doc0: DocumentoResuelto,
  prov: DatosProveedor,
  sello: SelloFirma,
): Promise<JsPdfDoc> {
  const doc = await crearDoc()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const right = pageW - MARGEN
  const ancho = right - MARGEN
  const limite = pageH - RESERVA_PIE

  let y = cabeceraReporte(doc, {
    titulo: doc0.titulo,
    izquierda: doc0.subtitulo,
    derecha: fechaLarga(sello.firmadoAt),
  })

  const salto = (alto: number) => {
    if (y + alto > limite) { doc.addPage(); y = MARGEN + 4 }
  }
  const escribir = (s: string | string[], x: number, yy: number, opts?: { align?: string }) => {
    const limpio = Array.isArray(s) ? s.map(textoPdfSeguro) : textoPdfSeguro(s)
    doc.text(limpio as string, x, yy, opts)
  }
  const parrafo = (s: string, x = MARGEN, w = ancho) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); texto(doc, MARCA.dark)
    const lineas = doc.splitTextToSize(textoPdfSeguro(s), w)
    for (const ln of lineas) { salto(6); escribir(ln, x, y); y += 5 }
  }
  const tituloSeccion = (t: string) => {
    salto(10); y += 2
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); texto(doc, MARCA.dark)
    escribir(t, MARGEN, y); y += 6
  }

  // ── Cuerpo ──
  for (const el of doc0.cuerpo) {
    if (el.tipo === 'seccion') {
      if (el.titulo) tituloSeccion(el.titulo)
      for (const p of el.parrafos) { parrafo(p); y += 1.5 }
    } else if (el.tipo === 'lista') {
      if (el.titulo) tituloSeccion(el.titulo)
      for (const it of el.items) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); texto(doc, MARCA.dark)
        const lineas = doc.splitTextToSize(textoPdfSeguro(it), ancho - 5)
        lineas.forEach((ln: string, i: number) => {
          salto(6)
          if (i === 0) escribir('·', MARGEN, y)
          escribir(ln, MARGEN + 5, y); y += 5
        })
        y += 1
      }
    } else if (el.tipo === 'tabla') {
      if (el.titulo) tituloSeccion(el.titulo)
      const c1 = MARGEN, c2 = MARGEN + ancho * 0.55, c3 = right
      salto(8)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); texto(doc, MARCA.muted)
      escribir(el.columnas[0], c1, y)
      escribir(el.columnas[1], c2, y)
      escribir(el.columnas[2], c3, y, { align: 'right' })
      y += 2.5
      trazo(doc, MARCA.border); doc.setLineWidth(0.2); doc.line(MARGEN, y, right, y); y += 4
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); texto(doc, MARCA.dark)
      for (const fila of el.filas) {
        salto(6)
        escribir(fila[0], c1, y)
        doc.setFontSize(8.5); texto(doc, MARCA.muted)
        escribir(fila[1], c2, y)
        texto(doc, MARCA.dark); doc.setFontSize(9)
        escribir(fila[2], c3, y, { align: 'right' })
        y += 5.5
      }
      if (el.nota) { y += 1; doc.setFontSize(8); texto(doc, MARCA.faint); parrafo(el.nota) }
      y += 3
    }
  }

  // ── Sello de firma ──
  salto(48)
  y += 4
  trazo(doc, MARCA.divider); doc.setLineWidth(0.3); doc.line(MARGEN, y, right, y); y += 7
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); texto(doc, MARCA.dark)
  escribir('Firmas', MARGEN, y); y += 7

  const colW = ancho / 2
  const yInicio = y
  // Lado CLAUX
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); texto(doc, MARCA.muted)
  escribir('Por CLAUX', MARGEN, y); y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); texto(doc, MARCA.dark)
  const claux = [
    prov.nombre,
    prov.nif ? `NIF: ${prov.nif}` : null,
    prov.domicilio || null,
    prov.email || null,
  ].filter(Boolean) as string[]
  for (const ln of claux) { escribir(doc.splitTextToSize(textoPdfSeguro(ln), colW - 4), MARGEN, y); y += 4.5 }

  // Lado Cliente (misma altura de inicio)
  let yc = yInicio
  const xc = MARGEN + colW
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); texto(doc, MARCA.muted)
  escribir('Por el Cliente (firma electrónica)', xc, yc); yc += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); texto(doc, MARCA.dark)
  const cli = [
    sello.firmadoPorNombre,
    sello.firmadoPorEmail,
    `Aceptado el ${fechaLarga(sello.firmadoAt)}`,
  ]
  for (const ln of cli) { escribir(doc.splitTextToSize(textoPdfSeguro(ln), colW - 4), xc, yc); yc += 4.5 }

  y = Math.max(y, yc) + 4
  doc.setFontSize(7.5); texto(doc, MARCA.faint)
  parrafo(
    `Firma electrónica registrada por CLAUX conforme a eIDAS / Ley 6/2020. `
    + `Huella del documento (SHA-256): ${sello.docHash}`,
  )

  sellarPie(doc, 'Documento firmado con CLAUX')
  return doc
}

/** Descarga directa desde el modal, tras firmar. */
export async function descargarDocumentoFirmado(
  doc0: DocumentoResuelto, prov: DatosProveedor, sello: SelloFirma, filename?: string,
): Promise<void> {
  const doc = await construirDocumentoFirmado(doc0, prov, sello)
  doc.save(filename ?? `${doc0.tipo}-${doc0.version}.pdf`)
}

/** Blob del PDF, para subirlo al bucket privado sin regenerarlo. */
export async function blobDocumentoFirmado(
  doc0: DocumentoResuelto, prov: DatosProveedor, sello: SelloFirma,
): Promise<Blob> {
  const doc = await construirDocumentoFirmado(doc0, prov, sello)
  const dataUri = doc.output('datauristring')
  const base64 = dataUri.split(',')[1] ?? ''
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  return new Blob([bytes], { type: 'application/pdf' })
}
