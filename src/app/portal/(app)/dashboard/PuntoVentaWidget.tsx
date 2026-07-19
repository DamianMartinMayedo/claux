import Link from 'next/link'
import { Store } from 'lucide-react'
import type { PuntoVentaResumen } from '@/app/actions/portal/dashboard'
import { formatFecha } from './format'

// Importes por moneda en una línea: distintas monedas no se suman en un número.
// Mismo criterio que el KPI «Caja» de Contabilidad.
const porMoneda = (items: { moneda: string; total: number }[]) =>
  items.length
    ? items.map(v => `${v.total.toLocaleString('es-ES', { maximumFractionDigits: 0 })} ${v.moneda}`).join(' · ')
    : '—'

export default function PuntoVentaWidget({ data }: { data: PuntoVentaResumen }) {
  return (
    <section className="card dash-card-sm">
      <div className="card-header">
        <div className="dash-card-head">
          <span className="dash-card-icon metric-icon-teal"><Store size={18} /></span>
          <h2 className="card-title">Punto de venta</h2>
        </div>
        <Link href="/portal/caja/operaciones" className="btn btn-secondary btn-sm">Ver operaciones</Link>
      </div>

      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Ventas de hoy</span>
          <span className="dash-kpi-value dash-kpi-value-sm">{porMoneda(data.ventasHoy)}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Sin sincronizar</span>
          <span className={`dash-kpi-value ${data.sinSincronizar > 0 ? 'is-neg' : 'is-pos'}`}>
            {data.sinSincronizar}
          </span>
        </div>
      </div>

      {data.puntos.length === 0 ? (
        <p className="dash-muted">
          Aún no tienes puntos de venta.{' '}
          <Link href="/portal/caja" className="link-primary">Crea el primero</Link>.
        </p>
      ) : (
        <ul className="dash-list">
          {data.puntos.map((p, i) => (
            <li key={i} className="dash-list-item">
              <span className="dash-list-main">
                <span className="dash-list-title">{p.nombre}</span>
                <span className="dash-list-meta">
                  {/* El turno sin cerrar manda sobre la última sincronización: mientras
                      siga abierto no hay cierre, y sin cierre no hay ingreso en
                      Tesorería ni salida de stock. Es lo que hay que ir a resolver. */}
                  {p.turnoAbiertoDesde
                    ? `Turno abierto desde el ${formatFecha(p.turnoAbiertoDesde)}`
                    : p.ultimaSync
                      ? `Sincronizado ${formatFecha(p.ultimaSync)}`
                      : 'Nunca ha sincronizado'}
                </span>
              </span>
              <span className={`dash-list-amount${p.syncHoy ? '' : ' is-neg'}`}>
                {porMoneda(p.ventasHoy)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
