'use client'

import type { ContextoDocumentoData } from '@/app/actions/portal/ventas'
import type { LineaInput }            from './_ventas-helpers'

interface Props {
  contexto:    ContextoDocumentoData
  empresa_id:  string
  lineas:      LineaInput[]
  descuenta:   boolean
  almacen_id:  string
  onDescuentaChange: (v: boolean) => void
  onAlmacenChange:   (v: string)  => void
}

/**
 * «Descontar del inventario al emitir» (mig. 150). Decisión POR FACTURA, no
 * automatismo: no toda factura mueve existencias (servicios, alquileres, una reventa
 * que no pasa por almacén).
 *
 * El bloque **no existe** si el cliente no tiene Inventario o si ninguna línea es de
 * producto físico: enseñar un check que no puede hacer nada es peor que no enseñarlo.
 * Con un solo almacén activo, el selector tampoco se pinta — se da por elegido.
 *
 * El aviso de existencias AVISA, no bloquea: facturar es un hecho comercial y un stock
 * mal cuadrado no puede impedir emitir (mismo criterio que el cierre de caja, que
 * permite negativos a propósito).
 */
export function DescuentoStock({
  contexto, empresa_id, lineas, descuenta, almacen_id,
  onDescuentaChange, onAlmacenChange,
}: Props) {
  if (!contexto.hay_inventario) return null

  const fisicos = new Map(
    contexto.productos.filter(p => p.tipo === 'PRODUCTO').map(p => [p.producto_id, p]),
  )
  // Cantidad pedida por producto físico, sumando las líneas repetidas: dos líneas del
  // mismo artículo agotan el mismo stock, y avisar por línea suelta se queda corto.
  const pedido = new Map<string, number>()
  for (const l of lineas) {
    if (!l.producto_id || !fisicos.has(l.producto_id)) continue
    pedido.set(l.producto_id, (pedido.get(l.producto_id) ?? 0) + (Number(l.cantidad) || 0))
  }
  if (pedido.size === 0) return null

  const almacenes = contexto.almacenes.filter(a => a.empresa_id === empresa_id)
  if (almacenes.length === 0) return null
  const unico = almacenes.length === 1
  const elegido = almacen_id || almacenes[0].almacen_id

  const faltantes = descuenta
    ? [...pedido.entries()]
        .map(([producto_id, cantidad]) => {
          const p    = fisicos.get(producto_id)!
          const hay  = p.stock[elegido] ?? 0
          return { nombre: p.nombre, unidad: p.unidad, cantidad, hay }
        })
        .filter(f => f.cantidad > f.hay)
    : []

  return (
    <div className="ven-form-section">
      <span className="ven-form-section-title">Inventario</span>

      <label className="filtro-toggle">
        <input
          type="checkbox"
          className="row-check"
          checked={descuenta}
          onChange={e => {
            onDescuentaChange(e.target.checked)
            if (e.target.checked && !almacen_id) onAlmacenChange(elegido)
          }}
        />
        Descontar del inventario al emitir
      </label>

      <p className="input-hint mt-2">
        Solo bajan las líneas <strong>enlazadas a un artículo del catálogo</strong> — las que
        llevan su código al final del campo; una línea escrita a mano no mueve existencias.
        El coste de esos productos ya está en tus Compras: esto solo mueve existencias,
        no vuelve a contar el gasto. El stock baja al <strong>emitir</strong> la factura,
        no al guardar el borrador, y vuelve si la anulas.
      </p>

      {descuenta && !unico && (
        <div className="input-group mt-3">
          <label htmlFor="factura-almacen">Almacén de salida <span className="required">*</span></label>
          <select
            id="factura-almacen"
            className="input"
            value={elegido}
            onChange={e => onAlmacenChange(e.target.value)}
          >
            {almacenes.map(a => (
              <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>
            ))}
          </select>
        </div>
      )}

      {descuenta && unico && (
        <p className="input-hint mt-2">Sale de <strong>{almacenes[0].nombre}</strong>.</p>
      )}

      {faltantes.length > 0 && (
        <p className="input-hint-warning mt-3">
          No hay existencias para todo lo que vendes:{' '}
          {faltantes.map(f => `${f.nombre} (pides ${f.cantidad} ${f.unidad}, hay ${f.hay})`).join('; ')}.
          Se emite igual y el stock queda en negativo — la venta ya ocurrió.
        </p>
      )}
    </div>
  )
}
