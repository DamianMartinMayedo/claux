'use client'

import { X } from 'lucide-react'
import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import {
  crearUsuarioAdmin,
  actualizarUsuarioAdmin,
  resetPasswordUsuarioAdmin,
  type UsuarioAdmin,
} from '@/app/actions/usuarios-admin'
import { SECCIONES, PERMISOS_VENDEDOR_DEFAULT, type RolAdmin, type SeccionKey } from '@/lib/roles'

function generarPassword(len = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function UsuarioModal({
  usuario,
  onClose,
}: {
  usuario: UsuarioAdmin | null
  onClose: (guardado: boolean) => void
}) {
  const editando = !!usuario
  const mounted = useMounted()

  const [nombre, setNombre]     = useState(usuario?.nombre ?? '')
  const [email, setEmail]       = useState(usuario?.email ?? '')
  const [rol, setRol]           = useState<RolAdmin>(usuario?.rol ?? 'vendedor')
  const [activo, setActivo]     = useState(usuario?.activo ?? true)
  const [password, setPassword] = useState('')
  const [permisos, setPermisos] = useState<SeccionKey[]>(
    usuario?.rol === 'vendedor' ? usuario.permisos : [...PERMISOS_VENDEDOR_DEFAULT],
  )
  const [avanzado, setAvanzado] = useState(false)
  const [loading, setLoading]   = useState(false)

  const close = useCallback(() => onClose(false), [onClose])
  useModalKeyboard(true, close)

  function togglePermiso(key: SeccionKey) {
    setPermisos(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (editando) {
        const r = await actualizarUsuarioAdmin(usuario!.email, { nombre, rol, permisos, activo })
        if (!r.ok) { toastError(r.error); return }
        if (password.trim()) {
          const rp = await resetPasswordUsuarioAdmin(usuario!.email, password.trim())
          if (!rp.ok) { toastError(rp.error); return }
        }
        toastSuccess('Usuario actualizado')
      } else {
        const r = await crearUsuarioAdmin({ email, nombre, rol, permisos, password })
        if (!r.ok) { toastError(r.error); return }
        toastSuccess('Usuario creado')
      }
      onClose(true)
    } finally {
      setLoading(false)
    }
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-560">
        <div className="modal-header">
          <h2 className="modal-title">{editando ? 'Editar usuario' : 'Nuevo usuario'}</h2>
          <button onClick={close} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="input-group">
              <label htmlFor="u-nombre">Nombre <span className="required">*</span></label>
              <input id="u-nombre" className="input" required value={nombre}
                onChange={e => setNombre(e.target.value)} placeholder="Ej: Claudia" />
            </div>

            <div className="input-group">
              <label htmlFor="u-email">Correo <span className="required">*</span></label>
              <input id="u-email" type="email" className="input" required value={email}
                disabled={editando}
                onChange={e => setEmail(e.target.value)} placeholder="persona@claux.es" />
              {editando && <span className="input-hint">El correo no se puede cambiar.</span>}
            </div>

            <div className="seg-field">
              <span className="seg-field-label">Rol</span>
              <div className="seg">
                {(['vendedor', 'super_admin'] as const).map(r => (
                  <label key={r} className="seg-opt">
                    <input type="radio" name="rol" value={r} checked={rol === r} onChange={() => setRol(r)} />
                    <span>{r === 'vendedor' ? 'Vendedor' : 'Super Admin'}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="u-pass">
                {editando ? 'Nueva contraseña (opcional)' : 'Contraseña'} {!editando && <span className="required">*</span>}
              </label>
              <div className="grid-cols-2">
                <input id="u-pass" type="text" className="input" value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={editando ? 'Dejar vacío para no cambiarla' : 'Mínimo 8 caracteres'} />
                <button type="button" className="btn btn-secondary" onClick={() => setPassword(generarPassword())}>
                  Generar
                </button>
              </div>
              <span className="input-hint">
                {editando
                  ? 'Si la rellenas, se regenera la contraseña de acceso de este usuario.'
                  : 'Se la comunicas al vendedor; podrá cambiarla luego.'}
              </span>
            </div>

            {editando && (
              <label className="checkbox-group">
                <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} />
                <span className="checkbox-label">Usuario activo (puede iniciar sesión)</span>
              </label>
            )}

            {rol === 'vendedor' ? (
              <div className="input-group">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAvanzado(v => !v)}>
                  {avanzado ? 'Ocultar configuración avanzada' : 'Configuración avanzada de accesos'}
                </button>
                <span className="input-hint">
                  Por defecto: Solicitudes, Presupuestos y Clientes (solo lectura). Amplía solo si hace falta.
                </span>
                {avanzado && (
                  <div className="mod-list">
                    <p className="mod-list-label">Secciones a las que puede acceder</p>
                    {SECCIONES.map(s => (
                      <label key={s.key} className="checkbox-group">
                        <input type="checkbox" checked={permisos.includes(s.key)} onChange={() => togglePermiso(s.key)} />
                        <span className="checkbox-label">{s.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="alert alert-info">
                Un <strong>Super Admin</strong> tiene acceso total al panel.
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={close}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading
                ? <><span className="spinner" /> Guardando...</>
                : (editando ? 'Guardar cambios' : 'Crear usuario')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return mounted ? createPortal(modal, document.body) : null
}
