'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, X } from 'lucide-react'
import IaSparkle from '@/components/ia/IaSparkle'
import { parteDelDia } from '@/app/actions/admin/parte'
import type { LineaParteUi } from '@/app/actions/admin/parte'

// ── «Qué ha pasado» ──────────────────────────────────────────────────────────
// La estrellita de la cabecera, igual que en el portal (`.ia-tp-*`): se pulsa y
// suelta un globo con lo que hay que saber hoy. Ni bloque en medio del panel ni
// vista previa con casillas —eso es `.iap-*`, y es para lo que se TRABAJA—: esto
// se lee de pasada y se cierra.
//
// Se pide al pulsar, no al montar: el panel se recarga todo el día y pedir IA en
// cada recarga era pagar por un parte que nadie había pedido. Y una vez traído se
// queda en memoria: reabrir el globo no vuelve a llamar.

const AVISO = 'ia-tip-parte'

export default function ParteDelDia() {
  const [abierto, setAbierto]     = useState(false)
  const [lineas, setLineas]       = useState<LineaParteUi[] | null>(null)
  const [cargando, setCargando]   = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [reintento, setReintento] = useState(false)
  const [aviso, setAviso]         = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  // El aviso de la primera vez, igual que el del portal: una estrellita suelta en
  // una cabecera no dice qué hace, y sin esto la función existe pero no se
  // encuentra. Se cierra una vez y no vuelve (recordado en este navegador).
  useEffect(() => {
    try { if (localStorage.getItem(AVISO) !== '1') setAviso(true) } catch { setAviso(true) }
  }, [])

  // Cerrar al pulsar fuera, como el del portal: un globo que tapa media cabecera
  // y solo se cierra con la X estorba.
  useEffect(() => {
    if (!abierto) return
    function fuera(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  async function pedir() {
    setError(null)
    setReintento(false)
    setCargando(true)
    try {
      const res = await parteDelDia()
      if (!res.ok) { setError(res.error); setReintento(!!res.reintentar); return }
      setLineas(res.lineas)
    } catch {
      setError('No se ha podido pedir el parte.')
      setReintento(true)
    } finally {
      setCargando(false)
    }
  }

  function cerrarAviso() {
    setAviso(false)
    try { localStorage.setItem(AVISO, '1') } catch {}
  }

  function alPulsar() {
    setAviso(false)
    if (abierto) { setAbierto(false); return }
    setAbierto(true)
    if (!lineas && !cargando) void pedir()
  }

  return (
    <span className="ia-tp ia-tp-fin" ref={ref}>
      <button
        type="button" className="ia-tp-icon" onClick={alPulsar}
        aria-label="Qué ha pasado"
      >
        <IaSparkle size={18} />
      </button>

      {aviso && !abierto && (
        <span className="ia-tp-callout" role="note">
          <span className="ia-tp-callout-text">La estrella genera el resumen del día con IA.</span>
          <button type="button" className="ia-icon-btn" onClick={cerrarAviso} aria-label="Cerrar aviso">
            <X size={15} strokeWidth={2} />
          </button>
        </span>
      )}

      {abierto && (
        <span className="ia-tp-panel" role="dialog">
          <span className="ia-tp-panel-head">
            <span className="ia-tp-panel-title"><IaSparkle size={15} /> Qué ha pasado</span>
            <button type="button" className="ia-icon-btn" onClick={() => setAbierto(false)} aria-label="Cerrar">
              <X size={16} strokeWidth={2} />
            </button>
          </span>

          {cargando && <span className="ia-typing" aria-label="Leyendo"><span /><span /><span /></span>}

          {!cargando && error && (
            <>
              <span className="ia-tp-error">{error}</span>
              {reintento && (
                <button type="button" className="btn btn-secondary btn-sm ia-tp-reintentar" onClick={pedir}>
                  <RefreshCw size={14} strokeWidth={2} /> Reintentar
                </button>
              )}
            </>
          )}

          {!cargando && !error && lineas && (
            <>
              {lineas.length === 0
                ? <span className="ia-tp-body">Nada que destacar hoy.</span>
                : (
                  <span className="ia-tp-lineas">
                    {lineas.map(l => (
                      <span key={l.clave} className="ia-tp-linea">
                        <strong>{l.marca}</strong> · {l.titulo}
                        {l.enlace && <> <Link href={l.enlace.href}>{l.enlace.texto}</Link></>}
                      </span>
                    ))}
                  </span>
                )}
              <span className="ia-tp-disclaimer">
                Generado por IA con los avisos y las cifras del panel · los avisos los detecta el sistema.
              </span>
            </>
          )}
        </span>
      )}
    </span>
  )
}
