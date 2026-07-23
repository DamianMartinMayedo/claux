'use client'

import type { ReactNode } from 'react'
import { useTransition } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { resincronizarSnapshot } from '@/app/actions/portal/dossier'

// Banner de "snapshot desfasado" compartido por «Mi dossier», «Presentación» y
// «Estado de resultados». Con Contabilidad, el botón RE-SINCRONIZA solo (vuelve a
// derivar la serie en la moneda/empresa/período actuales) y avisa por toast —el
// dueño no re-teclea nada. Sin base no hay de dónde traer: se le lleva a «Los
// números» para que los revise a mano.
export default function DossierDesfase({
  dossierId, tieneBase, mensaje, onIrANumeros, onActualizado,
}: {
  dossierId: string
  tieneBase: boolean
  mensaje: ReactNode
  onIrANumeros?: () => void
  onActualizado?: () => void
}) {
  const [pending, startTransition] = useTransition()

  function actualizar() {
    const ld = toastLoading('Actualizando…')
    startTransition(async () => {
      const res = await resincronizarSnapshot(dossierId)
      await ld.dismiss()
      if (res.ok) { toastSuccess('Datos actualizados'); onActualizado?.() }
      else toastError(res.error || 'No se pudo actualizar')
    })
  }

  return (
    <div className="dos-desfase" role="alert">
      <AlertTriangle size={16} strokeWidth={2} />
      <div className="dos-desfase-texto">{mensaje}</div>
      {tieneBase ? (
        <button type="button" className="btn btn-aviso btn-sm" onClick={actualizar} disabled={pending}>
          {pending ? <Loader2 size={13} strokeWidth={2.5} className="dos-spin" /> : <RefreshCw size={13} strokeWidth={2.5} />}
          Actualizar números
        </button>
      ) : onIrANumeros ? (
        <button type="button" className="btn btn-aviso btn-sm" onClick={onIrANumeros}>Revisar números</button>
      ) : null}
    </div>
  )
}
