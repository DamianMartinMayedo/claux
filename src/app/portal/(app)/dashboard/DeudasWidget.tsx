import Link from 'next/link'
import { ArrowLeftRight } from 'lucide-react'
import type { DeudasResumen, DeudasLado } from '@/app/actions/portal/dashboard'
import { formatMoneda } from './format'

// Cobros y pagos en el dashboard.
//
// Estos datos YA se calculaban (`resumenDeudas`) y no se pintaban en ninguna
// parte: solo los leía la IA. «Quién te debe dinero y lleva X días de retraso» es
// lo más accionable que tiene un ERP, y estaba invisible.
//
// Lo que manda aquí es lo VENCIDO, no el total: un saldo pendiente que aún no ha
// llegado a su fecha no es un problema, es el negocio funcionando. Por eso la
// barra mide la parte vencida sobre el total, y no hay gráfico de evolución: esto
// se mira para actuar hoy, no para ver una tendencia.

function Lado({ titulo, lado, ruta, tono }: {
  titulo: string; lado: DeudasLado; ruta: string; tono: 'cobrar' | 'pagar'
}) {
  const conSaldo = lado.por_moneda.filter(m => Math.abs(m.total) > 0.005)
  if (conSaldo.length === 0) return null

  return (
    <div className="dash-deuda-lado">
      <div className="dash-deuda-head">
        <span className="dash-deuda-titulo">{titulo}</span>
        <Link href={ruta} className="dash-deuda-link">Ver</Link>
      </div>

      {conSaldo.map(m => {
        // Proporción vencida: el ancho es un dato de runtime, así que va como
        // custom property y la clase la consume (nunca estilo inline).
        const pct = m.total > 0.005 ? Math.min(100, Math.round((m.vencido / m.total) * 100)) : 0
        return (
          <div key={m.moneda} className="dash-deuda-moneda">
            <div className="dash-deuda-cifras">
              <span className="dash-deuda-total">{formatMoneda(m.total, m.moneda)}</span>
              {m.vencido > 0.005 && (
                <span className="dash-deuda-vencido">{formatMoneda(m.vencido, m.moneda)} vencido</span>
              )}
            </div>
            <div
              className={`dash-deuda-barra is-${tono}`}
              style={{ '--vencido': `${pct}%` } as React.CSSProperties}
              role="img"
              aria-label={`${pct}% vencido`}
            />
          </div>
        )
      })}

      {lado.top.length > 0 && (
        <ul className="dash-deuda-top">
          {lado.top.slice(0, 3).map((t, i) => (
            <li key={i} className="dash-deuda-fila">
              <span className="dash-deuda-nombre">{t.nombre}</span>
              <span className="dash-deuda-saldo">
                {formatMoneda(t.saldo, t.moneda)}
                {t.dias_vencido_max > 0 && (
                  <em className="dash-deuda-dias">{t.dias_vencido_max} d</em>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function DeudasWidget({ data }: { data: DeudasResumen }) {
  const hayCobrar = data.cobrar.por_moneda.some(m => Math.abs(m.total) > 0.005)
  const hayPagar  = data.pagar.por_moneda.some(m => Math.abs(m.total) > 0.005)

  return (
    <section className="card dash-card-sm">
      <div className="card-header">
        <div className="dash-card-head">
          <span className="dash-card-icon metric-icon-rose"><ArrowLeftRight size={18} /></span>
          <h2 className="card-title">Cobros y pagos</h2>
        </div>
      </div>

      {!hayCobrar && !hayPagar ? (
        <p className="dash-muted">No hay nada pendiente de cobrar ni de pagar.</p>
      ) : (
        <div className="dash-deudas">
          <Lado titulo="Te deben"  lado={data.cobrar} ruta="/portal/cxc" tono="cobrar" />
          <Lado titulo="Tú debes"  lado={data.pagar}  ruta="/portal/cxp" tono="pagar" />
        </div>
      )}
    </section>
  )
}
