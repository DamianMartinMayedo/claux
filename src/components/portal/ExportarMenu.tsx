'use client'

// ────────────────────────────────────────────────────────────────────────────
// «Descarga lo que estás viendo», en Excel o CSV. ES EL ÚNICO BOTÓN DE DESCARGA de un
// listado del portal: hubo otro exclusivo de la sesión de configuración y se eliminó
// por redundante (hacía lo mismo, peor y solo en CSV).
//
// Todo pasa por el registro de columnas de `lib/exportar/tablas.ts` y el generador de
// `lib/exportar/csv.ts`: si se añade una columna, sale en los dos formatos y en todos
// los listados. Ese era el punto de tener un registro y no un exportador por pantalla —
// en el repo llegó a haber cuatro generadores de CSV a mano, cada uno con su separador
// y uno sin BOM.
//
// **Se descarga TODO lo que cae en el filtro, no lo que hay pintado**: el listado
// pagina para no traerse la historia entera a la pantalla, pero «descargar las facturas
// de este trimestre» significa las del trimestre. Por eso los filtros VIAJAN a la
// consulta en vez de exportarse las filas del navegador.
//
// Y por eso mismo el desplegable dice QUÉ se lleva antes de clicar (`resumen`): un
// fichero que no es lo que el dueño creía es peor que no tenerlo.
//
// Descarga DIRECTA (Blob, sin abrir pestaña ni recargar), que en Cuba es la regla.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useTransition } from 'react'
import { Download } from 'lucide-react'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { exportarListado } from '@/app/actions/portal/exportar'
import { descargarBase64, descargarBlob, CSV_MIME, XLSX_MIME } from '@/lib/exportar/descargar'
import { fmtFechaEs } from '@/lib/date-utils'
import { presetDeFechas, PRESETS_RANGO } from '@/lib/listados'
import type { FiltroExport } from '@/lib/exportar/tablas'

interface Props {
  /** Clave del registro de `lib/exportar/tablas.ts` (facturas, gastos_cobros…). */
  clave?: string
  /** Los filtros TAL COMO están aplicados en la pantalla. */
  filtro?: FiltroExport
  /**
   * Los filtros NO temporales, en palabras del dueño: `['Empresa 1', 'Vencidas']`. Los
   * escribe la vista porque es la única que sabe traducir los suyos («VENCIDA» →
   * «Vencidas»). El período lo pone este componente a partir de `filtro`, para que no
   * haya quince vistas formateando la misma fecha (y una olvidándose).
   */
  resumen?: string[]
  /**
   * Cuando de una misma pantalla se pueden bajar DOS cosas distintas (el conteo: el
   * acta de lo que pasó y la hoja en blanco para ir a contar).
   *
   * Van aquí y no en dos componentes porque dos botones «Descargar» seguidos son
   * indistinguibles: hay **un** botón de descarga por pantalla, y es el desplegable el
   * que dice qué se lleva. La `etiqueta` la pone la vista y no el registro porque
   * `tablas.ts` arrastra acciones de servidor: no se importa desde el navegador.
   */
  opciones?: { clave: string; etiqueta: string; filtro?: FiltroExport; resumen?: string[]; detalle?: string }[]
  /**
   * Texto del botón. Por defecto «Descargar», que es lo correcto cuando en la pantalla
   * solo hay uno. Cuando una pantalla ofrece DOS descargas distintas, no pueden llamarse
   * las dos igual —el usuario no tiene forma de saber cuál es cuál—: van separadas, cada
   * una en su sitio, y la secundaria dice lo que es («Hoja para contar»).
   */
  etiquetaBoton?: string
  /** Botón pequeño, para cuando vive en una barra de filtros y no en la cabecera. */
  pequeno?: boolean
  /**
   * Sin CSV.
   *
   * Para una PLANTILLA que se rellena a mano y se vuelve a subir, el CSV no es una
   * opción más: es la que rompe el trabajo. Se abre en Excel, el Excel en español lo
   * interpreta en Windows-1252, los acentos vuelven ilegibles y el «1.500» vuelve como
   * 1,5 — el mismo destrozo del que avisa el importador. Donde el archivo es un dato que
   * se lee (un listado, un acta), el CSV sí vale y sigue estando.
   */
  sinCsv?: boolean
  /**
   * Sin el trozo del período.
   *
   * `chipPeriodo` dice «Todo el listado» cuando no hay rango de fechas, y eso es
   * informativo en un LISTADO (dice que no está acotado). En una descarga que no es un
   * listado —el acta de un conteo concreto, la plantilla de un almacén— es una etiqueta
   * falsa: no hay ningún listado ni ningún período que acotar, y encabeza la frase
   * empujando al final lo único que identifica el archivo.
   */
  sinPeriodo?: boolean
  /**
   * PDF, que no puede salir del registro de tablas: un CSV es una tabla y un PDF es un
   * DOCUMENTO —tiene cabecera de marca, resumen y maquetación—, y eso solo lo sabe la
   * pantalla que lo emite. Se pinta como una opción más del mismo desplegable para que
   * el dueño vea los tres formatos juntos y no un botón suelto por formato.
   * `jspdf` se importa dinámicamente en quien lo genera, no aquí.
   */
  pdf?: { etiqueta?: string; detalle?: string; generar: () => void | Promise<void> }
  /**
   * QUÉ lleva el fichero, en una frase. El resumen de arriba dice de qué pantalla sale
   * («Acta del conteo · Almacén Central») y esto dice qué te vas a encontrar dentro
   * («Todo lo contado, línea a línea»). Sin esto, dos descargas de la misma pantalla se
   * distinguen solo por el nombre del botón, que es adivinar.
   */
  detalle?: string
}

