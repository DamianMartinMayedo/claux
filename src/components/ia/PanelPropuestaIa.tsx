'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, RefreshCw, X } from 'lucide-react'
import IaSparkle from './IaSparkle'
import {
  BADGE_CONFIANZA, ETIQUETA_CONFIANZA, naceMarcada, ordenarParaRevisar,
  type LineaPropuesta, type PropuestaIa,
} from '@/lib/ia/propuesta'

// ── La vista previa de lo que la IA va a escribir ────────────────────────────
// El panel ÚNICO de la IA del admin. Todas las funciones que escriben pasan por
// aquí, y por eso las cuatro condiciones de la supervisión se cumplen aunque el
// que enchufe la novena función no se haya leído el plan:
//
//   · se ve el cambio (antes → después), no un texto que lo describe;
//   · se aplica el lote de un clic, y se desmarca lo que no;
//   · lo dudoso NACE DESMARCADO y se lee primero;
//   · quien aplica es una persona, y queda en el registro que vino de IA.
//
// Se ve como la IA del portal a propósito (misma estrellita, mismos puntos de
// espera, mismo descargo): el equipo no tiene que aprender dos lenguajes. Lo que
// NO se comparte es la doctrina — esto es del admin; en el portal la IA sigue
// proponiendo sin escribir.

interface Props<T> {
  /** Qué propone, en las palabras de la pantalla: «Columnas emparejadas». */
  titulo: string
  propuesta: PropuestaIa<T> | null
  cargando?: boolean
  error?: string | null
  /** true mientras se escribe en la base: bloquea el panel entero. */
  aplicando?: boolean
  /** El verbo del botón. Por defecto «Aplicar». */
  verbo?: string
  onAplicar: (lineas: LineaPropuesta<T>[]) => void
  /** Volver a pedirlo. Solo se pone cuando el fallo es reintentable. */
  onReintentar?: () => void
  onCerrar: () => void
}

export default function PanelPropuestaIa<T>({
  titulo, propuesta, cargando = false, error = null, aplicando = false,
  verbo = 'Aplicar', onAplicar, onReintentar, onCerrar,
}: Props<T>) {
  const lineas = useMemo(
    () => (propuesta ? ordenarParaRevisar(propuesta.lineas) : []),
    [propuesta],
  )
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())

  // Al llegar una propuesta nueva se rehace la selección: lo seguro marcado, lo
  // dudoso no. Conservar la selección anterior arrastraría un «sí» dado a otra
  // línea que ya no existe.
  useEffect(() => {
    setMarcadas(new Set(lineas.filter(l => naceMarcada(l.confianza)).map(l => l.clave)))
  }, [lineas])

  function alternar(clave: string) {
    setMarcadas(prev => {
      const s = new Set(prev)
      if (s.has(clave)) s.delete(clave); else s.add(clave)
      return s
    })
  }

  const todas = lineas.length > 0 && marcadas.size === lineas.length
  const seleccionadas = lineas.filter(l => marcadas.has(l.clave))

  return (
    <div className="iap">
      <div className="iap-head">
        <span className="iap-title">
          <IaSparkle size={15} strokeWidth={2} />
          {titulo}
          {!cargando && lineas.length > 0 && (
            <span className="iap-count">· {marcadas.size} de {lineas.length}</span>
          )}
        </span>
        <span className="iap-head-actions">
          {!cargando && lineas.length > 0 && (
            <button
              type="button" className="btn btn-ghost btn-xs" disabled={aplicando}
              onClick={() => setMarcadas(todas ? new Set() : new Set(lineas.map(l => l.clave)))}
            >
              {todas ? 'Ninguna' : 'Todas'}
            </button>
          )}
          <button type="button" className="ia-icon-btn" onClick={onCerrar} aria-label="Cerrar" disabled={aplicando}>
            <X size={16} strokeWidth={2} />
          </button>
        </span>
      </div>

      {cargando && (
        <div className="iap-cargando">
          <span className="ia-typing" aria-label="Analizando"><span /><span /><span /></span>
          Analizando…
        </div>
      )}

      {/* El fallo no cierra la puerta: si hay a quién pedírselo otra vez, el botón
          va aquí mismo. Sin `onReintentar` (bolsa agotada, interruptor apagado)
          se queda el mensaje solo, que es lo correcto: eso no se reintenta. */}
      {!cargando && error && (
        <div className="iap-error">
          <span className="iap-error-texto">{error}</span>
          {onReintentar && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onReintentar}>
              <RefreshCw size={14} strokeWidth={2} /> Reintentar
            </button>
          )}
        </div>
      )}

      {!cargando && !error && propuesta && (
        <>
          {propuesta.nota && <p className="iap-nota">{propuesta.nota}</p>}

          {lineas.length === 0
            ? <p className="iap-nota">No hay nada que proponer aquí.</p>
            : (
              <div className="iap-lista">
                {lineas.map(l => {
                  const on = marcadas.has(l.clave)
                  return (
                    <label key={l.clave} className={on ? 'iap-linea' : 'iap-linea iap-linea--off'}>
                      <input
                        type="checkbox" className="iap-check" checked={on} disabled={aplicando}
                        onChange={() => alternar(l.clave)}
                        aria-label={`${verbo}: ${l.titulo}`}
                      />
                      <span className="iap-cuerpo">
                        <span className="iap-linea-head">
                          <span className="iap-linea-titulo">{l.titulo}</span>
                          <span className={`badge ${BADGE_CONFIANZA[l.confianza]}`}>{ETIQUETA_CONFIANZA[l.confianza]}</span>
                        </span>
                        <span className="iap-cambio">
                          {l.antes
                            ? <span className="iap-antes">{l.antes}</span>
                            : <span className="iap-vacio">vacío</span>}
                          <ArrowRight size={13} strokeWidth={2} className="iap-flecha" />
                          <span className="iap-despues">{l.despues}</span>
                        </span>
                        {l.motivo && <span className="iap-motivo">{l.motivo}</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

          <div className="iap-pie">
            <span className="iap-disclaimer">Generado por IA a partir de tus datos · revísalo antes de aplicar.</span>
            <span className="iap-pie-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={onCerrar} disabled={aplicando}>
                Descartar
              </button>
              <button
                type="button" className="btn btn-primary btn-sm"
                disabled={aplicando || seleccionadas.length === 0}
                onClick={() => onAplicar(seleccionadas)}
              >
                {aplicando ? 'Aplicando…' : `${verbo} ${seleccionadas.length}`}
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}
