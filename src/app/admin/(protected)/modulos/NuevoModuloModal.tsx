'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { crearModulo } from '@/app/actions/modulos'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { useToast } from '@/app/contexts/ToastContext'

export default function NuevoModuloModal() {
  const { success: toastSuccess, error: toastError, loading: toastLoading } = useToast()
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const formRef               = useRef<HTMLFormElement>(null)
  const mounted               = useMounted()

  const handleClose = useCallback(() => { setOpen(false) }, [])
  useModalKeyboard(open, handleClose)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await crearModulo(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al crear'); return }
    toastSuccess('Módulo creado')
    handleClose()
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-md">
        <div className="modal-header">
          <h2 className="modal-title">Nuevo módulo</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Clave <span className="required">*</span></label>
                <input name="clave" className="input" required placeholder="ej: fidelizacion" pattern="[a-z][a-z0-9_]*" />
                <span className="input-hint">Identificador único, solo minúsculas y _</span>
              </div>
              <div className="input-group">
                <label>Tipo <span className="required">*</span></label>
                <select name="tipo" className="input" required defaultValue="modulo">
                  <option value="modulo">Módulo</option>
                  <option value="funcionalidad">Funcionalidad</option>
                  <option value="addon">Addon</option>
                </select>
              </div>
            </div>
            <div className="input-group">
              <label>Nombre <span className="required">*</span></label>
              <input name="nombre" className="input" required placeholder="ej: Fidelización" />
            </div>
            <div className="input-group">
              <label>Descripción</label>
              <textarea name="descripcion" className="input" rows={2} placeholder="Describe qué incluye este módulo…" />
            </div>
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Precio fundador (USD)</label>
                <input name="precio_fundador_usd" className="input" type="number" min="0" step="0.01" required defaultValue="0" />
              </div>
              <div className="input-group">
                <label>Precio estándar (USD)</label>
                <input name="precio_estandar_usd" className="input" type="number" min="0" step="0.01" required defaultValue="0" />
              </div>
            </div>
            <div className="info-banner" style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p>Las páginas internas (módulo) o rutas (funcionalidad) se crean con el asistente de IA. Desde aquí solo gestionas el catálogo.</p>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Creando...</> : 'Crear módulo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Nuevo módulo
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
