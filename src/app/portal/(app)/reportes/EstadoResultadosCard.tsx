'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import type { ResultadoMoneda, ResultadoAnterior } from '@/app/actions/portal/reportes'
import { construirFilasPL, type FilaPL } from '@/lib/pl/comparar'
import { etiquetaMes } from '@/lib/pl/periodo'
import { formatMonto, formatPct, formatDelta } from './_formato'

// ── Δ contra el período de comparación ───────────────────────────────────────
// El TONO no se deduce del signo: que suban los ingresos es bueno y que suban los
// gastos no. Por eso `bueno` viene en la fila y no se calcula de `n > 0`.

function Delta({ valor, bueno }: { valor: number | null; bueno: 'subir' | 'bajar' }) {
  if (valor == null) return <span className="rep-delta-vacio">—</span>
  const plano = Math.abs(valor) < 0.05
  const sube  = valor > 0
  const tono  = plano ? 'plano' : (sube === (bueno === 'subir') ? 'bien' : 'mal')
  const Icono = plano ? Minus : sube ? ArrowUp : ArrowDown
  // Δ enorme (un neto que pasa de casi-cero a mucho da +99.366%): el porcentaje
  // exacto no informa y no cabe en la columna. Se acota a ±999% y el valor real
  // queda en el `title`.
  const capado = Math.abs(valor) >= 1000
  return (
    <span className={`rep-delta rep-delta-${tono}`} title={capado ? formatDelta(valor) : undefined}>
      <Icono size={10} strokeWidth={3} aria-hidden="true" />
      {capado ? `${sube ? '+' : '−'}999%` : formatDelta(valor)}
    </span>
  )
}

// ── Evolución mensual ────────────────────────────────────────────────────────
// Barras del resultado por mes, no una línea: en 360 px una línea de 3 puntos no
// se lee, y lo que el dueño quiere saber es qué meses ganó y cuáles perdió.

