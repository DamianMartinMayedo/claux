'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { reabrirFirmas } from '@/app/actions/documentos-admin'

// Reabre la firma: caduca las firmas vigentes para que el cliente pueda
// actualizar sus datos fiscales y volver a firmar. Pide confirmación porque
// invalida firmas ya hechas (aunque el PDF de cada una se conserva).
export default function ReabrirFirmasBtn({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleReabrir() {
    startTransition(async () => {
      const res = await reabrirFirmas(clientId)
      if (!res.ok) { toastError(res.error ?? 'No se pudo reabrir.'); return }
      toastSuccess(`Firma reabierta (${res.caducadas ?? 0} caducada(s)). El cliente deberá volver a firmar.`)
      setConfirmando(false)
      router.refresh()
    })
  }

  if (!confirmando) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmando(true)}>
        <RotateCcw size={14} strokeWidth={2.5} /> Reabrir para actualizar
      </button>
    )
  }

  return (
    <div className="doc-cli-confirm">
      <span className="doc-cli-confirm-txt">¿Caducar las firmas y pedir que firme de nuevo?</span>
      <button type="button" className="btn btn-danger btn-sm" disabled={isPending} onClick={handleReabrir}>
        {isPending ? 'Reabriendo…' : 'Sí, reabrir'}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmando(false)}>Cancelar</button>
    </div>
  )
}
