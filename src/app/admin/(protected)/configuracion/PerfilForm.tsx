'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function PerfilForm({
  initialName,
  email,
  passwordOnly = false,
}: {
  initialName: string
  email: string
  passwordOnly?: boolean
}) {
  const [name, setName]           = useState(initialName)
  const [saving, setSaving]       = useState(false)
  const [savedOk, setSavedOk]     = useState(false)
  const [sending, setSending]     = useState(false)
  const [sentOk, setSentOk]       = useState(false)
  const [error, setError]         = useState('')

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(''); setSavedOk(false)
    const supabase = createClient()
    const { error: err } = await supabase.auth.updateUser({
      data: { full_name: name.trim() },
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 3000)
  }

  async function handleSendReset() {
    setSending(true); setError(''); setSentOk(false)
    const supabase = createClient()
    const origin   = window.location.origin
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/admin/reset-password`,
    })
    setSending(false)
    if (err) { setError(err.message); return }
    setSentOk(true)
  }

  if (passwordOnly) {
    return (
      <div style={{ marginTop: 'var(--space-4)' }}>
        {sentOk ? (
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
        ) : (
          <button
            className="btn btn-secondary"
            onClick={handleSendReset}
            disabled={sending}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            {sending ? 'Enviando…' : 'Enviar enlace de cambio de contraseña'}
          </button>
        )}
        {error && <div className="alert alert-error" style={{ marginTop: 'var(--space-3)' }}>{error}</div>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSaveName} style={{ marginTop: 'var(--space-5)' }}>
      <div className="form-group">
        <label className="form-label">Nombre</label>
        <input
          className="form-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Tu nombre completo"
          required
        />
      </div>
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label className="form-label">Email</label>
        <input className="form-input" value={email} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
        <p className="form-hint">El email no se puede cambiar desde aquí.</p>
      </div>
      {error   && <div className="alert alert-error"   style={{ margin: 'var(--space-4) 0 0' }}>{error}</div>}
      {savedOk && <div className="alert alert-success" style={{ margin: 'var(--space-4) 0 0' }}>Nombre actualizado correctamente.</div>}
      <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 'var(--space-5)' }}>
        {saving ? 'Guardando...' : 'Guardar cambios'}
      </button>
    </form>
  )
}
