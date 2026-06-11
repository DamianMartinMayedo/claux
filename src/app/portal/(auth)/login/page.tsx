'use client'

import { useState, useTransition } from 'react'
import { useRouter }               from 'next/navigation'
import { loginCliente }            from '@/app/actions/portal/auth'

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
      } else {
        router.push('/portal/empresas')
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
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input"
                  type={showPass ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  style={{ paddingRight: '2.5rem' }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{
                    position: 'absolute', right: 'var(--space-3)', top: '50%',
                    transform: 'translateY(-50%)', background: 'none', border: 'none',
                    padding: 0, color: 'var(--color-text-muted)', cursor: 'pointer',
                  }}
                  aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPass ? <IconEyeOff /> : <IconEye />}
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
                ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} /> Entrando…</>
                : 'Iniciar sesión'}
            </button>

          </form>
        </div>

        <p className="login-footer" style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
          ¿Problemas de acceso?{' '}
          <a href="mailto:soporte@claux.app">soporte@claux.app</a>
        </p>
      </div>
    </div>
  )
}

function IconEye() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
}
function IconEyeOff() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
}
