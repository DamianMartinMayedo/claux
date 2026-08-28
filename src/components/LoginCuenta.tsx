'use client'

import { Mail } from 'lucide-react'
import CampoPassword from '@/components/CampoPassword'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * El formulario de acceso por cuenta de Supabase Auth, compartido por las dos
 * puertas del sistema: el panel del equipo (`/admin/login`) y la de un
 * revendedor (`/partners`). Es el MISMO login —la misma tabla de cuentas y el
 * mismo proveedor—; lo que cambia es el rótulo con el que se presenta y adónde
 * se entra al terminar. El rol decide el resto: un partner que aterrice en el
 * panel sale rebotado al manual, y al revés.
 */
export default function LoginCuenta({ subtitulo, destino, pie }: {
  /** Qué es esto, bajo el logo. */
  subtitulo: string
  /** Adónde se va tras entrar. */
  destino: string
  /** La línea del pie. */
  pie: string
}) {
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
    router.push(destino)
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
            <img src="/logo_color.svg" alt="CLAUX" height={48} />
          </div>
          <p className="login-subtitle">{subtitulo}</p>
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
                  <CampoPassword
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
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
                      <Mail size={20} />
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

        <p className="login-footer">{pie}</p>
      </div>
    </div>
  )
}
