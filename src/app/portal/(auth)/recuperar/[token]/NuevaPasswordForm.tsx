'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { restablecerPasswordPortal } from '@/app/actions/portal/password-reset'
import type { CuentaReset } from '@/lib/portal-reset'

export default function NuevaPasswordForm({ token, email, cuentas }: {
  token:   string
  email:   string
  cuentas: CuentaReset[]
}) {
  const [isPending, startTransition] = useTransition()
  const [error,    setError]    = useState('')
  const [showPass, setShowPass] = useState(false)
  const [listo,    setListo]    = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd      = new FormData(e.currentTarget)
    const nueva   = (fd.get('password_nueva')   as string) ?? ''
    const confirm = (fd.get('password_confirm') as string) ?? ''
    if (nueva.length < 8)  { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (nueva !== confirm) { setError('Las contraseñas no coinciden.'); return }

    startTransition(async () => {
      const result = await restablecerPasswordPortal(fd)
      if (!result.ok) { setError(result.error ?? 'No se pudo guardar la contraseña.'); return }
      setListo(true)
    })
  }

  return (
    <div className="login-container">
      <div className="login-box">

        <div className="login-header">
          <div className="login-logo-group">
            <img src="/logo_color.svg" alt="CLAUX" height={48} />
          </div>
          <p className="login-subtitle">Digitaliza tu negocio</p>
        </div>

        <div className="card card-lg">
          {listo ? (
            <>
              <h1 className="login-card-title">Contraseña guardada</h1>
              <div className="alert alert-success">
                Ya puedes entrar con tu contraseña nueva.
              </div>
              <Link href="/portal/login" className="btn btn-primary btn-full btn-lg">
                Iniciar sesión
              </Link>
            </>
          ) : (
            <>
              <h1 className="login-card-title">Nueva contraseña</h1>
              <p className="text-sm-muted mb-3">
                Define la contraseña de <strong>{email}</strong>. La anterior deja de
                funcionar en cuanto guardes.
              </p>

              <form onSubmit={handleSubmit} className="login-form" noValidate>
                <input type="hidden" name="token" value={token} />

                {cuentas.length === 1 ? (
                  <input type="hidden" name="user_id" value={cuentas[0].user_id} />
                ) : (
                  // El mismo correo puede tener cuenta en varios negocios. La
                  // contraseña es de una cuenta, así que hay que decir cuál.
                  <div className="form-group">
                    <label className="form-label" htmlFor="user_id">
                      Negocio <span className="required">*</span>
                    </label>
                    <select className="input" id="user_id" name="user_id" required defaultValue="">
                      <option value="" disabled>Elige el negocio</option>
                      {cuentas.map(c => (
                        <option key={c.user_id} value={c.user_id}>{c.empresa}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Nueva contraseña <span className="required">*</span></label>
                  <div className="input-pwd-wrap">
                    <input
                      className="form-input input-pwd"
                      type={showPass ? 'text' : 'password'}
                      name="password_nueva"
                      autoComplete="new-password"
                      placeholder="Mínimo 8 caracteres"
                      minLength={8}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(v => !v)}
                      className="input-eye-btn"
                      aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPass ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Repite la contraseña <span className="required">*</span></label>
                  <input
                    className="form-input"
                    type={showPass ? 'text' : 'password'}
                    name="password_confirm"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    minLength={8}
                    required
                  />
                </div>

                {error && <div className="alert alert-error">{error}</div>}

                <button type="submit" disabled={isPending} className="btn btn-primary btn-full btn-lg">
                  {isPending
                    ? <><span className="spinner spinner-sm" /> Guardando…</>
                    : 'Guardar contraseña'}
                </button>

                <Link href="/portal/login" className="login-forgot-link link-full-center">
                  ← Volver al inicio de sesión
                </Link>
              </form>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
