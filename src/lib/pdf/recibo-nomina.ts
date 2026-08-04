// ────────────────────────────────────────────────────────────────────────────
// Constructor vectorial (jsPDF) del recibo de nómina de un trabajador.
//
// MISMO sistema que la factura y la oferta (`venta.ts`): la cabecera de empresa
// compartida de `documento.ts`, el bloque de documento a la derecha, la tabla con
// regla fina sin bandas de color, los totales a la derecha y el sello de marca en el
// pie. No hay una segunda estética para esto: un recibo y una factura del mismo
// negocio tienen que parecer del mismo negocio.
//
// UN generador para los dos modelos de nómina, condicionado por `esCuba`. Dos
// funciones separadas acabarían divergiendo en cuanto se tocara una: el modelo
// GENERAL es el mismo documento sin los bloques que ese modelo no calcula.
//
// REGLA DE IMPRESIÓN: solo se imprime lo que tiene valor, con una excepción — el
// Salario Básico va SIEMPRE, aunque sea el único devengo. Un mes sin incidencias
// tiene que salir corto, no con una columna de ceros (un cero se lee como «no le
// pagaron eso», que es distinto de «eso no pasó este mes»).
//
// NUNCA se abrevia: las siglas (CESS, IRPF, UFT 5 %…) son solo de la tabla en
// pantalla, donde el espacio aprieta. Esto lo lee el trabajador o un inspector.
// ────────────────────────────────────────────────────────────────────────────

import {
  MARCA, MARGEN, RESERVA_PIE, texto, trazo,
  crearDoc, sellarPie, cabeceraEmpresa, type JsPdfDoc,
} from './documento'
import { formatearMoneda } from '@/app/portal/(app)/ventas/_ventas-helpers'
import { fmtFechaLargaEs } from '@/lib/date-utils'

export interface EmpresaReciboPdf {
  nombre:             string
  nombre_fiscal:      string | null
  rif_nit:            string | null
  direccion:          string | null
  ciudad:             string | null
  pais:               string | null
  telefono:           string | null
  email:              string | null
  logo_url:           string | null
  mostrar_logo:       boolean | null
  letra_facturacion:  string | null
  color:              string
}

export interface TrabajadorReciboPdf {
  nombre:       string
  /** Carné de identidad. En blanco si no está cargado: no bloquea la generación. */
  documento:    string | null
  cargo:        string | null
  departamento: string | null
  email:        string | null
  fecha_alta:   string | null
}

/** Una fila del desglose. El nombre llega ya resuelto, completo y sin abreviar. */
export interface ConceptoReciboPdf {
  nombre: string
  monto:  number
}

export interface ReciboNominaPdf {
  /** 'YYYY-MM' */
  periodo:         string
  moneda:          string
  /** Un borrador se marca en el documento: no es un recibo definitivo. */
  esBorrador:      boolean
  /** MIPYME_CUBA en CUP. Con `false` se omiten aportes, vacaciones y coste. */
  esCuba:          boolean
  empresa:         EmpresaReciboPdf
  trabajador:      TrabajadorReciboPdf
  dias_laborables: number
  /** null = mes completo; no se imprime la fila. */
  dias_trabajados: number | null
  /** Días de vacaciones disfrutados ESTE período (incidencia). 0 = no se imprime. */
  dias_vacaciones: number
  salario_base:    number
  devengos:        ConceptoReciboPdf[]
  retenciones:     ConceptoReciboPdf[]
  aportes:         ConceptoReciboPdf[]
  devengado:       number
  deducciones:     number
  /** Adelantado al trabajador y recuperable de la Seguridad Social. Suma al neto. */
  subsidios:       number
  neto:            number
  /** Lo que ESTA nómina calculó como vacaciones a acumular (no un saldo histórico). */
  vacaciones_acumuladas: number
  /** Importe de las vacaciones disfrutadas que se pagan este período. */
  vacaciones_pagadas:    number
}

// ── Constructor ───────────────────────────────────────────────────────────────

const MES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** '2026-05' → 'mayo de 2026'. En el recibo el período va en letra, no en clave. */
function periodoLargo(periodo: string): string {
  const [a, m] = periodo.split('-')
  const mes = MES_ES[Number(m) - 1]
  return mes ? `${mes} de ${a}` : periodo
}

/**
 * Dibuja el recibo completo en `doc`. El llamador añade el sello de pie y guarda —
 * o usa `descargarReciboNomina`, que lo hace todo.
 */
