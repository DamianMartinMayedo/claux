import Link from 'next/link'
import type { ReactNode } from 'react'
import type { AgendaResumen } from '@/app/actions/portal/dashboard'
import { formatFecha } from './format'
import CargaSemanalChart from './charts/CargaSemanalChart'

interface Props {
  data: AgendaResumen
  titulo: string          // etiqueta del sector (Reservas / Citas …)
  ruta: string            // /portal/reservas | /portal/citas
  unidad: string          // 'reserva' | 'cita' (para textos)
  mostrarPersonas: boolean
  icon: ReactNode
  tone: string            // clase metric-icon-* para el color del icono
}

export default function AgendaWidget({ data, titulo, ruta, unidad, mostrarPersonas, icon, tone }: Props) {
  const prox = data.proxima
  const proxValor = prox ? (prox.hora ?? formatFecha(prox.fecha)) : '—'

  return (
    <section className="card dash-card-md">
      <div className="card-header">
        <div className="dash-card-head">
          <span className={`dash-card-icon ${tone}`}>{icon}</span>
          <h2 className="card-title">{titulo}</h2>
        </div>
        <Link href={ruta} className="btn btn-secondary btn-sm">Ver {titulo.toLowerCase()}</Link>
      </div>

      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Hoy</span>
          <span className="dash-kpi-value">{data.hoyCount}</span>
        </div>
        {mostrarPersonas && (
          <div className="dash-kpi">
            <span className="dash-kpi-label">Personas hoy</span>
            <span className="dash-kpi-value">{data.personasHoy}</span>
          </div>
        )}
        <div className="dash-kpi">
          <span className="dash-kpi-label">Próxima</span>
          <span className="dash-kpi-value dash-kpi-value-sm">{proxValor}</span>
        </div>
      </div>

      <h3 className="dash-subtitle">Carga · próximos 7 días</h3>
      <CargaSemanalChart serie={data.serie7} unidad={unidad} />

      <h3 className="dash-subtitle">
        <span>Hoy</span>
        <Link href={ruta} className="btn-ghost-xs">Ver todas</Link>
      </h3>
      {data.hoyLista.length === 0 ? (
        <p className="dash-muted">Sin {unidad}s para hoy.</p>
      ) : (
        <ul className="dash-list">
          {data.hoyLista.map((r, i) => (
            <li key={i} className="dash-list-item">
              <span className="dash-list-main">
                <span className="dash-list-title">{r.hora ?? '—'} · {r.nombre}</span>
                {mostrarPersonas && (
                  <span className="dash-list-meta">{r.personas} persona{r.personas !== 1 ? 's' : ''}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
