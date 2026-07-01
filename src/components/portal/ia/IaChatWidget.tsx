'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Sparkles, X, Send } from 'lucide-react'
import { chatAgenteIa } from '@/app/actions/portal/ia'
import type { TurnoChat } from '@/lib/ia/agente'

// Botón flotante (abajo-derecha) con chat libre del dueño hacia su agente.
// Se monta en el layout del portal solo si el addon 'asistente_ia' está activo.
export default function IaChatWidget({ nombreAgente }: { nombreAgente: string }) {
  const [abierto,  setAbierto]  = useState(false)
  const [mensajes, setMensajes] = useState<TurnoChat[]>([])
  const [entrada,  setEntrada]  = useState('')
  const [pending, startTransition] = useTransition()
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [mensajes, pending])

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    const texto = entrada.trim()
    if (!texto || pending) return
    const historial = mensajes
    setMensajes([...historial, { rol: 'user', texto }])
    setEntrada('')
    startTransition(async () => {
      const r = await chatAgenteIa(historial, texto)
      const respuesta = r.ok ? r.texto : r.error
      setMensajes(prev => [...prev, { rol: 'assistant', texto: respuesta }])
    })
  }

  return (
    <>
      {abierto && (
        <div className="ia-chat" role="dialog" aria-label={`Chat con ${nombreAgente}`}>
          <div className="ia-chat-head">
            <span className="ia-chat-title"><Sparkles size={16} strokeWidth={2} /> {nombreAgente}</span>
            <button type="button" className="ia-icon-btn" onClick={() => setAbierto(false)} aria-label="Cerrar chat">
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          <div className="ia-chat-body" ref={bodyRef}>
            {mensajes.length === 0 && !pending && (
              <p className="ia-chat-empty">Pregúntame sobre tu negocio: cómo van tus ventas, en qué gastas más, qué esperar el próximo mes…</p>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={m.rol === 'user' ? 'ia-msg ia-msg-user' : 'ia-msg ia-msg-bot'}>{m.texto}</div>
            ))}
            {pending && (
              <div className="ia-msg ia-msg-bot">
                <span className="ia-typing" aria-label={`${nombreAgente} está escribiendo`}><span></span><span></span><span></span></span>
              </div>
            )}
          </div>

          <form className="ia-chat-foot" onSubmit={enviar}>
            <input
              className="input"
              value={entrada}
              onChange={e => setEntrada(e.target.value)}
              placeholder="Escribe tu pregunta…"
              aria-label="Mensaje para el asistente"
              disabled={pending}
            />
            <button type="submit" className="btn btn-primary" disabled={pending || !entrada.trim()} aria-label="Enviar">
              <Send size={16} strokeWidth={2} />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        className="ia-fab"
        onClick={() => setAbierto(o => !o)}
        aria-label={abierto ? 'Cerrar asistente' : 'Abrir asistente IA'}
      >
        {abierto ? <X size={22} strokeWidth={2} /> : <Sparkles size={22} strokeWidth={2} />}
      </button>
    </>
  )
}
