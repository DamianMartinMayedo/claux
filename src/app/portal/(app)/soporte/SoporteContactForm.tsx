'use client'

import { useState, useTransition } from 'react'
import { enviarMensajeSoporte } from '@/app/actions/portal/soporte'
import { Check, Send } from 'lucide-react'

export default function SoporteContactForm() {
  const [isPending, startTransition] = useTransition()
  const [error,   setError]   = useState('')
  const [enviado, setEnviado] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const form = e.currentTarget
    const fd   = new FormData(form)
    startTransition(async () => {
      const res = await enviarMensajeSoporte(fd)
      if (!res.ok) { setError(res.error ?? 'No se pudo enviar.'); return }
      form.reset()
      setEnviado(true)
      setTimeout(() => setEnviado(false), 6000)
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="soporte-form">
      <div className="input-group">
        <label>Asunto <span className="required">*</span></label>
        <input
          className="input"
          name="asunto"
          maxLength={160}
          placeholder="Ej: Duda al registrar un gasto"
          required
        />
      </div>

      <div className="input-group">
        <label>Mensaje <span className="required">*</span></label>
        <textarea
          className="input"
          name="mensaje"
          rows={5}
          maxLength={4000}
          placeholder="Cuéntanos con detalle en qué te ayudamos…"
          required
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {enviado && (
        <div className="alert alert-success">
          <Check size={15} className="flex-shrink-0" /> ¡Mensaje enviado! Te responderemos pronto.
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-full" disabled={isPending}>
        {isPending
          ? <><span className="spinner spinner-sm" /> Enviando…</>
          : <><Send size={15} /> Enviar mensaje</>}
      </button>
    </form>
  )
}
