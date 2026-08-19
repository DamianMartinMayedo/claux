'use client'

import { useTransition } from 'react'
import { Send } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { enviarRecordatorioDocumentos } from '@/app/actions/documentos-admin'

export default function RecordatorioDocumentosBtn({ clientId }: { clientId: string }) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const res = await enviarRecordatorioDocumentos(clientId)
      if (!res.ok) { toastError(res.error ?? 'No se pudo enviar el recordatorio.'); return }
      toastSuccess('Recordatorio enviado al cliente')
    })
  }

  return (
    <button type="button" className="btn btn-secondary btn-sm" disabled={isPending} onClick={handleClick}>
      <Send size={14} strokeWidth={2.5} /> {isPending ? 'Enviando…' : 'Enviar recordatorio'}
    </button>
  )
}
