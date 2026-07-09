'use client'

import { useState, useTransition } from 'react'
import { useRouter }               from 'next/navigation'
import { loginCliente }            from '@/app/actions/portal/auth'
import { Eye, EyeOff } from 'lucide-react'

export default function PortalLoginPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error,    setError]    = useState('')
  const [showPass, setShowPass] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await loginCliente(fd)
      if (result?.error) {
        setError(result.error)
      } else if (result?.mustChangePassword) {
        router.push('/portal/cambiar-password')
      } else {
        router.push('/portal/dashboard')
      }
    })
  }

  return (
    <div className="login-container">
      <div className="login-box">

        <div className="login-header">
          <div className="login-logo-group">
            <div className="login-logo-icon"><span>C</span></div>
            <h2 className="login-title">CLAUX</h2>
          </div>
          <p className="login-subtitle">Portal de gestión empresarial</p>
        </div>

        <div className="card card-lg">
          <h1 className="login-card-title">Iniciar sesión</h1>

          <form onSubmit={handleSubmit} className="login-form" noValidate>

            <div className="form-group">
              <label className="form-label">Email <span className="required">*</span></label>
              <input
                className="form-input"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="tu@empresa.com"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Contraseña <span className="required">*</span></label>
              <div className="input-pwd-wrap">
                <input
                  className="form-input input-pwd"
                  type={showPass ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
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

            {error && <div className="alert alert-error">{error}</div>}

            <button
              type="submit"
              disabled={isPending}
              className="btn btn-primary btn-full btn-lg"
            >
              {isPending
                ? <><span className="spinner spinner-sm" /> Entrando…</>
                : 'Iniciar sesión'}
            </button>

          </form>
        </div>

        {/* TODO: reactivar cuando tengamos correo de soporte (avisar cuando esté listo).
        <p className="login-footer">
          ¿Problemas de acceso?{' '}
          <a href="mailto:soporte@claux.app">soporte@claux.app</a>
        </p>
        */}
      </div>
    </div>
  )
}

