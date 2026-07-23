'use client'

import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition } from 'react'
import { useRouter }               from 'next/navigation'
import {
  crearUsuario,
  editarUsuario,
  resetearPassword,
  type UsuarioPortal,
} from '@/app/actions/portal/usuarios'
import type { Empresa } from '@/app/actions/portal/empresas'
import { empresaColorVar } from '@/components/portal/EmpresaTag'
import Tabs from '@/components/Tabs'
import { Info, Key, Pencil, Plus, User, X } from 'lucide-react'

// Módulos/funcionalidades que el tenant tiene contratados (para repartir por usuario).
export interface ModuloContratado {
  clave:  string
  nombre: string
  tipo:   'base' | 'modulo' | 'funcionalidad' | 'addon'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROL_LABEL: Record<string, string> = {
  admin_empresa: 'Administrador',
  usuario:       'Operador',
}

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
  modulosContratados,
  onClose,
  onSaved,
}: {
  usuario:            UsuarioPortal | null
  empresas:           Empresa[]
  sessionUserId:      string
  modulosContratados: ModuloContratado[]
  onClose:            () => void
  onSaved:            (pwd?: string) => void
}) {
  const esEdicion = !!usuario
  const [isPending, startTransition] = useTransition()
  const [rol,       setRol]          = useState<UsuarioPortal['rol']>(usuario?.rol ?? 'usuario')
  const [empresasSel, setEmpresasSel] = useState<string[]>(usuario?.empresas ?? [])

  // Permisos por módulo. "Todos" = sin filas (acceso a todo lo contratado); es el
  // estado de los usuarios existentes sin restricción y el default al crear.
  const [todosModulos, setTodosModulos] = useState<boolean>(
    esEdicion ? (usuario!.modulos.length === 0) : true,
  )
  const [modPerms, setModPerms] = useState<Record<string, 'ver' | 'editar'>>(() => {
    const m: Record<string, 'ver' | 'editar'> = {}
    for (const mm of (usuario?.modulos ?? [])) m[mm.clave] = mm.puede_editar ? 'editar' : 'ver'
    return m
  })
  function setModPerm(clave: string, val: 'no' | 'ver' | 'editar') {
    setModPerms(prev => {
      const next = { ...prev }
      if (val === 'no') delete next[clave]
      else next[clave] = val
      return next
    })
  }

  function toggleEmpresa(id: string) {
    setEmpresasSel(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    )
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('rol', rol)
    empresasSel.forEach(id => fd.append('empresas', id))

    // Permisos por módulo (solo operador y solo si NO es "acceso a todos").
    if (rol === 'usuario' && !todosModulos) {
      const claves = Object.keys(modPerms)
      if (claves.length === 0) {
        toastError('Selecciona al menos un módulo o marca «Acceso a todos los módulos».')
        return
      }
      for (const clave of claves) {
        fd.append('modulos', clave)
        if (modPerms[clave] === 'editar') fd.append('modulos_editar', clave)
      }
    }

    const ld = toastLoading(esEdicion ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const result = esEdicion ? await editarUsuario(fd) : await crearUsuario(fd)
      await ld.dismiss()
      if (!result.ok) { toastError(result.error ?? 'Error inesperado.'); return }
      onSaved('passwordTemporal' in result ? (result.passwordTemporal as string | undefined) : undefined)
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{esEdicion ? 'Editar usuario' : 'Nuevo usuario'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={20} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body modal-body-form">
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
                <label className="form-label">Empresas con acceso</label>
                {empresas.filter(e => e.estado === 'ACTIVO').length === 0 ? (
                  <p className="text-sm-muted">No hay empresas activas.</p>
                ) : (
                  <div className="usr-empresa-list">
                    {empresas.filter(e => e.estado === 'ACTIVO').map(emp => (
                      <label key={emp.empresa_id} className={`usr-empresa-item${empresasSel.includes(emp.empresa_id) ? ' selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={empresasSel.includes(emp.empresa_id)}
                          onChange={() => toggleEmpresa(emp.empresa_id)}
                        />
                        <span className="usr-empresa-dot" style={empresaColorVar(emp.color)} />
                        <span>{emp.nombre}</span>
                      </label>
                    ))}
                  </div>
                )}
                <span className="input-hint">El operador solo verá y operará en estas empresas</span>
              </div>
            )}

            {/* Módulos y permisos — solo para operadores */}
            {rol === 'usuario' && (
              <div>
                <label className="form-label">Módulos y permisos</label>
                <label className="checkbox-group">
                  <input
                    type="checkbox"
                    checked={todosModulos}
                    onChange={e => setTodosModulos(e.target.checked)}
                  />
                  <span className="checkbox-label">Acceso a todos los módulos contratados</span>
                </label>

                {!todosModulos && (
                  modulosContratados.length === 0 ? (
                    <p className="text-sm-muted">El negocio no tiene módulos contratados.</p>
                  ) : (
                    <div className="usr-mod-list">
                      {modulosContratados.map(m => (
                        <div key={m.clave} className="usr-mod-row">
                          <span>{m.nombre}</span>
                          <select
                            className="input usr-mod-select"
                            aria-label={`Permiso para ${m.nombre}`}
                            value={modPerms[m.clave] ?? 'no'}
                            onChange={e => setModPerm(m.clave, e.target.value as 'no' | 'ver' | 'editar')}
                          >
                            <option value="no">Sin acceso</option>
                            <option value="ver">Ver</option>
                            <option value="editar">Ver y editar</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )
                )}
                <span className="input-hint">
                  Los módulos ocultos siguen funcionando en segundo plano: sus cargas y relaciones
                  con otros módulos se mantienen.
                </span>
              </div>
            )}

            {!esEdicion && (
              <div className="usr-pwd-info">
                <Info size={16} strokeWidth={2} />
                <span>Se generará una contraseña temporal automáticamente. Podrás copiarla al crear el usuario.</span>
              </div>
            )}

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" />{esEdicion ? 'Guardando…' : 'Creando…'}</>
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
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Contraseña temporal</h2>
        </div>
        <div className="modal-body modal-body-form">
          <p className="text-sm-muted">
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
  modulosContratados: ModuloContratado[]
}

export default function UsuariosView({ usuarios, empresas, sessionUserId, soloLectura, modulosContratados }: Props) {
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
            <Plus size={16} strokeWidth={2} /> Nuevo usuario
          </button>
        )}
      </div>

      {/* Tabs */}
      <Tabs<TabKind>
        ariaLabel="Secciones de usuarios"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'usuarios', label: 'Usuarios', count: usuarios.length },
          { id: 'roles',    label: 'Roles y permisos' },
        ]}
      />

      {/* ── Tab Usuarios ── */}
      {tab === 'usuarios' && (
        <div className="card card-table">
          {usuarios.length === 0 ? (
            <div className="mon-empty mon-empty-xl">
              <User size={40} strokeWidth={1} />
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
                    {!soloLectura && <th className="col-actions" />}
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map(u => (
                    <tr key={u.user_id} className={u.estado === 'INACTIVO' ? 'row-inactive' : ''}>
                      <td data-label="Usuario">
                        <div className="usr-cell-email">
                          <div className="usr-avatar">{(u.nombre || u.email).charAt(0).toUpperCase()}</div>
                          <div>
                            {u.nombre && <div className="text-sm-bold">{u.nombre}</div>}
                            <div className="text-xs-muted">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Rol"><RolBadge rol={u.rol} soloLectura={u.solo_lectura} /></td>
                      <td data-label="Empresas">
                        {u.rol === 'admin_empresa' ? (
                          <span className="text-xs-muted">Todas</span>
                        ) : u.empresas.length === 0 ? (
                          <span className="text-xs-error">Sin asignar</span>
                        ) : (
                          <div className="usr-empresas-list">
                            {u.empresas.slice(0, 2).map(id => (
                              <span key={id} className="usr-empresa-tag" style={empresaColorVar(empresaMap.get(id)?.color)}>
                                {empresaMap.get(id)?.nombre ?? id}
                              </span>
                            ))}
                            {u.empresas.length > 2 && (
                              <span className="usr-empresa-tag">+{u.empresas.length - 2}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td data-label="Estado">
                        <span className={`usr-estado ${u.estado === 'ACTIVO' ? 'usr-estado-activo' : 'usr-estado-inactivo'}`}>
                          {u.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      {!soloLectura && (
                        <td className="col-actions">
                          <div className="ter-actions">
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={() => abrirEditar(u)}
                              disabled={u.user_id === sessionUserId}
                              title="Editar"
                            >
                              <Pencil size={13} strokeWidth={2} />
                            </button>
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={() => handleReset(u.user_id)}
                              disabled={u.user_id === sessionUserId || (resetPending && resetTarget === u.user_id)}
                              title="Resetear contraseña"
                            >
                              {resetPending && resetTarget === u.user_id
                                ? <span className="spinner spinner-sm" />
                                : <Key size={13} strokeWidth={2} />}
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
        <div className="usr-roles-wrap">
          <div className="card modal-body-wide">
            <h3 className="text-sm-bold mb-3">Roles</h3>
            <div className="usr-lectura-ejemplos">
              <div className="usr-lectura-ejemplo">
                <RolBadge rol="admin_empresa" soloLectura={false} />
                <span>Acceso total: ve todas las empresas y todos los módulos contratados, y gestiona usuarios, empresas y monedas.</span>
              </div>
              <div className="usr-lectura-ejemplo">
                <RolBadge rol="usuario" soloLectura={false} />
                <span>Acceso acotado: solo las empresas y los módulos que le asignes (cada módulo, en «Ver» o «Ver y editar»). No gestiona usuarios, empresas ni monedas.</span>
              </div>
            </div>
          </div>

          <div className="card modal-body-wide">
            <h3 className="text-sm-bold mb-3">Permisos por módulo (operadores)</h3>
            <p className="body-text">
              A cada operador se le puede definir qué módulos ve y en cuáles puede editar
              (Sin acceso / Ver / Ver y editar), o darle acceso a todos los contratados.
              Ocultar un módulo a un operador es solo una cuestión de vista: el módulo sigue
              existiendo y sus relaciones con el resto (cargas y actualizaciones automáticas)
              se mantienen intactas.
            </p>
          </div>

          <div className="card modal-body-wide">
            <h3 className="text-sm-bold mb-3">Flag «Solo lectura»</h3>
            <p className="body-text">
              Interruptor maestro: se puede activar en cualquier rol. Un usuario con solo lectura
              puede navegar por los módulos a los que tiene acceso, pero no puede crear, editar ni
              eliminar ningún dato, aunque un módulo esté marcado como «Ver y editar».
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
          modulosContratados={modulosContratados}
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

