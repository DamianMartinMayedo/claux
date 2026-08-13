'use client'

import { useState, useTransition } from 'react'
import { useRouter }               from 'next/navigation'
import { Download, ChevronDown, BarChart3, Check, Send } from 'lucide-react'
import { hoyEnTz } from '@/lib/fecha-tz'
import { generarXlsxReportes, type ReportesData } from '@/app/actions/portal/reportes'
import type { Asesor }             from '@/app/actions/portal/asesores'
import EmpresaPills                from '@/components/portal/EmpresaPills'
import { useEmpresas }             from '@/components/portal/EmpresaColorContext'
import IaTouchpoint                from '@/components/portal/ia/IaTouchpoint'
import Tabs                        from '@/components/Tabs'
import EnviarAsesorModal           from './EnviarAsesorModal'
import EstadoResultadosCard        from './EstadoResultadosCard'
import AvisoGaveta                 from '@/components/portal/AvisoGaveta'
import type { ResumenGaveta }      from '@/lib/caja/pendientes'
import { formatMonto, formatPct, formatDelta, formatFechaCorta } from './_formato'
import { construirFilasPL } from '@/lib/pl/comparar'
import { descargarBase64, XLSX_MIME } from '@/lib/exportar/descargar'
import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import {
  LABEL_COMPARACION, etiquetaMes, etiquetaAnterior, etiquetaInteranual,
  clasificarRango, type ModoComparacion,
} from '@/lib/pl/periodo'
import { crearDoc, cabeceraReporte, sellarPie, MARCA } from '@/lib/pdf/documento'
import { crearCursor } from '@/lib/pdf/reporte'

// ── Constantes ────────────────────────────────────────────────────────────────

const ORIGEN_LABEL: Record<string, string> = {
  MANUAL: 'Manual', COBRO: 'Cobros', PAGO: 'Pagos', TRANSFERENCIA: 'Transferencias',
}

// Presets de rango por duración (el período en curso).
type RangoPreset = 'mes' | 'trimestre' | 'semestre' | 'anio'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Normaliza un nombre para usarlo en el nombre de archivo (sin acentos ni símbolos).
/** Nombres de mes para las píldoras de período. En minúscula no: encabezan la píldora. */
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'reporte'
}

// ── Vista ─────────────────────────────────────────────────────────────────────

