'use client'

import { useTransition } from 'react'
import { Download } from 'lucide-react'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { useConfigurador } from '@/components/portal/ConfiguradorContext'
import { exportarTabla } from '@/app/actions/portal/exportar'
import { descargarBlob, CSV_MIME } from '@/lib/exportar/descargar'

/**
 * Descarga la tabla entera del negocio en CSV.
 *
 * SOLO se pinta en la sesión de CONFIGURACIÓN (impersonación). Para el usuario del
 * negocio no existe: no es una función del portal, es la herramienta con la que el
 * equipo CLAUX se lleva los datos de un cliente. Ocultarlo aquí es cosmética — el
 * candado de verdad está en la server action, que comprueba `session.imp`.
 *
 * Solo CSV: un .xlsx es un ZIP de XML y encima habría que codificarlo en base64
 * para cruzar la server action. Para revisar o migrar datos pesa varias veces más
 * por lo mismo, y esto se descarga en 3G.
 *
 * Descarga DIRECTA (Blob, sin abrir pestaña ni recargar), que en Cuba es la regla.
 */
export default function ExportarTabla({ clave }: { clave: string }) {
  const esConfigurador = useConfigurador()
  const [isPending, startTransition] = useTransition()

  if (!esConfigurador) return null

  function descargar() {
    // El toast de carga se crea ANTES de la transición: dentro no llega a pintarse.
    const ld = toastLoading('Preparando el CSV…')
    startTransition(async () => {
      const res = await exportarTabla(clave)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'No se pudo exportar.'); return }

      descargarBlob(res.nombre!, new Blob([res.contenido!], { type: CSV_MIME }))
      const n = res.filas ?? 0
      toastSuccess(n === 0 ? 'No había filas que exportar' : `${n} ${n === 1 ? 'fila' : 'filas'} descargadas`)
    })
  }

  return (
    <button type="button" className="btn btn-secondary btn-sm" disabled={isPending}
      onClick={descargar} title="Descargar esta tabla en CSV (solo configuración)">
      <Download size={14} strokeWidth={2} /> CSV
    </button>
  )
}
