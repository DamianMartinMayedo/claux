'use client'

import { AtSign, KeyRound, Pencil, Plus, Trash2, UserCog } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RowActions } from '@/components/portal/RowActions'
import { ConfirmDialog } from '@/components/portal/Dialog'
import ModalShell from '@/components/portal/ModalShell'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import { useToast } from '@/app/contexts/ToastContext'
import {
  eliminarUsuarioAdmin,
  resetPasswordUsuarioAdmin,
  type UsuarioAdmin,
} from '@/app/actions/usuarios-admin'
import UsuarioModal from './UsuarioModal'
import ContactoPropuestasModal from './ContactoPropuestasModal'
import { ROL_LABEL, type RolAdmin } from '@/lib/roles'

/** Color del rol en el listado. */
const ROL_BADGE: Record<RolAdmin, string> = {
  super_admin: 'badge-info',
  vendedor:    'badge-neutral',
}

const COLUMNAS: ColumnasOrden<UsuarioAdmin> = {
  nombre: { label: 'Nombre', valor: u => u.nombre },
  email:  { label: 'Correo', valor: u => u.email },
  rol:    { label: 'Rol',    valor: u => ROL_LABEL[u.rol] },
  estado: { label: 'Estado', valor: u => u.activo },
  alta:   { label: 'Alta',   valor: u => u.created_at },
}

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
  const [contacto, setContacto]     = useState<UsuarioAdmin | null>(null)
  const [aEliminar, setAEliminar]   = useState<UsuarioAdmin | null>(null)
  const [borrando, setBorrando]     = useState(false)
  const [aResetear, setAResetear]   = useState<UsuarioAdmin | null>(null)
  const [nuevaPass, setNuevaPass]   = useState('')
  const [reseteando, setReseteando] = useState(false)
  // Por nombre: una lista de personas se busca por el nombre, no por cuándo se dio de alta.
  const orden = useOrden(usuarios, COLUMNAS, { clave: 'nombre', dir: 'asc' })
  const { pageItems, ...pag } = usePagination(orden.filas)

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
          <h1 className="page-title">Usuarios</h1>
          <p className="page-subtitle">
            {usuarios.length} usuario{usuarios.length !== 1 ? 's' : ''} · el equipo de CLAUX y
            quienes revenden desde fuera.
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
            <p>El botón de arriba crea el primero.</p>
          </div>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <ThOrden orden={orden} clave="nombre" />
                  <ThOrden orden={orden} clave="email" />
                  <ThOrden orden={orden} clave="rol" />
                  <ThOrden orden={orden} clave="estado" />
                  <ThOrden orden={orden} clave="alta" />
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(u => (
                  <tr
                    key={u.email}
                    className={u.gestionable ? 'table-row-clickable' : undefined}
                    onClick={u.gestionable ? () => setEditando(u) : undefined}
                  >
                    <td data-label="Nombre">
                      {u.nombre}
                      {u.esBootstrap && <div className="table-cell-sub">Cuenta base</div>}
                    </td>
                    <td data-label="Correo" className="table-muted">{u.email}</td>
                    <td data-label="Rol">
                      <span className={`badge ${ROL_BADGE[u.rol]}`}>{ROL_LABEL[u.rol]}</span>
                      {/* Un vendedor sin ninguna sección no entra al panel: solo lee el
                          manual. Es quien revende de puertas afuera, y se distingue aquí
                          porque desde fuera los dos son «Vendedor». */}
                      {u.rol === 'vendedor' && u.permisos.length === 0 && (
                        <div className="table-cell-sub">Solo manual</div>
                      )}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge ${u.activo ? 'badge-success' : 'badge-warning'}`}>
                        {u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td data-label="Alta" className="table-muted">{fmtFecha(u.created_at)}</td>
                    <td className="col-actions" onClick={e => e.stopPropagation()}>
                      <RowActions>
                        {u.gestionable && (
                          <button className="row-actions-item" onClick={() => setEditando(u)}>
                            <Pencil size={15} strokeWidth={2} /> Editar
                          </button>
                        )}
                        <button className="row-actions-item" onClick={() => setContacto(u)}>
                          <AtSign size={15} strokeWidth={2} /> Contacto en propuestas
                        </button>
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

      {contacto && (
        <ContactoPropuestasModal
          usuario={contacto}
          onClose={guardado => { setContacto(null); if (guardado) router.refresh() }}
        />
      )}

      {aEliminar && (
        <ConfirmDialog
          danger
          title="Eliminar usuario"
          body={<>
            Se elimina a <strong>{aEliminar.nombre}</strong> ({aEliminar.email}) y su cuenta
            de acceso. No se puede deshacer.
          </>}
          confirmLabel="Eliminar"
          pendingLabel="Eliminando…"
          pending={borrando}
          onConfirm={confirmarEliminar}
          onCancel={() => setAEliminar(null)}
        />
      )}

      {aResetear && (
        <ModalShell
          title="Regenerar contraseña"
          subtitle={`${aResetear.nombre} · ${aResetear.email}`}
          size="modal-sm"
          onClose={() => setAResetear(null)}
        >
          <div className="modal-body">
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
        </ModalShell>
      )}
    </div>
  )
}
