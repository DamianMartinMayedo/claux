'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/app/contexts/ToastContext'

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
  const [sending, setSending]     = useState(false)
  const [sentOk, setSentOk]       = useState(false)
  const { success: toastSuccess, error: toastError } = useToast()

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const supabase = createClient()
    const { error: err } = await supabase.auth.updateUser({
      data: { full_name: name.trim() },
    })
    setSaving(false)
    if (err) { toastError(err.message); return }
    toastSuccess('Nombre actualizado correctamente.')
  }

  async function handleSendReset() {
    setSending(true); setSentOk(false)
    const supabase = createClient()
    const origin   = window.location.origin
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/admin/reset-password`,
    })
    setSending(false)
    if (err) { toastError(err.message); return }
    setSentOk(true)
  }

  if (passwordOnly) {
    return (
      <div className="mt-4">
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
      </div>
    )
  }

  return (
    <form onSubmit={handleSaveName} className="mt-5">
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
      <div className="form-group mt-4">
        <label className="form-label">Email</label>
        <input className="form-input input-disabled" value={email} disabled />
        <p className="form-hint">El email no se puede cambiar desde aquí.</p>
      </div>
      <button type="submit" className="btn btn-primary mt-5" disabled={saving}>
        {saving ? 'Guardando...' : 'Guardar cambios'}
      </button>
    </form>
  )
}
