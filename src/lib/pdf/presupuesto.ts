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
  crearDoc, cabeceraReporte, sellarPie, texto, trazo, relleno, textoPdfSeguro,
  MARCA, MARGEN, RESERVA_PIE, type JsPdfDoc,
} from './documento'
import { importeClaux, type MonedaClaux } from '@/lib/moneda-claux'

const hs = (n: number) => `${Number(n) || 0} h`

/**
 * Escribe SANEANDO el texto. Las fuentes estándar de jsPDF codifican en WinAnsi, y un
 * carácter fuera de esa tabla no se omite: jsPDF cambia la cadena entera a UTF-16 y el
 * resultado sale con un espacio entre cada letra y el carácter convertido en otro glifo.
 *
 * Pasó exactamente eso: «Si se paga por año (−10%)» —con el menos tipográfico U+2212, el que
 * usa la UI porque el guion ASCII no alinea— salió como « S i   s e   p a g a   p o r   a ñ o
 * ("10%)». El repo ya tenía `textoPdfSeguro` para esto; el fallo fue no pasarlo por él.
 *
 * Va en UN envoltorio y no en cada llamada a propósito: olvidarse de una es justo lo que
 * ocurrió, y aquí hay quince.
 */
function escribir(
  doc: JsPdfDoc, s: string | string[], x: number, y: number,
  opts?: { align?: string },
): void {
  const limpio = Array.isArray(s) ? s.map(textoPdfSeguro) : textoPdfSeguro(s)
  doc.text(limpio as string, x, y, opts)
}

export interface LineaPdf {
  etiqueta: string
  horas:    number
  /** Cuántos hay de eso. Lo único que acompaña al nombre: al cliente le interesa
   *  que se le configuran 3 empresas, no que salen de «1h + 2×0,5h». */
  volumen?: number
}

export interface FasePdf {
  fase:     string
  horas:    number
  subtotal: number
  lineas?:  LineaPdf[]
}

export interface ModuloPdf {
  nombre: string
  precio: number
}

export interface PresupuestoPdf {
  numero:            string
  fecha:             string
  negocio:           string
  /** Moneda de TODOS los importes del documento. El presupuesto se emite en una. */
  moneda:            MonedaClaux
  responsable?:      string | null
  contacto?:         string | null
  // ── Pago único ──
  desglose:          FasePdf[]
  horasTotal:        number
  tarifaHora:        number
  costeInstalacion:  number
  descuentoPct:      number
  totalInstalacion:  number
  // ── Recurrente ──
  modulos:           ModuloPdf[]
  cuotaMensual:      number
  cuotaAnual:        number
  descuentoAnualPct: number
  /**
   * Qué bloques imprimir. Un presupuesto de ampliación a un cliente que ya paga su cuota no
   * tiene por qué volver a enseñársela —y al revés, a veces solo se manda la parte
   * recurrente—. Por defecto, los dos.
   */
  incluir?: 'todo' | 'instalacion' | 'suscripcion'
}

