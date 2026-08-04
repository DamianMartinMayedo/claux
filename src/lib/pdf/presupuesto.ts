// ── El presupuesto de instalación, en PDF, para enseñárselo al cliente ──
//
// Misma plantilla de marca que la factura y el recibo de nómina (`documento.ts`): cabecera con
// el filete teal, tipografía helvetica saneada y el pie sellado en todas las páginas.
//
// ── DOS PRECIOS, DOS BLOQUES ─────────────────────────────────────────────────
// La instalación y la suscripción son cosas distintas y el documento las separa: arriba el
// PAGO ÚNICO (configuración, cotizada por horas) y debajo lo RECURRENTE (los módulos, que se
// pagan cada mes o cada año). Juntarlas en un solo total —que es como se leía en pantalla—
// hace que el cliente sume dos cifras que nunca se pagan a la vez, y la conversación se
// convierte en «¿esto es lo que pago hoy o al mes?».

import {
  crearDoc, cabeceraReporte, sellarPie, texto, trazo, relleno,
  MARCA, MARGEN, RESERVA_PIE, type JsPdfDoc,
} from './documento'

const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`
const hs  = (n: number) => `${Number(n) || 0} h`

export interface LineaPdf {
  etiqueta: string
  horas:    number
  detalle:  string
}

export interface FasePdf {
  fase:        string
  horas:       number
  subtotalUsd: number
  lineas?:     LineaPdf[]
}

export interface ModuloPdf {
  nombre: string
  precio: number
}

export interface PresupuestoPdf {
  numero:            string
  fecha:             string
  negocio:           string
  responsable?:      string | null
  contacto?:         string | null
  comercial?:        string | null
  // ── Pago único ──
  desglose:          FasePdf[]
  horasTotal:        number
  tarifaHora:        number
  costeInstalacion:  number
  descuentoPct:      number
  descuentoMotivo?:  string | null
  totalInstalacion:  number
  // ── Recurrente ──
  modulos:           ModuloPdf[]
  cuotaMensual:      number
  cuotaAnual:        number
  descuentoAnualPct: number
}

export async function construirPresupuesto(d: PresupuestoPdf): Promise<JsPdfDoc> {
  const doc = await crearDoc()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const right = pageW - MARGEN
  const limite = pageH - RESERVA_PIE

  let y = cabeceraReporte(doc, {
    titulo: 'Presupuesto de instalación',
    izquierda: d.negocio,
    derecha: `${d.numero} · ${d.fecha}`,
  })

  const salto = (alto: number) => {
    if (y + alto > limite) { doc.addPage(); y = MARGEN + 4 }
  }

  // ── Datos de contacto ──
  const contacto = [d.responsable, d.contacto, d.comercial ? `Atiende: ${d.comercial}` : null]
    .filter(Boolean).join('  ·  ')
  if (contacto) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    texto(doc, MARCA.muted); doc.text(contacto, MARGEN, y)
    y += 8
  }

  /** Título de bloque, con su banda de color: son las dos mitades del documento. */
  const tituloBloque = (txt: string, sub: string) => {
    salto(18)
    relleno(doc, MARCA.teal); doc.rect(MARGEN, y - 3.2, 2.2, 7, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
    texto(doc, MARCA.dark); doc.text(txt, MARGEN + 5, y + 2)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    texto(doc, MARCA.muted); doc.text(sub, right, y + 2, { align: 'right' })
    y += 10
  }

  // ══ 1 · PAGO ÚNICO ═════════════════════════════════════════════════════════
  tituloBloque('Instalación y configuración', 'Pago único')

  doc.setFontSize(9.5)
  for (const f of d.desglose) {
    salto(10)
    doc.setFont('helvetica', 'bold'); texto(doc, MARCA.dark)
    doc.text(f.fase, MARGEN, y)
    texto(doc, MARCA.muted); doc.setFont('helvetica', 'normal')
    doc.text(hs(f.horas), right - 28, y, { align: 'right' })
    texto(doc, MARCA.dark)
    doc.text(usd(f.subtotalUsd), right, y, { align: 'right' })
    y += 5

    // El detalle de cada línea: es lo que hace que el cliente entienda de dónde sale la cifra
    // en vez de tener que creérsela.
    doc.setFontSize(8.5); texto(doc, MARCA.muted)
    for (const l of f.lineas ?? []) {
      salto(6)
      doc.text(`${l.etiqueta} — ${l.detalle}`, MARGEN + 4, y)
      doc.text(hs(l.horas), right - 28, y, { align: 'right' })
      y += 4.2
    }
    doc.setFontSize(9.5)
    y += 2
    trazo(doc, MARCA.border); doc.setLineWidth(0.15)
    doc.line(MARGEN, y, right, y)
    y += 5
  }

  // Totales del pago único
  const totX = right - 78
  const fila = (label: string, valor: string, fuerte = false) => {
    salto(8)
    doc.setFont('helvetica', fuerte ? 'bold' : 'normal')
    doc.setFontSize(fuerte ? 11 : 9.5)
    texto(doc, fuerte ? MARCA.dark : MARCA.muted)
    doc.text(label, totX, y)
    doc.text(valor, right, y, { align: 'right' })
    y += fuerte ? 7 : 5.5
  }

  fila(`${d.horasTotal} h × ${usd(d.tarifaHora)}/h`, usd(d.costeInstalacion))
  if (d.descuentoPct > 0) {
    const dto = d.costeInstalacion - d.totalInstalacion
    fila(`Descuento ${d.descuentoPct}%${d.descuentoMotivo ? ` · ${d.descuentoMotivo}` : ''}`, `− ${usd(dto)}`)
  }
  y += 1
  trazo(doc, MARCA.dark); doc.setLineWidth(0.4)
  doc.line(totX, y, right, y)
  y += 6
  fila('Total a pagar una vez', usd(d.totalInstalacion), true)
  y += 6

  // ══ 2 · RECURRENTE ═════════════════════════════════════════════════════════
  tituloBloque('Suscripción', 'Cada mes, mientras se use')

  doc.setFontSize(9.5)
  for (const m of d.modulos) {
    salto(7)
    doc.setFont('helvetica', 'normal'); texto(doc, MARCA.dark)
    doc.text(m.nombre, MARGEN, y)
    texto(doc, m.precio > 0 ? MARCA.dark : MARCA.muted)
    doc.text(m.precio > 0 ? `${usd(m.precio)}/mes` : 'Incluido', right, y, { align: 'right' })
    y += 5.2
  }
  y += 2
  trazo(doc, MARCA.dark); doc.setLineWidth(0.4)
  doc.line(totX, y, right, y)
  y += 6
  fila('Total mensual', `${usd(d.cuotaMensual)}/mes`, true)
  if (d.cuotaAnual > 0) {
    // El anual se enseña SIEMPRE que haya cuota: es la palanca de venta que el comercial
    // tenía que calcular a mano, y el ahorro dicho en dinero convence más que el porcentaje.
    const ahorro = d.cuotaMensual * 12 - d.cuotaAnual
    fila(`Si se paga por año (−${d.descuentoAnualPct}%)`, `${usd(d.cuotaAnual)}/año`)
    if (ahorro > 0) fila('Ahorro frente a pagar mes a mes', usd(ahorro))
  }
  y += 8

  // ── Nota de cierre ──
  salto(16)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  texto(doc, MARCA.muted)
  const nota = doc.splitTextToSize(
    'Las horas de instalación son una estimación sobre los volúmenes declarados. Si los datos '
    + 'entregados no se corresponden con lo indicado, se informa del ajuste antes de continuar. '
    + 'La suscripción se factura por separado del pago de instalación.',
    right - MARGEN,
  )
  doc.text(nota, MARGEN, y)

  sellarPie(doc, 'Presupuesto generado con CLAUX')
  return doc
}

/** Descarga directa desde la vista: sin abrir pestaña ni recargar (conexión de Cuba). */
export async function descargarPresupuesto(d: PresupuestoPdf, filename?: string): Promise<void> {
  const doc = await construirPresupuesto(d)
  doc.save(filename ?? `${d.numero}.pdf`)
}
