'use client'

import type { Nivel } from '@/lib/niveles'
import { importeClaux } from '@/lib/moneda-claux'
import type { ImpactoCliente } from '@/lib/catalogo-precios'

/**
 * A quién le cambia la cuota. Se pinta ANTES de guardar cualquier precio del
 * catálogo, porque ese guardado no toca un número: toca la factura de gente con
 * nombre. Plan §8.2.
 *
 * La fila trae también lo que hay CACHEADO en `clients`. Cuando no coincide con
 * «ahora», es que la caché venía sucia de antes —precios cambiados sin
 * recalcular— y conviene verlo, porque guardar lo va a arreglar de camino.
 *
 * Es LA MISMA fila que calcula `impactoDeCambios`, no una copia: cuando se le
 * añadió la moneda (mig. 225) el duplicado se habría quedado corto en silencio, y
 * esta tabla habría seguido pintando euros con el símbolo del dólar.
 */
export type ImpactoFila = ImpactoCliente

export default function ImpactoPrecios(
  { impacto, nombresNivel }: { impacto: ImpactoFila[]; nombresNivel: Record<Nivel, string> },
) {
  if (!impacto.length) {
    return <p className="text-xs-muted">No le cambia la cuota a ningún cliente.</p>
  }

  const suben = impacto.filter(i => i.despues > i.antes).length
  const bajan = impacto.length - suben

  return (
    <div className="impacto-precios">
      <div className="alert alert-warning">
        <strong className="alert-titulo">Esto cambia la cuota de {impacto.length} cliente{impacto.length !== 1 ? 's' : ''}</strong>
        <span>
          {suben > 0 && `${suben} sube${suben !== 1 ? 'n' : ''}`}
          {suben > 0 && bajan > 0 && ' · '}
          {bajan > 0 && `${bajan} baja${bajan !== 1 ? 'n' : ''}`}
          . Se recalcula al guardar; el cobro siguiente sale con el precio nuevo.
        </span>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Nivel</th>
              <th className="col-num">Ahora</th>
              <th className="col-num">Quedaría</th>
            </tr>
          </thead>
          <tbody>
            {impacto.map(c => (
              <tr key={c.client_id}>
                <td data-label="Cliente">
                  <span className="impacto-cliente">
                    <span className="table-empresa cell-clamp">{c.nombre_empresa}</span>
                    {c.archivado && <span className="badge badge-neutral">Archivado</span>}
                    {c.cacheado !== c.antes && (
                      <span className="badge badge-warning" title={`La ficha dice ${importeClaux(c.cacheado, c.moneda)}`}>
                        caché desfasada
                      </span>
                    )}
                  </span>
                </td>
                <td data-label="Nivel">{nombresNivel[c.nivel]}</td>
                <td data-label="Ahora" className="col-num table-price">{importeClaux(c.antes, c.moneda)}</td>
                <td data-label="Quedaría" className="col-num table-price">
                  <span className={c.despues > c.antes ? 'impacto-sube' : 'impacto-baja'}>
                    {importeClaux(c.despues, c.moneda)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
