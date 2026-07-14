'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Package, Plus, X, Zap } from 'lucide-react'
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
    <div className="prd-editor-wrap">
      <div className={`prd-editor-header${rows.length ? ' prd-editor-header-sep' : ''}`}>
        <span className="prd-editor-label">{label}</span>
        <button type="button" onClick={addRow} className="btn-ghost-xs">+ Añadir</button>
      </div>
      {rows.length === 0 && (
        <p className="prd-editor-empty">Sin {label.toLowerCase()} configurados</p>
      )}
      {rows.map((row, i) => (
        <div key={i} className={`prd-editor-row${i < rows.length - 1 ? ' prd-editor-row-sep' : ''}`}>
          <select className="input prd-editor-select" value={row.moneda}
            onChange={e => updateRow(i, 'moneda', e.target.value)}>
            <option value="">—</option>
            {monedasDisponibles.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input className="input prd-editor-input" type="number" step="0.01" min="0" placeholder="0.00"
            value={row.valor} onChange={e => updateRow(i, 'valor', e.target.value)} />
          <button type="button" onClick={() => removeRow(i)} title="Quitar" className="prd-editor-del-btn">
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
        <input className="input mt-2" type="text"
          value={custom} onChange={e => setCustom(e.target.value)}
          placeholder="Escribe la unidad…" />
      )}
    </>
  )
}

// ── Iconos locales ────────────────────────────────────────────────────────────

// ── ProductoFormModal ─────────────────────────────────────────────────────────

export function ProductoFormModal({
  producto, categorias, proveedores, monedas, hayAlmacenes, onClose, onSaved,
}: {
  producto:     Producto | null
  categorias:   Categoria[]
  proveedores:  { tercero_id: string; nombre: string }[]
  monedas:      string[]
  hayAlmacenes: boolean
  onClose:      () => void
  onSaved:      () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [tipo,      setTipo]         = useState<TipoProducto>(producto?.tipo ?? 'PRODUCTO')
  const [precios,   setPrecios]      = useState<PrecioRow[]>(() => objToRows(producto?.precios ?? {}))
  const [costos,    setCostos]       = useState<PrecioRow[]>(() => objToRows(producto?.costos  ?? {}))

  const isEdit             = !!producto
  const categoriasActivas  = categorias.filter(c => c.estado === 'ACTIVO')
  const monedasDisponibles = monedas.length ? monedas : MONEDAS_FALLBACK
  // Un producto FÍSICO necesita un almacén donde vivir su stock; un servicio no.
  // Al crear un físico sin almacén, se bloquea el guardado y se ofrece crear uno.
  const bloqueadoPorAlmacen = !isEdit && tipo === 'PRODUCTO' && !hayAlmacenes

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('tipo',    tipo)
    fd.set('precios', JSON.stringify(rowsToObj(precios)))
    fd.set('costos',  JSON.stringify(rowsToObj(costos)))
    startTransition(async () => {
      const res = await guardarProducto(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>

        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar producto' : 'Nuevo producto / servicio'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {producto && <input type="hidden" name="producto_id" value={producto.producto_id} />}

          <div className="modal-body">

            {/* ── Tipo ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Tipo</span>
              <div className="prd-tipo-grid">
                {(['PRODUCTO', 'SERVICIO'] as TipoProducto[]).map(t => (
                  <button key={t} type="button"
                    onClick={() => !isEdit && setTipo(t)}
                    disabled={isEdit}
                    className={`prd-tipo-btn${tipo === t ? ' active' : ''}`}>
                    {t === 'PRODUCTO' ? <Package size={15} strokeWidth={2} /> : <Zap size={16} strokeWidth={2} />}
                    <span className="prd-tipo-labels">
                      <span className="prd-tipo-name">
                        {t === 'PRODUCTO' ? 'Producto' : 'Servicio'}
                      </span>
                      <span className="prd-tipo-desc">
                        {t === 'PRODUCTO' ? 'Bien físico con stock' : 'Sin inventario físico'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {isEdit && (
                <p className="prd-tipo-hint">El tipo no puede modificarse una vez creado.</p>
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
              <div className="grid-cols-2">
                <PreciosCostosEditor label="Precios de venta" rows={precios} onChange={setPrecios} monedasDisponibles={monedasDisponibles} />
                <PreciosCostosEditor label="Costos"           rows={costos}  onChange={setCostos}  monedasDisponibles={monedasDisponibles} />
              </div>
            </div>

            {/* ── Stock (solo PRODUCTO) ── */}
            {tipo === 'PRODUCTO' && (
              <div className="ter-form-section mb-0">
                <span className="ter-form-section-title">Inventario</span>
                {bloqueadoPorAlmacen ? (
                  <div className="prd-almacen-req">
                    <p className="input-hint">Los productos físicos necesitan un <strong>almacén</strong> donde registrar su stock. Crea uno para poder guardar (los servicios no lo necesitan).</p>
                    <Link href="/portal/almacenes" className="btn btn-primary btn-sm"><Plus size={14} strokeWidth={2.5} /> Crear almacén</Link>
                  </div>
                ) : (
                  <div className="ter-form-grid">
                    {isEdit && (
                      <div className="input-group ter-col-span-3">
                        <label>Stock actual</label>
                        <input className="input input-static" readOnly
                          value={`${producto?.stock_actual ?? 0} ${producto?.unidad ?? ''}`} />
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
                )}
              </div>
            )}

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || bloqueadoPorAlmacen}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : `Crear ${tipo === 'SERVICIO' ? 'servicio' : 'producto'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
