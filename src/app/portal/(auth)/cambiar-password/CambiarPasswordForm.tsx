'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cambiarPasswordObligatorio } from '@/app/actions/portal/auth'
import { Eye, EyeOff } from 'lucide-react'

export default function CambiarPasswordForm({ email }: { email: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error,    setError]    = useState('')
  const [showPass, setShowPass] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    const nueva   = (fd.get('password_nueva')   as string) ?? ''
    const confirm = (fd.get('password_confirm') as string) ?? ''
    if (nueva.length < 8)  { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (nueva !== confirm) { setError('Las contraseñas no coinciden.'); return }

    startTransition(async () => {
      const result = await cambiarPasswordObligatorio(fd)
      if (result?.error) { setError(result.error); return }
      router.push('/portal/dashboard')
    })
  }

  return (
    <div className="login-container">
      <div className="login-box">

        <div className="login-header">
          <div className="login-logo-group">
            <img src="/logo_color.svg" alt="CLAUX" height={48} />
          </div>
          <p className="login-subtitle">Portal de gestión empresarial</p>
        </div>

        <div className="card card-lg">
          <h1 className="login-card-title">Crea tu contraseña</h1>
          <p className="text-sm-muted mb-3">
            Por seguridad, define una contraseña propia para <strong>{email}</strong>.
            La temporal deja de funcionar tras este paso.
          </p>

          <form onSubmit={handleSubmit} className="login-form" noValidate>

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

            <button
              type="submit"
              disabled={isPending}
              className="btn btn-primary btn-full btn-lg"
            >
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : 'Guardar y entrar'}
            </button>

          </form>
        </div>

      </div>
    </div>
  )
}
