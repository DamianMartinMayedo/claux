'use client'

// ────────────────────────────────────────────────────────────────────────────
// «Descarga lo que estás viendo», en Excel o CSV.
//
// Es el hermano de `ExportarTabla` y NO lo mismo: aquel se lleva la tabla entera y solo
// existe para la sesión de configuración; este exporta lo FILTRADO y lo ve el dueño, que
// es el caso de uso del día a día («todas las facturas de este período»).
//
// Los dos comparten motor (`lib/exportar/csv.ts` + el registro de columnas de
// `lib/exportar/tablas.ts`): si se añade una columna, sale en los dos formatos y en las
// dos exportaciones. Ese era el punto de tener un registro y no un exportador por
// pantalla — en el repo llegó a haber cuatro generadores de CSV a mano, cada uno con su
// separador y uno sin BOM.
//
// Descarga DIRECTA (Blob, sin abrir pestaña ni recargar), que en Cuba es la regla.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useTransition } from 'react'
import { Download } from 'lucide-react'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { exportarListado } from '@/app/actions/portal/exportar'
import { descargarBase64, descargarBlob, CSV_MIME, XLSX_MIME } from '@/lib/exportar/descargar'

interface Props {
  /** Clave del registro de `lib/exportar/tablas.ts` (facturas, gastos_cobros…). */
  clave: string
  /** Los filtros TAL COMO están aplicados en la pantalla. */
  desde?: string
  hasta?: string
  q?:     string
}

export default function ExportarMenu({ clave, desde, hasta, q }: Props) {
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
      const res = await exportarListado(clave, { desde, hasta, q }, formato)
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
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={isPending}
        onClick={() => setAbierto(v => !v)}
        aria-expanded={abierto}
        title="Descargar lo que estás viendo"
      >
        <Download size={14} strokeWidth={2} /> Descargar
      </button>
      {abierto && (
        <div className="ven-dropdown-menu">
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
