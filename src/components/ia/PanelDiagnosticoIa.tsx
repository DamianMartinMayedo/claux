'use client'

import Link from 'next/link'
import { ArrowRight, RefreshCw, X } from 'lucide-react'
import IaSparkle from './IaSparkle'

// ── Lo que la IA solo LEE ────────────────────────────────────────────────────
// El hermano de `PanelPropuestaIa` para las funciones que no escriben nada: el
// muro de filas rechazadas del importador, el revisor de presupuestos y lo que
// venga después con la misma naturaleza. Se ve igual —misma cabecera, mismos
// puntos de espera, mismo descargo— y por eso comparte la familia `.iap-*`.
//
// Lo que NO tiene, y es la diferencia: casillas, botón de aplicar y confianza por
// línea. Aquí no hay nada que marcar; ofrecer un botón de aplicar sobre algo que
// no cambia nada sería el peor de los ruidos.
//
// Las cuatro partes de una línea son las mismas en los dos usos —un chip a la
// izquierda, qué pasa, qué hacer y en qué se apoya—, así que van con nombres
// genéricos y cada pantalla decide qué pone en cada hueco: «212 filas» o
// «Importante», el motivo técnico del importador o el caso real que sostiene un
// aviso.

export interface LineaDiagnostico {
  clave:    string
  /** El chip de la izquierda: «212 filas», «Importante». */
  marca:    string
  /** Qué pasa, en cristiano. */
  titulo:   string
  /** Qué hacer con ello. Va destacado: es lo accionable. */
  detalle?: string
  /** En qué se apoya: el motivo técnico, el caso real, el dato de origen. */
  apoyo?:   string
  /**
   * A dónde se va a hacerlo. Lo pone SIEMPRE quien llama, sacándolo de un dato
   * suyo: una ruta escrita por un modelo lleva a una pantalla que no existe.
   */
  enlace?:  { href: string; texto: string }
}

interface Props {
  titulo: string
  lineas: LineaDiagnostico[] | null
  cargando?: boolean
  error?: string | null
  /** Qué se dice mientras piensa. Por defecto, lo genérico. */
  cargandoTexto?: string
  /** Qué se dice cuando no hay nada que señalar — que a veces es la respuesta buena. */
  vacio?: string
  /** El descargo del pie: dónde comprobarlo. */
  descargo?: string
  /** Volver a pedirlo. Solo se pone cuando el fallo es reintentable. */
  onReintentar?: () => void
  onCerrar: () => void
}

export default function PanelDiagnosticoIa({
  titulo, lineas, cargando = false, error = null,
  cargandoTexto = 'Analizando…',
  vacio = 'No hay nada que señalar.',
  descargo = 'Generado por IA a partir de tus datos · compruébalo antes de darlo por bueno.',
  onReintentar, onCerrar,
}: Props) {
  return (
    <div className="iap">
      <div className="iap-head">
        <span className="iap-title">
          <IaSparkle size={15} strokeWidth={2} />
          {titulo}
        </span>
        <span className="iap-head-actions">
          <button type="button" className="ia-icon-btn" onClick={onCerrar} aria-label="Cerrar">
            <X size={16} strokeWidth={2} />
          </button>
        </span>
      </div>

      {cargando && (
        <div className="iap-cargando">
          <span className="ia-typing" aria-label="Analizando"><span /><span /><span /></span>
          {cargandoTexto}
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

      {!cargando && !error && lineas && (
        <>
          {lineas.length === 0
            ? <p className="iap-nota">{vacio}</p>
            : (
              <div className="iap-lista">
                {lineas.map(l => (
                  <div key={l.clave} className="iap-diag">
                    <span className="iap-diag-marca">{l.marca}</span>
                    <span className="iap-cuerpo">
                      <span className="iap-linea-titulo">{l.titulo}</span>
                      {l.detalle && <span className="iap-diag-detalle">{l.detalle}</span>}
                      {l.apoyo && <span className="iap-motivo">{l.apoyo}</span>}
                      {l.enlace && (
                        <Link className="iap-diag-enlace" href={l.enlace.href}>
                          {l.enlace.texto} <ArrowRight size={13} strokeWidth={2} />
                        </Link>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          <div className="iap-pie">
            <span className="iap-disclaimer">{descargo}</span>
          </div>
        </>
      )}
    </div>
  )
}
