'use client'

import { KeyRound, Pencil, Plus, Trash2, UserCog, X } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RowActions } from '@/components/portal/RowActions'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useToast } from '@/app/contexts/ToastContext'
import {
  eliminarUsuarioAdmin,
  resetPasswordUsuarioAdmin,
  type UsuarioAdmin,
} from '@/app/actions/usuarios-admin'
import UsuarioModal from './UsuarioModal'

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

function generarPassword(len = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function UsuariosView({ usuarios }: { usuarios: UsuarioAdmin[] }) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  const [modalNuevo, setModalNuevo] = useState(false)
  const [editando, setEditando]     = useState<UsuarioAdmin | null>(null)
  const [aEliminar, setAEliminar]   = useState<UsuarioAdmin | null>(null)
  const [borrando, setBorrando]     = useState(false)
  const [aResetear, setAResetear]   = useState<UsuarioAdmin | null>(null)
  const [nuevaPass, setNuevaPass]   = useState('')
  const [reseteando, setReseteando] = useState(false)
  const { pageItems, ...pag } = usePagination(usuarios)

  function cerrarModal(guardado: boolean) {
    setModalNuevo(false)
    setEditando(null)
    if (guardado) router.refresh()
  }

  async function confirmarEliminar() {
    if (!aEliminar) return
    setBorrando(true)
    const r = await eliminarUsuarioAdmin(aEliminar.email)
    setBorrando(false)
    if (!r.ok) { toastError(r.error); return }
    toastSuccess('Usuario eliminado')
    setAEliminar(null)
    router.refresh()
  }

  function abrirResetear(u: UsuarioAdmin) {
    setNuevaPass('')
    setAResetear(u)
  }

  async function confirmarResetear() {
    if (!aResetear) return
    setReseteando(true)
    const r = await resetPasswordUsuarioAdmin(aResetear.email, nuevaPass)
    setReseteando(false)
    if (!r.ok) { toastError(r.error); return }
    toastSuccess('Contraseña regenerada')
    setAResetear(null)
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Usuarios del equipo</h1>
          <p className="page-subtitle">
            {usuarios.length} usuario{usuarios.length !== 1 ? 's' : ''} · super admins y vendedores.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalNuevo(true)}>
          <Plus size={16} /> Nuevo usuario
        </button>
      </div>

      {usuarios.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <UserCog size={40} strokeWidth={1.5} />
            <h3 className="table-empty-title">Sin usuarios registrados</h3>
            <p>Crea el primer vendedor con el botón de arriba.</p>
          </div>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Alta</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(u => (
                  <tr key={u.email} className="table-row-clickable"
                    onClick={() => u.gestionable ? setEditando(u) : abrirResetear(u)}>
                    <td data-label="Nombre">
                      {u.nombre}
                      {u.esBootstrap && <div className="table-cell-sub">Cuenta base</div>}
                    </td>
                    <td data-label="Correo" className="table-muted">{u.email}</td>
                    <td data-label="Rol">
                      <span className={`badge ${u.rol === 'super_admin' ? 'badge-info' : 'badge-neutral'}`}>
                        {u.rol === 'super_admin' ? 'Super Admin' : 'Vendedor'}
                      </span>
                    </td>
                    <td data-label="Estado">
                      <span className={`badge ${u.activo ? 'badge-success' : 'badge-warning'}`}>
                        {u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td data-label="Alta" className="table-muted">{fmtFecha(u.created_at)}</td>
                    <td className="col-actions">
                      <RowActions>
                        {u.gestionable && (
                          <button className="row-actions-item" onClick={() => setEditando(u)}>
                            <Pencil size={15} strokeWidth={2} /> Editar
                          </button>
                        )}
                        <button className="row-actions-item" onClick={() => abrirResetear(u)}>
                          <KeyRound size={15} strokeWidth={2} /> Regenerar contraseña
                        </button>
                        {u.gestionable && (
                          <button className="row-actions-item row-actions-item-danger" onClick={() => setAEliminar(u)}>
                            <Trash2 size={15} strokeWidth={2} /> Eliminar
                          </button>
                        )}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} label="usuario" />
        </div>
      )}

      {(modalNuevo || editando) && (
        <UsuarioModal usuario={editando} onClose={cerrarModal} />
      )}

      {aEliminar && (
        <div className="modal-backdrop" onClick={() => setAEliminar(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Eliminar usuario</h2>
              <button onClick={() => setAEliminar(null)} className="modal-close" aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-sm-muted">
                ¿Seguro que quieres eliminar a <strong>{aEliminar.nombre}</strong> ({aEliminar.email})?
                Se borrará también su cuenta de acceso. Esta acción no se puede deshacer.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAEliminar(null)}>Cancelar</button>
              <button className="btn btn-danger" disabled={borrando} onClick={confirmarEliminar}>
                {borrando ? <><span className="spinner" /> Eliminando...</> : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {aResetear && (
        <div className="modal-backdrop" onClick={() => !reseteando && setAResetear(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Regenerar contraseña</h2>
              <button onClick={() => setAResetear(null)} className="modal-close" aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-sm-muted">
                Nueva contraseña de acceso para <strong>{aResetear.nombre}</strong> ({aResetear.email}).
              </p>
              <div className="input-group">
                <label htmlFor="reset-pass">Contraseña</label>
                <div className="grid-cols-2">
                  <input id="reset-pass" type="text" className="input" value={nuevaPass}
                    onChange={e => setNuevaPass(e.target.value)} placeholder="Mínimo 8 caracteres" />
                  <button type="button" className="btn btn-secondary" onClick={() => setNuevaPass(generarPassword())}>
                    Generar
                  </button>
                </div>
                <span className="input-hint">Comunícasela al usuario; podrá cambiarla luego.</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAResetear(null)}>Cancelar</button>
              <button className="btn btn-primary" disabled={reseteando || nuevaPass.length < 8} onClick={confirmarResetear}>
                {reseteando ? <><span className="spinner" /> Guardando...</> : 'Guardar contraseña'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
