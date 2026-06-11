'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function ResetPasswordForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [ready, setReady]       = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    // Flujo PKCE: Supabase envía ?code= en la URL (modo por defecto con @supabase/ssr)
    const code = searchParams.get('code')
    if (code) {
      supabase.auth.exchangeCodeForSession(code)
        .then(({ error: err }) => {
          if (err) setError('El enlace ha expirado o no es válido. Solicita uno nuevo.')
          else setReady(true)
        })
        .finally(() => setChecking(false))
      return
    }

    // Flujo implícito (fallback): token en el hash de la URL
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { setReady(true); setChecking(false) }
    })

    // Si no hay code ni evento tras 3s, el enlace no es válido
    const timeout = setTimeout(() => {
      setChecking(false)
      if (!ready) setError('Enlace no válido o expirado. Solicita un nuevo enlace desde el panel.')
    }, 3000)

    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return }
    if (password.length < 8)  { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    setSaving(true)
    const supabase = createClient()
    const { error: err } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (err) { setError(err.message); return }
    router.push('/admin/dashboard')
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
          <h1 className="login-card-title">Nueva contraseña</h1>

          {checking && !error && (
            <div className="reset-status-box reset-status-info">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Validando el enlace de recuperación…
            </div>
          )}

          {error && (
            <div className="reset-status-box reset-status-error">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {ready && !error && (
            <form onSubmit={handleSubmit} className="login-form" style={{ marginTop: 'var(--space-2)' }}>
              <div className="form-group">
                <label className="form-label">Nueva contraseña</label>
                <input
                  className="form-input" type="password" value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres" required autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirmar contraseña</label>
                <input
                  className="form-input" type="password" value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repite la contraseña" required
                />
              </div>
              <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={saving}>
                {saving ? 'Guardando…' : 'Establecer nueva contraseña'}
              </button>
            </form>
          )}
        </div>
        <p className="login-footer">CLAUX v0.1 — Super Admin</p>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
