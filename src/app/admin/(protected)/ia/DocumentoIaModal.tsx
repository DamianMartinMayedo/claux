'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { guardarDocumentoIa, restaurarDocumentoIa } from '@/app/actions/ia-admin'
import ModalShell from '@/components/portal/ModalShell'
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

  const handleClose = useCallback(() => { setOpen(false) }, [])

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
    <ModalShell title={label} size="modal-lg" onClose={handleClose}>
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
        <div className="modal-footer">
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
    </ModalShell>
  )

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={abrir}>Ver / editar</button>
      {open && modal}
    </>
  )
}
