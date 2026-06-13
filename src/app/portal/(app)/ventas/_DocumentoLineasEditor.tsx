'use client'

import { useMemo } from 'react'
import {
  AJUSTE_TIPO_LABEL,
  calcularTotales,
  formatearMoneda,
  type AjusteInput,
  type AjusteModo,
  type AjusteTipo,
  type LineaInput,
} from './_ventas-helpers'

interface ProductoOption {
  producto_id: string
  codigo:      string
  nombre:      string
  unidad:      string
  precios:     Record<string, number>
}

interface Props {
  lineas:        LineaInput[]
  ajustes:       AjusteInput[]
  moneda:        string
  productos:     ProductoOption[]
  notas?:              string
  notasInternas?:      string
  onLineasChange:       (v: LineaInput[])  => void
  onAjustesChange:      (v: AjusteInput[]) => void
  onNotasChange?:       (v: string) => void
  onNotasInternasChange?: (v: string) => void
}

export function DocumentoLineasEditor({
  lineas, ajustes, moneda, productos,
  notas, notasInternas,
  onLineasChange, onAjustesChange,
  onNotasChange, onNotasInternasChange,
}: Props) {
  const totales = useMemo(
    () => calcularTotales(lineas, ajustes),
    [lineas, ajustes],
  )

  // ── Líneas ──────────────────────────────────────────────────────────────────
  function addLinea() {
    onLineasChange([
      ...lineas,
      { producto_id: null, descripcion: '', cantidad: 1, precio_unitario: 0, descuento_pct: 0 },
    ])
  }
  function removeLinea(i: number) {
    onLineasChange(lineas.filter((_, idx) => idx !== i))
  }
  function updateLinea(i: number, patch: Partial<LineaInput>) {
    onLineasChange(lineas.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  function handleDescripcionChange(i: number, val: string) {
    // Check if typed value matches a product exactly
    const match = productos.find(p => `${p.codigo} — ${p.nombre}` === val)
    if (match) {
      updateLinea(i, {
        producto_id:     match.producto_id,
        descripcion:     val,
        precio_unitario: match.precios[moneda] ?? lineas[i].precio_unitario ?? 0,
      })
    } else {
      updateLinea(i, { producto_id: null, descripcion: val })
    }
  }

  // ── Ajustes ──────────────────────────────────────────────────────────────────
  function addAjuste(tipo: AjusteTipo) {
    onAjustesChange([
      ...ajustes,
      { tipo, nombre: '', modo: 'PORCENTAJE', valor: 0 },
    ])
  }
  function removeAjuste(i: number) {
    onAjustesChange(ajustes.filter((_, idx) => idx !== i))
  }
  function updateAjuste(i: number, patch: Partial<AjusteInput>) {
    onAjustesChange(ajustes.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }

  function ajustePlaceholder(tipo: AjusteTipo): string {
    if (tipo === 'DESCUENTO') return 'Descuento comercial'
    if (tipo === 'CARGO')     return 'Cargo / flete'
    return 'Nombre del impuesto'
  }

  return (
    <div className="ven-editor">

      {/* ── Líneas ── */}
      <div className="ven-form-section">
        <div className="ven-section-header">
          <span className="ven-form-section-title">Líneas</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addLinea}>
            <IconPlus /> Añadir línea
          </button>
        </div>

        {lineas.length === 0 ? (
          <div className="ven-empty-mini">
            Sin líneas todavía. Añade al menos una para poder guardar.
          </div>
        ) : (
          <div className="ven-lineas-table">
            <div className="ven-lineas-head">
              <div className="ven-col-prod">Producto / descripción</div>
              <div className="ven-col-num">Cant.</div>
              <div className="ven-col-num">Precio</div>
              <div className="ven-col-num">Dto. %</div>
              <div className="ven-col-num">Total</div>
              <div className="ven-col-del"></div>
            </div>

            {lineas.map((l, i) => (
              <div key={i} className="ven-lineas-row">
                {/* Unified product/description field */}
                <div className="ven-col-prod">
                  <input
                    className="input input-sm"
                    type="text"
                    list={`prod-list-${i}`}
                    placeholder="Escribe o selecciona un producto…"
                    value={l.descripcion}
                    onChange={e => handleDescripcionChange(i, e.target.value)}
                  />
                  <datalist id={`prod-list-${i}`}>
                    {productos.map(p => (
                      <option key={p.producto_id} value={`${p.codigo} — ${p.nombre}`} />
                    ))}
                  </datalist>
                </div>

                <div className="ven-col-num">
                  <input
                    className="input input-sm ven-input-num"
                    type="number" min="0" step="0.001"
                    value={l.cantidad}
                    onChange={e => updateLinea(i, { cantidad: parseFloat(e.target.value) || 0 })}
                    onFocus={e => e.target.select()}
                  />
                </div>

                <div className="ven-col-num">
                  <input
                    className="input input-sm ven-input-num"
                    type="number" min="0" step="0.01"
                    value={l.precio_unitario}
                    onChange={e => updateLinea(i, { precio_unitario: parseFloat(e.target.value) || 0 })}
                    onFocus={e => e.target.select()}
                  />
                </div>

                <div className="ven-col-num">
                  <input
                    className="input input-sm ven-input-num"
                    type="number" min="0" max="100" step="0.5"
                    value={l.descuento_pct ?? 0}
                    onChange={e => updateLinea(i, { descuento_pct: parseFloat(e.target.value) || 0 })}
                    onFocus={e => e.target.select()}
                  />
                </div>

                <div className="ven-col-num ven-total-cell">
                  {formatearMoneda(totales.lineas_totales[i] ?? 0, moneda)}
                  {(totales.lineas_descuentos[i] ?? 0) > 0 && (
                    <div className="ven-descuento-hint">
                      −{formatearMoneda(totales.lineas_descuentos[i], moneda)}
                    </div>
                  )}
                </div>

                <div className="ven-col-del">
                  <button
                    type="button"
                    className="ter-action-btn ter-action-danger"
                    onClick={() => removeLinea(i)}
                    title="Eliminar línea"
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Ajustes ── */}
      <div className="ven-form-section">
        <div className="ven-section-header">
          <span className="ven-form-section-title">Descuentos, cargos e impuestos</span>
          <div className="ven-section-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addAjuste('DESCUENTO')}>
              <IconPlus /> Descuento
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addAjuste('CARGO')}>
              <IconPlus /> Cargo
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addAjuste('IMPUESTO')}>
              <IconPlus /> Impuesto
            </button>
          </div>
        </div>

        {ajustes.length === 0 ? (
          <div className="ven-empty-mini">
            Sin ajustes. Los porcentajes se calculan sobre el subtotal de líneas.
          </div>
        ) : (
          <div className="ven-ajustes-list">
            {/* Header row */}
            <div className="ven-ajuste-head">
              <div className="ven-ajh-nombre">Nombre</div>
              <div className="ven-ajh-modo">Modo</div>
              <div className="ven-ajh-valor">Valor</div>
              <div className="ven-ajh-monto">Importe</div>
              <div></div>
            </div>
            {ajustes.map((a, i) => (
              <div
                key={i}
                className={`ven-ajuste-row ven-ajuste-row-${a.tipo.toLowerCase()}`}
              >
                <input
                  className="input input-sm ven-aj-nombre"
                  type="text"
                  placeholder={ajustePlaceholder(a.tipo)}
                  value={a.nombre}
                  onChange={e => updateAjuste(i, { nombre: e.target.value })}
                />
                <select
                  className="input input-sm ven-aj-modo"
                  value={a.modo}
                  onChange={e => updateAjuste(i, { modo: e.target.value as AjusteModo })}
                >
                  <option value="PORCENTAJE">%</option>
                  <option value="MONTO_FIJO">Fijo</option>
                </select>
                <input
                  className="input input-sm ven-input-num ven-aj-valor"
                  type="number" min="0" step="0.01"
                  value={a.valor}
                  onChange={e => updateAjuste(i, { valor: parseFloat(e.target.value) || 0 })}
                  onFocus={e => e.target.select()}
                />
                <div className="ven-aj-monto">
                  <span className={a.tipo === 'DESCUENTO' ? 'ven-monto-neg' : 'ven-monto-pos'}>
                    {a.tipo === 'DESCUENTO' ? '−' : '+'}{formatearMoneda(totales.ajustes_calculados[i] ?? 0, moneda)}
                  </span>
                </div>
                <button
                  type="button"
                  className="ter-action-btn ter-action-danger"
                  onClick={() => removeAjuste(i)}
                  title="Eliminar ajuste"
                >
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Bottom: totales + notas ── */}
      <div className="ven-bottom-row">
        {/* Totales */}
        <div className="ven-totales-resumen">
          <div className="ven-total-row">
            <span>Subtotal</span>
            <strong>{formatearMoneda(totales.subtotal, moneda)}</strong>
          </div>
          {ajustes.map((a, i) => (
            <div key={i} className="ven-total-row ven-total-ajuste">
              <span>{a.tipo === 'DESCUENTO' ? '− ' : '+ '}{a.nombre || AJUSTE_TIPO_LABEL[a.tipo]}</span>
              <span>
                {a.tipo === 'DESCUENTO' ? '−' : '+'} {formatearMoneda(totales.ajustes_calculados[i] ?? 0, moneda)}
              </span>
            </div>
          ))}
          <div className="ven-total-row ven-total-final">
            <span>Total</span>
            <strong>{formatearMoneda(totales.total, moneda)}</strong>
          </div>
        </div>

        {/* Notas públicas */}
        {onNotasChange !== undefined && (
          <div className="ven-notas-inline">
            <label className="ven-notas-label">
              Notas <span className="input-hint-inline">(visibles en el PDF)</span>
            </label>
            <textarea
              className="input input-textarea ven-notas-textarea"
              rows={4}
              value={notas ?? ''}
              onChange={e => onNotasChange(e.target.value)}
              placeholder="Condiciones, garantías, referencias…"
            />
          </div>
        )}
      </div>

      {/* Notas internas — al fondo */}
      {onNotasInternasChange !== undefined && (
        <div className="ven-form-section mt-3">
          <label className="label-secondary">
            Notas internas <span className="input-hint-inline">(no se imprimen)</span>
          </label>
          <textarea
            className="input input-textarea mt-2"
            rows={2}
            value={notasInternas ?? ''}
            onChange={e => onNotasInternasChange(e.target.value)}
            placeholder="Observaciones para uso interno del equipo…"
          />
        </div>
      )}

    </div>
  )
}

function IconPlus() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function IconTrash() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/></svg>
}
