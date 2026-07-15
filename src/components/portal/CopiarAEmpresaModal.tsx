'use client'

import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'

// Modal genérico para copiar un registro (cliente/proveedor o empleado) a otra
// empresa. El registro copiado es INDEPENDIENTE: cada empresa lleva su propia
// relación (moneda, CxC, contrato). `onCopiar` ejecuta la server action concreta.
export default function CopiarAEmpresaModal({
  titulo, descripcion, empresas, onCopiar, onClose, onCopiado,
}: {
  titulo:      string
  descripcion: string
  empresas:    { empresa_id: string; nombre: string }[]
  onCopiar:    (empresaId: string) => Promise<{ ok: boolean; error?: string }>
  onClose:     () => void
  onCopiado:   () => void
}) {
  const [empresaId, setEmpresaId]    = useState(empresas[0]?.empresa_id ?? '')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    startTransition(async () => {
      const r = await onCopiar(empresaId)
      if (!r.ok) { toastError(r.error ?? 'No se pudo copiar.'); return }
      toastSuccess('Copiado a la otra empresa.')
      onCopiado()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{titulo}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="input-group">
              <label htmlFor="copiar-empresa">Empresa destino</label>
              <select id="copiar-empresa" className="input" value={empresaId}
                onChange={e => setEmpresaId(e.target.value)}>
                {empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
              </select>
              <span className="input-hint">{descripcion}</span>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || !empresaId}>
              {isPending ? <><span className="spinner spinner-sm" /> Copiando…</> : 'Copiar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
