import { Coins, AlertTriangle } from 'lucide-react'
import type { TasasResumen, FuenteTasa } from '@/app/actions/portal/dashboard'
import TasasActualizar from './TasasActualizar'

// Tasas de cambio en el dashboard.
//
// Acompaña a Cobros y pagos porque es la otra mitad de la misma historia: TODO lo
// que el dashboard consolida —ventas, gastos, deudas— pasa por estas tasas. Una
// tasa vieja no da error: da un número creíble y equivocado, y con la volatilidad
// del cambio en Cuba eso pasa en días, no en meses.
//
// Muestra los PARES tal como están en Monedas (EUR→CUP, USD→CUP…), con su fuente
// y su fecha —una versión compacta de esa pantalla—, no una derivación contra una
// moneda base: es lo que el dueño reconoce y va a ir a corregir.

// Mismos nombres que en Monedas (MonedasView): una sola forma de llamar a cada
// fuente en todo el portal.
const FUENTE_LABEL: Record<FuenteTasa, string> = {
  EL_TOQUE:    'El Toque',
  FRANKFURTER: 'Frankfurter',
  MANUAL:      'Manual',
}

// A partir de aquí la tasa ya no representa el mercado. Criterio de producto para
// la volatilidad cubana, no un número mágico del cambio: quincena.
const DIAS_VIEJA = 15

function fmtTasa(n: number): string {
  // Las tasas van de 0,004 (CUP→USD) a cientos (USD→CUP): con dos decimales fijos
  // la pequeña se ve como «0,00». Se dan más decimales cuanto más pequeña es.
  const maxDec = n >= 1 ? 2 : 4
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: maxDec })
}

function edad(dias: number | null): string {
  if (dias === null) return 'sin fecha'
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'ayer'
  return `hace ${dias} d`
}

export default function TasasWidget({ data }: { data: TasasResumen }) {
  const sinTasa = data.filas.filter(f => f.tasa === null).length
  const viejas  = data.filas.filter(f => f.tasa !== null && f.dias !== null && f.dias >= DIAS_VIEJA).length

  return (
    <section className="card dash-card-sm">
      <div className="card-header">
        <div className="dash-card-head">
          <span className="dash-card-icon metric-icon-teal"><Coins size={18} /></span>
          <h2 className="card-title dash-card-title-sm">Tasas de cambio</h2>
        </div>
        <TasasActualizar />
      </div>

      <ul className="dash-tasas">
        {data.filas.map(f => {
          const vieja = f.tasa !== null && f.dias !== null && f.dias >= DIAS_VIEJA
          return (
            <li key={`${f.origen}-${f.destino}`} className="dash-tasa">
              <span className="dash-tasa-par">
                <span className="dash-tasa-cod">{f.origen}</span>
                <span className="dash-tasa-flecha" aria-hidden="true">→</span>
                <span className="dash-tasa-cod">{f.destino}</span>
              </span>
              <span className="dash-tasa-valor">
                {f.tasa === null ? <span className="dash-tasa-sin">sin tasa</span> : fmtTasa(f.tasa)}
              </span>
              <span className="dash-tasa-meta">
                {FUENTE_LABEL[f.fuente]}
                {f.tasa !== null && <> · <span className={vieja ? 'is-vieja' : ''}>{edad(f.dias)}</span></>}
              </span>
            </li>
          )
        })}
      </ul>

      {(viejas > 0 || sinTasa > 0) && (
        <p className="dash-tasas-aviso">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            {sinTasa > 0
              ? 'Hay un par sin tasa: lo que esté en esa moneda se cae de los totales.'
              : 'Hay tasas de hace más de dos semanas. Todo lo consolidado se calcula con ellas.'}
          </span>
        </p>
      )}
    </section>
  )
}
