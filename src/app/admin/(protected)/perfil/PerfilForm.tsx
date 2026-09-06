'use client'

import { Mail } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
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
  const [sending, setSending]     = useState(false)
  const [sentOk, setSentOk]       = useState(false)

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
              <Mail size={20} />
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
            <Mail size={16} />
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
