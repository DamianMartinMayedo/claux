'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { cambiarPlan, cambiarEstadoCliente, aplicarGracia } from '@/app/actions/clientes'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'

type Plan = { plan_id: string; nombre: string; nivel: string; precio_usd: number }

type Cliente = {
  client_id: string
  nombre_empresa: string
  estado: string
  plan_id: string
}

type ModalType = 'plan' | 'estado' | 'gracia' | null

export default function AccionesCliente({ cliente, planes }: { cliente: Cliente; planes: Plan[] }) {
  const [modal, setModal]   = useState<ModalType>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const [success, setSuccess] = useState('')
  const mounted = useMounted()
  const formRef = useRef<HTMLFormElement>(null)
  const router  = useRouter()

  const handleClose = useCallback(() => { setModal(null); setError(''); setSuccess('') }, [])
  useModalKeyboard(!!modal, handleClose)

  async function handleSubmit(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
    setError('')
    setLoading(true)
    const res = await action(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error desconocido'); return }
    setSuccess('Cambio guardado correctamente')
    setTimeout(() => { handleClose(); router.refresh() }, 1000)
  }

  const esSuspendido = cliente.estado === 'SUSPENDIDO'

  // ── Modal: Cambiar plan ──────────────────────────────────────────────
  const modalCambiarPlan = (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2 className="modal-title">Cambiar plan</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); handleSubmit(cambiarPlan) }}>
          <input type="hidden" name="client_id" value={cliente.client_id} />
          <div className="modal-body">
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
              Cliente: <strong>{cliente.nombre_empresa}</strong>
            </p>
            <div className="input-group">
              <label>Nuevo plan <span className="required">*</span></label>
              <select name="plan_id" className="input" required defaultValue={cliente.plan_id}>
                {planes.map(p => (
                  <option key={p.plan_id} value={p.plan_id}>
                    {p.nombre} — ${p.precio_usd}/período
                  </option>
                ))}
              </select>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              La fecha de expiración se recalculará desde hoy según la duración del nuevo plan.
            </p>
            {error   && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar cambio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  // ── Modal: Suspender / Reactivar ─────────────────────────────────────
  const nuevoEstado = esSuspendido ? 'ACTIVO' : 'SUSPENDIDO'
  const modalEstado = (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2 className="modal-title">{esSuspendido ? 'Reactivar cliente' : 'Suspender cliente'}</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); handleSubmit(cambiarEstadoCliente) }}>
          <input type="hidden" name="client_id" value={cliente.client_id} />
          <input type="hidden" name="estado" value={nuevoEstado} />
          <div className="modal-body">
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              {esSuspendido
                ? <>¿Reactivar el acceso de <strong>{cliente.nombre_empresa}</strong>? El estado pasará a ACTIVO.</>
                : <>¿Suspender el acceso de <strong>{cliente.nombre_empresa}</strong>? El cliente no podrá iniciar sesión.</>
              }
            </p>
            {error   && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button
              type="submit"
              className={`btn ${esSuspendido ? 'btn-primary' : 'btn-danger'}`}
              disabled={loading}
            >
              {loading
                ? <><span className="spinner" /> {esSuspendido ? 'Reactivando...' : 'Suspendiendo...'}</>
                : esSuspendido ? 'Reactivar' : 'Suspender'
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  // ── Modal: Período de gracia ─────────────────────────────────────────
  const modalGracia = (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2 className="modal-title">Período de gracia</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); handleSubmit(aplicarGracia) }}>
          <input type="hidden" name="client_id" value={cliente.client_id} />
          <div className="modal-body">
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
              Extiende el acceso de <strong>{cliente.nombre_empresa}</strong> sin registrar un pago.
            </p>
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Días de gracia <span className="required">*</span></label>
                <input name="dias" type="number" min="1" max="180" className="input" required defaultValue={15} />
              </div>
              <div className="input-group">
                <label>Motivo <span className="required">*</span></label>
                <input name="motivo" className="input" required placeholder="Ej: negociación en curso" />
              </div>
            </div>
            <div className="input-group">
              <label>Notas adicionales</label>
              <textarea name="notas" className="input" rows={2} placeholder="Opcional" />
            </div>
            {error   && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Aplicando...</> : 'Aplicar gracia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  const activeModal = modal === 'plan'
    ? modalCambiarPlan
    : modal === 'estado'
    ? modalEstado
    : modal === 'gracia'
    ? modalGracia
    : null

  return (
    <>
      <div className="table-actions-right">
        <button className="btn btn-secondary btn-sm" onClick={() => setModal('plan')} title="Cambiar plan">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
          Plan
        </button>
        <button
          className={`btn btn-sm ${esSuspendido ? 'btn-secondary' : 'btn-secondary'}`}
          onClick={() => setModal('estado')}
          title={esSuspendido ? 'Reactivar' : 'Suspender'}
        >
          {esSuspendido ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="10 8 16 12 10 16 10 8"/>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/>
            </svg>
          )}
          {esSuspendido ? 'Activar' : 'Pausar'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => setModal('gracia')} title="Período de gracia">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Gracia
        </button>
      </div>

      {mounted && activeModal && createPortal(activeModal, document.body)}
    </>
  )
}
