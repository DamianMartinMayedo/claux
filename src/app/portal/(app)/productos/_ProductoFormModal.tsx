'use client'

import { useState, useTransition } from 'react'
import {
  guardarProducto,
  type Producto,
  type Categoria,
  type TipoProducto,
} from '@/app/actions/portal/productos'

// ── Constantes ────────────────────────────────────────────────────────────────

export const MONEDAS_FALLBACK = ['USD']

export const UNIDADES_GRUPOS: { label: string; opciones: string[] }[] = [
  { label: 'General',         opciones: ['unidad', 'pieza', 'par', 'servicio'] },
  { label: 'Tiempo',          opciones: ['hora', 'día', 'semana', 'mes', 'año'] },
  { label: 'Peso',            opciones: ['kg', 'g', 'lb', 'ton', 'oz'] },
  { label: 'Volumen',         opciones: ['litro', 'ml', 'galón', 'm³'] },
  { label: 'Longitud / Área', opciones: ['metro', 'cm', 'mm', 'm²', 'km'] },
  { label: 'Empaque',         opciones: ['caja', 'paquete', 'rollo', 'bolsa', 'paleta'] },
]

export const TODAS_UNIDADES = UNIDADES_GRUPOS.flatMap(g => g.opciones)

// ── PreciosCostosEditor ───────────────────────────────────────────────────────

export interface PrecioRow { moneda: string; valor: string }

