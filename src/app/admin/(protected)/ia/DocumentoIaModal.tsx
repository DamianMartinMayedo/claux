'use client'

import { X } from 'lucide-react'
import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { guardarDocumentoIa, restaurarDocumentoIa } from '@/app/actions/ia-admin'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'

// Ver/editar un documento de IA (personalidad o prompt de sección) en un modal.
// El contenido no ocupa espacio en la página hasta que se abre.
export default function DocumentoIaModal({
  docKey, label, descripcion, valor, esPersonalidad,
}: { docKey: string; label: string; descripcion: string; valor: string; esPersonalidad: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [texto, setTexto] = useState(valor)
  const [loading, setLoading] = useState(false)
  const mounted = useMounted()

  const handleClose = useCallback(() => { setOpen(false) }, [])
  useModalKeyboard(open, handleClose)

  function abrir() { setTexto(valor); setOpen(true) }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const r = await guardarDocumentoIa(docKey, texto)
    setLoading(false)
    if (!r.ok) { toastError(r.error); return }
    toastSuccess(`${label} guardado`)
    handleClose()
    router.refresh()
  }

  async function restaurar() {
    setLoading(true)
    const r = await restaurarDocumentoIa(docKey)
    setLoading(false)
    if (!r.ok) { toastError(r.error); return }
    toastSuccess(`${label} restaurado por defecto`)
    handleClose()
    router.refresh()
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2 className="modal-title">{label}</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <form onSubmit={guardar}>
          <div className="modal-body">
            <p className="config-field-hint">{descripcion}</p>
            <textarea className="input ia-instr-textarea" value={texto} onChange={e => setTexto(e.target.value)}
                      rows={18} spellCheck={false} aria-label={label} />
            {esPersonalidad && (
              <span className="input-hint">
                Comodines disponibles (se rellenan solos): <code>{'{{agente}}'}</code>, <code>{'{{negocio}}'}</code>,{' '}
                <code>{'{{usuario}}'}</code>, <code>{'{{tono}}'}</code>. Los datos del negocio se añaden aparte, no aquí.
              </span>
            )}
          </div>
          <div className="modal-footer modal-footer-split">
            <button type="button" className="btn btn-ghost btn-sm" onClick={restaurar} disabled={loading}>
              Restaurar por defecto
            </button>
            <div className="modal-footer-actions">
              <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={abrir}>Ver / editar</button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
