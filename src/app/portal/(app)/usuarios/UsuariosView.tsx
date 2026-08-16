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
import type { Permiso } from '@/lib/permisos'
import type { Empresa } from '@/app/actions/portal/empresas'
import { empresaColorVar, EmpresaTag } from '@/components/portal/EmpresaTag'
import { ConfirmDialog } from '@/components/portal/Dialog'
import FormHelp from '@/components/portal/FormHelp'
import ModalShell from '@/components/portal/ModalShell'
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

const PERMISO_LABEL: Record<Permiso, string> = {
  sin_acceso: 'Sin acceso',
  ver:        'Lectura',
  editar:     'Ver y editar',
}

// Familia canónica `.badge`: se pinta dentro de la tabla, donde el design system apaga
// el fondo. `.usr-badge-*` sigue existiendo para PerfilView, que la usa en una tarjeta
// (ahí el pill es correcto); el modificador `usr-badge-lectura` no lleva fondo, así que
// compone bien con `.badge`.
function RolBadge({ rol, soloLectura }: { rol: string; soloLectura: boolean }) {
  const label = soloLectura
    ? `${ROL_LABEL[rol] ?? rol} · Solo lectura`
    : ROL_LABEL[rol] ?? rol
  const cls = rol === 'admin_empresa' ? 'badge-warning' : 'badge-info'
  return <span className={`badge ${cls}${soloLectura ? ' usr-badge-lectura' : ''}`}>{label}</span>
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
   onSaved:            (pwd?: string, emailEnviado?: boolean) => void
}) {
  const esEdicion = !!usuario
  const [isPending, startTransition] = useTransition()
  const [rol,       setRol]          = useState<UsuarioPortal['rol']>(usuario?.rol ?? 'usuario')
  const [permisoDefecto, setPermisoDefecto] = useState<Permiso>(usuario?.permiso_defecto ?? 'editar')
  const [empresasSel, setEmpresasSel] = useState<string[]>(usuario?.empresas ?? [])

  // Excepciones por módulo: solo las que difieren del permiso por defecto. Ausencia de
  // entrada = ese módulo sigue el defecto (incluidos los que se contraten en el futuro).
  const [overrides, setOverrides] = useState<Record<string, Permiso>>(() => {
    const m: Record<string, Permiso> = {}
    for (const mm of (usuario?.modulos ?? [])) m[mm.clave] = mm.permiso
    return m
  })
  function setOverride(clave: string, val: string) {
    setOverrides(prev => {
      const next = { ...prev }
      if (val === 'sin_acceso' || val === 'ver' || val === 'editar') next[clave] = val
      else delete next[clave]  // "defecto"
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
    fd.set('permiso_defecto', permisoDefecto)
    empresasSel.forEach(id => fd.append('empresas', id))

    // Excepciones por módulo (solo operador): "clave:permiso", solo las que difieren
    // del defecto. Sin entradas = todos los módulos siguen el permiso por defecto.
    if (rol === 'usuario') {
      for (const [clave, permiso] of Object.entries(overrides)) fd.append('ov', `${clave}:${permiso}`)
    }

    const ld = toastLoading(esEdicion ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const result = esEdicion ? await editarUsuario(fd) : await crearUsuario(fd)
      await ld.dismiss()
      if (!result.ok) { toastError(result.error ?? 'Error inesperado.'); return }
      onSaved(
        'passwordTemporal' in result ? (result.passwordTemporal as string | undefined) : undefined,
        'emailEnviado' in result ? (result.emailEnviado as boolean | undefined) : undefined,
      )
    })
  }

  // La lista de excepciones solo pinta los módulos que difieren del defecto; el «+ Añadir
  // excepción» ofrece el resto. Así no hay scroll aunque el negocio tenga muchos módulos.
  const modulosConExcepcion = modulosContratados.filter(m => overrides[m.clave] !== undefined)
  const modulosSinExcepcion = modulosContratados.filter(m => overrides[m.clave] === undefined)

  return (
    <ModalShell title={esEdicion ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose} size="modal-lg">
        <form onSubmit={handleSubmit}>
          <div className="modal-body modal-body-form">
            {esEdicion && <input type="hidden" name="user_id" value={usuario.user_id} />}

            <div className="usr-form-grid">
              <div className="input-group">
                <div className="form-label-with-help">
                  <label>Email <span className="required">*</span></label>
                  {esEdicion && <FormHelp text="El email no se puede cambiar." label="Por qué no se puede cambiar el email" />}
                </div>
                <input
                  className="input"
                  type="email"
                  name="email"
                  defaultValue={usuario?.email ?? ''}
                  placeholder="usuario@empresa.com"
                  readOnly={esEdicion}
                  required
                />
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
                <select className="input" value={rol} onChange={e => {
                  const nuevo = e.target.value as UsuarioPortal['rol']
                  setRol(nuevo)
                  if (nuevo === 'admin_empresa') { setEmpresasSel([]); if (permisoDefecto === 'sin_acceso') setPermisoDefecto('ver') }
                }}>
                  <option value="admin_empresa">Administrador — acceso total</option>
                  <option value="usuario">Operador — empresas asignadas</option>
                </select>
              </div>

              <div className="input-group">
                <div className="form-label-with-help">
                  <label>Permiso por defecto</label>
                  <FormHelp
                    text={rol === 'admin_empresa'
                      ? 'Se aplica a todos los módulos contratados. «Lectura» convierte al administrador en uno de solo lectura.'
                      : 'Se aplica a todos los módulos contratados, incluidos los que contrates en el futuro. Abajo puedes hacer excepciones módulo a módulo.'}
                    label="Qué es el permiso por defecto"
                  />
                </div>
                <select className="input" value={permisoDefecto}
                  onChange={e => setPermisoDefecto(e.target.value as Permiso)}>
                  {rol === 'usuario' && <option value="sin_acceso">Sin acceso</option>}
                  <option value="ver">Lectura</option>
                  <option value="editar">Ver y editar</option>
                </select>
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
              <div className="usr-form-seccion">
                <div className="form-label-with-help">
                  <label className="form-label">Empresas con acceso</label>
                  <FormHelp text="El operador solo verá y operará en estas empresas." label="Alcance de las empresas asignadas" />
                </div>
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
              </div>
            )}

            {/* Excepciones por módulo — solo para operadores. Bajo demanda: la lista solo
                muestra los módulos que difieren del permiso por defecto; el resto lo siguen.
                Como las excepciones son pocas por diseño, no hay scroll interno. */}
            {rol === 'usuario' && (
              <div className="usr-form-seccion">
                <div className="form-label-with-help">
                  <label className="form-label">Excepciones por módulo</label>
                  <FormHelp text="Cada módulo usa el permiso por defecto salvo que le pongas otro aquí. Los módulos que ocultes siguen funcionando en segundo plano: sus cargas y relaciones con otros módulos se mantienen." label="Cómo funcionan las excepciones" />
                </div>
                {modulosContratados.length === 0 ? (
                  <p className="text-sm-muted">El negocio no tiene módulos contratados.</p>
                ) : (
                  <>
                    {modulosConExcepcion.length > 0 && (
                      <div className="usr-exc-list">
                        {modulosConExcepcion.map(m => (
                          <div key={m.clave} className="usr-exc-row">
                            <span className="usr-exc-nombre">{m.nombre}</span>
                            <select
                              className="input usr-mod-select"
                              aria-label={`Permiso para ${m.nombre}`}
                              value={overrides[m.clave]}
                              onChange={e => setOverride(m.clave, e.target.value)}
                            >
                              <option value="sin_acceso">Sin acceso</option>
                              <option value="ver">Lectura</option>
                              <option value="editar">Ver y editar</option>
                            </select>
                            <button
                              type="button"
                              className="usr-exc-quitar"
                              aria-label={`Quitar excepción de ${m.nombre}`}
                              onClick={() => setOverride(m.clave, 'defecto')}
                            >
                              <X size={15} strokeWidth={2} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {modulosSinExcepcion.length > 0 ? (
                      <select
                        className="input usr-exc-add"
                        aria-label="Añadir excepción por módulo"
                        value=""
                        onChange={e => { if (e.target.value) setOverride(e.target.value, permisoDefecto === 'editar' ? 'ver' : 'editar') }}
                      >
                        <option value="">+ Añadir excepción…</option>
                        {modulosSinExcepcion.map(m => (
                          <option key={m.clave} value={m.clave}>{m.nombre}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs-muted">Todos los módulos contratados tienen una excepción.</p>
                    )}
                  </>
                )}
              </div>
            )}

            {!esEdicion && (
              <div className="usr-pwd-info">
                <Info size={16} strokeWidth={2} />
                 <span>Se generará una contraseña temporal y se enviará junto con el enlace de acceso. También podrás copiarla al crear el usuario.</span>
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
    </ModalShell>
  )
}

// ── Modal contraseña temporal ─────────────────────────────────────────────────

function PasswordModal({ password, emailEnviado, onClose }: { password: string; emailEnviado?: boolean; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false)

  function copiar() {
    navigator.clipboard.writeText(password).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

  return (
    <ModalShell title="Contraseña temporal" onClose={onClose} size="modal-sm">
        <div className="modal-body modal-body-form">
          <p className="text-sm-muted">
            Comparte esta contraseña con el usuario de forma segura. No se mostrará de nuevo.
          </p>
          <p className={`alert ${emailEnviado ? 'alert-success' : 'alert-warning'}`} role="alert">
            {emailEnviado
              ? 'También enviamos sus datos de acceso por correo.'
              : 'No pudimos enviar el correo. Comparte la contraseña de forma segura.'}
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
    </ModalShell>
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
  const [pwdModal,   setPwdModal]  = useState<{ password: string; emailEnviado?: boolean } | null>(null)
  const [resetPending, startResetTrans] = useTransition()
  const [resetTarget, setResetTarget]   = useState<string | null>(null)
  // Resetear invalida la contraseña actual del compañero al instante: se confirma antes,
  // que es una acción destructiva de la que no se avisa a la otra persona.
  const [confirmReset, setConfirmReset] = useState<UsuarioPortal | null>(null)

  function abrirNuevo() { setEditTarget(null); setModalOpen(true) }
  function abrirEditar(u: UsuarioPortal) { setEditTarget(u); setModalOpen(true) }
  function cerrar() { setModalOpen(false); setEditTarget(null) }

  function onSaved(pwd?: string, emailEnviado?: boolean) {
    cerrar()
    if (pwd) setPwdModal({ password: pwd, emailEnviado })
    router.refresh()
  }

  function handleReset(user_id: string) {
    setResetTarget(user_id)
    startResetTrans(async () => {
      const result = await resetearPassword(user_id)
      setResetTarget(null)
      if (result.ok && result.passwordTemporal) {
        setPwdModal({ password: result.passwordTemporal, emailEnviado: result.emailEnviado })
      }
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
                            {/* `EmpresaTag` es el componente canónico para identidad de
                                empresa en una tabla (punto de color + nombre, sin pill);
                                es el mismo que usa la columna Empresa de Movimientos. La
                                `.usr-empresa-tag` que había aquí era un recuadro gris con
                                borde de color, que dentro de la tabla desentonaba. */}
                            {u.empresas.slice(0, 2).map(id => (
                              <EmpresaTag key={id} color={empresaMap.get(id)?.color} nombre={empresaMap.get(id)?.nombre ?? id} />
                            ))}
                            {/* El «+N» no es una empresa: no lleva punto de color. */}
                            {u.empresas.length > 2 && (
                              <span className="text-xs-muted">+{u.empresas.length - 2}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td data-label="Estado">
                        <span className={`badge ${u.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
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
                              onClick={() => setConfirmReset(u)}
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
                <span>Acceso acotado: solo las empresas y los módulos que le asignes (cada módulo, en «Lectura» o «Ver y editar»). No gestiona usuarios, empresas ni monedas.</span>
              </div>
            </div>
          </div>

          <div className="card modal-body-wide">
            <h3 className="text-sm-bold mb-3">Permiso por defecto</h3>
            <p className="body-text">
              A cada usuario se le fija un permiso por defecto —<strong>Sin acceso</strong>,{' '}
              <strong>Ver</strong> o <strong>Ver y editar</strong>— que se aplica a todos los módulos
              contratados, incluidos los que se contraten en el futuro. Es lo único que hace falta
              para el caso normal: un operador que lo ve y edita todo, o uno de solo lectura.
            </p>
          </div>

          <div className="card modal-body-wide">
            <h3 className="text-sm-bold mb-3">Excepciones por módulo (operadores)</h3>
            <p className="body-text">
              Sobre ese permiso por defecto, a un operador se le puede cambiar módulo a módulo
              (Sin acceso / Lectura / Ver y editar): por ejemplo «solo lectura salvo Inventario, que
              edita», o «lo ve todo menos Nómina». Ocultar un módulo es solo una cuestión de vista:
              el módulo sigue existiendo y sus relaciones con el resto (cargas y actualizaciones
              automáticas) se mantienen intactas.
            </p>
            <div className="usr-lectura-ejemplos">
              <div className="usr-lectura-ejemplo">
                <RolBadge rol="admin_empresa" soloLectura={true} />
                <span>Administrador con permiso por defecto «Lectura»: ve todo el grupo sin poder modificar nada.</span>
              </div>
              <div className="usr-lectura-ejemplo">
                <RolBadge rol="usuario" soloLectura={true} />
                <span>Operador con permiso por defecto «Lectura»: ve sus empresas asignadas sin ejecutar operaciones.</span>
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
        <PasswordModal password={pwdModal.password} emailEnviado={pwdModal.emailEnviado} onClose={() => { setPwdModal(null); router.refresh() }} />
      )}
      {confirmReset && (
        <ConfirmDialog
          title="Resetear contraseña"
          body={<>Se generará una contraseña temporal nueva para <strong>{confirmReset.nombre || confirmReset.email}</strong> y la actual dejará de funcionar. Tendrás que hacérsela llegar tú.</>}
          confirmLabel="Resetear contraseña"
          danger
          onConfirm={() => { const u = confirmReset; setConfirmReset(null); handleReset(u.user_id) }}
          onCancel={() => setConfirmReset(null)}
        />
      )}
    </div>
  )
}