/**
 * El período **en las palabras que el dueño eligió**: si tiene puesto «Últimos 3 meses»,
 * eso es lo que lee, no dos fechas que tiene que interpretar para reconocer el filtro
 * que acaba de pulsar. Las fechas solo salen cuando las escribió él (rango
 * personalizado), que es cuando son la información.
 *
 * El preset se deduce del rango con el MISMO `presetDeFechas` que enciende la píldora
 * en `RangoBusqueda`: así el desplegable y la barra de filtros no pueden decir cosas
 * distintas.
 */
function chipPeriodo(filtro?: FiltroExport): string {
  const desde = filtro?.desde ?? ''
  const hasta = filtro?.hasta ?? ''
  const preset = presetDeFechas(desde, hasta)
  // Sirve para las dos formas de «sin fecha»: un listado al que le han quitado el rango
  // y una tabla maestra (clientes, productos) que no filtra por fecha.
  if (preset === 'todo') return 'Todo el listado'
  if (preset !== 'personalizado') {
    return PRESETS_RANGO.find(p => p.id === preset)?.label ?? 'Todo el listado'
  }
  if (desde && hasta) return `${fmtFechaEs(desde)} – ${fmtFechaEs(hasta)}`
  return desde ? `desde el ${fmtFechaEs(desde)}` : `hasta el ${fmtFechaEs(hasta)}`
}

export default function ExportarMenu({
  clave, filtro, resumen, detalle, opciones, etiquetaBoton = 'Descargar', pequeno, pdf,
  sinCsv, sinPeriodo,
}: Props) {
  const [abierto, setAbierto] = useState(false)
  const [isPending, startTransition] = useTransition()
  const wrapRef = useRef<HTMLDivElement>(null)

  // Una sola forma interna: la lista. El caso de siempre (una clave suelta) es esa
  // lista con un elemento, así que no hay dos caminos que mantener.
  const tablas = opciones?.length
    ? opciones
    : clave ? [{ clave, etiqueta: '', filtro, resumen, detalle }] : []
  const varias = tablas.length > 1

  useEffect(() => {
    if (!abierto) return
    function fuera(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  function descargar(tabla: { clave: string; filtro?: FiltroExport }, formato: 'csv' | 'xlsx') {
    setAbierto(false)
    // El toast de carga se crea ANTES de la transición: dentro no llega a pintarse.
    const ld = toastLoading(formato === 'csv' ? 'Preparando el CSV…' : 'Preparando el Excel…')
    startTransition(async () => {
      const res = await exportarListado(tabla.clave, tabla.filtro ?? {}, formato)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'No se pudo exportar.'); return }

      if (res.xlsx) descargarBase64(res.nombre!, res.xlsx, XLSX_MIME)
      else          descargarBlob(res.nombre!, new Blob([res.csv ?? ''], { type: CSV_MIME }))

      const n = res.filas ?? 0
      toastSuccess(n === 0 ? 'No había filas que exportar' : `${n} ${n === 1 ? 'fila' : 'filas'} descargadas`)
    })
  }

  return (
    <div className="ven-dropdown-wrap" ref={wrapRef}>
      {/* Tamaño normal, no `btn-sm`: vive en el `page-header` junto a «Nueva factura» y
          «Nueva cuenta», que son `.btn` a secas. En pequeño parecía un pie de página. */}
      <button
        type="button"
        className={`btn btn-secondary${pequeno ? ' btn-sm' : ''}`}
        disabled={isPending}
        onClick={() => setAbierto(v => !v)}
        aria-expanded={abierto}
        title={`${etiquetaBoton}: Excel o CSV`}
      >
        <Download size={pequeno ? 14 : 16} strokeWidth={2} /> {etiquetaBoton}
      </button>
      {abierto && (
        <div className="ven-dropdown-menu">
          {tablas.map(t => (
            <div key={t.clave}>
              {/* Dos frases, y hacen falta las dos: la primera dice DE DÓNDE sale (la
                  pantalla y su filtro) y la segunda QUÉ hay dentro. Con solo la primera,
                  dos descargas de la misma pantalla se distinguían por el nombre del
                  botón, o sea adivinando. */}
              <div className="ven-dropdown-ctx">
                {[varias ? t.etiqueta : '', sinPeriodo ? '' : chipPeriodo(t.filtro), ...(t.resumen ?? [])]
                  .filter(Boolean).join(' · ')}
                {t.detalle && <span className="ven-dropdown-detalle">{t.detalle}</span>}
              </div>
              <button type="button" className="ven-dropdown-item" onClick={() => descargar(t, 'xlsx')}>
                Excel (.xlsx)
              </button>
              {!sinCsv && (
                <button type="button" className="ven-dropdown-item" onClick={() => descargar(t, 'csv')}>
                  CSV
                </button>
              )}
            </div>
          ))}
          {pdf && (
            <>
              {pdf.detalle && (
                <div className="ven-dropdown-ctx">
                  <span className="ven-dropdown-detalle">{pdf.detalle}</span>
                </div>
              )}
              <button type="button" className="ven-dropdown-item" onClick={() => { setAbierto(false); void pdf.generar() }}>
                {pdf.etiqueta ?? 'PDF'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
