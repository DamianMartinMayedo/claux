'use client'

// ── Alta y edición de una compra (borrador) ──
//
// Es el gemelo del editor de líneas de Ventas y se comporta IGUAL que él, porque quien
// factura por la mañana compra por la tarde y una diferencia de comportamiento entre las
// dos pantallas se vive como un fallo:
//
//  · **Autocompletado** en la descripción (`DescripcionCatalogo`, el mismo componente),
//    con el vínculo al catálogo creado al ELEGIR, nunca por coincidencia de texto.
//  · **Del catálogo** añade varias de una vez y reutiliza la última línea vacía en vez
//    de dejarla ahí para que la borres a mano.
//  · **Misma rejilla** (`ven-lineas-head`/`ven-lineas-row`): había una copia `cmp-*` con
//    otras columnas y por eso la cabecera no cuadraba con las filas.
//
// Y lo que faltaba del todo: **cambiar de moneda no puede arrastrar los importes**.
// 10.000 CUP no son 10.000 USD. Al cambiar, cada línea toma su coste del catálogo en la
// moneda nueva y, si no lo tiene, se vacía — nunca se queda un número que significa otra
// cosa. La tasa se OFRECE como atajo (patrón de Citas y suscripciones) y el cambio se
// puede deshacer, porque el error más caro aquí es el silencioso.

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useMemo, useRef, useTransition } from 'react'
import { Plus, X, Trash2, PackageSearch, Info } from 'lucide-react'
import {
  guardarCompra,
  type Compra,
  type CompraLinea,
  type ProductoCompra,
} from '@/app/actions/portal/compras'
import { CampoNumero } from '@/components/portal/CampoNumero'
import { DescripcionCatalogo } from '@/components/portal/DescripcionCatalogo'
import { SelectorProductoCompra } from './_SelectorProductoCompra'
// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: con `toISOString()` a partir de
// las 20:00 la fecha ya es la de mañana, así que un documento registrado de noche el último
// día del mes caía en el mes siguiente. Una sola fuente: `lib/fecha-tz.ts`.
import { hoyEnTz } from '@/lib/fecha-tz'

function fmt(n: number, moneda: string) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)
}

export interface CompraFormData {
  /** Con `empresa_id`: una compra es de UNA empresa (la del almacén elegido), así que
   *  el selector se filtra a esa empresa — igual que los clientes en Ventas
   *  (`NuevaFacturaPage`). Sin filtrar, un proveedor con ficha en dos empresas salía
   *  duplicado en la lista sin forma de saber cuál corresponde. */
  proveedores: { tercero_id: string; nombre: string; empresa_id: string; moneda_defecto: string | null }[]
  almacenes:   { almacen_id: string; nombre: string; empresa_id: string }[]
  productos:   ProductoCompra[]
  monedas:     string[]
  /** `"ORIGEN__DESTINO"` → factor. El atajo al cambiar de moneda. */
  tasas:       Record<string, number>
}

interface LineaUI {
  producto_id:    string
  descripcion:    string
  unidad:         string
  cantidad:       number
  costo_unitario: number
}

function lineaVacia(): LineaUI {
  return { producto_id: '', descripcion: '', unidad: '', cantidad: 1, costo_unitario: 0 }
}

