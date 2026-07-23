'use client'

import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition, useRef } from 'react'
import Link from 'next/link'
import { Plus, X, Sparkles, Loader2 } from 'lucide-react'
import {
  guardarProducto,
  type Producto,
  type Categoria,
  type TipoProducto,
} from '@/app/actions/portal/productos'
import { autocompletarDescripcionProducto } from '@/app/actions/portal/ia'
import { useIa } from '@/components/portal/ia/IaContext'

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

/**
 * Un importe por moneda, y solo uno. La lista se guarda como objeto (`{USD: 12}`), así
 * que dos filas en la misma moneda no son dos precios: la segunda pisa a la primera sin
 * decir nada y el importe que se ve no es el que se guarda. Por eso cada selector solo
 * ofrece las monedas libres, y cuando no queda ninguna no se puede añadir más.
 */
export function PreciosCostosEditor({
  label, rows, onChange, monedasDisponibles,
}: {
  label:               string
  rows:                PrecioRow[]
  onChange:            (rows: PrecioRow[]) => void
  monedasDisponibles:  string[]
}) {
  const usadas = new Set(rows.map(r => r.moneda).filter(Boolean))
  const libres = monedasDisponibles.filter(m => !usadas.has(m))
  const completo = libres.length === 0

  function addRow() {
    if (completo) return
    onChange([...rows, { moneda: libres[0], valor: '' }])
  }
  function removeRow(i: number) { onChange(rows.filter((_, idx) => idx !== i)) }
  function updateRow(i: number, field: keyof PrecioRow, val: string) {
    onChange(rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  return (
    <div className="prd-editor-wrap">
      <div className={`prd-editor-header${rows.length ? ' prd-editor-header-sep' : ''}`}>
        <span className="prd-editor-label">{label}</span>
        <button type="button" onClick={addRow} className="btn-ghost-xs" disabled={completo}
          title={completo ? 'Ya hay un importe en cada moneda' : undefined}>+ Añadir</button>
      </div>
      {rows.length === 0 && (
        <p className="prd-editor-empty">Sin {label.toLowerCase()} configurados</p>
      )}
      {rows.map((row, i) => (
        <div key={i} className={`prd-editor-row${i < rows.length - 1 ? ' prd-editor-row-sep' : ''}`}>
          <select className="input prd-editor-select" value={row.moneda}
            aria-label={`Moneda — ${label}`}
            onChange={e => updateRow(i, 'moneda', e.target.value)}>
            <option value="">—</option>
            {/* Solo las libres y la suya: la que ya tiene otra fila no vuelve a ofrecerse. */}
            {monedasDisponibles.filter(m => m === row.moneda || !usadas.has(m))
              .map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input className="input prd-editor-input" type="number" step="any" min="0" placeholder="0.00"
            aria-label={`Importe en ${row.moneda || 'la moneda elegida'} — ${label}`}
            value={row.valor} onChange={e => updateRow(i, 'valor', e.target.value)} />
          <button type="button" onClick={() => removeRow(i)} title="Quitar" aria-label={`Quitar ${row.moneda || 'esta fila'}`}
            className="prd-editor-del-btn">
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

// ── ProductoFormModal ─────────────────────────────────────────────────────────

export function ProductoFormModal({
  producto, categorias, proveedores, monedas, hayAlmacenes, modo,
  etiquetaServicio, onClose, onSaved,
}: {
  producto:     Producto | null
  categorias:   Categoria[]
  proveedores:  { tercero_id: string; nombre: string }[]
  monedas:      string[]
  hayAlmacenes: boolean
  /** Qué se crea/edita en esta página: PRODUCTO (Inventario) o SERVICIO (Servicios).
   *  El tipo lo fija la página, no hay selector — cada módulo cataloga uno. */
  modo:             TipoProducto
  etiquetaServicio: string
  onClose:      () => void
  onSaved:      () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [precios,   setPrecios]      = useState<PrecioRow[]>(() => objToRows(producto?.precios ?? {}))
  const [costos,    setCostos]       = useState<PrecioRow[]>(() => objToRows(producto?.costos  ?? {}))
  const [esSuscribible, setEsSuscribible] = useState(producto?.es_suscribible ?? false)
  const [periodicidad,  setPeriodicidad]  = useState(producto?.periodicidad_defecto ?? 'MENSUAL')
  const [descripcion,   setDescripcion]   = useState(producto?.descripcion ?? '')
  const [sugiriendo,    setSugiriendo]    = useState(false)
  const nombreRef = useRef<HTMLInputElement>(null)
  const { tieneIa } = useIa()

  async function sugerirDescripcion() {
    const nombre = nombreRef.current?.value.trim() ?? ''
    if (!nombre) { toastError('Escribe primero el nombre.'); return }
    setSugiriendo(true)
    const r = await autocompletarDescripcionProducto(nombre, (producto?.tipo ?? modo) === 'SERVICIO')
    setSugiriendo(false)
    if (!r.ok) { toastError(r.error); return }
    setDescripcion(r.texto)
  }

  const isEdit             = !!producto
  // El tipo no es una decisión del usuario: lo impone la página. Al editar se
  // respeta el del producto (que nunca cambia), pero coincide con el modo.
  const tipo               = producto?.tipo ?? modo
  const esServicio         = tipo === 'SERVICIO'
  const nombreTipo         = esServicio ? etiquetaServicio.toLowerCase() : 'producto'
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
    fd.set('es_suscribible',       esSuscribible ? '1' : '')
    fd.set('periodicidad_defecto', esSuscribible ? periodicidad : '')
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarProducto(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>

        <div className="modal-header">
          <h2 className="modal-title">
            {isEdit ? `Editar ${nombreTipo}` : `Nuevo ${nombreTipo}`}
          </h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {producto && <input type="hidden" name="producto_id" value={producto.producto_id} />}

          <div className="modal-body">

            {/* ── Identificación ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Identificación</span>
              <div className="ter-form-grid">
                <div className={`input-group ${esServicio ? 'ter-col-full' : 'ter-col-span-4'}`}>
                  <label>Nombre <span className="required">*</span></label>
                  <input className="input" name="nombre" required autoFocus={!isEdit} ref={nombreRef}
                    defaultValue={producto?.nombre ?? ''}
                    placeholder={esServicio ? 'Ej: Consultoría técnica, Corte de pelo…' : 'Ej: Laptop Dell XPS, Tornillo M6…'} />
                </div>
                {/* Unidad solo para físicos: un servicio no siempre es medible. */}
                {!esServicio && (
                  <div className="input-group ter-col-span-2">
                    <label>Unidad <span className="required">*</span></label>
                    <UnidadSelect defaultValue={producto?.unidad} />
                  </div>
                )}
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
                  {tieneIa && (
                    <button type="button" className="btn btn-secondary btn-sm cat-ia-btn" onClick={sugerirDescripcion} disabled={sugiriendo}>
                      {sugiriendo ? <Loader2 size={14} strokeWidth={2} className="img-upload-spin" /> : <Sparkles size={14} strokeWidth={2} />}
                      {sugiriendo ? 'Pensando…' : 'Sugerir con IA'}
                    </button>
                  )}
                  <textarea className="input input-textarea" name="descripcion" rows={2}
                    value={descripcion} onChange={e => setDescripcion(e.target.value)}
                    placeholder={`Descripción detallada del ${nombreTipo}…`} />
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

            {/* ── Suscripción (solo SERVICIO) ── */}
            {esServicio && (
              <div className="ter-form-section">
                <span className="ter-form-section-title">Suscripción</span>
                <label className="checkbox-group">
                  <input type="checkbox" checked={esSuscribible}
                    onChange={e => setEsSuscribible(e.target.checked)} />
                  <span className="checkbox-label">Se puede contratar de forma recurrente (suscripción)</span>
                </label>
                {esSuscribible && (
                  <div className="ter-form-grid mt-3">
                    <div className="input-group ter-col-span-3">
                      <label>Periodicidad por defecto</label>
                      <select className="input" value={periodicidad}
                        onChange={e => setPeriodicidad(e.target.value)}>
                        <option value="MENSUAL">Mensual</option>
                        <option value="TRIMESTRAL">Trimestral</option>
                        <option value="SEMESTRAL">Semestral</option>
                        <option value="ANUAL">Anual</option>
                      </select>
                      <span className="input-hint">Se usará al crear una suscripción; se puede cambiar por cliente.</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Stock (solo PRODUCTO físico) ── */}
            {tipo === 'PRODUCTO' && (
              <div className="ter-form-section mb-0">
                <span className="ter-form-section-title">Inventario</span>
                {bloqueadoPorAlmacen ? (
                  <div className="prd-almacen-req">
                    <p className="input-hint">Los productos físicos necesitan un <strong>almacén</strong> donde registrar su stock. Crea uno para poder guardar.</p>
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
                        step="any" min="0" defaultValue={producto?.stock_minimo ?? 0} placeholder="0" />
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
                : isEdit ? 'Guardar cambios'
                : `Crear ${nombreTipo}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
