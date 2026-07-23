'use client'

import { useMemo, useState, useTransition } from 'react'
import type { CSSProperties } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { guardarBasicos, type DossierBasico } from '@/app/actions/portal/dossier'
import { proyectar, type FilaSerie } from '@/lib/dossier/snapshot'
import { geometriaGrafico } from '@/lib/dossier/grafico'

// Una sola palanca: el % de crecimiento mensual. La base de la proyección es la
// MEDIA de los últimos 3 meses (lo decide `proyectar`), no el último — un apagón
// o un diciembre bueno no deben torcer la recta.

const nf = new Intl.NumberFormat('es', { maximumFractionDigits: 0 })

export default function PasoCrecimiento({
  dossier, serie, simbolo, onGuardado,
}: {
  dossier: DossierBasico
  serie: FilaSerie[]
  simbolo: string
  onGuardado?: () => void
}) {
  const [pct, setPct] = useState(String(dossier.crecimiento_mensual_pct ?? 0))
  const [pending, startTransition] = useTransition()

  const valor = Number(pct) || 0
  const historico = useMemo(() => serie.map(f => f.ingresos), [serie])
  const futuro = useMemo(() => proyectar(serie, valor, 12), [serie, valor])
  const g = useMemo(() => geometriaGrafico(historico, futuro), [historico, futuro])

  const ultimoReal = historico.length > 0 ? historico[historico.length - 1] : 0
  const ultimoProy = futuro.length > 0 ? futuro[futuro.length - 1] : 0

  // Relleno del slider (rango −10…30 → 40 de recorrido) como % para pintar la pista.
  const RANGO_MIN = -10, RANGO_MAX = 30
  const fill = ((Math.min(RANGO_MAX, Math.max(RANGO_MIN, valor)) - RANGO_MIN) / (RANGO_MAX - RANGO_MIN)) * 100
  // X de la frontera real→proyección, para el divisor vertical del gráfico.
  const fronteraX = historico.length > 0 && futuro.length > 0 ? g.puntos[historico.length - 1]?.x ?? null : null

  function guardar() {
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      fd.set('crecimiento_mensual_pct', String(valor))
      const res = await guardarBasicos(fd)
      await ld.dismiss()
      if (res.ok) { toastSuccess('Crecimiento guardado'); onGuardado?.() }
      else toastError(res.error || 'No se pudo guardar')
    })
  }

  return (
    <section className="card">
      <div className="dos-body">
        <h2 className="dos-section-title">Crecimiento</h2>
        <p className="dos-section-hint">
          Es tu estimación, no una promesa; el inversor la verá marcada como proyección.
        </p>

        {serie.length === 0 ? (
          <p className="dos-vacio">Carga tus números primero y aquí verás la proyección.</p>
        ) : (
          <>
            <div className="dos-campo">
              <label className="dos-label" htmlFor="dos-crecimiento">¿Cuánto esperas crecer cada mes?</label>
              <div className="dos-pct-row">
                <input
                  id="dos-crecimiento" type="range" className="dos-range"
                  min={RANGO_MIN} max={RANGO_MAX} step={1}
                  value={valor} onChange={e => setPct(e.target.value)}
                  style={{ '--dos-fill': `${fill}%` } as CSSProperties}
                />
                <div className="dos-pct-campo">
                  <input
                    type="number" inputMode="numeric" className="input dos-input dos-pct-input"
                    value={pct} onChange={e => setPct(e.target.value)}
                    min={RANGO_MIN} max={RANGO_MAX} step={1} aria-label="Crecimiento mensual en por ciento"
                  />
                  <span className="dos-pct-simbolo">%</span>
                </div>
              </div>
            </div>

            <figure className="dos-grafico">
              <svg
                viewBox={`0 0 ${g.ancho} ${g.alto}`} className="dos-grafico-svg"
                role="img" preserveAspectRatio="none"
                aria-label={`Ingresos: ${nf.format(ultimoReal)} ${simbolo} el último mes real, ${nf.format(ultimoProy)} ${simbolo} proyectado a 12 meses con ${valor} % mensual`}
              >
                <defs>
                  <linearGradient id="dosAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop className="dos-grad-top" offset="0%" />
                    <stop className="dos-grad-bot" offset="100%" />
                  </linearGradient>
                </defs>
                {g.areaHistorico && <path d={g.areaHistorico} className="dos-grafico-area" />}
                {/* Divisor real → proyección: deja claro dónde acaban los datos. */}
                {fronteraX != null && (
                  <line x1={fronteraX} y1={0} x2={fronteraX} y2={g.alto} className="dos-grafico-divisor" />
                )}
                {g.pathHistorico && <path d={g.pathHistorico} className="dos-grafico-linea" />}
                {/* Discontinuo: lo estimado NUNCA se pinta igual que lo real. */}
                {g.pathProyectado && <path d={g.pathProyectado} className="dos-grafico-linea dos-grafico-proy" />}
              </svg>
              <figcaption className="dos-grafico-leyenda">
                <span className="dos-leyenda-item"><span className="dos-leyenda-marca" /> Real ({serie.length} {serie.length === 1 ? 'mes' : 'meses'})</span>
                <span className="dos-leyenda-item"><span className="dos-leyenda-marca dos-leyenda-proy" /> Proyección (12 meses)</span>
              </figcaption>
            </figure>

            <div className="dos-resumen">
              <div className="dos-resumen-item">
                <span className="dos-resumen-label">Último mes real</span>
                <span className="dos-resumen-valor">{nf.format(ultimoReal)} {simbolo}</span>
              </div>
              <div className="dos-resumen-item">
                <span className="dos-resumen-label">Proyectado al mes 12</span>
                <span className="dos-resumen-valor">{nf.format(ultimoProy)} {simbolo}</span>
              </div>
            </div>

            <div className="dos-acciones">
              <button className="btn btn-primary" onClick={guardar} disabled={pending}>
                {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Save size={14} strokeWidth={2.5} />}
                Guardar crecimiento
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