function Evolucion({ meses }: { meses: { mes: string; neto: number }[] }) {
  if (meses.length < 2) return null

  const W = 100, H = 40
  const tope = Math.max(...meses.map(m => Math.abs(m.neto)), 1)
  const paso = W / meses.length
  const ancho = Math.max(paso * 0.62, 1)
  const cero = H / 2

  return (
    <div className="rep-spark">
      <div className="rep-spark-title">Resultado por mes</div>
      <svg
        className="rep-spark-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        role="img" aria-label={`Resultado de ${meses.length} meses, del ${etiquetaMes(meses[0].mes)} al ${etiquetaMes(meses[meses.length - 1].mes)}`}
      >
        <line className="rep-spark-cero" x1="0" y1={cero} x2={W} y2={cero} vectorEffect="non-scaling-stroke" />
        {meses.map((m, i) => {
          const alto = (Math.abs(m.neto) / tope) * (H / 2 - 1)
          const x = i * paso + (paso - ancho) / 2
          return (
            <rect
              key={m.mes}
              className={m.neto >= 0 ? 'rep-spark-pos' : 'rep-spark-neg'}
              x={x} width={ancho}
              y={m.neto >= 0 ? cero - alto : cero}
              height={Math.max(alto, 0.6)}
            >
              <title>{`${etiquetaMes(m.mes)}: ${formatMonto(m.neto)}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="rep-spark-ejes">
        <span>{etiquetaMes(meses[0].mes)}</span>
        <span>{etiquetaMes(meses[meses.length - 1].mes)}</span>
      </div>
    </div>
  )
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────

interface Props {
  r:        ResultadoMoneda
  anterior: ResultadoAnterior | null
  /**
   * Lo decide la PANTALLA, no la card: si alguna moneda tiene con qué comparar,
   * todas pintan las columnas —las que no tienen datos, con «—»—. Si lo decidiera
   * cada card, una crecería dos columnas y su vecina no, y quedarían descuadradas.
   */
  comparando: boolean
  /** Etiqueta de la columna del período comparado, adaptada al rango. */
  labelAnterior: string
}

export default function EstadoResultadosCard({ r, anterior, comparando, labelAnterior }: Props) {
  const [margenAbierto, setMargenAbierto] = useState(false)
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())

  const filas = useMemo(
    () => construirFilasPL(r, comparando ? anterior : null),
    [r, anterior, comparando],
  )

  const toggle = (clave: string) =>
    setAbiertas(prev => {
      const n = new Set(prev)
      if (n.has(clave)) n.delete(clave); else n.add(clave)
      return n
    })

  const Celdas = ({ f }: { f: FilaPL }) => (
    <>
      <span className="rep-t-val">{formatMonto(f.monto)}</span>
      <span className="rep-t-pct">{f.pct != null ? formatPct(f.pct) : ''}</span>
      {comparando && <span className="rep-t-ant">{f.anterior != null ? formatMonto(f.anterior) : '—'}</span>}
      {comparando && <span className="rep-t-delta"><Delta valor={f.variacion} bueno={f.bueno} /></span>}
    </>
  )

  return (
    <div className="rep-card">
      <div className="rep-card-head">
        <span className="rep-moneda">{r.moneda}</span>
        <span className={`rep-neto ${r.neto >= 0 ? 'rep-pos' : 'rep-neg'}`}>{formatMonto(r.neto)}</span>
      </div>
      <div className="rep-card-label">Resultado neto · {formatPct(r.margen_neto_pct)} de los ingresos</div>

      {/* Tabla comparativa: los dos períodos, columna con columna, en CADA
          renglón. Antes la comparación eran chips sueltos sobre los totales, y
          por eso no se entendía: decían que los gastos subían un 70% sin poder
          enseñar cuál de ellos. */}
      <div className={`rep-tabla${comparando ? ' rep-tabla-comp' : ''}`}>
        <div className="rep-t-row rep-t-head">
          <span />
          <span className="rep-t-val">{comparando ? 'Período' : 'Importe'}</span>
          <span className="rep-t-pct">%</span>
          {comparando && <span className="rep-t-ant">{labelAnterior}</span>}
          {comparando && <span className="rep-t-delta">Δ</span>}
        </div>

        {filas.map(f => {
          const conHijos = f.nivel === 'cat' && (f.hijos?.length ?? 0) > 0
          const abierta  = abiertas.has(f.clave)
          return (
            <div key={f.clave} className="rep-t-wrap">
              {conHijos ? (
                <button
                  type="button" className={`rep-t-row rep-t-${f.nivel} rep-t-toggle`}
                  onClick={() => toggle(f.clave)} aria-expanded={abierta}
                >
                  <span className="rep-t-nombre">
                    <ChevronRight size={13} className={`rep-wf-chevron${abierta ? ' is-open' : ''}`} aria-hidden="true" />
                    {f.concepto}
                  </span>
                  <Celdas f={f} />
                </button>
              ) : (
                <div className={`rep-t-row rep-t-${f.nivel}`}>
                  <span className="rep-t-nombre">{f.concepto}</span>
                  <Celdas f={f} />
                </div>
              )}
              {conHijos && abierta && f.hijos!.map(h => (
                <div key={h.clave} className="rep-t-row rep-t-hija">
                  <span className="rep-t-nombre">{h.concepto}</span>
                  <Celdas f={h} />
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <Evolucion meses={r.evolucion} />

      {/* Margen por lo vendido: informativo y SECUNDARIO, así que va plegado.
          Desplegado ocupaba media tarjeta con un párrafo de disclaimer y competía
          visualmente con el waterfall, que es lo que se viene a mirar. */}
      {r.costo_directo > 0 && (
        <div className="rep-extra">
          <button
            type="button" className="rep-extra-toggle"
            onClick={() => setMargenAbierto(v => !v)} aria-expanded={margenAbierto}
          >
            <ChevronRight size={13} className={`rep-wf-chevron${margenAbierto ? ' is-open' : ''}`} aria-hidden="true" />
            Margen por lo vendido
            <span className="rep-extra-valor">{formatMonto(r.margen_unitario)}</span>
          </button>
          {margenAbierto && (
            <>
              <div className="rep-line rep-sub"><span>Ventas</span><span>{formatMonto(r.ventas)}</span></div>
              <div className="rep-line rep-sub"><span>Coste de lo vendido</span><span>−{formatMonto(r.costo_directo)}</span></div>
              <p className="rep-info-nota">
                Informativo: <strong>no se resta del resultado neto</strong>. Es el margen de
                cada artículo o servicio que vendiste, no el de tu período — lo que compras a
                un proveedor ya está arriba, dentro de los gastos.
                {r.costo_sin_proveedor > 0 && ` De este coste, ${formatMonto(r.costo_sin_proveedor)} no tiene proveedor detrás y no ha generado ninguna deuda: si es trabajo de tu gente, su sueldo ya cuenta en los gastos de personal.`}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