export async function construirReciboNomina(
  doc: JsPdfDoc,
  d: ReciboNominaPdf,
): Promise<void> {
  const pageH = doc.internal.pageSize.getHeight()
  const M     = MARGEN
  const right = doc.internal.pageSize.getWidth() - M
  const limiteInferior = pageH - RESERVA_PIE - 4
  let y = M

  // ── Cabecera: empresa (izq) · documento (der) ─────────────────────────────
  const ey = await cabeceraEmpresa(doc, d.empresa, y)

  let dy = y + 3
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
  texto(doc, MARCA.faint); doc.text('RECIBO DE NÓMINA', right, dy, { align: 'right' })
  dy += 8
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  texto(doc, MARCA.dark); doc.text(periodoLargo(d.periodo), right, dy, { align: 'right' })
  dy += 7

  doc.setFontSize(9)
  const meta: [string, string][] = [['Días laborables', String(d.dias_laborables)]]
  // Los días trabajados solo se imprimen si hubo prorrateo: en un mes completo la
  // fila no dice nada que no diga ya «días laborables».
  if (d.dias_trabajados !== null && d.dias_trabajados !== d.dias_laborables) {
    meta.push(['Días trabajados', String(d.dias_trabajados)])
  }
  if (d.dias_vacaciones > 0) meta.push(['Días de vacaciones', String(d.dias_vacaciones)])
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

  // ── Trabajador ────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
  texto(doc, MARCA.faint); doc.text('TRABAJADOR', M, y)
  y += 5.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5)
  texto(doc, MARCA.dark); doc.text(d.trabajador.nombre, M, y)
  y += 4.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  texto(doc, MARCA.muted)
  // «Documento», no «Expediente»: es el campo que la ficha ya tiene y que el
  // trabajador reconoce (su carné). Vacío se imprime vacío, no rompe nada.
  const datosTrab = [
    d.trabajador.documento ? `Documento: ${d.trabajador.documento}` : null,
    [d.trabajador.cargo, d.trabajador.departamento].filter(Boolean).join('  ·  ') || null,
    d.trabajador.email,
    d.trabajador.fecha_alta ? `Alta: ${fmtFechaLargaEs(d.trabajador.fecha_alta)}` : null,
  ].filter(Boolean) as string[]
  for (const linea of datosTrab) { doc.text(linea, M, y); y += 4.2 }
  y += 8

  // ── Tabla del desglose ────────────────────────────────────────────────────
  const cImporte = right
  const descX    = M
  const descW    = cImporte - 34 - descX

  const cabeceraTabla = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    texto(doc, MARCA.faint)
    const th = y + 3
    doc.text('CONCEPTO', descX, th)
    doc.text('IMPORTE', cImporte, th, { align: 'right' })
    y += 6
    trazo(doc, MARCA.dark); doc.setLineWidth(0.4)
    doc.line(M, y, right, y)
    y += 4
  }

  const seccion = (titulo: string) => {
    if (y + 12 > limiteInferior) { doc.addPage(); y = M; cabeceraTabla() }
    y += 2
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    texto(doc, MARCA.faint); doc.text(titulo, descX, y + 3)
    y += 6.5
  }

  const fila = (nombre: string, monto: number, negativo = false) => {
    const nom   = doc.splitTextToSize(nombre, descW)
    const filaH = Math.max(8, nom.length * 4.4 + 3.5)
    if (y + filaH > limiteInferior) { doc.addPage(); y = M; cabeceraTabla() }
    const ty = y + 4.5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    texto(doc, MARCA.dark)
    doc.text(nom, descX, ty)
    // El signo se imprime, no se deduce del color: en blanco y negro un importe sin
    // signo dentro de «Retenciones» sigue siendo ambiguo al sumarlo a mano.
    const valor = (negativo ? '- ' : '') + formatearMoneda(Math.abs(monto), d.moneda)
    doc.text(valor, cImporte, ty, { align: 'right' })
    y += filaH
    trazo(doc, MARCA.border); doc.setLineWidth(0.15)
    doc.line(M, y, right, y)
  }

  const subtotal = (label: string, monto: number) => {
    if (y + 9 > limiteInferior) { doc.addPage(); y = M }
    y += 1.5
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    texto(doc, MARCA.dark)
    doc.text(label, descX, y + 3.5)
    doc.text(formatearMoneda(monto, d.moneda), cImporte, y + 3.5, { align: 'right' })
    y += 8
  }

  cabeceraTabla()

  // DEVENGOS — el salario básico va siempre, aunque sea el único.
  seccion('DEVENGOS')
  fila('Salario Básico', d.salario_base)
  for (const c of d.devengos) fila(c.nombre, c.monto, c.monto < 0)
  subtotal('Total devengado', d.devengado)

  if (d.retenciones.length) {
    seccion('RETENCIONES')
    for (const c of d.retenciones) fila(c.nombre, c.monto, true)
    subtotal('Total retenido', d.deducciones)
  }

  // El subsidio no es devengo (no lo paga la empresa) pero SÍ lo cobra el trabajador:
  // sin esta fila el neto no cuadraría con la suma de lo de arriba.
  if (d.subsidios > 0) {
    seccion('OTROS PAGOS')
    fila('Subsidios adelantados', d.subsidios)
  }

  y += 4

  // ── Neto (bloque derecho, como el total de la factura) ────────────────────
  const totX = right - 78
  if (y + 14 > limiteInferior) { doc.addPage(); y = M }
  trazo(doc, MARCA.dark); doc.setLineWidth(0.4)
  doc.line(totX, y, right, y)
  y += 6.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  texto(doc, MARCA.dark)
  doc.text('Neto a percibir', totX, y)
  doc.text(formatearMoneda(d.neto, d.moneda), right, y, { align: 'right' })
  y += 11

  // ── Bloques del modelo cubano ─────────────────────────────────────────────
  // En GENERAL no se imprimen: ese modelo no calcula aportes ni acumula vacaciones,
  // y una sección a cero diría que sí existen y valen nada.
  if (d.esCuba) {
    const bloque = (titulo: string, filas: [string, number][]) => {
      const visibles = filas.filter(([, v]) => Math.abs(v) > 0.005)
      if (!visibles.length) return
      const alto = 11 + visibles.length * 5
      if (y + alto > limiteInferior) { doc.addPage(); y = M }
      trazo(doc, MARCA.border); doc.setLineWidth(0.2)
      doc.line(M, y, right, y)
      y += 5.5
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
      texto(doc, MARCA.faint); doc.text(titulo, M, y)
      y += 5
      doc.setFontSize(9)
      for (const [label, valor] of visibles) {
        doc.setFont('helvetica', 'normal'); texto(doc, MARCA.muted)
        doc.text(label, M, y)
        texto(doc, MARCA.dark)
        doc.text(formatearMoneda(valor, d.moneda), right, y, { align: 'right' })
        y += 5
      }
      y += 3
    }

    // A CARGO DE LA EMPRESA: no reduce el neto del trabajador. Se imprime porque es
    // lo que de verdad cuesta esa persona, y sin ello el «coste» de abajo no se
    // podría comprobar sumando.
    bloque('A CARGO DE LA EMPRESA (no reduce su neto)',
      d.aportes.map(a => [a.nombre, a.monto] as [string, number]))

    // VACACIONES: el importe que ESTE período acumuló, no un saldo corrido — el
    // histórico anterior a CLAUX no se conoce con exactitud y presentarlo como saldo
    // sería inventarlo.
    bloque('VACACIONES DE ESTE PERÍODO', [
      ['Importe de vacaciones a acumular', d.vacaciones_acumuladas],
      ['Vacaciones disfrutadas pagadas',   d.vacaciones_pagadas],
    ])

    // COSTE EMPRESARIAL — la fórmula del modelo de coste/deuda:
    //   (devengado - vacaciones disfrutadas) + acumulación del mes + aportes
    // Las vacaciones disfrutadas se restan porque su coste ya se reconoció el mes en
    // que se acumularon; sumarlas otra vez las contaría dos veces. Y NO es
    // «neto + aportes»: eso deja fuera las retenciones, que son el mismo coste con
    // otro acreedor — el error que ya se corrigió una vez en la contabilidad.
    const sumaAportes = d.aportes.reduce((s, a) => s + a.monto, 0)
    const coste = Math.round(
      (d.devengado - d.vacaciones_pagadas + d.vacaciones_acumuladas + sumaAportes) * 100) / 100
    if (y + 12 > limiteInferior) { doc.addPage(); y = M }
    trazo(doc, MARCA.border); doc.setLineWidth(0.2)
    doc.line(M, y, right, y)
    y += 6
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    texto(doc, MARCA.muted); doc.text('Coste total para la empresa', M, y)
    texto(doc, MARCA.dark)
    doc.text(formatearMoneda(coste, d.moneda), right, y, { align: 'right' })
    y += 9
  }

  // Un borrador se marca: sus cifras aún pueden cambiar y el trabajador no debe
  // guardarlo como comprobante de lo cobrado.
  if (d.esBorrador) {
    if (y + 8 > limiteInferior) { doc.addPage(); y = M }
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5)
    texto(doc, MARCA.amber)
    doc.text('Borrador — esta nómina aún no está confirmada y sus importes pueden cambiar.',
      (M + right) / 2, y, { align: 'center' })
  }
}

/**
 * Genera y descarga el recibo en un solo paso, en cliente, con los datos que la
 * acción de servidor ya devolvió: un clic → archivo, sin navegar ni recargar
 * (principio de descargas directas del proyecto).
 */
export async function descargarReciboNomina(
  d: ReciboNominaPdf,
  filename?: string,
): Promise<void> {
  const doc = await crearDoc()
  await construirReciboNomina(doc, d)
  sellarPie(doc, 'Recibo de nómina generado con CLAUX')
  doc.save(filename ?? `recibo-${d.periodo}.pdf`)
}
