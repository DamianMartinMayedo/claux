'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { crearCliente } from '@/app/actions/clientes'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'

type Plan = { plan_id: string; nombre: string; nivel: string; precio_usd: number }

export default function NuevoClienteModal({ planes }: { planes: Plan[] }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [resultado, setResultado] = useState<{ client_id: string; passwordTemporal: string } | null>(null)
  const mounted = useMounted()
  const formRef = useRef<HTMLFormElement>(null)
  const router  = useRouter()

  const handleClose = useCallback(() => {
    setOpen(false)
    setError('')
    if (resultado) {
      setResultado(null)
      router.refresh()
    }
  }, [resultado, router])

  useModalKeyboard(open, handleClose)

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await crearCliente(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error desconocido'); return }
    setResultado({ client_id: res.client_id!, passwordTemporal: res.passwordTemporal! })
    formRef.current?.reset()
  }

  const modal = (
    <div
      className="modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="modal">
        {resultado ? (
          <div className="modal-body modal-body-success">
            <div className="success-icon-circle">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div className="text-center">
              <h2 className="modal-title modal-success-title">Cliente creado</h2>
              <p className="modal-success-description">
                Guarda las credenciales iniciales del cliente.
              </p>
            </div>
            <div className="code-block">
              <div className="code-block-field">
                <label className="code-block-label">ID Cliente</label>
                <p className="code-block-value">{resultado.client_id}</p>
              </div>
              <div className="code-block-field">
                <label className="code-block-label">Contraseña temporal</label>
                <p className="code-block-value code-block-value-text">{resultado.passwordTemporal}</p>
              </div>
            </div>
            <button className="btn btn-primary btn-full" onClick={handleClose}>Listo</button>
          </div>
        ) : (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Nuevo cliente</h2>
              <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <form ref={formRef} onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="input-group">
                  <label>Nombre de la empresa <span className="required">*</span></label>
                  <input name="nombre_empresa" className="input" required placeholder="Ej: Empresa Ejemplo S.L." />
                </div>

                <div className="input-group">
                  <label>Nombre del contacto</label>
                  <input name="nombre_contacto" className="input" placeholder="Nombre del administrador" />
                </div>

                <div className="input-group">
                  <label>Email del administrador <span className="required">*</span></label>
                  <input name="email_admin" type="email" className="input" required placeholder="admin@empresa.com" />
                </div>

                <div className="input-group">
                  <label>Plan <span className="required">*</span></label>
                  <select name="plan_id" className="input" required defaultValue="">
                    <option value="" disabled>Selecciona un plan</option>
                    {planes.map(p => (
                      <option key={p.plan_id} value={p.plan_id}>
                        {p.nombre} — ${p.precio_usd}/período
                      </option>
                    ))}
                  </select>
                </div>

                <label className="checkbox-group">
                  <input type="checkbox" name="es_trial" value="true" defaultChecked />
                  <span className="checkbox-label">Iniciar con período de prueba gratuita</span>
                </label>

                <div className="input-group">
                  <label>Notas internas</label>
                  <textarea name="notas" className="input" rows={2} placeholder="Opcional" />
                </div>

                {error && <div className="alert alert-error">{error}</div>}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading
                    ? <><span className="spinner" /> Creando...</>
                    : 'Crear cliente'
                  }
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Nuevo cliente
      </button>

      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