export function CompraFormModal({
  form, compra, lineasIniciales, onClose, onSaved,
}: {
  form:            CompraFormData
  compra?:         Compra
  lineasIniciales?: CompraLinea[]
  onClose:         () => void
  onSaved:         (compra_id: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!compra

  const [almacenId,   setAlmacenId]   = useState(compra?.almacen_id ?? form.almacenes[0]?.almacen_id ?? '')
  const [proveedorId, setProveedorId] = useState(compra?.proveedor_id ?? '')
  const [moneda,      setMoneda]      = useState(compra?.moneda ?? form.monedas[0] ?? 'USD')
  const [fecha,       setFecha]       = useState(compra?.fecha ?? hoyEnTz())
  const [notas,       setNotas]       = useState(compra?.notas ?? '')
  const [selectorAbierto, setSelectorAbierto] = useState(false)
  const [lineas,      setLineas]      = useState<LineaUI[]>(
    lineasIniciales && lineasIniciales.length
      ? lineasIniciales.map(l => ({
          producto_id: l.producto_id ?? '', descripcion: l.descripcion, unidad: '',
          cantidad: l.cantidad, costo_unitario: l.costo_unitario,
        }))
      : [lineaVacia()],
  )
  /** Lo que había antes del último cambio de moneda, para poder deshacerlo. */
  const [antes, setAntes] = useState<{ moneda: string; lineas: LineaUI[] } | null>(null)

  // Foco en la descripción de la línea recién añadida: con `ref` y no con un efecto, que
  // el foco es consecuencia del CLIC y no del render.
  const filasRef = useRef<Record<number, HTMLInputElement | null>>({})

  const catalogo = useMemo(
    () => new Map(form.productos.map(p => [p.producto_id, p])),
    [form.productos],
  )

  const total = useMemo(
    () => lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0),
    [lineas],
  )

  // La compra es de la empresa del almacén elegido: el proveedor se acota a esa
  // empresa (igual que los clientes en NuevaFacturaPage), no a todas las del cliente.
  const empresaId            = form.almacenes.find(a => a.almacen_id === almacenId)?.empresa_id
  const proveedoresDeEmpresa = form.proveedores.filter(p => p.empresa_id === empresaId)

  const factor = antes ? form.tasas[`${antes.moneda}__${moneda}`] : undefined
  const totalAntes = antes ? antes.lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0) : 0

  function onAlmacenChange(id: string) {
    setAlmacenId(id)
    // Si el proveedor ya elegido no pertenece a la empresa del nuevo almacén, se
    // limpia: dejarlo seleccionado pero fuera de la lista visible sería confuso.
    const nuevaEmpresa = form.almacenes.find(a => a.almacen_id === id)?.empresa_id
    if (proveedorId && !form.proveedores.some(p => p.tercero_id === proveedorId && p.empresa_id === nuevaEmpresa)) {
      setProveedorId('')
    }
  }

  /**
   * Cambiar de moneda RE-TARIFA, no convierte por su cuenta.
   *
   * Cada línea enlazada toma el coste que el catálogo tenga en la moneda nueva; la que
   * no lo tenga (y la escrita a mano) se queda **a cero**, que es lo honesto: mantener
   * el número sería decir que 10.000 CUP son 10.000 USD. Lo anterior se guarda para
   * poder deshacer y para ofrecer la tasa.
   */
  function onMonedaChange(nueva: string) {
    if (nueva === moneda) return
    const previo = { moneda, lineas }
    setLineas(lineas.map(l => {
      const p = l.producto_id ? catalogo.get(l.producto_id) : undefined
      return { ...l, costo_unitario: p?.costos?.[nueva] ?? 0 }
    }))
    setMoneda(nueva)
    setAntes(previo)
  }

  function aplicarTasa() {
    if (!antes || !factor) return
    setLineas(antes.lineas.map(l => ({
      ...l,
      costo_unitario: Math.round(l.costo_unitario * factor * 100) / 100,
    })))
    setAntes(null)
  }

  function deshacerMoneda() {
    if (!antes) return
    setMoneda(antes.moneda)
    setLineas(antes.lineas)
    setAntes(null)
  }

  function addLinea() {
    const i = lineas.length
    setLineas([...lineas, lineaVacia()])
    // Tras el repintado: el input de esa fila aún no existe en este tick.
    requestAnimationFrame(() => filasRef.current[i]?.focus())
  }
  function removeLinea(i: number) { setLineas(lineas.filter((_, idx) => idx !== i)) }
  function updateLinea(i: number, patch: Partial<LineaUI>) {
    setLineas(lineas.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  /** Línea nueva a partir de un producto del catálogo. */
  function lineaDe(p: ProductoCompra): LineaUI {
    return {
      producto_id: p.producto_id,
      descripcion: p.nombre,
      unidad: p.unidad ?? '',
      cantidad: 1,
      costo_unitario: p.costos?.[moneda] ?? 0,
    }
  }

  /**
   * Enlaza una línea EXISTENTE con un producto (autocompletado). La descripción pasa a
   * ser la del producto solo si estaba vacía o si es un prefijo de lo escrito: quien ya
   * matizó «Arroz — saco roto» no quiere perder el matiz.
   */
  function enlazarProducto(i: number, p: ProductoCompra) {
    const actual  = lineas[i]
    const escrito = actual.descripcion.trim()
    const esBusqueda = !escrito
      || p.nombre.toLowerCase().startsWith(escrito.toLowerCase())
      || p.codigo.toLowerCase() === escrito.toLowerCase()
    updateLinea(i, {
      producto_id:    p.producto_id,
      descripcion:    esBusqueda ? p.nombre : escrito,
      unidad:         p.unidad ?? '',
      costo_unitario: p.costos?.[moneda] ?? actual.costo_unitario ?? 0,
    })
  }

  /** Añade una línea por producto elegido, reutilizando la última si estaba vacía. */
  function anadirDelCatalogo(elegidos: ProductoCompra[]) {
    if (elegidos.length === 0) return
    const ultima = lineas[lineas.length - 1]
    const base = ultima && !ultima.producto_id && !ultima.descripcion.trim()
      ? lineas.slice(0, -1)
      : lineas
    setLineas([...base, ...elegidos.map(lineaDe)])
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const validas = lineas.filter(l => l.descripcion.trim() && l.cantidad > 0)
    if (!almacenId)           { toastError('Selecciona el almacén de entrada.'); return }
    if (validas.length === 0) { toastError('Añade al menos una línea con cantidad.'); return }

    const fd = new FormData()
    if (compra) fd.set('compra_id', compra.compra_id)
    fd.set('almacen_id',   almacenId)
    fd.set('proveedor_id', proveedorId)
    fd.set('moneda',       moneda)
    fd.set('fecha',        fecha)
    fd.set('notas',        notas)
    fd.set('lineas', JSON.stringify(validas.map(l => ({
      producto_id: l.producto_id || null,
      descripcion: l.descripcion.trim(),
      cantidad: l.cantidad,
      costo_unitario: l.costo_unitario,
    }))))

    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarCompra(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(isEdit ? 'Compra actualizada' : 'Compra creada en borrador')
      onSaved(res.compra_id!)
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-xl" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? `Editar compra ${compra!.numero}` : 'Nueva compra'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">

            <div className="ven-form-section">
              <span className="ven-form-section-title">Datos de la compra</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-3">
                  <label htmlFor="cmp-alm">Almacén de entrada <span className="required">*</span></label>
                  <select id="cmp-alm" className="input" value={almacenId} onChange={e => onAlmacenChange(e.target.value)} required>
                    <option value="">Selecciona almacén…</option>
                    {form.almacenes.map(a => <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div className="input-group ter-col-span-3">
                  <label htmlFor="cmp-prov">Proveedor</label>
                  <select id="cmp-prov" className="input" value={proveedorId} onChange={e => setProveedorId(e.target.value)}>
                    <option value="">Sin proveedor</option>
                    {proveedoresDeEmpresa.map(p => <option key={p.tercero_id} value={p.tercero_id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div className="input-group ter-col-span-2">
                  <label htmlFor="cmp-mon">Moneda <span className="required">*</span></label>
                  <select id="cmp-mon" className="input" value={moneda} onChange={e => onMonedaChange(e.target.value)} required>
                    {form.monedas.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="input-group ter-col-span-2">
                  <label htmlFor="cmp-fecha">Fecha</label>
                  <input id="cmp-fecha" className="input" type="date" value={fecha}
                    max={hoyEnTz()} onChange={e => setFecha(e.target.value)} />
                </div>

                {/* El aviso del cambio de moneda, con las dos salidas: la tasa como
                    atajo (se ofrece, no se impone) y deshacer. */}
                {antes && (
                  <div className="moneda-cambio">
                    <div className="moneda-cambio-nota">
                      <Info size={14} strokeWidth={2} />
                      <span>
                        Estaba en {antes.moneda} ({fmt(totalAntes, antes.moneda)}). Los costes se han
                        puesto al del catálogo en {moneda}; escribe los que falten
                        {factor && <> o <button type="button" className="aplicar-tasa-btn" onClick={aplicarTasa}>
                          convierte los de antes con la tasa</button></>}
                        {' · '}
                        <button type="button" className="aplicar-tasa-btn" onClick={deshacerMoneda}>
                          volver a {antes.moneda}
                        </button>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="ven-form-section">
              <div className="ven-section-header">
                <span className="ven-form-section-title">Líneas</span>
                <div className="ven-section-actions">
                  {form.productos.length > 0 && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectorAbierto(true)}>
                      <PackageSearch size={12} strokeWidth={2.5} /> Del catálogo
                    </button>
                  )}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addLinea}>
                    <Plus size={12} strokeWidth={2.5} /> Añadir línea
                  </button>
                </div>
              </div>

              {lineas.length === 0 ? (
                <div className="ven-empty-mini">
                  Sin líneas todavía. Añade al menos una para poder guardar
                  {form.productos.length > 0 && <> — o elige varias del catálogo de una vez</>}.
                </div>
              ) : (
                <div className="ven-lineas-table">
                  <div className="cmp-lineas-head">
                    <div className="ven-col-prod">Producto / descripción</div>
                    <div className="ven-col-num">Cant.</div>
                    <div className="ven-col-num">Costo</div>
                    <div className="ven-col-num">Total</div>
                    <div className="ven-col-del"></div>
                  </div>
                  {lineas.map((l, i) => {
                    const p = l.producto_id ? catalogo.get(l.producto_id) : undefined
                    return (
                      <div key={i} className="cmp-lineas-row">
                        <div className="ven-col-prod">
                          <DescripcionCatalogo
                            valor={l.descripcion}
                            articulos={form.productos}
                            placeholder="Describe lo que compras…"
                            linkCodigo={l.producto_id ? (p?.codigo ?? l.producto_id) : null}
                            inputRef={el => { filasRef.current[i] = el }}
                            importeTexto={a => a.costos?.[moneda] != null
                              ? fmt(a.costos[moneda], moneda) : null}
                            onTexto={v => updateLinea(i, { descripcion: v })}
                            onElegir={a => enlazarProducto(i, a)}
                            onEnter={() => { if (i === lineas.length - 1) addLinea() }}
                          />
                        </div>
                        <div className="ven-col-num" data-label="Cant.">
                          <CampoNumero className="input input-sm ven-input-num"
                            valor={l.cantidad}
                            onValor={n => updateLinea(i, { cantidad: n })}
                            etiqueta={`Cantidad de la línea ${i + 1}`} />
                        </div>
                        <div className="ven-col-num" data-label="Costo">
                          <CampoNumero className="input input-sm ven-input-num"
                            valor={l.costo_unitario}
                            onValor={n => updateLinea(i, { costo_unitario: n })}
                            etiqueta={`Costo unitario de la línea ${i + 1}`} />
                        </div>
                        <div className="ven-col-num ven-total-cell" data-label="Total">{fmt(l.cantidad * l.costo_unitario, moneda)}</div>
                        <div className="ven-col-del">
                          <button type="button" className="ter-action-btn ter-action-danger"
                            onClick={() => removeLinea(i)}
                            aria-label={`Eliminar la línea ${i + 1}`} title="Eliminar línea">
                            <Trash2 size={13} strokeWidth={2} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="ven-bottom-row">
              <div className="ven-totales-resumen">
                <div className="ven-total-row ven-total-final">
                  <span>Total</span>
                  <strong>{fmt(total, moneda)}</strong>
                </div>
              </div>
              <div className="ven-notas-inline">
                <label className="ven-notas-label" htmlFor="cmp-notas">Notas</label>
                <textarea id="cmp-notas" className="input input-textarea ven-notas-textarea" rows={3}
                  value={notas} onChange={e => setNotas(e.target.value)}
                  placeholder="Nº de factura del proveedor, referencias…" />
              </div>
            </div>

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear borrador'}
            </button>
          </div>
        </form>
      </div>

      {selectorAbierto && (
        <SelectorProductoCompra
          productos={form.productos}
          moneda={moneda}
          onAnadir={anadirDelCatalogo}
          onCerrar={() => setSelectorAbierto(false)}
        />
      )}
    </div>
  )
}
