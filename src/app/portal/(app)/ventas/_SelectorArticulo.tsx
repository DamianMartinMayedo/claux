'use client'

// ────────────────────────────────────────────────────────────────────────────
// Elegir un artículo del catálogo para una línea de documento.
//
// Sustituye al `<datalist>` que había, cuyo vínculo con el artículo dependía de que
// el texto del input coincidiera EXACTAMENTE con «CÓDIGO — Nombre»: matizar la
// descripción («… mesa 4», «sin cebolla») rompía el enlace en silencio, y con él el
// coste congelado de la línea, el margen del informe y la CxP automática al proveedor.
// Aquí el `producto_id` se elige una vez y vive aparte de la descripción.
// ────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import { Search }            from 'lucide-react'
import type { ProductoOpcion } from '@/app/actions/portal/ventas'
import { formatearMoneda }     from './_ventas-helpers'

interface Props {
  productos: ProductoOpcion[]
  moneda:    string
  /** Almacén elegido para el descuento de stock; sin él no se enseñan existencias. */
  almacenId?: string
  onElegir:  (p: ProductoOpcion) => void
  onCerrar:  () => void
}

export function SelectorArticulo({ productos, moneda, almacenId, onElegir, onCerrar }: Props) {
  const [q, setQ] = useState('')

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return productos.slice(0, 50)
    return productos
      .filter(p => p.codigo.toLowerCase().includes(t) || p.nombre.toLowerCase().includes(t))
      .slice(0, 50)
  }, [productos, q])

  return (
    <div className="modal-backdrop open" onClick={onCerrar}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Elegir del catálogo</h2>
          <button type="button" className="modal-close" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        <div className="modal-body">
          <div className="ter-search-wrap">
            <Search size={14} strokeWidth={2} />
            <input
              className="ter-search"
              type="search"
              autoFocus
              aria-label="Buscar artículo por código o nombre"
              placeholder="Código o nombre…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>

          {filtrados.length === 0 ? (
            <div className="ven-empty-mini mt-3">
              {productos.length === 0
                ? 'Tu catálogo está vacío. Escribe la línea a mano.'
                : 'Ningún artículo coincide.'}
            </div>
          ) : (
            <div className="table-wrapper mt-3">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Artículo</th>
                    <th className="col-num">Precio</th>
                    {almacenId && <th className="col-num">Existencias</th>}
                    <th className="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map(p => {
                    const precio = p.precios[moneda]
                    return (
                      <tr key={p.producto_id}>
                        <td data-label="Código">{p.codigo}</td>
                        <td data-label="Artículo">{p.nombre}</td>
                        <td data-label="Precio" className="col-num">
                          {precio != null
                            ? formatearMoneda(precio, moneda)
                            : <span className="text-muted">sin tarifa en {moneda}</span>}
                        </td>
                        {almacenId && (
                          <td data-label="Existencias" className="col-num">
                            {p.tipo === 'PRODUCTO'
                              ? `${p.stock[almacenId] ?? 0} ${p.unidad}`
                              : <span className="text-muted">—</span>}
                          </td>
                        )}
                        <td className="col-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => { onElegir(p); onCerrar() }}
                          >
                            Elegir
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {productos.length > filtrados.length && (
            <p className="input-hint mt-2">
              Se enseñan los {filtrados.length} primeros. Escribe para acotar.
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
