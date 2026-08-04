'use client'

// ────────────────────────────────────────────────────────────────────────────
// Elegir productos del catálogo para una compra. **Varios de una vez.**
//
// Sustituye al `<datalist>` que había, cuyo vínculo con el producto dependía de que
// el texto del input coincidiera EXACTAMENTE con «CÓDIGO — Nombre». En cuanto el
// dueño matizaba la descripción, el enlace se rompía en silencio y la línea NO movía
// stock al confirmar: la compra se cargaba como gasto pero las existencias no subían.
// Es la misma trampa que la mig. 151 retiró en Ventas.
//
// Escribir a mano una línea suelta sigue valiendo (para algo que no está en el
// catálogo); esto es el atajo para lo que sí está, con su último coste ya puesto.
// ────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { ProductoCompra } from '@/app/actions/portal/compras'

const TOPE = 60

export function SelectorProductoCompra({
  productos, moneda, onAnadir, onCerrar,
}: {
  productos: ProductoCompra[]
  moneda:    string
  onAnadir:  (elegidos: ProductoCompra[]) => void
  onCerrar:  () => void
}) {
  const [q, setQ] = useState('')
  const [elegidos, setElegidos] = useState<string[]>([])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    const base = !t
      ? productos
      : productos.filter(p => p.codigo.toLowerCase().includes(t) || p.nombre.toLowerCase().includes(t))
    return base.slice(0, TOPE)
  }, [productos, q])

  function alternar(id: string) {
    setElegidos(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function confirmar() {
    const porId = new Map(productos.map(p => [p.producto_id, p]))
    onAnadir(elegidos.map(id => porId.get(id)!).filter(Boolean))
    onCerrar()
  }

  return (
    <div className="modal-backdrop open" onClick={onCerrar}>
      <div className="modal modal-lg modal-fixed-actions" role="dialog" aria-modal onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Elegir del catálogo</h2>
            <p className="text-xs-muted mt-1">Marca todo lo que compras y se añade de una vez, con su último coste.</p>
          </div>
          <button type="button" className="modal-close" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        <div className="modal-body">
          <div className="ter-search-wrap">
            <Search size={14} strokeWidth={2} />
            <input className="ter-search" type="search" autoFocus
              aria-label="Buscar producto por código o nombre"
              placeholder="Código o nombre…"
              value={q} onChange={e => setQ(e.target.value)} />
          </div>

          {filtrados.length === 0 ? (
            <div className="ven-empty-mini mt-3">
              {productos.length === 0
                ? 'Tu catálogo está vacío. Escribe las líneas a mano.'
                : 'Ningún producto coincide.'}
            </div>
          ) : (
            <div className="table-wrapper mt-3">
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-check"></th>
                    <th>Código</th>
                    <th>Producto</th>
                    <th className="col-num">Último coste</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map(p => {
                    const coste = p.costos[moneda]
                    const marcado = elegidos.includes(p.producto_id)
                    return (
                      <tr key={p.producto_id} className="table-row-clickable" onClick={() => alternar(p.producto_id)}>
                        <td className="col-check">
                          <input type="checkbox" className="row-check" checked={marcado}
                            onChange={() => alternar(p.producto_id)}
                            onClick={e => e.stopPropagation()}
                            aria-label={`Añadir ${p.nombre}`} />
                        </td>
                        <td data-label="Código">{p.codigo}</td>
                        <td data-label="Producto"><span className="cell-clamp">{p.nombre}</span></td>
                        <td data-label="Último coste" className="col-num">
                          {coste != null
                            ? coste.toLocaleString('es-ES', { maximumFractionDigits: 2 })
                            : <span className="text-muted">sin coste en {moneda}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {productos.length > filtrados.length && (
            <p className="input-hint mt-2">Se enseñan los {filtrados.length} primeros. Escribe para acotar.</p>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={confirmar} disabled={elegidos.length === 0}>
            {elegidos.length <= 1 ? 'Añadir' : `Añadir ${elegidos.length} productos`}
          </button>
        </div>
      </div>
    </div>
  )
}
