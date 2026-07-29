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
  clave: string
  /** Los filtros TAL COMO están aplicados en la pantalla. */
  filtro?: FiltroExport
  /**
   * Los filtros NO temporales, en palabras del dueño: `['Empresa 1', 'Vencidas']`. Los
   * escribe la vista porque es la única que sabe traducir los suyos («VENCIDA» →
   * «Vencidas»). El período lo pone este componente a partir de `filtro`, para que no
   * haya quince vistas formateando la misma fecha (y una olvidándose).
   */
  resumen?: string[]
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

export default function ExportarMenu({ clave, filtro, resumen }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [isPending, startTransition] = useTransition()
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    function fuera(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  function descargar(formato: 'csv' | 'xlsx') {
    setAbierto(false)
    // El toast de carga se crea ANTES de la transición: dentro no llega a pintarse.
    const ld = toastLoading(formato === 'csv' ? 'Preparando el CSV…' : 'Preparando el Excel…')
    startTransition(async () => {
      const res = await exportarListado(clave, filtro ?? {}, formato)
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
        className="btn btn-secondary"
        disabled={isPending}
        onClick={() => setAbierto(v => !v)}
        aria-expanded={abierto}
        title="Descargar lo que estás viendo"
      >
        <Download size={16} strokeWidth={2} /> Descargar
      </button>
      {abierto && (
        <div className="ven-dropdown-menu">
          <div className="ven-dropdown-ctx">
            {[chipPeriodo(filtro), ...(resumen ?? []).filter(Boolean)].join(' · ')}
          </div>
          <button type="button" className="ven-dropdown-item" onClick={() => descargar('xlsx')}>
            Excel (.xlsx)
          </button>
          <button type="button" className="ven-dropdown-item" onClick={() => descargar('csv')}>
            CSV
          </button>
        </div>
      )}
    </div>
  )
}
