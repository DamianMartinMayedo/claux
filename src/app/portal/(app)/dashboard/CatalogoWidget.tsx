import Link from 'next/link'
import { QrCode } from 'lucide-react'
import type { CatalogoResumen } from '@/app/actions/portal/dashboard'

// Catálogo / menú público en el dashboard.
//
// La cifra que importa NO es cuántos platos hay —eso no pide ninguna acción—,
// sino qué está estropeando la carta que ve el cliente final: un plato sin precio
// o sin foto en una carta publicada es una venta que no ocurre.
//
// `etiqueta` viene del sector (Menú / Carta / Catálogo): el dueño de un
// restaurante no llama «catálogo» a su carta.
export default function CatalogoWidget({ data, etiqueta }: { data: CatalogoResumen; etiqueta: string }) {
  const porArreglar = data.sinFoto + data.sinPrecio

  return (
    <section className="card dash-card-sm">
      <div className="card-header">
        <div className="dash-card-head">
          <span className="dash-card-icon metric-icon-teal"><QrCode size={18} /></span>
          <h2 className="card-title">{etiqueta}</h2>
        </div>
        <Link href="/portal/catalogo" className="btn btn-secondary btn-sm">Ver {etiqueta.toLowerCase()}</Link>
      </div>

      {data.vacio ? (
        <p className="dash-muted">
          Aún no has añadido nada. Crea tu {etiqueta.toLowerCase()} y compártelo con un QR.
        </p>
      ) : (
        <>
          <div className="dash-kpis">
            <div className="dash-kpi">
              <span className="dash-kpi-label">Publicados</span>
              <span className="dash-kpi-value">{data.items}</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi-label">Por arreglar</span>
              <span className={`dash-kpi-value ${porArreglar > 0 ? 'is-neg' : 'is-pos'}`}>{porArreglar}</span>
            </div>
          </div>

          {porArreglar === 0 ? (
            <p className="dash-muted">
              Todo con foto y precio.
              {data.agotados > 0 && ` ${data.agotados} marcado${data.agotados === 1 ? '' : 's'} como agotado.`}
            </p>
          ) : (
            <ul className="dash-list">
              {data.sinFoto > 0 && (
                <li className="dash-list-item">
                  <span className="dash-list-main"><span className="dash-list-title">Sin foto</span></span>
                  <span className="dash-list-amount is-neg">{data.sinFoto}</span>
                </li>
              )}
              {data.sinPrecio > 0 && (
                <li className="dash-list-item">
                  <span className="dash-list-main"><span className="dash-list-title">Sin precio</span></span>
                  <span className="dash-list-amount is-neg">{data.sinPrecio}</span>
                </li>
              )}
              {data.agotados > 0 && (
                <li className="dash-list-item">
                  <span className="dash-list-main"><span className="dash-list-title">Agotados</span></span>
                  <span className="dash-list-amount">{data.agotados}</span>
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