export async function construirPresupuesto(d: PresupuestoPdf): Promise<JsPdfDoc> {
  const imp = (n: number) => importeClaux(n, d.moneda)
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
  const contacto = [d.responsable, d.contacto]
    .filter(Boolean).join('  ·  ')
  if (contacto) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    texto(doc, MARCA.muted); escribir(doc, contacto, MARGEN, y)
    y += 8
  }

  /** Título de bloque, con su banda de color: son las dos mitades del documento. */
  const tituloBloque = (txt: string, sub: string) => {
    salto(18)
    relleno(doc, MARCA.teal); doc.rect(MARGEN, y - 3.2, 2.2, 7, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
    texto(doc, MARCA.dark); escribir(doc, txt, MARGEN + 5, y + 2)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    texto(doc, MARCA.muted); escribir(doc, sub, right, y + 2, { align: 'right' })
    y += 10
  }

  // Fila de totales: la usan los DOS bloques, así que vive fuera de ambos.
  const totX = right - 78
  const fila = (label: string, valor: string, fuerte = false) => {
    salto(8)
    doc.setFont('helvetica', fuerte ? 'bold' : 'normal')
    doc.setFontSize(fuerte ? 11 : 9.5)
    texto(doc, fuerte ? MARCA.dark : MARCA.muted)
    escribir(doc, label, totX, y)
    escribir(doc, valor, right, y, { align: 'right' })
    y += fuerte ? 7 : 5.5
  }

  const conInstalacion = d.incluir !== 'suscripcion'
  const conSuscripcion = d.incluir !== 'instalacion'

  // ══ 1 · PAGO ÚNICO ═════════════════════════════════════════════════════════
  if (conInstalacion) {
  tituloBloque('Instalación y configuración', 'Pago único')

  doc.setFontSize(9.5)
  for (const f of d.desglose) {
    salto(10)
    doc.setFont('helvetica', 'bold'); texto(doc, MARCA.dark)
    escribir(doc, f.fase, MARGEN, y)
    texto(doc, MARCA.muted); doc.setFont('helvetica', 'normal')
    escribir(doc, hs(f.horas), right - 28, y, { align: 'right' })
    texto(doc, MARCA.dark)
    escribir(doc, imp(f.subtotal), right, y, { align: 'right' })
    y += 5

    // El detalle de cada línea: es lo que hace que el cliente entienda de dónde sale la cifra
    // en vez de tener que creérsela.
    doc.setFontSize(8.5); texto(doc, MARCA.muted)
    for (const l of f.lineas ?? []) {
      salto(6)
      escribir(doc, l.volumen ? `${l.etiqueta} ×${l.volumen}` : l.etiqueta, MARGEN + 4, y)
      escribir(doc, hs(l.horas), right - 28, y, { align: 'right' })
      y += 4.2
    }
    doc.setFontSize(9.5)
    y += 2
    trazo(doc, MARCA.border); doc.setLineWidth(0.15)
    doc.line(MARGEN, y, right, y)
    y += 5
  }

  fila(`${d.horasTotal} h × ${imp(d.tarifaHora)}/h`, imp(d.costeInstalacion))
  if (d.descuentoPct > 0) {
    const dto = d.costeInstalacion - d.totalInstalacion
    fila(`Descuento ${d.descuentoPct}%`, `− ${imp(dto)}`)
  }
  y += 1
  trazo(doc, MARCA.dark); doc.setLineWidth(0.4)
  doc.line(totX, y, right, y)
  y += 6
  fila('Total a pagar una vez', imp(d.totalInstalacion), true)
  y += 6
  }

  // ══ 2 · RECURRENTE ═════════════════════════════════════════════════════════
  if (conSuscripcion) {
  tituloBloque('Suscripción', 'Cada mes, mientras se use')

  doc.setFontSize(9.5)
  for (const m of d.modulos) {
    salto(7)
    doc.setFont('helvetica', 'normal'); texto(doc, MARCA.dark)
    escribir(doc, m.nombre, MARGEN, y)
    texto(doc, m.precio > 0 ? MARCA.dark : MARCA.muted)
    escribir(doc, m.precio > 0 ? `${imp(m.precio)}/mes` : 'Incluido', right, y, { align: 'right' })
    y += 5.2
  }
  y += 2
  trazo(doc, MARCA.dark); doc.setLineWidth(0.4)
  doc.line(totX, y, right, y)
  y += 6
  fila('Total mensual', `${imp(d.cuotaMensual)}/mes`, true)
  if (d.cuotaAnual > 0) {
    // El anual se enseña SIEMPRE que haya cuota: es la palanca de venta que el comercial
    // tenía que calcular a mano, y el ahorro dicho en dinero convence más que el porcentaje.
    const ahorro = d.cuotaMensual * 12 - d.cuotaAnual
    fila(`Si se paga por año (−${d.descuentoAnualPct}%)`, `${imp(d.cuotaAnual)}/año`)
    if (ahorro > 0) fila('Ahorro frente a pagar mes a mes', imp(ahorro))
  }
  y += 8
  }

  // ── Nota de cierre ──
  salto(16)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  texto(doc, MARCA.muted)
  // La nota dice solo lo que aplica a lo impreso: hablar de las horas en un documento que
  // solo lleva la suscripción es prometer una letra pequeña de otra cosa.
  const partes: string[] = []
  if (conInstalacion) {
    partes.push('Las horas de instalación son una estimación sobre los volúmenes declarados. '
      + 'Si los datos entregados no se corresponden con lo indicado, se informa del ajuste '
      + 'antes de continuar.')
  }
  if (conInstalacion && conSuscripcion) {
    partes.push('La suscripción se factura por separado del pago de instalación.')
  }
  if (!conInstalacion) partes.push('Importes de la suscripción, sin el coste de instalación.')
  const nota = doc.splitTextToSize(partes.join(' '), right - MARGEN)
  escribir(doc, nota, MARGEN, y)

  sellarPie(doc, 'Presupuesto generado con CLAUX')
  return doc
}

/** Descarga directa desde la vista: sin abrir pestaña ni recargar (conexión de Cuba). */
export async function descargarPresupuesto(d: PresupuestoPdf, filename?: string): Promise<void> {
  const doc = await construirPresupuesto(d)
  doc.save(filename ?? `${d.numero}.pdf`)
}
