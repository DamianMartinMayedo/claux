'use client'

import { useTransition } from 'react'
import { Download } from 'lucide-react'
import { toastError } from '@/app/contexts/ToastContext'
import { urlPdfFirmado } from '@/app/actions/documentos-admin'

export default function DescargarFirmaBtn({
  clientId, firmaId,
}: {
  clientId: string
  firmaId: number
}) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const url = await urlPdfFirmado(clientId, firmaId)
      if (!url) { toastError('El PDF firmado aún no está disponible.'); return }
      window.open(url, '_blank', 'noopener')
    })
  }

  return (
    <button type="button" className="ter-action-btn" disabled={isPending} onClick={handleClick} title="Descargar PDF firmado">
      <Download size={16} />
    </button>
  )
}