export function PreciosCostosEditor({
  label, rows, onChange, monedasDisponibles,
}: {
  label:               string
  rows:                PrecioRow[]
  onChange:            (rows: PrecioRow[]) => void
  monedasDisponibles:  string[]
}) {
  function addRow() {
    const used = rows.map(r => r.moneda)
    const next = monedasDisponibles.find(m => !used.includes(m)) ?? monedasDisponibles[0] ?? ''
    onChange([...rows, { moneda: next, valor: '' }])
  }
  function removeRow(i: number) { onChange(rows.filter((_, idx) => idx !== i)) }
  function updateRow(i: number, field: keyof PrecioRow, val: string) {
    onChange(rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', background: 'var(--color-surface-2)',
        borderBottom: rows.length ? '1px solid var(--color-border)' : undefined,
      }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>
          {label}
        </span>
        <button type="button" onClick={addRow}
          style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
          + Añadir
        </button>
      </div>
      {rows.length === 0 && (
        <p style={{ padding: '10px 12px', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
          Sin {label.toLowerCase()} configurados
        </p>
      )}
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: i < rows.length - 1 ? '1px solid var(--color-border)' : undefined }}>
          <select className="input" value={row.moneda}
            onChange={e => updateRow(i, 'moneda', e.target.value)}
            style={{ width: 88, flexShrink: 0, fontSize: 'var(--text-sm)', padding: '4px 6px' }}>
            <option value="">—</option>
            {monedasDisponibles.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input className="input" type="number" step="0.01" min="0" placeholder="0.00"
            value={row.valor} onChange={e => updateRow(i, 'valor', e.target.value)}
            style={{ flex: 1, fontSize: 'var(--text-sm)', padding: '4px 8px' }} />
          <button type="button" onClick={() => removeRow(i)} title="Quitar"
            style={{ width: 24, height: 24, flexShrink: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)' }}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function rowsToObj(rows: PrecioRow[]): Record<string, number> {
  const obj: Record<string, number> = {}
  for (const r of rows) {
    if (r.moneda && r.valor !== '') {
      const v = parseFloat(r.valor)
      if (!isNaN(v) && v >= 0) obj[r.moneda] = v
    }
  }
  return obj
}

export function objToRows(obj: Record<string, number>): PrecioRow[] {
  return Object.entries(obj).map(([moneda, valor]) => ({ moneda, valor: String(valor) }))
}

// ── UnidadSelect ──────────────────────────────────────────────────────────────

export function UnidadSelect({ defaultValue }: { defaultValue?: string }) {
  const inicial    = defaultValue ?? 'unidad'
  const esConocida = TODAS_UNIDADES.includes(inicial)
  const [sel,      setSel]    = useState(esConocida ? inicial : '__otra__')
  const [custom,   setCustom] = useState(esConocida ? '' : inicial)

  const valor = sel === '__otra__' ? custom : sel

  return (
    <>
      <input type="hidden" name="unidad" value={valor} />
      <select className="input" value={sel}
        onChange={e => { setSel(e.target.value); if (e.target.value !== '__otra__') setCustom('') }}>
        {UNIDADES_GRUPOS.map(g => (
          <optgroup key={g.label} label={g.label}>
            {g.opciones.map(o => <option key={o} value={o}>{o}</option>)}
          </optgroup>
        ))}
        <option value="__otra__">Otra (personalizada)…</option>
      </select>
      {sel === '__otra__' && (
        <input className="input" style={{ marginTop: 6 }} type="text"
          value={custom} onChange={e => setCustom(e.target.value)}
          placeholder="Escribe la unidad…" />
      )}
    </>
  )
}

// ── Iconos locales ────────────────────────────────────────────────────────────

function IconX()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function IconBox() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> }
function IconZap() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> }

// ── ProductoFormModal ─────────────────────────────────────────────────────────

export function ProductoFormModal({
  producto, categorias, proveedores, monedas, onClose, onSaved,
}: {
  producto:    Producto | null
  categorias:  Categoria[]
  proveedores: { tercero_id: string; nombre: string }[]
  monedas:     string[]
  onClose:     () => void
  onSaved:     () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error,     setError]        = useState('')
  const [tipo,      setTipo]         = useState<TipoProducto>(producto?.tipo ?? 'PRODUCTO')
  const [precios,   setPrecios]      = useState<PrecioRow[]>(() => objToRows(producto?.precios ?? {}))
  const [costos,    setCostos]       = useState<PrecioRow[]>(() => objToRows(producto?.costos  ?? {}))

  const isEdit             = !!producto
  const categoriasActivas  = categorias.filter(c => c.estado === 'ACTIVO')
  const monedasDisponibles = monedas.length ? monedas : MONEDAS_FALLBACK

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    fd.set('tipo',    tipo)
    fd.set('precios', JSON.stringify(rowsToObj(precios)))
    fd.set('costos',  JSON.stringify(rowsToObj(costos)))
    startTransition(async () => {
      const res = await guardarProducto(fd)
      if (!res.ok) { setError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>

        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar producto' : 'Nuevo producto / servicio'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><IconX /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {producto && <input type="hidden" name="producto_id" value={producto.producto_id} />}

          <div className="modal-body">

            {/* ── Tipo ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Tipo</span>
              <div style={{ display: 'flex', gap: 12 }}>
                {(['PRODUCTO', 'SERVICIO'] as TipoProducto[]).map(t => (
                  <button key={t} type="button"
                    onClick={() => !isEdit && setTipo(t)}
                    disabled={isEdit}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px',
                      border: `2px solid ${tipo === t ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--radius-lg)',
                      background: tipo === t ? '#e0f5f4' : 'var(--color-surface)',
                      color: tipo === t ? 'var(--color-primary)' : 'var(--color-text-muted)',
                      cursor: isEdit ? 'default' : 'pointer',
                      opacity: isEdit ? 0.7 : 1,
                      textAlign: 'left',
                    }}>
                    {t === 'PRODUCTO' ? <IconBox /> : <IconZap />}
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                        {t === 'PRODUCTO' ? 'Producto' : 'Servicio'}
                      </span>
                      <span style={{ fontWeight: 400, fontSize: 'var(--text-xs)', opacity: 0.8 }}>
                        {t === 'PRODUCTO' ? 'Bien físico con stock' : 'Sin inventario físico'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {isEdit && (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 6 }}>
                  El tipo no puede modificarse una vez creado.
                </p>
              )}
            </div>

            {/* ── Identificación ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Identificación</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-4">
                  <label>Nombre <span className="required">*</span></label>
                  <input className="input" name="nombre" required autoFocus={!isEdit}
                    defaultValue={producto?.nombre ?? ''}
                    placeholder="Ej: Laptop Dell XPS, Consultoría técnica…" />
                </div>
                <div className="input-group ter-col-span-2">
                  <label>Unidad <span className="required">*</span></label>
                  <UnidadSelect defaultValue={producto?.unidad} />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Categoría</label>
                  <select className="input" name="categoria_id" defaultValue={producto?.categoria_id ?? ''}>
                    <option value="">— Sin categoría —</option>
                    {categoriasActivas.map(c => (
                      <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Proveedor</label>
                  <select className="input" name="proveedor_id" defaultValue={producto?.proveedor_id ?? ''}>
                    <option value="">— Sin especificar —</option>
                    {proveedores.map(p => (
                      <option key={p.tercero_id} value={p.tercero_id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="input-group ter-col-full">
                  <label>Descripción</label>
                  <textarea className="input input-textarea" name="descripcion" rows={2}
                    defaultValue={producto?.descripcion ?? ''}
                    placeholder="Descripción detallada del producto o servicio…" />
                </div>
              </div>
            </div>

            {/* ── Precios y costos ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Precios y costos</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <PreciosCostosEditor label="Precios de venta" rows={precios} onChange={setPrecios} monedasDisponibles={monedasDisponibles} />
                <PreciosCostosEditor label="Costos"           rows={costos}  onChange={setCostos}  monedasDisponibles={monedasDisponibles} />
              </div>
            </div>

            {/* ── Stock (solo PRODUCTO) ── */}
            {tipo === 'PRODUCTO' && (
              <div className="ter-form-section" style={{ marginBottom: 0 }}>
                <span className="ter-form-section-title">Inventario</span>
                <div className="ter-form-grid">
                  {isEdit && (
                    <div className="input-group ter-col-span-3">
                      <label>Stock actual</label>
                      <input className="input" readOnly
                        value={`${producto?.stock_actual ?? 0} ${producto?.unidad ?? ''}`}
                        style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }} />
                      <span className="input-hint">Ajusta el stock desde el botón correspondiente.</span>
                    </div>
                  )}
                  <div className="input-group ter-col-span-3">
                    <label>Stock mínimo</label>
                    <input className="input" type="number" name="stock_minimo"
                      step="0.001" min="0" defaultValue={producto?.stock_minimo ?? 0} placeholder="0" />
                    <span className="input-hint">Aviso cuando el stock baje de este nivel.</span>
                  </div>
                </div>
              </div>
            )}

            {error && <div className="alert alert-error" style={{ marginTop: 16 }}>{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} /> Guardando…</>
                : isEdit ? 'Guardar cambios' : `Crear ${tipo === 'SERVICIO' ? 'servicio' : 'producto'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
