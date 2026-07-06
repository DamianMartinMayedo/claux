'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Sparkles, X, Send, SquarePen, History, MessageCircle, Trash2, Clock } from 'lucide-react'
import {
  chatAgenteIa,
  guardarConversacion,
  obtenerConversaciones,
  obtenerMensajesConversacion,
  eliminarConversacion as eliminarConversacionAction,
  type ConversacionResumen
} from '@/app/actions/portal/ia'
import type { TurnoChat } from '@/lib/ia/agente'

// Botón flotante (abajo-derecha) con chat libre del dueño hacia su agente.
// Se monta en el layout del portal solo si el addon 'asistente_ia' está activo.
export default function IaChatWidget({ nombreAgente, sugerencias }: { nombreAgente: string; sugerencias: string[] }) {
  const [abierto,  setAbierto]  = useState(false)
  const [montado,  setMontado]  = useState(false)   // panel en el DOM (persiste durante el cierre para animarlo)
  const [visible,  setVisible]  = useState(false)   // panel ya animado a su estado abierto
  const [mensajes, setMensajes] = useState<TurnoChat[]>([])
  const [entrada,  setEntrada]  = useState('')
  const [pending, startTransition] = useTransition()
  const bodyRef = useRef<HTMLDivElement>(null)

  // Estado para historial
  const [mostrarHistorial, setMostrarHistorial] = useState(false)
  const [conversaciones, setConversaciones] = useState<ConversacionResumen[]>([])
  const [cargandoHistorial, setCargandoHistorial] = useState(false)
  const [conversacionActualId, setConversacionActualId] = useState<string | null>(null)
  const [tituloConversacion, setTituloConversacion] = useState('Nueva conversación')

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [mensajes, pending])

  // Cargar historial cuando se abre
  useEffect(() => {
    if (abierto && conversaciones.length === 0) {
      cargarHistorial()
    }
  }, [abierto])

  async function cargarHistorial() {
    setCargandoHistorial(true)
    const result = await obtenerConversaciones()
    if (result.ok && result.conversaciones) {
      setConversaciones(result.conversaciones)
    }
    setCargandoHistorial(false)
  }

  async function cargarConversacion(convId: string) {
    setCargandoHistorial(true)
    const result = await obtenerMensajesConversacion(convId)
    if (result.ok && result.conversacion) {
      setMensajes(result.conversacion.mensajes)
      setTituloConversacion(result.conversacion.titulo)
      setConversacionActualId(convId)
      setMostrarHistorial(false)
    }
    setCargandoHistorial(false)
  }

  async function eliminarConversacion(convId: string) {
    const result = await eliminarConversacionAction(convId)
    if (result.ok) {
      setConversaciones(prev => prev.filter(c => c.conversacion_id !== convId))
      if (conversacionActualId === convId) {
        nuevaConversacion()
      }
    }
  }

  function nuevaConversacion() {
    setMensajes([])
    setEntrada('')
    setConversacionActualId(null)
    setTituloConversacion('Nueva conversación')
    setMostrarHistorial(false)
  }

  // Apertura/cierre con animación tipo "genie" (sale/entra hacia el botón).
  // El panel se mantiene montado durante el cierre para que la transición se vea.
  function abrirChat() {
    setAbierto(true)
    setMontado(true)
    setVisible(true)   // la entrada la anima @starting-style (CSS); la salida, [data-visible=false]
  }
  function cerrarChat() {
    setAbierto(false)
    setVisible(false)   // dispara la salida; al terminar la transición se desmonta
  }
  function toggleChat() { abierto ? cerrarChat() : abrirChat() }

  async function enviarTexto(texto: string) {
    const t = texto.trim()
    if (!t || pending) return
    const historial = mensajes
    setMensajes([...historial, { rol: 'user', texto: t }])
    setEntrada('')

    // Generar título automático si es el primer mensaje
    if (historial.length === 0) {
      setTituloConversacion(t.substring(0, 50) + (t.length > 50 ? '...' : ''))
    }

    startTransition(async () => {
      const r = await chatAgenteIa(historial, t)
      const respuesta = r.ok ? r.texto : r.error
      const nuevosMensajes: TurnoChat[] = [
        ...historial,
        { rol: 'user', texto: t },
        { rol: 'assistant', texto: respuesta }
      ]
      setMensajes(nuevosMensajes)

      // Guardar conversación automáticamente
      const titulo = historial.length === 0 ? t.substring(0, 50) : tituloConversacion
      await guardarConversacion(conversacionActualId, titulo, nuevosMensajes)

      // Si es nueva, actualizar el ID
      if (!conversacionActualId) {
        const result = await obtenerConversaciones()
        if (result.ok && result.conversaciones && result.conversaciones.length > 0) {
          setConversacionActualId(result.conversaciones[0].conversacion_id)
          setConversaciones(result.conversaciones)
        }
      }
    })
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    enviarTexto(entrada)
  }

  function formatFecha(fecha: string) {
    const d = new Date(fecha)
    const ahora = new Date()
    const diffMs = ahora.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Ahora'
    if (diffMins < 60) return `Hace ${diffMins} min`
    if (diffHours < 24) return `Hace ${diffHours}h`
    if (diffDays < 7) return `Hace ${diffDays}d`
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  }

  return (
    <>
      {montado && (
        <div className="ia-chat" role="dialog" aria-label={`Chat con ${nombreAgente}`}
          data-visible={visible}
          onTransitionEnd={e => { if (e.target === e.currentTarget && !visible) setMontado(false) }}>
          <div className="ia-chat-head">
            <span className="ia-chat-title"><Sparkles size={16} strokeWidth={2} /> {nombreAgente}</span>
            <span className="ia-chat-head-actions">
              {(mensajes.length > 0 || mostrarHistorial) && (
                <button type="button" className="ia-icon-btn" onClick={nuevaConversacion} disabled={pending} aria-label="Nueva conversación" title="Nueva conversación">
                  <SquarePen size={17} strokeWidth={2} />
                </button>
              )}
              {(conversaciones.length > 0 || mostrarHistorial) && (
                <button type="button" className={`ia-icon-btn${mostrarHistorial ? ' ia-icon-btn--active' : ''}`}
                  onClick={() => { const abrir = !mostrarHistorial; setMostrarHistorial(abrir); if (abrir) cargarHistorial() }}
                  aria-pressed={mostrarHistorial} aria-label="Historial de conversaciones" title="Historial">
                  <History size={17} strokeWidth={2} />
                </button>
              )}
              <button type="button" className="ia-icon-btn" onClick={cerrarChat} aria-label="Cerrar chat">
                <X size={18} strokeWidth={2} />
              </button>
            </span>
          </div>

          <div className="ia-chat-body" ref={bodyRef}>
            {mostrarHistorial ? (
              // Vista de historial
              <div className="ia-historial">
                <div className="ia-historial-header">
                  <h3>Conversaciones anteriores</h3>
                </div>
                {cargandoHistorial ? (
                  <div className="ia-historial-loading">Cargando...</div>
                ) : conversaciones.length === 0 ? (
                  <div className="ia-historial-empty">
                    <MessageCircle size={32} strokeWidth={1.5} />
                    <p>Aún no tienes conversaciones guardadas</p>
                  </div>
                ) : (
                  <div className="ia-historial-list">
                    {conversaciones.map(conv => (
                      <div key={conv.conversacion_id} className="ia-historial-item">
                        <button
                          type="button"
                          className="ia-historial-item-content"
                          onClick={() => cargarConversacion(conv.conversacion_id)}
                        >
                          <MessageCircle size={16} strokeWidth={2} />
                          <div className="ia-historial-item-text">
                            <span className="ia-historial-item-title">{conv.titulo}</span>
                            <span className="ia-historial-item-date">
                              <Clock size={12} strokeWidth={2} />
                              {formatFecha(conv.updated_at)}
                            </span>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="ia-historial-item-delete"
                          onClick={() => eliminarConversacion(conv.conversacion_id)}
                          aria-label="Eliminar conversación"
                        >
                          <Trash2 size={14} strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : mensajes.length === 0 && !pending ? (
              // Vista de bienvenida
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
            ) : (
              // Vista de mensajes
              <>
                {mensajes.map((m, i) => (
                  <div key={i} className={m.rol === 'user' ? 'ia-msg ia-msg-user' : 'ia-msg ia-msg-bot'}>{m.texto}</div>
                ))}
                {pending && (
                  <div className="ia-msg ia-msg-bot">
                    <span className="ia-typing" aria-label={`${nombreAgente} está escribiendo`}><span></span><span></span><span></span></span>
                  </div>
                )}
              </>
            )}
          </div>

          <form className="ia-chat-foot" onSubmit={enviar}>
            <input
              className="input"
              value={entrada}
              onChange={e => setEntrada(e.target.value)}
              placeholder="Escribe tu pregunta…"
              aria-label="Mensaje para el asistente"
              disabled={pending || mostrarHistorial}
            />
            <button type="submit" className="btn btn-primary" disabled={pending || !entrada.trim() || mostrarHistorial} aria-label="Enviar">
              <Send size={16} strokeWidth={2} />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        className="ia-fab"
        onClick={toggleChat}
        aria-label={abierto ? 'Cerrar asistente' : 'Abrir asistente IA'}
      >
        {abierto ? <X size={22} strokeWidth={2} /> : <Sparkles size={22} strokeWidth={2} />}
      </button>
    </>
  )
}
