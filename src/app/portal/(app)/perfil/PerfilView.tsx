'use client'

import { useState, useTransition } from 'react'
import { useRouter }               from 'next/navigation'
import { actualizarMiPerfil, type PerfilData } from '@/app/actions/portal/perfil'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ESTADO_LABEL: Record<string, string> = {
  ACTIVO:     'Activo',
  TRIAL:      'Período de prueba',
  GRACIA:     'Período especial',
  VENCIDO:    'Vencido',
  DESACTIVADO: 'Desactivado',
}

const ROL_LABEL: Record<string, string> = {
  admin_empresa: 'Administrador',
  usuario:       'Operador',
}

function EstadoBadge({ estado }: { estado: string }) {
  const cls =
    estado === 'ACTIVO'                    ? 'prf-badge-activo'   :
    estado === 'TRIAL'                     ? 'prf-badge-trial'    :
    estado === 'GRACIA'                    ? 'prf-badge-gracia'   :
    ['VENCIDO', 'DESACTIVADO'].includes(estado) ? 'prf-badge-vencido' : ''
  return <span className={`prf-badge ${cls}`}>{ESTADO_LABEL[estado] ?? estado}</span>
}

function fmt(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function PerfilView({ perfil }: { perfil: PerfilData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error,     setError]        = useState('')
  const [success,   setSuccess]      = useState(false)
  const [showPwd,   setShowPwd]      = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setSuccess(false)

    const fd = new FormData(e.currentTarget)

    // Validación contraseña en cliente
    const nueva    = (fd.get('password_nueva')    as string) ?? ''
    const confirma = (fd.get('password_confirma') as string) ?? ''
    if (nueva && nueva !== confirma) {
      setError('Las contraseñas nuevas no coinciden.')
      return
    }

    startTransition(async () => {
      const result = await actualizarMiPerfil(fd)
      if (!result.ok) { setError(result.error ?? 'Error inesperado.'); return }
      setSuccess(true)
      setShowPwd(false)
      router.refresh()
    })
  }

  return (
    <div className="view-container">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Mi perfil</h1>
          <p className="page-subtitle">Datos de tu cuenta y configuración personal.</p>
        </div>
      </div>

      {/* ── Datos de la cuenta ── */}
      <div className="card mb-5">
        <div className="prf-card-header">
          <h2 className="prf-section-title">Datos de la cuenta</h2>
          <span className="prf-client-id">{perfil.client_id}</span>
        </div>

        <div className="prf-info-grid">
          <div className="prf-field">
            <span className="prf-label">Empresa</span>
            <span className="prf-value">{perfil.nombre_empresa}</span>
          </div>
          <div className="prf-field">
            <span className="prf-label">Contacto</span>
            <span className="prf-value">{perfil.nombre_contacto ?? '—'}</span>
          </div>
          <div className="prf-field">
            <span className="prf-label">Email de cuenta</span>
            <span className="prf-value">{perfil.email_admin}</span>
          </div>
          <div className="prf-field">
            <span className="prf-label">Suscripción</span>
            <span className="prf-value prf-value-strong">{perfil.suscripcion}</span>
          </div>
          <div className="prf-field">
            <span className="prf-label">Estado</span>
            <EstadoBadge estado={perfil.estado} />
          </div>
          <div className="prf-field">
            <span className="prf-label">Vigente hasta</span>
            <span className="prf-value">{fmt(perfil.fecha_expiracion)}</span>
          </div>
        </div>
      </div>

      {/* ── Mi usuario ── */}
      <div className="card">
        <div className="prf-card-header">
          <h2 className="prf-section-title">Mi usuario</h2>
          <div className="prf-badge-row">
            <span className="usr-badge usr-badge-admin" style={perfil.rol !== 'admin_empresa' ? { background: 'var(--color-info-bg)', color: 'var(--color-primary)' } : {}}>
              {ROL_LABEL[perfil.rol] ?? perfil.rol}
            </span>
            {perfil.solo_lectura && (
              <span className="usr-badge usr-badge-readonly">
                Solo lectura
              </span>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="prf-form">
          {/* Email + Nombre */}
          <div className="prf-form-row">
            <div className="input-group">
              <label>Email</label>
              <input className="input" type="email" value={perfil.email} readOnly />
              <span className="input-hint">El email no se puede cambiar.</span>
            </div>
            <div className="input-group">
              <label>Nombre</label>
              <input
                className="input"
                name="nombre"
                defaultValue={perfil.nombre ?? ''}
                placeholder="Tu nombre completo"
              />
            </div>
          </div>

          {/* Toggle cambiar contraseña */}
          {!showPwd ? (
            <div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowPwd(true)}
              >
                <IconLock /> Cambiar contraseña
              </button>
            </div>
          ) : (
            <div className="prf-pwd-section">
              <div className="prf-pwd-header">
                <span className="prf-pwd-title">Cambiar contraseña</span>
                <button type="button" className="prf-pwd-cancel" onClick={() => setShowPwd(false)}>
                  Cancelar
                </button>
              </div>
              <div className="prf-pwd-grid">
                <div className="input-group">
                  <label>Contraseña actual <span className="required">*</span></label>
                  <input className="input" type="password" name="password_actual" autoComplete="current-password" />
                </div>
                <div className="input-group">
                  <label>Contraseña nueva <span className="required">*</span></label>
                  <input className="input" type="password" name="password_nueva" autoComplete="new-password" minLength={8} />
                  <span className="input-hint">Mínimo 8 caracteres.</span>
                </div>
                <div className="input-group">
                  <label>Confirmar nueva <span className="required">*</span></label>
                  <input className="input" type="password" name="password_confirma" autoComplete="new-password" />
                </div>
              </div>
            </div>
          )}

          {error   && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">Perfil actualizado correctamente.</div>}

          <div className="prf-form-submit">
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>

    </div>
  )
}

// ── Iconos ────────────────────────────────────────────────────────────────────
function IconLock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
  )
}