export default function ReportesView({ data, asesores, gaveta }: {
  data: ReportesData
  asesores: Asesor[]
  gaveta: ResumenGaveta
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [enviarOpen, setEnviarOpen] = useState(false)

  const [desde,   setDesde]   = useState(data.desde)
  const [hasta,   setHasta]   = useState(data.hasta)
  const [empresa, setEmpresa] = useState(data.empresa_id)
  // Pestañas, no scroll: cuatro secciones apiladas convertían la pantalla en un
  // reguero donde ninguna se leía entera. El control "Ver en" se queda FUERA de
  // las pestañas porque afecta a las dos.
  const [tab, setTab] = useState<'estado' | 'flujo'>('estado')
  // El consolidado es una REFERENCIA (siempre en la moneda de configuración), no
  // el informe: va al pie y se puede ocultar. Lo que se ve es lo que se descarga.
  const [verConsolidado, setVerConsolidado] = useState(true)

  const { colorOf } = useEmpresas()
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))

  const antPorMoneda = new Map(data.anterior.map(a => [a.moneda, a]))
  const comparando   = data.comparar !== 'no' && data.anterior.length > 0

  // Las dos comparaciones se etiquetan según el rango: la duración NUNCA cambia
  // (un mes se compara con un mes), solo cambia cuál — el tramo justo anterior o
  // el mismo tramo de hace un año. «Año pasado» a secas sonaba a «todo el año
  // pasado» viendo un mes, que es de donde venía la confusión.
  const rangoTipo       = clasificarRango(data.desde, data.hasta)
  const labelAnterior   = etiquetaAnterior(data.desde, data.hasta)
  const labelInteranual = etiquetaInteranual(data.desde, data.hasta)
  const labelComparar = (m: ModoComparacion) =>
    m === 'anterior' ? labelAnterior : m === 'interanual' ? labelInteranual : LABEL_COMPARACION[m]
  // En un año entero, «año anterior» e «interanual» son el mismo tramo → sobra uno.
  const opcionesComparar: ModoComparacion[] = rangoTipo === 'anio' ? ['no', 'anterior'] : ['no', 'anterior', 'interanual']

  // Comparación a nivel de PANTALLA, no de card: si alguna moneda tiene con qué
  // comparar, TODAS las cards muestran las columnas (las que no, con «—»). Antes
  // una card crecía dos columnas y su vecina no, y quedaban descuadradas.
  const hayComparado = data.comparar !== 'no' && data.anterior.length > 0
  // Se pidió comparar pero el período de enfrente está vacío: hay que DECIRLO, no
  // callar — clicar el chip y que no cambie nada parece que la app ignoró el clic.
  const comparadoVacio = data.comparar !== 'no' && data.anterior.length === 0

  // ── Descarga ──────────────────────────────────────────────────────────────
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [descargando, setDescargando] = useState(false)

  // «Todas las empresas» solo cuando de verdad son VARIAS: con una sola, el filtro
  // «todas» ES esa empresa, y llamarlo de otro modo en la cabecera del informe y en
  // el nombre del archivo confunde a quien lo recibe.
  const unicaEmpresa = data.empresas.length === 1 ? data.empresas[0] : null
  const empresaNombre = data.empresa_id
    ? (data.empresas.find(e => e.empresa_id === data.empresa_id)?.nombre ?? '')
    : (unicaEmpresa?.nombre ?? 'Todas las empresas')
  // Nombre de archivo: reportes_<empresa|todas>_<desde>_<hasta>
  const empresaSlug = (data.empresa_id || unicaEmpresa) ? slug(empresaNombre) : 'todas'
  const nombreArchivo = `reportes_${empresaSlug}_${data.desde}_${data.hasta}`

  // PDF real (jsPDF). Se construye aquí para reutilizarlo en la descarga y en el
  // envío al asesor. Refleja EXACTAMENTE lo que hay en pantalla (misma moneda de
  // vista, mismo consolidado): lo que ves es lo que descargas. El asesor puede
  // decidir aparte si quiere el consolidado (su propio check).
  async function construirDoc(incluirConsolidado = verConsolidado) {
      const doc  = await crearDoc()
      const M    = 16
      const GRAY = MARCA.muted

      // Cursor compartido (lib/pdf/reporte.ts): estos ayudantes vivían aquí
      // duplicados y cierran sobre una `y` mutable, por eso salen como cursor.
      const cur = crearCursor(doc, { margen: M })

      cur.y = cabeceraReporte(doc, {
        titulo:    'Reportes financieros',
        izquierda: empresaNombre,
        derecha:   `${formatFechaCorta(data.desde)} — ${formatFechaCorta(data.hasta)}`,
      })

      // Moneda de la vista y nota de conversión (lo que ve el dueño).
      if (data.ver) {
        cur.nota(`Todo en ${data.ver}.`
          + (data.convertido?.convertidas.length ? ` Convertido a la tasa vigente.` : '')
          + (data.convertido?.excluidas.length ? ` Sin tasa hacia ${data.ver}, no incluidas: ${data.convertido.excluidas.join(', ')}.` : ''))
        cur.salto(2)
      }

      // Estado de resultados — las MISMAS filas que la pantalla, del mismo
      // `construirFilasPL`. Un PDF que reordena o reagrupa los renglones obliga
      // al asesor a recomponer el informe a mano.
      cur.titulo('Estado de resultados')
      if (data.resultado.length === 0) cur.fila('Sin ingresos ni gastos en el período.', '', { color: GRAY })
      for (const r of data.resultado) {
        const ant = comparando ? (antPorMoneda.get(r.moneda) ?? null) : null
        cur.cabeceraTabla(
          r.moneda,
          ant ? 'Período' : 'Importe',
          ant ? (data.comparar === 'anterior' ? labelAnterior : LABEL_COMPARACION[data.comparar]) : undefined,
          ant ? 'Δ' : undefined,
        )
        for (const f of construirFilasPL(r, ant)) {
          const destacada = f.nivel === 'grupo' || f.nivel === 'subtotal'
          if (f.nivel === 'final') {
            cur.filaTotal(`${f.concepto}  (${formatPct(r.margen_neto_pct)})`, formatMonto(f.monto))
            continue
          }
          cur.fila(f.concepto, formatMonto(f.monto), {
            bold:   destacada,
            indent: f.nivel === 'cat' || f.nivel === 'hija',
            color:  f.nivel === 'hija' ? GRAY : undefined,
            size:   f.nivel === 'hija' ? 9 : undefined,
            col2:   f.anterior != null ? formatMonto(f.anterior) : undefined,
            col3:   f.variacion != null ? formatDelta(f.variacion) : undefined,
          })
          for (const h of f.hijos ?? []) {
            cur.fila(`   ${h.concepto}`, formatMonto(h.monto), {
              indent: true, color: GRAY, size: 9,
              col2: h.anterior != null ? formatMonto(h.anterior) : undefined,
              col3: h.variacion != null ? formatDelta(h.variacion) : undefined,
            })
          }
        }
        if (data.periodo_comparado) {
          cur.nota(`Comparado con ${formatFechaCorta(data.periodo_comparado.desde)} — ${formatFechaCorta(data.periodo_comparado.hasta)}.`)
          cur.salto(2)
        }
        if (r.evolucion.length > 1) {
          cur.nota('Por mes: ' + r.evolucion.map(m => `${etiquetaMes(m.mes)} ${formatMonto(m.neto)}`).join(' · '))
          cur.salto(2)
        }
        if (r.costo_directo > 0) {
          cur.fila('Coste de lo vendido (informativo, no resta del neto)', formatMonto(r.costo_directo), { color: GRAY })
          cur.fila('Margen por lo vendido (informativo)', formatMonto(r.margen_unitario), { color: GRAY })
        }
      }

      // Puente devengado ↔ caja
      if (data.puente.length) {
        cur.salto(2)
        cur.titulo('Del resultado a la caja')
        for (const p of data.puente) {
          cur.cabeceraTabla(p.moneda, 'Importe')
          cur.fila('Resultado devengado', formatMonto(p.resultado), { bold: true })
          cur.fila('Cobrado en caja', formatMonto(p.cobrado), { indent: true })
          cur.fila('Pagado desde caja', `−${formatMonto(p.pagado)}`, { indent: true })
          cur.fila('Pendiente de cobro', formatMonto(p.pendiente_cobro), { indent: true })
          cur.fila('Pendiente de pago', formatMonto(p.pendiente_pago), { indent: true })
          cur.filaTotal('Flujo neto de caja', formatMonto(p.flujo))
        }
      }

      // Flujo de caja
      cur.salto(2)
      cur.titulo('Flujo de caja')
      if (data.flujo.length === 0) cur.fila('Sin movimientos de efectivo en el período.', '', { color: GRAY })
      for (const f of data.flujo) {
        cur.cabeceraTabla(f.moneda, 'Importe')
        cur.fila('Entradas', formatMonto(f.entradas), { bold: true })
        for (const e of f.detalle_entradas) cur.fila(ORIGEN_LABEL[e.origen] ?? e.origen, formatMonto(e.monto), { indent: true })
        cur.fila('Salidas', formatMonto(f.salidas), { bold: true })
        for (const s of f.detalle_salidas) cur.fila(ORIGEN_LABEL[s.origen] ?? s.origen, formatMonto(s.monto), { indent: true })
        cur.filaTotal('Flujo neto', formatMonto(f.neto))
      }

      // ── Consolidado de referencia ──
      // Entra solo si está visible en pantalla: lo que ves es lo que descargas.
      const c = data.consolidado
      if (c && incluirConsolidado) {
        cur.salto(2)
        cur.titulo(`Consolidado en ${c.moneda}`)
        cur.nota('Convertido a la tasa vigente.')
        cur.salto(2)
        if (c.resultado) {
          cur.cabeceraTabla('Estado de resultados', 'Importe')
          cur.fila('Ingresos', formatMonto(c.resultado.total_ingresos))
          cur.fila('Gastos',   formatMonto(c.resultado.total_gastos))
          cur.filaTotal('Resultado neto', formatMonto(c.resultado.neto))
        }
        if (c.flujo) {
          cur.cabeceraTabla('Flujo de caja', 'Importe')
          cur.fila('Entradas', formatMonto(c.flujo.entradas))
          cur.fila('Salidas',  formatMonto(c.flujo.salidas))
          cur.filaTotal('Flujo neto', formatMonto(c.flujo.neto))
        }
        if (c.monedasExcluidas.length) {
          cur.nota(`Sin tasa hacia ${c.moneda}, no incluidas: ${c.monedasExcluidas.join(', ')}.`)
        }
      }

      sellarPie(doc)
      return doc
  }

  async function descargarPDF() {
    setMenuOpen(false)
    if (descargando) return
    setDescargando(true)
    try {
      const doc = await construirDoc()
      doc.save(`${nombreArchivo}.pdf`)
    } finally {
      setDescargando(false)
    }
  }

  // Mismo PDF, devuelto en base64 (sin prefijo data:) para adjuntarlo en el envío.
  async function construirPdfBase64(incluirConsolidado: boolean): Promise<string> {
    const doc = await construirDoc(incluirConsolidado)
    return doc.output('datauristring').split('base64,')[1] ?? ''
  }

  /**
   * Excel (.xlsx), no CSV. El asesor abre esto en Excel y lo cruza con su
   * contabilidad: en CSV los importes le llegaban como TEXTO (no se pueden sumar
   * sin reescribir la columna) y arrastraba los dos destrozos clásicos —acentos
   * rotos y «1.500» leído como 1,50—. Se genera en servidor (el escritor de xlsx
   * es server-only) y baja como Blob, sin abrir página.
   */
  async function descargarXLSX() {
    setMenuOpen(false)
    if (descargando) return
    setDescargando(true)
    const ld = toastLoading('Generando Excel…')
    try {
      const res = await generarXlsxReportes(data.desde, data.hasta, data.empresa_id, data.comparar, data.ver, verConsolidado)
      await ld.dismiss()
      if (!res.ok || !res.base64) { toastError(res.error ?? 'No se pudo generar el Excel.'); return }
      descargarBase64(`${nombreArchivo}.xlsx`, res.base64, XLSX_MIME)
    } catch {
      await ld.dismiss()
      toastError('No se pudo generar el Excel.')
    } finally {
      setDescargando(false)
    }
  }

  function navegar(
    d: string, h: string, e: string,
    cmp: ModoComparacion = data.comparar,
    verSel: string = data.ver || 'nativo',
  ) {
    const params = new URLSearchParams({ desde: d, hasta: h })
    if (e) params.set('empresa', e)
    if (cmp !== 'no') params.set('comparar', cmp)
    params.set('ver', verSel)   // WYSIWYG: la moneda vista viaja en la URL
    startTransition(() => router.push(`/portal/reportes?${params.toString()}`))
  }

  // Cambiar la moneda de la vista ("Ver en"). Se recuerda en cookie (la última
  // elegida) para que la próxima visita arranque igual, y viaja en la URL.
  function cambiarVer(v: string) {
    document.cookie = `rep_ver=${v}; path=/; max-age=31536000`
    navegar(desde, hasta, empresa, data.comparar, v)
  }

  // Presets por DURACIÓN, apuntando al último período COMPLETO (mes/trimestre/
  // semestre ya cerrados), no al que está en curso: un trimestre recién empezado
  // está casi vacío y el informe abría en un tramo sin datos. El año sí es el
  // corriente (el ejercicio en marcha es lo que se mira).
  //
  // «Hoy» sale de la zona del NEGOCIO. Con la hora local del servidor (UTC en Vercel), la
  // noche del último día de un mes el «mes cerrado» se corría al siguiente.
  function rangoPreset(tipo: RangoPreset): { d: string; h: string } {
    const [y, m] = hoyEnTz().split('-').map(Number)   // m: 1-12
    const mi = m - 1                                   // índice 0-11, como `Date`
    let d: Date, h: Date
    if (tipo === 'mes')            { d = new Date(Date.UTC(y, mi - 1, 1)); h = new Date(Date.UTC(y, mi, 0)) }
    else if (tipo === 'trimestre') { const q = Math.floor(mi / 3) * 3 - 3; d = new Date(Date.UTC(y, q, 1)); h = new Date(Date.UTC(y, q + 3, 0)) }
    else if (tipo === 'semestre')  { const s = (mi < 6 ? 0 : 6) - 6;       d = new Date(Date.UTC(y, s, 1)); h = new Date(Date.UTC(y, s + 6, 0)) }
    else                           { d = new Date(Date.UTC(y, 0, 1));      h = new Date(Date.UTC(y, 11, 31)) }
    return { d: fmt(d), h: fmt(h) }
  }

  /**
   * El nombre del período que aplica cada preset, no su duración relativa.
   *
   * Decía «Último mes / Último trimestre / Último semestre / Este año», y dos comentarios del
   * repo afirmaban que ese vocabulario era el mismo que el de los listados. No lo era ni
   * podía serlo: aquí un preset es un tramo CERRADO («Último mes» = el mes anterior completo)
   * y en un listado es una ventana abierta hasta hoy («Este mes» = del día 1 a hoy). Con dos
   * juegos de palabras parecidas para dos cosas distintas, las cifras de Reportes y de Gastos
   * no cuadraban y no había forma de saber por qué.
   *
   * Con el nombre concreto —«Julio», «2.º trimestre», «2026»— no hay nada que interpretar, y
   * de paso desaparece la trampa del «Este año» que llegaba al 31 de diciembre.
   */
  function etiquetaPreset(tipo: RangoPreset): string {
    const { d } = rangoPreset(tipo)
    const [y, m] = d.split('-').map(Number)
    if (tipo === 'mes')       return `${MESES[m - 1]}${y !== Number(hoyEnTz().slice(0, 4)) ? ` ${y}` : ''}`
    if (tipo === 'trimestre') return `${Math.floor((m - 1) / 3) + 1}.º trimestre`
    if (tipo === 'semestre')  return m <= 6 ? '1.er semestre' : '2.º semestre'
    return String(y)
  }

  function preset(tipo: RangoPreset) {
    const { d, h } = rangoPreset(tipo)
    setDesde(d); setHasta(h); navegar(d, h, empresa)
  }

  // ¿Qué preset coincide con el período aplicado? (para resaltar el botón activo)
  const presetActivo = (tipo: RangoPreset) => {
    const { d, h } = rangoPreset(tipo)
    return data.desde === d && data.hasta === h
  }

  // Hay rango escrito sin aplicar: el botón «Aplicar» solo se enciende entonces.
  const rangoSinAplicar = desde !== data.desde || hasta !== data.hasta

  // El borrador se pone al día cuando el servidor aplica otro período (una píldora, volver
  // atrás), DURANTE EL RENDER: con un efecto se pinta un fotograma con las fechas viejas.
  const [rangoVisto, setRangoVisto] = useState({ desde: data.desde, hasta: data.hasta })
  if (rangoVisto.desde !== data.desde || rangoVisto.hasta !== data.hasta) {
    setRangoVisto({ desde: data.desde, hasta: data.hasta })
    setDesde(data.desde)
    setHasta(data.hasta)
  }

  const sinDatos = data.resultado.length === 0 && data.flujo.length === 0

  return (
    <div className="view-container">

      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Reportes financieros</h1>
            <IaTouchpoint tipo="proyeccion" descripcion="una proyección de tus ingresos" />
          </div>
          <p className="page-subtitle">Estado de resultados (devengado) y flujo de caja (efectivo) del período seleccionado.</p>
        </div>
        {!sinDatos && (
          <div className="rep-actions">
            <button className="btn btn-primary" onClick={() => setEnviarOpen(true)}>
              <Send size={14} strokeWidth={2.5} /> Enviar al asesor
            </button>
            <div className="rep-dl">
              <button className="btn btn-secondary" onClick={() => setMenuOpen(v => !v)} disabled={descargando}>
                <Download size={14} /> {descargando ? 'Generando…' : 'Descargar'}
                <ChevronDown size={13} />
              </button>
              {menuOpen && (
                <>
                  <div className="rep-dl-overlay" onClick={() => setMenuOpen(false)} />
                  <div className="rep-dl-menu">
                    {/* Qué se va a descargar, ANTES de clicar: el error caro aquí es
                        bajar el informe en otra moneda o sin el consolidado y no
                        enterarse hasta que ya está enviado. */}
                    <div className="rep-dl-ctx">
                      {formatFechaCorta(data.desde)} – {formatFechaCorta(data.hasta)}
                      {' · '}{empresaNombre}
                      {' · '}{data.ver ? `en ${data.ver}` : 'cada moneda'}
                      {data.consolidado && ` · ${verConsolidado ? 'con' : 'sin'} consolidado`}
                    </div>
                    <button className="dropdown-item" onClick={descargarPDF}>Descargar PDF</button>
                    <button className="dropdown-item" onClick={descargarXLSX}>Descargar Excel (.xlsx)</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Este informe es para dentro de casa: aquí SÍ se dice que faltan gastos por
          clasificar. El deck del dossier —que lo lee un inversor— no lleva ninguna
          nota de esto; ahí se avisa antes, al congelar y al publicar. */}
      <AvisoGaveta resumen={gaveta} href="/portal/tesoreria" />

      {/* ── Barra de control: PERÍODO (agrupado) a la izquierda, empresa a la
          derecha ───────────────────────────────────────────────────────────
          El período es una sola decisión —presets que rellenan el rango, o el
          rango a mano—, así que van juntos en un grupo; antes flotaban como tres
          islas sueltas. El buscador y la comparación bajan a la sección sobre la
          que actúan; la moneda de la vista, a su propia fila. */}
      <div className="rep-barra">
        <div className="rep-periodo">
          <div className="rep-barra-presets">
            {/* El período por su NOMBRE, no por su duración: ver `etiquetaPreset`. */}
            {(['mes', 'trimestre', 'semestre', 'anio'] as RangoPreset[]).map(t => (
              <button key={t} className={`cxx-chip${presetActivo(t) ? ' active' : ''}`}
                onClick={() => preset(t)} disabled={isPending}>
                {etiquetaPreset(t)}
              </button>
            ))}
          </div>
          {/* El rango a mano se APLICA con el botón, no en cada `change`.
              Navegaba por tecla: el navegador dispara el evento con la fecha a medio
              escribir —«0002-01-01» incluido—, así que teclear un rango lanzaba varios
              informes completos (estado de resultados + flujo, la consulta más cara del
              portal) con períodos absurdos antes de llegar al que se quería. Mismo patrón
              que `RangoBusqueda`, y con `min`/`max` cruzados para que no se pueda pedir un
              «hasta» anterior al «desde» —que devolvía un informe vacío sin explicar nada—. */}
          <form className="rep-barra-fechas"
            onSubmit={e => { e.preventDefault(); if (desde && hasta) navegar(desde, hasta, empresa) }}>
            <input
              className="input ter-filter-select" type="date" value={desde} aria-label="Desde"
              max={hasta || undefined}
              onChange={e => setDesde(e.target.value)}
            />
            <span className="rep-rango-sep">–</span>
            <input
              className="input ter-filter-select" type="date" value={hasta} aria-label="Hasta"
              min={desde || undefined}
              onChange={e => setHasta(e.target.value)}
            />
            <button type="submit" className={`btn btn-sm ${rangoSinAplicar ? 'btn-primary' : 'btn-secondary'}`}
              disabled={!rangoSinAplicar || isPending}>
              <Check size={13} strokeWidth={2.5} /> Aplicar
            </button>
          </form>
        </div>
        <div className="rep-barra-fin">
          <EmpresaPills
            empresas={empresasFiltro}
            value={empresa}
            onChange={id => { setEmpresa(id); navegar(desde, hasta, id) }}
            todasLabel="Todas"
          />
          {isPending && <span className="spinner spinner-sm" aria-label="Actualizando" />}
        </div>
      </div>

      {sinDatos ? (
        <div className="card mon-empty">
          <BarChart3 size={40} strokeWidth={1} opacity={0.2} />
          <p>No hay movimientos ni documentos en este período.</p>
        </div>
      ) : (
        <>
          {/* ── "Ver en [moneda]" ──────────────────────────────────────────────
              Reemplaza a la banda fija "Consolidado en…". "Cada moneda" muestra
              el informe nativo, sin convertir (la verdad contable); elegir una
              moneda lo colapsa a ella, convirtiendo solo lo que no está ya en esa
              moneda y marcándolo. Solo aparece si hay más de una moneda posible. */}
          {data.verOpciones.length >= 2 && (
            <div className="rep-ver">
              <span className="rep-ver-label">Ver en</span>
              <div className="rep-ver-chips" role="group" aria-label="Moneda de la vista">
                <button
                  className={`cxx-chip${data.ver === '' ? ' active' : ''}`}
                  onClick={() => cambiarVer('nativo')} disabled={isPending}
                >Cada moneda</button>
                {data.verOpciones.map(m => (
                  <button
                    key={m} className={`cxx-chip${data.ver === m ? ' active' : ''}`}
                    onClick={() => cambiarVer(m)} disabled={isPending}
                  >{m}</button>
                ))}
              </div>
              {data.convertido && (data.convertido.convertidas.length > 0 || data.convertido.excluidas.length > 0) && (
                <span className="rep-ver-nota">
                  {data.convertido.convertidas.length > 0 && `Convertido a ${data.ver} a la tasa vigente.`}
                  {data.convertido.excluidas.length > 0 && ` Sin tasa hacia ${data.ver}: ${data.convertido.excluidas.join(', ')} (no incluidas).`}
                </span>
              )}
            </div>
          )}

          {/* Dos informes, dos pestañas. Apilados eran una página de cuatro
              bloques que competían entre sí y ninguno se leía entero. */}
          <Tabs
            tabs={[
              { id: 'estado' as const, label: 'Estado de resultados' },
              { id: 'flujo'  as const, label: 'Flujo de caja' },
            ]}
            active={tab}
            onChange={setTab}
            ariaLabel="Informe a ver"
          />

          {tab === 'estado' && (<>
          <div className="rep-seccion">
            <div className="rep-seccion-head">
              <div>
                <p className="rep-nota rep-seccion-sub">
                  {formatFechaCorta(data.desde)} – {formatFechaCorta(data.hasta)} · devengado
                </p>
              </div>
              {/* La comparación cambia estos Δ y vive en SU pestaña. Chips: "Sin
                  comparar" por defecto; la etiqueta del "anterior" se adapta al
                  rango (Mes → «Mes anterior»…) y el interanual se oculta en un año
                  entero porque coincidiría con el período anterior. */}
              <div className="rep-seccion-tools">
                <div className="rep-comparar" role="group" aria-label="Comparar con">
                  {opcionesComparar.map(m => (
                    <button
                      key={m} type="button"
                      className={`cxx-chip${data.comparar === m ? ' active' : ''}`}
                      onClick={() => navegar(desde, hasta, empresa, m)} disabled={isPending}
                    >
                      {labelComparar(m)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Qué se está comparando, con las DOS fechas enfrentadas. Iba en gris
                pequeño junto al período y no se leía: al comparar, esto es el
                contexto que da sentido a las columnas Δ. */}
            {data.periodo_comparado && (
              <div className={`rep-comp-franja${comparadoVacio ? ' is-vacia' : ''}`}>
                <span className="rep-comp-txt">
                  Comparando <strong>{formatFechaCorta(data.desde)} – {formatFechaCorta(data.hasta)}</strong>
                  {' '}con <strong>{formatFechaCorta(data.periodo_comparado.desde)} – {formatFechaCorta(data.periodo_comparado.hasta)}</strong>
                </span>
                {comparadoVacio && (
                  <span className="rep-comp-aviso">No hay movimientos en ese período: no hay con qué comparar.</span>
                )}
              </div>
            )}

            {data.resultado.length === 0 ? (
              <div className="card mon-empty"><p>Sin ingresos ni gastos devengados en el período.</p></div>
            ) : (
              <div className="rep-grid">
                {data.resultado.map(r => (
                  <EstadoResultadosCard
                    key={r.moneda}
                    r={r}
                    anterior={antPorMoneda.get(r.moneda) ?? null}
                    comparando={hayComparado}
                    labelAnterior={labelComparar(data.comparar)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Del resultado a la caja ──
              Solo aparece cuando devengado y caja NO coinciden: si el mes se cobró
              y se pagó entero, este bloque no dice nada que no esté ya arriba.
              Va PEGADO al estado de resultados, no como sección hermana: es la
              explicación de una cifra de arriba, no un informe aparte. */}
          {data.puente.length > 0 && (
            <div className="rep-puente">
              <div className="rep-puente-head">
                <span className="rep-consol-title">Del resultado a la caja</span>
                <span className="rep-consol-note">Lo que ganaste no es lo que cobraste</span>
              </div>
              <div className="rep-puente-grid">
                {data.puente.map(p => (
                  <div key={p.moneda} className="rep-puente-bloque">
                    <p className="rep-puente-frase">
                      <span className="rep-moneda">{p.moneda}</span>{' '}
                      Ganaste <span className="rep-puente-cifra">{formatMonto(p.resultado)}</span>,
                      {' '}cobraste <span className="rep-puente-cifra">{formatMonto(p.cobrado)}</span>
                      {p.pendiente_cobro > 0.005 && <> y te deben <span className="rep-puente-cifra">{formatMonto(p.pendiente_cobro)}</span></>}.
                    </p>
                    <div className="rep-line rep-sub"><span>Cobrado en caja</span><span>{formatMonto(p.cobrado)}</span></div>
                    <div className="rep-line rep-sub"><span>Pagado desde caja</span><span>−{formatMonto(p.pagado)}</span></div>
                    <div className="rep-line rep-sub"><span>Pendiente de cobro</span><span>{formatMonto(p.pendiente_cobro)}</span></div>
                    <div className="rep-line rep-sub"><span>Pendiente de pago</span><span>{formatMonto(p.pendiente_pago)}</span></div>
                    <div className="rep-line rep-consol-neto"><span>Flujo neto de caja</span><strong>{formatMonto(p.flujo)}</strong></div>
                  </div>
                ))}
              </div>
              <p className="rep-consol-excl">
                El resultado cuenta lo que facturaste y gastaste por su fecha; la caja, solo el
                dinero que se movió de verdad. Los pendientes son el saldo vivo de este período.
              </p>
            </div>
          )}

          </>)}

          {tab === 'flujo' && (
          <div className="rep-seccion">
            <div className="rep-seccion-head">
              <div>
                <p className="rep-nota rep-seccion-sub">
                  Movimientos reales de efectivo · excluye transferencias internas
                </p>
              </div>
            </div>
            {data.flujo.length === 0 ? (
              <div className="card mon-empty"><p>Sin movimientos de efectivo en el período.</p></div>
            ) : (
              <div className="rep-grid">
                {data.flujo.map(f => (
                  <div key={f.moneda} className="rep-card">
                    <div className="rep-card-head">
                      <span className="rep-moneda">{f.moneda}</span>
                      <span className={`rep-neto ${f.neto >= 0 ? 'rep-pos' : 'rep-neg'}`}>{formatMonto(f.neto)}</span>
                    </div>
                    <div className="rep-card-label">Flujo neto</div>

                    <div className="rep-block">
                      <div className="rep-line rep-line-head rep-in"><span>Entradas</span><strong>{formatMonto(f.entradas)}</strong></div>
                      {f.detalle_entradas.map(e => (
                        <div key={e.origen} className="rep-line rep-sub"><span>{ORIGEN_LABEL[e.origen] ?? e.origen}</span><span>{formatMonto(e.monto)}</span></div>
                      ))}
                    </div>

                    <div className="rep-block">
                      <div className="rep-line rep-line-head rep-out"><span>Salidas</span><strong>{formatMonto(f.salidas)}</strong></div>
                      {f.detalle_salidas.map(s => (
                        <div key={s.origen} className="rep-line rep-sub"><span>{ORIGEN_LABEL[s.origen] ?? s.origen}</span><span>{formatMonto(s.monto)}</span></div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {/* ── Consolidado: banner de REFERENCIA al pie ───────────────────────
              Siempre en la moneda de configuración (`es_consolidacion`), mires el
              informe en la moneda que lo mires: responde «¿y esto cuánto es en
              total?» sin tocar las cifras de arriba. En pantalla se ve SIEMPRE; su
              check decide únicamente si entra en el PDF/Excel. */}
          {data.consolidado && (
            <div className="rep-consol">
              <div className="rep-consol-head">
                <div>
                  <span className="rep-consol-title">Consolidado en {data.consolidado.moneda}</span>
                  <span className="rep-consol-note"> · convertido a la tasa vigente</span>
                </div>
                <label className="rep-consol-toggle">
                  <input
                    type="checkbox" checked={verConsolidado}
                    onChange={e => setVerConsolidado(e.target.checked)}
                  />
                  <span>Incluir al descargar</span>
                </label>
              </div>
              {/* En PANTALLA se ve siempre: es la referencia «cuánto es esto en
                  total» y ocultarla al desmarcar no tenía sentido. El check decide
                  solo si el consolidado entra en el PDF/Excel. */}
              <div className="rep-consol-grid">
                  {data.consolidado.resultado && (
                    <div className="rep-consol-bloque">
                      <div className="rep-consol-sub">Estado de resultados</div>
                      <div className="rep-line rep-sub"><span>Ingresos</span><span>{formatMonto(data.consolidado.resultado.total_ingresos)}</span></div>
                      <div className="rep-line rep-sub"><span>Gastos</span><span>{formatMonto(data.consolidado.resultado.total_gastos)}</span></div>
                      <div className="rep-line rep-consol-neto">
                        <span>Resultado neto</span>
                        <strong className={data.consolidado.resultado.neto >= 0 ? 'rep-pos' : 'rep-neg'}>
                          {formatMonto(data.consolidado.resultado.neto)}
                        </strong>
                      </div>
                    </div>
                  )}
                  {data.consolidado.flujo && (
                    <div className="rep-consol-bloque">
                      <div className="rep-consol-sub">Flujo de caja</div>
                      <div className="rep-line rep-sub"><span>Entradas</span><span>{formatMonto(data.consolidado.flujo.entradas)}</span></div>
                      <div className="rep-line rep-sub"><span>Salidas</span><span>{formatMonto(data.consolidado.flujo.salidas)}</span></div>
                      <div className="rep-line rep-consol-neto">
                        <span>Flujo neto</span>
                        <strong className={data.consolidado.flujo.neto >= 0 ? 'rep-pos' : 'rep-neg'}>
                          {formatMonto(data.consolidado.flujo.neto)}
                        </strong>
                      </div>
                    </div>
                  )}
              </div>
              {data.consolidado.monedasExcluidas.length > 0 && (
                <p className="rep-consol-excl">
                  Sin tasa hacia {data.consolidado.moneda}, no incluidas: {data.consolidado.monedasExcluidas.join(', ')}.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {enviarOpen && (
        <EnviarAsesorModal
          data={data}
          desde={data.desde}
          hasta={data.hasta}
          empresaId={data.empresa_id}
          empresaNombre={empresaNombre}
          nombreArchivo={nombreArchivo}
          asesores={asesores}
          empresas={data.empresas}
          construirPdfBase64={construirPdfBase64}
          onClose={() => setEnviarOpen(false)}
          onEnviado={() => setEnviarOpen(false)}
        />
      )}
    </div>
  )
}
