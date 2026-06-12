'use client'

import { useState, useTransition } from 'react'
import { useRouter }               from 'next/navigation'
import {
  crearUsuario,
  editarUsuario,
  resetearPassword,
  type UsuarioPortal,
} from '@/app/actions/portal/usuarios'
import type { Empresa } from '@/app/actions/portal/empresas'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROL_LABEL: Record<string, string> = {
  admin_empresa: 'Administrador',
  usuario:       'Operador',
}

const PERMISOS: Array<{
  accion: string
  admin: boolean
  operador: boolean
}> = [
  { accion: 'Gestionar empresas',         admin: true,  operador: false },
  { accion: 'Gestionar monedas y tasas',  admin: true,  operador: false },
  { accion: 'Gestionar usuarios',         admin: true,  operador: false },
  { accion: 'Registrar operaciones',      admin: true,  operador: true  },
  { accion: 'Ver reportes',               admin: true,  operador: true  },
  { accion: 'Acceso a todas las empresas',admin: true,  operador: false },
  { accion: 'Acceso a empresas asignadas',admin: true,  operador: true  },
]

function RolBadge({ rol, soloLectura }: { rol: string; soloLectura: boolean }) {
  const label = soloLectura
    ? `${ROL_LABEL[rol] ?? rol} · Solo lectura`
    : ROL_LABEL[rol] ?? rol
  const cls = rol === 'admin_empresa' ? 'usr-badge-admin' : 'usr-badge-usuario'
  return <span className={`usr-badge ${cls}${soloLectura ? ' usr-badge-lectura' : ''}`}>{label}</span>
}

// ── Modal Usuario ─────────────────────────────────────────────────────────────

