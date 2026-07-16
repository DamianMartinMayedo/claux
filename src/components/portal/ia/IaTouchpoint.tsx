'use client'

import { useState, useTransition, useRef, useEffect, useId } from 'react'
import { Sparkles, X } from 'lucide-react'
import { generarInsightIa } from '@/app/actions/portal/ia'
import { useIa } from './IaContext'
import type { TipoInsight } from '@/lib/ia/agente'

// Icono de IA junto al nombre de un apartado. Al montarse muestra automáticamente
// un aviso (con cerrar) explicando qué hará la IA si lo pulsas; al pulsar genera
// un análisis directo y conciso del apartado. Solo aparece con el addon activo.
//
// `descripcion` completa la frase: "Deja que {agente} haga {descripcion}."
// p. ej. descripcion="un análisis de tus ventas".
export default function IaTouchpoint({
  tipo, descripcion,
}: { tipo: TipoInsight; descripcion: string }) {
  const { tieneIa, nombreAgente } = useIa()
  const [callout, setCallout] = useState(false)
  const [panel,   setPanel]   = useState(false)
  const [texto,   setTexto]   = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLSpanElement>(null)
  const dismissKey = `ia-tip-${tipo}`
  // Id único para el degradado del icono (evita ids duplicados si hay varios).
  const gradId = `iaspark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  // Auto-aviso al entrar, salvo que el usuario ya lo cerrara antes (recordado).
  useEffect(() => {
    if (!tieneIa) return
    try { if (localStorage.getItem(dismissKey) !== '1') setCallout(true) } catch { setCallout(true) }
  }, [tieneIa, dismissKey])

  // Cerrar el panel de resultado al hacer click fuera.
  useEffect(() => {
    if (!panel) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setPanel(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [panel])

  if (!tieneIa) return null

  function cerrarCallout() {
    setCallout(false)
    try { localStorage.setItem(dismissKey, '1') } catch {}
  }

  function analizar() {
    setCallout(false)
    setPanel(true); setError(null)
    startTransition(async () => {
      const r = await generarInsightIa(tipo)
      if (r.ok) { setTexto(r.texto); setError(null) }
      else { setError(r.error); setTexto(null) }
    })
  }

  return (
    <span className="ia-tp" ref={ref}>
      {/* Degradado de marca para el trazo del icono (estrellitas). */}
      <svg className="ia-grad-defs" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" className="ia-grad-0" />
            <stop offset="100%" className="ia-grad-1" />
          </linearGradient>
        </defs>
      </svg>
      <button
        type="button" className="ia-tp-icon"
        onClick={() => (panel ? setPanel(false) : analizar())}
        aria-label={`Deja que ${nombreAgente} haga ${descripcion}`}
      >
        <Sparkles size={18} strokeWidth={2} color={`url(#${gradId})`} />
      </button>

      {/* Aviso automático (solo informa; la acción la hace el icono) */}
      {callout && !panel && (
        <span className="ia-tp-callout" role="note">
          <span className="ia-tp-callout-text">Pulsa el icono para que {nombreAgente} haga {descripcion}.</span>
          <button type="button" className="ia-icon-btn" onClick={cerrarCallout} aria-label="Cerrar aviso">
            <X size={15} strokeWidth={2} />
          </button>
        </span>
      )}

      {/* Panel de resultado */}
      {panel && (
        <span className="ia-tp-panel" role="dialog">
          <span className="ia-tp-panel-head">
            <span className="ia-tp-panel-title"><Sparkles size={15} strokeWidth={2} /> {nombreAgente}</span>
            <button type="button" className="ia-icon-btn" onClick={() => setPanel(false)} aria-label="Cerrar">
              <X size={16} strokeWidth={2} />
            </button>
          </span>

          {pending
            ? <span className="ia-typing" aria-label="Escribiendo"><span></span><span></span><span></span></span>
            : error
              ? <span className="ia-tp-error">{error}</span>
              : <span className="ia-tp-body">{texto}</span>}

          {!pending && !error && texto && (
            <span className="ia-tp-disclaimer">Generado por IA a partir de tus datos · revísalo antes de decidir.</span>
          )}
        </span>
      )}
    </span>
  )
}
