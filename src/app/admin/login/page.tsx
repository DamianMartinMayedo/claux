'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router  = useRouter()
  const [mode, setMode]           = useState<'login' | 'forgot'>('login')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [sentOk, setSentOk]       = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Credenciales incorrectas. Verifica tu email y contraseña.')
      setLoading(false)
      return
    }
    router.push('/admin/dashboard')
    router.refresh()
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const supabase = createClient()
    const origin   = window.location.origin
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/admin/reset-password`,
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    setSentOk(true)
  }

  return (
    <div className="login-container">
      <div className="login-box">

        <div className="login-header">
          <div className="login-logo-group">
            <div className="login-logo-icon"><span>C</span></div>
            <h2 className="login-title">CLAUX</h2>
          </div>
          <p className="login-subtitle">Panel de administración</p>
        </div>

        <div className="card card-lg">

          {mode === 'login' ? (
            <>
              <h1 className="login-card-title">Iniciar sesión</h1>
              <form onSubmit={handleLogin} className="login-form">
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-input" type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    required placeholder="tu@email.com"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Contraseña</label>
                  <input
                    className="form-input" type="password" value={password}
                    onChange={e => setPassword(e.target.value)}
                    required placeholder="••••••••"
                  />
                </div>
                {error && <div className="alert alert-error">{error}</div>}
                <button type="submit" disabled={loading} className="btn btn-primary btn-full btn-lg">
                  {loading ? 'Entrando...' : 'Entrar'}
                </button>
                <button
                  type="button"
                  className="login-forgot-link"
                  onClick={() => { setMode('forgot'); setError(''); setSentOk(false) }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="login-card-title">Recuperar contraseña</h1>
              {sentOk ? (
                <div className="mt-4">
                  <div className="reset-sent-box">
                    <div className="reset-sent-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                        <polyline points="22,6 12,13 2,6"/>
                      </svg>
                    </div>
                    <div>
                      <p className="reset-sent-title">Enlace enviado</p>
                      <p className="reset-sent-email">{email}</p>
                      <p className="reset-sent-hint">Revisa tu bandeja de entrada y sigue el enlace para establecer tu nueva contraseña.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="login-forgot-link link-full-center mt-5"
                    onClick={() => { setMode('login'); setSentOk(false) }}
                  >
                    ← Volver al inicio de sesión
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgot} className="login-form">
                  <p className="text-sm-muted mb-4">
                    Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.
                  </p>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input
                      className="form-input" type="email" value={email}
                      onChange={e => setEmail(e.target.value)}
                      required placeholder="tu@email.com"
                    />
                  </div>
                  {error && <div className="alert alert-error">{error}</div>}
                  <button type="submit" disabled={loading} className="btn btn-primary btn-full btn-lg">
                    {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
                  </button>
                  <button
                    type="button"
                    className="login-forgot-link"
                    onClick={() => { setMode('login'); setError('') }}
                  >
                    ← Volver al inicio de sesión
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        <p className="login-footer">CLAUX v0.1 — Super Admin</p>
      </div>
    </div>
  )
}