function UsuarioModal({
  usuario,
  empresas,
  sessionUserId,
  onClose,
  onSaved,
}: {
  usuario:       UsuarioPortal | null
  empresas:      Empresa[]
  sessionUserId: string
  onClose:       () => void
  onSaved:       (pwd?: string) => void
}) {
  const esEdicion = !!usuario
  const [isPending, startTransition] = useTransition()
  const [error,     setError]        = useState('')
  const [rol,       setRol]          = useState<UsuarioPortal['rol']>(usuario?.rol ?? 'usuario')
  const [empresasSel, setEmpresasSel] = useState<string[]>(usuario?.empresas ?? [])

  function toggleEmpresa(id: string) {
    setEmpresasSel(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    )
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    fd.set('rol', rol)
    empresasSel.forEach(id => fd.append('empresas', id))

    startTransition(async () => {
      const result = esEdicion ? await editarUsuario(fd) : await crearUsuario(fd)
      if (!result.ok) { setError(result.error ?? 'Error inesperado.'); return }
      onSaved('passwordTemporal' in result ? (result.passwordTemporal as string | undefined) : undefined)
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal" style={{ maxWidth: 480 }} role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{esEdicion ? 'Editar usuario' : 'Nuevo usuario'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><IconX /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {esEdicion && <input type="hidden" name="user_id" value={usuario.user_id} />}

            <div className="usr-form-grid">
              <div className="input-group">
                <label>Email <span className="required">*</span></label>
                <input
                  className="input"
                  type="email"
                  name="email"
                  defaultValue={usuario?.email ?? ''}
                  placeholder="usuario@empresa.com"
                  readOnly={esEdicion}
                  required
                />
                {esEdicion && <span className="input-hint">El email no se puede cambiar.</span>}
              </div>

              <div className="input-group">
                <label>Nombre</label>
                <input
                  className="input"
                  name="nombre"
                  defaultValue={usuario?.nombre ?? ''}
                  placeholder="Nombre completo"
                />
              </div>

              <div className="input-group">
                <label>Rol</label>
                <select className="input" value={rol} onChange={e => { setRol(e.target.value as UsuarioPortal['rol']); if (e.target.value === 'admin_empresa') setEmpresasSel([]) }}>
                  <option value="admin_empresa">Administrador — acceso total</option>
                  <option value="usuario">Operador — empresas asignadas</option>
                </select>
              </div>

              <div className="input-group">
                <label>Permisos de escritura</label>
                <select className="input" name="solo_lectura" defaultValue={usuario?.solo_lectura ? 'true' : 'false'}>
                  <option value="false">Lectura y escritura</option>
                  <option value="true">Solo lectura</option>
                </select>
                <span className="input-hint">Solo lectura: puede ver todo pero no ejecutar acciones</span>
              </div>

              {esEdicion && usuario.user_id !== sessionUserId && (
                <div className="input-group">
                  <label>Estado</label>
                  <select className="input" name="estado" defaultValue={usuario.estado}>
                    <option value="ACTIVO">Activo</option>
                    <option value="INACTIVO">Inactivo</option>
                  </select>
                </div>
              )}
            </div>

            {/* Empresas asignadas — solo para operadores */}
            {rol === 'usuario' && (
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                  Empresas con acceso
                </label>
                {empresas.filter(e => e.estado === 'ACTIVO').length === 0 ? (
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>No hay empresas activas.</p>
                ) : (
                  <div className="usr-empresa-list">
                    {empresas.filter(e => e.estado === 'ACTIVO').map(emp => (
                      <label key={emp.empresa_id} className={`usr-empresa-item${empresasSel.includes(emp.empresa_id) ? ' selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={empresasSel.includes(emp.empresa_id)}
                          onChange={() => toggleEmpresa(emp.empresa_id)}
                        />
                        <span className="usr-empresa-dot" style={{ background: emp.color }} />
                        <span>{emp.nombre}</span>
                      </label>
                    ))}
                  </div>
                )}
                <span className="input-hint">El operador solo verá y operará en estas empresas</span>
              </div>
            )}

            {!esEdicion && (
              <div className="usr-pwd-info">
                <IconInfo />
                <span>Se generará una contraseña temporal automáticamente. Podrás copiarla al crear el usuario.</span>
              </div>
            )}

            {error && <div className="alert alert-error">{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} />{esEdicion ? 'Guardando…' : 'Creando…'}</>
                : esEdicion ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal contraseña temporal ─────────────────────────────────────────────────

function PasswordModal({ password, onClose }: { password: string; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false)

  function copiar() {
    navigator.clipboard.writeText(password).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal" style={{ maxWidth: 380 }} role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Contraseña temporal</h2>
        </div>
        <div className="modal-body" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            Comparte esta contraseña con el usuario de forma segura. No se mostrará de nuevo.
          </p>
          <div className="usr-pwd-box">
            <code className="usr-pwd-code">{password}</code>
            <button className="btn btn-secondary btn-sm" onClick={copiar}>
              {copiado ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Entendido</button>
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

type TabKind = 'usuarios' | 'roles'

interface Props {
  usuarios:      UsuarioPortal[]
  empresas:      Empresa[]
  sessionUserId: string
  soloLectura:   boolean
}

export default function UsuariosView({ usuarios, empresas, sessionUserId, soloLectura }: Props) {
  const router = useRouter()
  const [tab,        setTab]       = useState<TabKind>('usuarios')
  const [modalOpen,  setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UsuarioPortal | null>(null)
  const [pwdModal,   setPwdModal]  = useState<string | null>(null)
  const [resetPending, startResetTrans] = useTransition()
  const [resetTarget, setResetTarget]   = useState<string | null>(null)

  function abrirNuevo() { setEditTarget(null); setModalOpen(true) }
  function abrirEditar(u: UsuarioPortal) { setEditTarget(u); setModalOpen(true) }
  function cerrar() { setModalOpen(false); setEditTarget(null) }

  function onSaved(pwd?: string) {
    cerrar()
    if (pwd) setPwdModal(pwd)
    router.refresh()
  }

  function handleReset(user_id: string) {
    setResetTarget(user_id)
    startResetTrans(async () => {
      const result = await resetearPassword(user_id)
      setResetTarget(null)
      if (result.ok && result.passwordTemporal) setPwdModal(result.passwordTemporal)
    })
  }

  // Map empresa_id → nombre para mostrar
  const empresaMap = new Map(empresas.map(e => [e.empresa_id, e]))

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Usuarios</h1>
          <p className="page-subtitle">Gestiona quién tiene acceso al portal y con qué permisos.</p>
        </div>
        {!soloLectura && (
          <button className="btn btn-primary" onClick={abrirNuevo}>
            <IconPlus /> Nuevo usuario
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="usr-tabs">
        <button className={`usr-tab${tab === 'usuarios' ? ' active' : ''}`} onClick={() => setTab('usuarios')}>
          Usuarios ({usuarios.length})
        </button>
        <button className={`usr-tab${tab === 'roles' ? ' active' : ''}`} onClick={() => setTab('roles')}>
          Roles y permisos
        </button>
      </div>

      {/* ── Tab Usuarios ── */}
      {tab === 'usuarios' && (
        <div className="card card-table">
          {usuarios.length === 0 ? (
            <div className="mon-empty" style={{ padding: 'var(--space-10)' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              <p>No hay usuarios creados.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Empresas</th>
                    <th>Estado</th>
                    {!soloLectura && <th style={{ width: 100 }} />}
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map(u => (
                    <tr key={u.user_id} style={{ opacity: u.estado === 'INACTIVO' ? 0.5 : 1 }}>
                      <td>
                        <div className="usr-cell-email">
                          <div className="usr-avatar">{(u.nombre || u.email).charAt(0).toUpperCase()}</div>
                          <div>
                            {u.nombre && <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{u.nombre}</div>}
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td><RolBadge rol={u.rol} soloLectura={u.solo_lectura} /></td>
                      <td>
                        {u.rol === 'admin_empresa' ? (
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Todas</span>
                        ) : u.empresas.length === 0 ? (
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>Sin asignar</span>
                        ) : (
                          <div className="usr-empresas-list">
                            {u.empresas.slice(0, 2).map(id => (
                              <span key={id} className="usr-empresa-tag" style={{ borderColor: empresaMap.get(id)?.color }}>
                                {empresaMap.get(id)?.nombre ?? id}
                              </span>
                            ))}
                            {u.empresas.length > 2 && (
                              <span className="usr-empresa-tag">+{u.empresas.length - 2}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`usr-estado ${u.estado === 'ACTIVO' ? 'usr-estado-activo' : 'usr-estado-inactivo'}`}>
                          {u.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      {!soloLectura && (
                        <td>
                          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={() => abrirEditar(u)}
                              disabled={u.user_id === sessionUserId}
                              title="Editar"
                            >
                              <IconEdit />
                            </button>
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={() => handleReset(u.user_id)}
                              disabled={u.user_id === sessionUserId || (resetPending && resetTarget === u.user_id)}
                              title="Resetear contraseña"
                            >
                              {resetPending && resetTarget === u.user_id
                                ? <span className="spinner spinner-sm" />
                                : <IconKey />}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab Roles ── */}
      {tab === 'roles' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div className="card card-table">
            <div className="mon-card-header">
              <h2 className="mon-section-title">Tabla de permisos</h2>
            </div>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Acción</th>
                    <th style={{ textAlign: 'center' }}>Administrador</th>
                    <th style={{ textAlign: 'center' }}>Operador</th>
                  </tr>
                </thead>
                <tbody>
                  {PERMISOS.map(p => (
                    <tr key={p.accion}>
                      <td style={{ fontSize: 'var(--text-sm)' }}>{p.accion}</td>
                      <td style={{ textAlign: 'center' }}>{p.admin  ? <IconCheck /> : <IconMinus />}</td>
                      <td style={{ textAlign: 'center' }}>{p.operador ? <IconCheck /> : <IconMinus />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
              Flag «Solo lectura»
            </h3>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              Se puede activar en cualquier rol. Un usuario con solo lectura puede navegar por todos los módulos
              a los que su rol le da acceso, pero no puede crear, editar ni eliminar ningún dato.
              Es ideal para socios, auditores o supervisores que necesitan visibilidad sin poder modificar.
            </p>
            <div className="usr-lectura-ejemplos">
              <div className="usr-lectura-ejemplo">
                <RolBadge rol="admin_empresa" soloLectura={true} />
                <span>Ve todos los datos del grupo sin poder modificar nada</span>
              </div>
              <div className="usr-lectura-ejemplo">
                <RolBadge rol="usuario" soloLectura={true} />
                <span>Ve solo sus empresas asignadas, sin ejecutar operaciones</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modales */}
      {modalOpen && (
        <UsuarioModal
          key={editTarget?.user_id ?? 'nuevo'}
          usuario={editTarget}
          empresas={empresas}
          sessionUserId={sessionUserId}
          onClose={cerrar}
          onSaved={onSaved}
        />
      )}
      {pwdModal && (
        <PasswordModal password={pwdModal} onClose={() => { setPwdModal(null); router.refresh() }} />
      )}
    </div>
  )
}

// ── Iconos ────────────────────────────────────────────────────────────────────
function IconX()     { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function IconPlus()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> }
function IconEdit()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function IconKey()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> }
function IconCheck() { return <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg> }
function IconMinus() { return <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/></svg> }
function IconInfo()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0, color: 'var(--color-primary)' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> }
