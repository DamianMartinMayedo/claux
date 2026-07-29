'use client'

// ────────────────────────────────────────────────────────────────────────────
// Elegir artículos del catálogo para un documento. **Varios de una vez.**
//
// Sustituye al `<datalist>` que había, cuyo vínculo con el artículo dependía de que el
// texto del input coincidiera EXACTAMENTE con «CÓDIGO — Nombre»: matizar la descripción
// («… mesa 4», «sin cebolla») rompía el enlace en silencio, y con él el coste congelado
// de la línea, el margen del informe y la CxP automática al proveedor.
//
// Se abre desde la cabecera de Líneas, al lado de «Añadir línea», y no desde cada fila:
// una factura se llena eligiendo cinco artículos, no abriendo cinco veces el mismo
// buscador. Escribir a mano sigue funcionando (con autocompletado), que es lo que
// necesita quien vende algo que no está en el catálogo.
// ────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { ProductoOpcion } from '@/app/actions/portal/ventas'
import { formatearMoneda } from './_ventas-helpers'

interface Props {
  productos: ProductoOpcion[]
  moneda:    string
  /** Almacén elegido para el descuento de stock; sin él no se enseñan existencias. */
  almacenId?: string
  onAnadir:  (elegidos: ProductoOpcion[]) => void
  onCerrar:  () => void
}

const TOPE = 60

export function SelectorArticulo({ productos, moneda, almacenId, onAnadir, onCerrar }: Props) {
  const [q, setQ] = useState('')
  // Orden de selección, no un Set: si el dueño marca tres artículos, las líneas salen en
  // el orden en que los eligió — que es el que tiene en la cabeza.
  const [elegidos, setElegidos] = useState<string[]>([])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return productos.slice(0, TOPE)
    return productos
      .filter(p => p.codigo.toLowerCase().includes(t) || p.nombre.toLowerCase().includes(t))
      .slice(0, TOPE)
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
      {/* `modal-fixed-actions`: con un catálogo largo, «Añadir» no puede quedarse al final
          de un scroll de cien filas — el pie se queda a la vista y scrollea solo la lista. */}
      <div className="modal modal-lg modal-fixed-actions" role="dialog" aria-modal onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Elegir del catálogo</h2>
            <p className="text-xs-muted mt-1">
              Marca todo lo que vendes y se añade de una vez, una línea por artículo.
            </p>
          </div>
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
                ? 'Tu catálogo está vacío. Escribe las líneas a mano.'
                : 'Ningún artículo coincide.'}
            </div>
          ) : (
            <div className="table-wrapper mt-3">
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-check"></th>
                    <th>Código</th>
                    <th>Artículo</th>
                    <th className="col-num">Precio</th>
                    {almacenId && <th className="col-num">Existencias</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map(p => {
                    const precio = p.precios[moneda]
                    const marcado = elegidos.includes(p.producto_id)
                    return (
                      <tr
                        key={p.producto_id}
                        className="table-row-clickable"
                        onClick={() => alternar(p.producto_id)}
                      >
                        <td className="col-check">
                          <input
                            type="checkbox" className="row-check" checked={marcado}
                            onChange={() => alternar(p.producto_id)}
                            onClick={e => e.stopPropagation()}
                            aria-label={`Añadir ${p.nombre}`}
                          />
                        </td>
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
          <button type="button" className="btn btn-primary" onClick={confirmar} disabled={elegidos.length === 0}>
            {elegidos.length <= 1 ? 'Añadir' : `Añadir ${elegidos.length} artículos`}
          </button>
        </div>
      </div>
    </div>
  )
}
