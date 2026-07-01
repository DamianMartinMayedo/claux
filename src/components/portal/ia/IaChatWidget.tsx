'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Sparkles, X, Send, Eraser } from 'lucide-react'
import { chatAgenteIa } from '@/app/actions/portal/ia'
import type { TurnoChat } from '@/lib/ia/agente'

// Botón flotante (abajo-derecha) con chat libre del dueño hacia su agente.
// Se monta en el layout del portal solo si el addon 'asistente_ia' está activo.
export default function IaChatWidget({ nombreAgente, sugerencias }: { nombreAgente: string; sugerencias: string[] }) {
  const [abierto,  setAbierto]  = useState(false)
  const [mensajes, setMensajes] = useState<TurnoChat[]>([])
  const [entrada,  setEntrada]  = useState('')
  const [pending, startTransition] = useTransition()
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [mensajes, pending])

  function vaciar() {
    if (pending) return
    setMensajes([])
    setEntrada('')
  }

  function enviarTexto(texto: string) {
    const t = texto.trim()
    if (!t || pending) return
    const historial = mensajes
    setMensajes([...historial, { rol: 'user', texto: t }])
    setEntrada('')
    startTransition(async () => {
      const r = await chatAgenteIa(historial, t)
      const respuesta = r.ok ? r.texto : r.error
      setMensajes(prev => [...prev, { rol: 'assistant', texto: respuesta }])
    })
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    enviarTexto(entrada)
  }

  return (
    <>
      {abierto && (
        <div className="ia-chat" role="dialog" aria-label={`Chat con ${nombreAgente}`}>
          <div className="ia-chat-head">
            <span className="ia-chat-title"><Sparkles size={16} strokeWidth={2} /> {nombreAgente}</span>
            <span className="ia-chat-head-actions">
              {mensajes.length > 0 && (
                <button type="button" className="ia-icon-btn" onClick={vaciar} disabled={pending} aria-label="Vaciar conversación" title="Vaciar conversación">
                  <Eraser size={17} strokeWidth={2} />
                </button>
              )}
              <button type="button" className="ia-icon-btn" onClick={() => setAbierto(false)} aria-label="Cerrar chat">
                <X size={18} strokeWidth={2} />
              </button>
            </span>
          </div>

          <div className="ia-chat-body" ref={bodyRef}>
            {mensajes.length === 0 && !pending && (
              <div className="ia-chat-welcome">
                <p className="ia-chat-welcome-text">¡Hola! Soy {nombreAgente}, tu asistente. ¿En qué te ayudo hoy?</p>
                {sugerencias.length > 0 && (
                  <div className="ia-chat-sugs">
                    {sugerencias.map((s, i) => (
                      <button key={i} type="button" className="ia-chat-sug" onClick={() => enviarTexto(s)}>{s}</button>
                    ))}
                  </div>
                )}
              </div>
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
