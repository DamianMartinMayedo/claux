'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { crearPlan } from '@/app/actions/planes'
import { MODULOS, DURACION_MODALIDAD } from '@/lib/planes-constants'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'

export default function NuevoPlanModal() {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)
  const mounted = useMounted()
  const formRef     = useRef<HTMLFormElement>(null)
  const duracionRef = useRef<HTMLInputElement>(null)
  const router      = useRouter()

  const handleClose = useCallback(() => { setOpen(false); setError(''); setSuccess(false) }, [])

  useModalKeyboard(open, handleClose)

  function onModalidadChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const sugerido = DURACION_MODALIDAD[e.target.value]
    if (sugerido && duracionRef.current) duracionRef.current.value = String(sugerido)
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await crearPlan(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error desconocido'); return }
    setSuccess(true)
    setTimeout(() => { setOpen(false); setSuccess(false); formRef.current?.reset(); router.refresh() }, 1200)
  }

  const modal = (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="modal" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <h2 className="modal-title">Nuevo plan</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">

            {/* Nombre */}
            <div className="input-group">
              <label>Nombre del plan <span className="required">*</span></label>
              <input name="nombre" className="input" required placeholder="Ej: Básico Mensual" />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                El ID se genera automáticamente según nivel y modalidad (ej: BM001, PT002).
              </span>
            </div>

            {/* Nivel + Modalidad */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Nivel <span className="required">*</span></label>
                <select name="nivel" className="input" required defaultValue="basico">
                  <option value="basico">Básico</option>
                  <option value="profesional">Profesional</option>
                  <option value="empresarial">Empresarial</option>
                </select>
              </div>
              <div className="input-group">
                <label>Modalidad <span className="required">*</span></label>
                <select name="modalidad" className="input" required defaultValue="mensual" onChange={onModalidadChange}>
                  <option value="mensual">Mensual</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="semestral">Semestral</option>
                  <option value="anual">Anual</option>
                  <option value="personalizado">Personalizado</option>
                </select>
              </div>
            </div>

            {/* Precio + Duración + Trial */}
            <div className="grid-cols-3">
              <div className="input-group">
                <label>Precio USD <span className="required">*</span></label>
                <input name="precio_usd" type="number" step="0.01" min="0" className="input" required placeholder="0.00" />
              </div>
              <div className="input-group">
                <label>Duración (días) <span className="required">*</span></label>
                <input ref={duracionRef} name="duracion_dias" type="number" min="1" className="input" required defaultValue={30} />
              </div>
              <div className="input-group">
                <label>Días de trial</label>
                <input name="dias_trial" type="number" min="0" className="input" defaultValue={15} />
              </div>
            </div>

            {/* Capacidad */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Máx. empresas</label>
                <input name="max_empresas" type="number" min="1" className="input" defaultValue={1} />
              </div>
              <div className="input-group">
                <label>Máx. usuarios <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(-1 = ilimitado)</span></label>
                <input name="max_usuarios" type="number" min="-1" className="input" defaultValue={2} />
              </div>
            </div>

            {/* Módulos */}
            <div>
              <p className="modal-section-label">Módulos incluidos</p>
              <div className="modules-grid">
                {MODULOS.map(m => (
                  <label key={m.id} className="module-check">
                    <input type="checkbox" name="modulos" value={m.id} />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Estado + Visible */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Estado</label>
                <select name="estado" className="input" defaultValue="ACTIVO">
                  <option value="ACTIVO">ACTIVO</option>
                  <option value="INACTIVO">INACTIVO</option>
                </select>
              </div>
              <div className="input-group">
                <label>Visible para clientes</label>
                <select name="visible" className="input" defaultValue="true">
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>
            </div>

            {/* Descripción */}
            <div className="input-group">
              <label>Descripción</label>
              <textarea name="descripcion" className="input" rows={2} placeholder="Descripción breve del plan" />
            </div>

            {error   && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">Plan creado correctamente</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Creando...</> : 'Crear plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Nuevo plan
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
