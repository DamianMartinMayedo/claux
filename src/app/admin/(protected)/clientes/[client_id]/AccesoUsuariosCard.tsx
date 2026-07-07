'use client'

import { Check, Key, X } from 'lucide-react'
import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { toastError } from '@/app/contexts/ToastContext'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { regenerarPasswordCliente } from '@/app/actions/clientes'

const ROL_LABEL: Record<string, string> = {
  admin_empresa: 'Administrador',
  usuario:       'Operador',
}

export type ClientUserRow = {
  user_id: string
  email:   string
  nombre:  string | null
  rol:     string
  estado:  string
}

type Props = {
  clientId: string
  usuarios: ClientUserRow[]
}

export default function AccesoUsuariosCard({ clientId, usuarios }: Props) {
  const mounted = useMounted()
  const [resetting, setResetting] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ email: string; password: string } | null>(null)
  const [copiado, setCopiado]     = useState(false)

  const cerrar = useCallback(() => { setResultado(null); setCopiado(false) }, [])
  useModalKeyboard(!!resultado, cerrar)

  async function handleReset(u: ClientUserRow) {
    setResetting(u.user_id)
    const res = await regenerarPasswordCliente(u.user_id, clientId)
    setResetting(null)
    if (!res.ok || !res.passwordTemporal) {
      toastError(res.error ?? 'No se pudo regenerar la contraseña.')
      return
    }
    setResultado({ email: u.email, password: res.passwordTemporal })
  }

  function copiar() {
    if (!resultado) return
    navigator.clipboard.writeText(resultado.password).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

  const modal = resultado && (
    <div className="modal-backdrop">
      <div className="modal modal-420">
        <div className="modal-header">
          <h2 className="modal-title">Contraseña regenerada</h2>
          <button onClick={cerrar} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="text-sm-muted">
            Comparte esta contraseña con <strong>{resultado.email}</strong> de forma segura.
            No se mostrará de nuevo.
          </p>
          <div className="code-block">
            <div className="code-block-field">
              <label className="code-block-label">Usuario</label>
              <p className="code-block-value code-block-value-text">{resultado.email}</p>
            </div>
            <div className="code-block-field">
              <label className="code-block-label">Contraseña temporal</label>
              <p className="code-block-value code-block-value-text">{resultado.password}</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={copiar}>
            {copiado ? <><Check size={15} /> Copiado</> : 'Copiar contraseña'}
          </button>
          <button className="btn btn-primary" onClick={cerrar}>Listo</button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="card">
      <h2 className="detail-section-title">Acceso y usuarios</h2>

      {usuarios.length === 0 ? (
        <p className="text-sm-muted">Este cliente no tiene usuarios registrados.</p>
      ) : (
        <div className="table-wrapper table-wrapper-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Estado</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.user_id} className={u.estado === 'INACTIVO' ? 'row-inactive' : ''}>
                  <td data-label="Email">{u.email}</td>
                  <td data-label="Nombre" className="table-muted">{u.nombre || '—'}</td>
                  <td data-label="Rol">
                    <span className="badge badge-neutral">{ROL_LABEL[u.rol] ?? u.rol}</span>
                  </td>
                  <td data-label="Estado">
                    <span className={`badge ${u.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
                      {u.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="col-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleReset(u)}
                      disabled={resetting === u.user_id}
                      title="Regenerar contraseña"
                    >
                      {resetting === u.user_id
                        ? <><span className="spinner spinner-xs" /> Regenerando…</>
                        : <><Key size={14} /> Restablecer contraseña</>}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mounted && modal && createPortal(modal, document.body)}
    </div>
  )
}
