'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { actualizarPlan } from '@/app/actions/planes'
import { MODULOS, DURACION_MODALIDAD } from '@/lib/planes-constants'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'

type Plan = {
  plan_id: string; nombre: string; nivel: string; modalidad: string
  precio_usd: number; duracion_dias: number; dias_trial: number
  max_empresas: number; max_usuarios: number; modulos: string | string[] | null
  estado: string; visible: boolean; descripcion: string | null
}

export default function EditarPlanModal({ plan }: { plan: Plan }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)
  const mounted = useMounted()
  const formRef     = useRef<HTMLFormElement>(null)
  const duracionRef = useRef<HTMLInputElement>(null)
  const router      = useRouter()

  const modulosActivos = Array.isArray(plan.modulos)
    ? plan.modulos.filter(Boolean)
    : (plan.modulos ?? '').split(',').map(m => m.trim()).filter(Boolean)

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
    const res = await actualizarPlan(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error desconocido'); return }
    setSuccess(true)
    setTimeout(() => { setOpen(false); setSuccess(false); router.refresh() }, 1200)
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <h2 className="modal-title">Editar plan</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <input type="hidden" name="plan_id" value={plan.plan_id} />

          <div className="modal-body">

            {/* Nombre */}
            <div className="input-group">
              <label>Nombre del plan <span className="required">*</span></label>
              <input name="nombre" className="input" required defaultValue={plan.nombre} />
            </div>

            {/* Nivel + Modalidad */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Nivel <span className="required">*</span></label>
                <select name="nivel" className="input" required defaultValue={plan.nivel}>
                  <option value="basico">Básico</option>
                  <option value="profesional">Profesional</option>
                  <option value="empresarial">Empresarial</option>
                </select>
              </div>
              <div className="input-group">
                <label>Modalidad <span className="required">*</span></label>
                <select name="modalidad" className="input" required defaultValue={plan.modalidad ?? 'mensual'} onChange={onModalidadChange}>
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
                <input name="precio_usd" type="number" step="0.01" min="0" className="input" required defaultValue={plan.precio_usd} />
              </div>
              <div className="input-group">
                <label>Duración (días) <span className="required">*</span></label>
                <input ref={duracionRef} name="duracion_dias" type="number" min="1" className="input" required defaultValue={plan.duracion_dias ?? 30} />
              </div>
              <div className="input-group">
                <label>Días de trial</label>
                <input name="dias_trial" type="number" min="0" className="input" defaultValue={plan.dias_trial ?? 15} />
              </div>
            </div>

            {/* Capacidad */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Máx. empresas</label>
                <input name="max_empresas" type="number" min="1" className="input" defaultValue={plan.max_empresas ?? 1} />
              </div>
              <div className="input-group">
                <label>Máx. usuarios <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(-1 = ilimitado)</span></label>
                <input name="max_usuarios" type="number" min="-1" className="input" defaultValue={plan.max_usuarios ?? 2} />
              </div>
            </div>

            {/* Módulos */}
            <div>
              <p className="modal-section-label">Módulos incluidos</p>
              <div className="modules-grid">
                {MODULOS.map(m => (
                  <label key={m.id} className="module-check">
                    <input
                      type="checkbox"
                      name="modulos"
                      value={m.id}
                      defaultChecked={modulosActivos.includes(m.id)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Estado + Visible */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Estado</label>
                <select name="estado" className="input" defaultValue={plan.estado}>
                  <option value="ACTIVO">ACTIVO</option>
                  <option value="INACTIVO">INACTIVO</option>
                  <option value="OCULTO">OCULTO</option>
                </select>
              </div>
              <div className="input-group">
                <label>Visible para clientes</label>
                <select name="visible" className="input" defaultValue={String(plan.visible)}>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>
            </div>

            {/* Descripción */}
            <div className="input-group">
              <label>Descripción</label>
              <textarea name="descripcion" className="input" rows={2} defaultValue={plan.descripcion ?? ''} placeholder="Descripción breve del plan" />
            </div>

            {error   && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">Plan actualizado correctamente</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button className="btn-icon" onClick={() => setOpen(true)} title="Editar plan" aria-label="Editar plan">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
