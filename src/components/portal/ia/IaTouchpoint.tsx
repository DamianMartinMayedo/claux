'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import { generarInsightIa } from '@/app/actions/portal/ia'
import type { TipoInsight } from '@/lib/ia/agente'

// Punto de entrada de IA: icono + tooltip que explica qué hará la IA aquí; al
// pulsar genera el insight y lo muestra en un popover. Solo se monta donde el
// addon está contratado (el gating real está en la server action).
export default function IaTouchpoint({
  tipo, label, tip,
}: { tipo: TipoInsight; label: string; tip: string }) {
  const [abierto, setAbierto] = useState(false)
  const [texto,   setTexto]   = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [abierto])

  function lanzar() {
    setAbierto(true); setError(null)
    startTransition(async () => {
      const r = await generarInsightIa(tipo)
      if (r.ok) { setTexto(r.texto); setError(null) }
      else { setError(r.error); setTexto(null) }
    })
  }

  return (
    <div className="ia-tp" ref={ref}>
      <button type="button" className="ia-tp-btn" onClick={lanzar} disabled={pending} aria-label={tip}>
        <Sparkles size={14} strokeWidth={2} /> {label}
      </button>
      <span className="ia-tp-tip" role="tooltip">{tip}</span>

      {abierto && (
        <div className="ia-tp-panel">
          <div className="ia-tp-panel-head">
            <span className="ia-tp-panel-title"><Sparkles size={15} strokeWidth={2} /> {label}</span>
            <button type="button" className="ia-icon-btn" onClick={() => setAbierto(false)} aria-label="Cerrar">
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          {pending
            ? <span className="ia-tp-loading"><span className="spinner spinner-sm" /> Analizando tus datos…</span>
            : error
              ? <p className="ia-tp-error">{error}</p>
              : <p className="ia-tp-body">{texto}</p>}

          {!pending && !error && texto && (
            <p className="ia-tp-disclaimer">Generado por IA a partir de tus datos · puede equivocarse.</p>
          )}
        </div>
      )}
    </div>
  )
}
