'use client'

import { Check, Key, LogIn } from 'lucide-react'
import { useState, useCallback } from 'react'
import { toastError } from '@/app/contexts/ToastContext'
import { regenerarPasswordCliente } from '@/app/actions/clientes'
import ModalShell from '@/components/portal/ModalShell'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import { entrarComoCliente } from '@/app/actions/admin/impersonar'

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

const COLUMNAS: ColumnasOrden<ClientUserRow> = {
  email:  { label: 'Email',  valor: u => u.email },
  nombre: { label: 'Nombre', valor: u => u.nombre },
  // El administrador de la empresa primero: es a quien se llama cuando hay lío.
  rol:    { label: 'Rol',    valor: u => (u.rol === 'admin_empresa' ? 0 : 1) },
  estado: { label: 'Estado', valor: u => (u.estado === 'ACTIVO' ? 0 : 1) },
}

type Props = {
  clientId: string
  usuarios: ClientUserRow[]
}

export default function AccesoUsuariosCard({ clientId, usuarios }: Props) {
  const orden = useOrden(usuarios, COLUMNAS, { clave: 'rol', dir: 'asc' })
  const [resetting, setResetting] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ email: string; password: string; emailEnviado: boolean } | null>(null)
  const [copiado, setCopiado]     = useState(false)
  const [confirmEntrar, setConfirmEntrar] = useState(false)
  const [entrando, setEntrando]           = useState(false)

  const cerrar = useCallback(() => { setResultado(null); setCopiado(false) }, [])

  const cerrarEntrar = useCallback(() => { if (!entrando) setConfirmEntrar(false) }, [entrando])

  async function handleEntrar() {
    setEntrando(true)
    // En éxito el server action redirige al portal (no retorna); solo llega aquí
    // si hubo error.
    const res = await entrarComoCliente(clientId)
    setEntrando(false)
    if (res?.error) {
      setConfirmEntrar(false)
      toastError(res.error)
    }
  }

  async function handleReset(u: ClientUserRow) {
    setResetting(u.user_id)
    const res = await regenerarPasswordCliente(u.user_id, clientId)
    setResetting(null)
    if (!res.ok || !res.passwordTemporal) {
      toastError(res.error ?? 'No se pudo regenerar la contraseña.')
      return
    }
    setResultado({ email: u.email, password: res.passwordTemporal, emailEnviado: !!res.emailEnviado })
  }

  function copiar() {
    if (!resultado) return
    navigator.clipboard.writeText(resultado.password).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

  const modal = resultado && (
    <ModalShell title="Contraseña regenerada" size="modal-420" onClose={cerrar}>
      <div className="modal-body">
        <p className="text-sm-muted">
          La contraseña no se mostrará de nuevo. El usuario definirá la suya en el
          próximo acceso.
        </p>
        <p className={`alert ${resultado.emailEnviado ? 'alert-success' : 'alert-warning'}`} role="alert">
          {resultado.emailEnviado
            ? <>Le enviamos estos datos de acceso a <strong>{resultado.email}</strong>.</>
            : <>No pudimos enviarle el correo. Comparte la contraseña con <strong>{resultado.email}</strong> de forma segura.</>}
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
    </ModalShell>
  )

  const modalEntrar = confirmEntrar && (
    <ModalShell title="Entrar al portal del cliente" size="modal-420" onClose={cerrarEntrar}>
      <div className="modal-body">
        <p className="text-sm-muted">
          Vas a entrar al portal de este negocio como <strong>sesión de configuración</strong>,
          sin necesidad de su contraseña. Verás un aviso mientras estés dentro y podrás salir
          cuando quieras. El acceso queda registrado en Actividad y no cuenta como uso del cliente.
        </p>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={cerrarEntrar} disabled={entrando}>Cancelar</button>
        <button className="btn btn-primary" onClick={handleEntrar} disabled={entrando}>
          {entrando
            ? <><span className="spinner spinner-xs" /> Entrando…</>
            : <><LogIn size={15} /> Entrar al portal</>}
        </button>
      </div>
    </ModalShell>
  )

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="detail-section-title">Acceso y usuarios</h2>
        <button className="btn btn-secondary btn-sm" onClick={() => setConfirmEntrar(true)}>
          <LogIn size={14} /> Entrar al portal
        </button>
      </div>

      {usuarios.length === 0 ? (
        <p className="text-sm-muted">Este cliente no tiene usuarios registrados.</p>
      ) : (
        <div className="table-wrapper table-wrapper-flush">
          <table className="table">
            <thead>
              <tr>
                <ThOrden clave="email" orden={orden} />
                <ThOrden clave="nombre" orden={orden} />
                <ThOrden clave="rol" orden={orden} />
                <ThOrden clave="estado" orden={orden} />
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {orden.filas.map(u => (
                <tr key={u.user_id} className={u.estado === 'INACTIVO' ? 'row-inactive' : ''}>
                  <td data-label="Email">{u.email}</td>
                  <td data-label="Nombre" className="table-muted"><span className="cell-clamp">{u.nombre || '—'}</span></td>
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

      {modal}
      {modalEntrar}
    </div>
  )
}
