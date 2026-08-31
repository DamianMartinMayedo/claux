'use client'

import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Plus, X, Loader2 } from 'lucide-react'
import IaSparkle from '@/components/portal/ia/IaSparkle'
import FormHelp from '@/components/portal/FormHelp'
import {
  guardarProducto,
  type Producto,
  type Categoria,
  type TipoProducto,
  type ModoCatalogo,
} from '@/app/actions/portal/productos'
import { autocompletarFichaProducto } from '@/app/actions/portal/ia'
import { useIa } from '@/components/portal/ia/IaContext'
import { parseNumeroEs, textoNumeroEs } from '@/lib/numeros'

// ── Constantes ────────────────────────────────────────────────────────────────

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
          <input className="input prd-editor-input" type="text" inputMode="decimal" placeholder="0,00"
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
    if (r.moneda && r.valor.trim() !== '') {
      const v = parseNumeroEs(r.valor)
      if (v >= 0) obj[r.moneda] = v
    }
  }
  return obj
}

export function objToRows(obj: Record<string, number>): PrecioRow[] {
  return Object.entries(obj).map(([moneda, valor]) => ({ moneda, valor: textoNumeroEs(valor) }))
}

// ── UnidadSelect ──────────────────────────────────────────────────────────────

/**
 * `sugerida` la usa el autocompletado con IA: llega una unidad de la lista cerrada y
 * el selector se posiciona en ella. Es una preselección que el dueño ve antes de
 * guardar, nunca una escritura.
 */
export function UnidadSelect({ defaultValue, sugerida }: { defaultValue?: string; sugerida?: string | null }) {
  const inicial    = defaultValue ?? 'unidad'
  const esConocida = TODAS_UNIDADES.includes(inicial)
  const [sel,      setSel]    = useState(esConocida ? inicial : '__otra__')
  const [custom,   setCustom] = useState(esConocida ? '' : inicial)

  // Solo si es de la lista: una unidad inventada dejaría el selector en un estado
  // que no existe. La verificación de fondo está en `lib/ia/producto.ts`.
  useEffect(() => {
    if (sugerida && TODAS_UNIDADES.includes(sugerida)) { setSel(sugerida); setCustom('') }
  }, [sugerida])

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
  producto, categorias, proveedores, empresas, monedas, hayAlmacenes, llevaExistencias, modo,
  usaCostes, usaSuscripciones, etiquetaServicio, onClose, onSaved,
}: {
  producto:     Producto | null
  categorias:   Categoria[]
  /** Con `empresa_id`: el mismo proveedor real puede tener una ficha por empresa
   *  (third_parties es por-empresa). Con `empresas` se filtra el <select> a una
   *  empresa a la vez, para no enseñar dos filas idénticas sin poder distinguirlas. */
  proveedores:  { tercero_id: string; nombre: string; empresa_id: string }[]
  /** Empresas visibles para este usuario. Con 2+, aparece el selector «Empresa del
   *  proveedor» que filtra la lista; con 0 o 1 no hace falta (ya se ve todo o nada). */
  empresas:     { empresa_id: string; nombre: string }[]
  monedas:      string[]
  hayAlmacenes: boolean
  /** ¿El cliente lleva EXISTENCIAS (módulo Inventario)? Sin él, la página de Caja
   *  cataloga artículos de mostrador: nombre y precio, sin stock ni almacén. */
  llevaExistencias: boolean
  /** Qué cataloga esta página: `PRODUCTO` (Inventario o mostrador), `SERVICIO`
   *  (Servicios) o `AMBOS` (el mostrador de quien no tiene ninguno de los dos
   *  módulos). En los dos primeros el tipo lo fija la página; en `AMBOS` se pregunta,
   *  porque es la única forma de que el reparto futuro no sea un volcado. */
  modo:             ModoCatalogo
  /** ¿Los costes de este cliente los lee alguien (`inventario` o `base`)? Sin ninguno
   *  de los dos, «Costos» es una casilla que no va a ningún sitio: no se pinta. Lo que
   *  hubiera guardado sigue guardado (ver `ProductosPageData.usaCostes`). */
  usaCostes:        boolean
  /** ¿Contrató el módulo `servicios`? Es lo que decide si un servicio se puede
   *  CONTRATAR (acuerdos, periodicidad): en el catálogo del mostrador un servicio es
   *  una línea de venta con su precio, y no hay suscripciones que gestionar. */
  usaSuscripciones: boolean
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
  // Controlados para que el autocompletado con IA pueda preseleccionarlos.
  const [categoriaId,     setCategoriaId]     = useState(producto?.categoria_id ?? '')
  const [unidadSugerida,  setUnidadSugerida]  = useState<string | null>(null)
  // Empresa por la que se filtra el selector de Proveedor (ver más abajo): al editar,
  // la del proveedor ya enlazado; si no, la primera. Es un filtro de UI, no un campo
  // del producto — el catálogo sigue siendo del cliente entero, no de una empresa.
  const [proveedorEmpresaId, setProveedorEmpresaId] = useState(() => {
    const actual = producto?.proveedor_id
      ? proveedores.find(p => p.tercero_id === producto.proveedor_id)
      : undefined
    return actual?.empresa_id ?? empresas[0]?.empresa_id ?? ''
  })
  const [proveedorId, setProveedorId] = useState(producto?.proveedor_id ?? '')
  const nombreRef = useRef<HTMLInputElement>(null)
  const { tieneIa } = useIa()

  /** Cambiar de empresa cambia el juego de proveedores: el elegido deja de valer. */
  function onProveedorEmpresaChange(id: string) {
    setProveedorEmpresaId(id)
    if (proveedorId && !proveedores.some(p => p.tercero_id === proveedorId && p.empresa_id === id)) {
      setProveedorId('')
    }
  }

  /**
   * Autocompletar con IA: descripción + unidad + categoría en UNA llamada.
   *
   * Nada se guarda: los tres campos quedan rellenos y el dueño los revisa. La lista
   * de unidades se le pasa cerrada al servidor, y la categoría vuelve verificada
   * contra las del cliente (`lib/ia/producto.ts`).
   */
  async function sugerirConIa() {
    const nombre = nombreRef.current?.value.trim() ?? ''
    if (!nombre) { toastError('Escribe primero el nombre.'); return }
    setSugiriendo(true)
    // `tipo`, no `modo`: en el catálogo del mostrador el tipo lo elige el desplegable de
    // arriba, y pedirle a la IA la ficha de un producto para lo que es un servicio
    // devolvía unidad de medida y ninguna pista de suscripción.
    const r = await autocompletarFichaProducto(nombre, tipo === 'SERVICIO', TODAS_UNIDADES)
    setSugiriendo(false)
    if (!r.ok) { toastError(r.error); return }
    const s = r.sugerencia
    if (s.descripcion) setDescripcion(s.descripcion)
    if (s.unidad)      setUnidadSugerida(s.unidad)
    if (s.categoria_id && categorias.some(c => c.categoria_id === s.categoria_id)) {
      setCategoriaId(s.categoria_id)
    }
    // También si se presta por suscripción y con qué ciclo (lista cerrada, verificada al
    // volver). Es una SUGERENCIA: la casilla se marca y el dueño la revisa como el resto.
    if (s.es_suscribible) {
      setEsSuscribible(true)
      if (s.periodicidad) setPeriodicidad(s.periodicidad)
    }
    if (!s.descripcion && !s.unidad && !s.categoria_id && !s.es_suscribible) {
      toastError('No pude sugerir nada con ese nombre. Rellena la ficha a mano.')
    }
  }

  const isEdit             = !!producto
  // En Inventario y en Servicios el tipo NO es una decisión del usuario: lo impone la
  // página. En el catálogo del mostrador (`AMBOS`) sí se pregunta —y también al
  // editar—: ese cliente no tiene Inventario ni Servicios, así que nada cuelga del
  // tipo todavía (ni stock, ni suscripciones) y equivocarse al crear no puede dejar
  // «corte de pelo» marcado como físico para siempre.
  const mixto              = modo === 'AMBOS'
  const [tipoElegido, setTipoElegido] = useState<TipoProducto>(
    producto?.tipo ?? (mixto ? 'PRODUCTO' : modo),
  )
  const tipo               = mixto ? tipoElegido : (producto?.tipo ?? modo)
  const esServicio         = tipo === 'SERVICIO'
  const nombreTipo         = esServicio ? etiquetaServicio.toLowerCase() : 'producto'
  const categoriasActivas  = categorias.filter(c => c.estado === 'ACTIVO')
  const proveedoresDeEmpresa = proveedores.filter(p => p.empresa_id === proveedorEmpresaId)
  // El selector de Empresa solo se enseña con 2+: con una sola no hay nada que elegir
  // (filtrar por ella ya deja pasar a todos). Categoría/Empresa/Proveedor reparten la
  // misma fila de 6 columnas: a dos (sin empresa) o a tres (con ella).
  const provSpan = empresas.length > 1 ? 'ter-col-span-2' : 'ter-col-span-3'
  // Proveedor: se pinta cuando HAY alguno. Un desplegable cuya única opción es
  // «— Sin especificar —» y sin forma de añadir nada no es un campo: un cliente
  // solo-Caja no tiene página de Terceros donde crear uno. Aparece solo el día que
  // exista un proveedor, sin tocar nada más. Y entonces la categoría se queda sola en
  // su fila, así que ocupa la mitad y no un tercio.
  const hayProveedores = proveedores.length > 0
  const catSpan        = hayProveedores ? provSpan : 'ter-col-span-3'
  const monedasDisponibles = monedas
  // Un producto FÍSICO necesita un almacén donde vivir su stock; un servicio no.
  // Al crear un físico sin almacén, se bloquea el guardado y se ofrece crear uno.
  // Un físico necesita almacén… solo si el cliente LLEVA existencias. Con Caja a
  // secas no hay almacenes ni stock: la ficha es nombre y precio para el mostrador,
  // y exigir un almacén dejaría al cliente sin poder crear su catálogo.
  const bloqueadoPorAlmacen = !isEdit && tipo === 'PRODUCTO' && llevaExistencias && !hayAlmacenes

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
      <div className="modal modal-xl" role="dialog" aria-modal>

        <div className="modal-header">
          <h2 className="modal-title">
            {isEdit ? `Editar ${nombreTipo}` : `Nuevo ${nombreTipo}`}
          </h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {producto && <input type="hidden" name="producto_id" value={producto.producto_id} />}
          {/* Dos campos que este formulario NO pinta y que se guardan igual, porque el
              guardado escribe la ficha entera: sin esto, editar el precio de un artículo
              importado le borraba el código del proveedor. El de proveedor se conserva
              también cuando el desplegable no se pinta (no hay proveedores) y la ficha
              vieja sí tenía uno: esconder un campo no es motivo para soltar el dato. */}
          {producto?.codigo_proveedor && (
            <input type="hidden" name="codigo_proveedor" value={producto.codigo_proveedor} />
          )}
          {!hayProveedores && producto?.proveedor_id && (
            <input type="hidden" name="proveedor_id" value={producto.proveedor_id} />
          )}

          <div className="modal-body">

            {/* ── Identificación ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Identificación</span>
              <div className="ter-form-grid">
                {/* Lo primero, porque cambia el resto del formulario (unidad, almacén). */}
                {mixto && (
                  <div className="input-group ter-col-span-3">
                    <div className="form-label-with-help">
                      <label htmlFor="prd-tipo">¿Qué es? <span className="required">*</span></label>
                      <FormHelp label="Para qué sirve el tipo"
                        text="Los dos se venden igual en el mostrador. El tipo importa el día que contrates Inventario (los físicos llevan existencias) o Servicios (los servicios se pueden contratar por meses)." />
                    </div>
                    <select id="prd-tipo" className="input" value={tipo}
                      onChange={e => setTipoElegido(e.target.value as TipoProducto)}>
                      <option value="PRODUCTO">Producto físico</option>
                      <option value="SERVICIO">Servicio</option>
                    </select>
                  </div>
                )}
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
                    <UnidadSelect defaultValue={producto?.unidad} sugerida={unidadSugerida} />
                  </div>
                )}
                <div className={`input-group ${catSpan}`}>
                  <label>Categoría</label>
                  <select className="input" name="categoria_id"
                    value={categoriaId} onChange={e => setCategoriaId(e.target.value)}>
                    <option value="">— Sin categoría —</option>
                    {categoriasActivas.map(c => (
                      <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>
                    ))}
                    {/* La que ya tiene asignada se conserva aunque esté archivada: si no,
                        editar el precio de una ficha vieja le cambiaría la categoría. */}
                    {categoriaId && !categoriasActivas.some(c => c.categoria_id === categoriaId) && (
                      <option value={categoriaId}>
                        {categorias.find(c => c.categoria_id === categoriaId)?.nombre ?? categoriaId}
                      </option>
                    )}
                  </select>
                </div>
                {/* Los proveedores son por-empresa (third_parties): con 2+ empresas, se
                    elige primero la empresa para no ofrecer un mismo proveedor real
                    repetido sin decir a cuál pertenece cada fila (patrón de Suscripciones). */}
                {hayProveedores && empresas.length > 1 && (
                  <div className={`input-group ${provSpan}`}>
                    <label>Empresa del proveedor</label>
                    <select className="input" value={proveedorEmpresaId}
                      onChange={e => onProveedorEmpresaChange(e.target.value)}>
                      {empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
                    </select>
                  </div>
                )}
                {hayProveedores && (
                  <div className={`input-group ${provSpan}`}>
                    <label>Proveedor</label>
                    <select className="input" name="proveedor_id" value={proveedorId}
                      onChange={e => setProveedorId(e.target.value)}>
                      <option value="">— Sin especificar —</option>
                      {proveedoresDeEmpresa.map(p => (
                        <option key={p.tercero_id} value={p.tercero_id}>{p.nombre}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="input-group ter-col-full">
                  <label>Descripción</label>
                  {tieneIa && (
                    <button type="button" className="btn btn-ia btn-sm cat-ia-btn" onClick={sugerirConIa}
                      disabled={sugiriendo}
                      title={esServicio
                        ? 'Sugiere la descripción y la categoría a partir del nombre'
                        : 'Sugiere la descripción, la unidad y la categoría a partir del nombre'}>
                      {sugiriendo ? <Loader2 size={14} strokeWidth={2} className="img-upload-spin" /> : <IaSparkle size={14} />}
                      {sugiriendo ? 'Pensando…' : 'Completar con IA'}
                    </button>
                  )}
                  <textarea className="input input-textarea" name="descripcion" rows={2}
                    value={descripcion} onChange={e => setDescripcion(e.target.value)}
                    placeholder={`Descripción detallada del ${nombreTipo}…`} />
                </div>
              </div>
            </div>

            {/* ── Precios (y costos, si alguien los lee) ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">{usaCostes ? 'Precios y costos' : 'Precios de venta'}</span>
              <div className={usaCostes ? 'grid-cols-2' : undefined}>
                {/* La nota va DENTRO de la columna del editor, no como celda propia de la
                    rejilla: suelta ocupaba el segundo hueco y empujaba «Costos» a la fila
                    de abajo, descuadrando las dos columnas. */}
                <div>
                  {/* La etiqueta dice lo que ES: en un suscribible, «Precios de venta»
                      oculta lo único que importa del importe —que se cobra cada mes—.
                      Misma regla que rotular «Coste de compras del período» sin Inventario. */}
                  <PreciosCostosEditor
                    label={esSuscribible ? 'Precio al mes' : 'Precios de venta'}
                    rows={precios} onChange={setPrecios} monedasDisponibles={monedasDisponibles} />
                  {esSuscribible && (
                    <span className="input-hint">
                      Se guarda siempre por mes: el importe de cada cobro lo calcula la
                      periodicidad del acuerdo.
                    </span>
                  )}
                </div>
                {usaCostes && (
                  <PreciosCostosEditor label="Costos" rows={costos} onChange={setCostos} monedasDisponibles={monedasDisponibles} />
                )}
              </div>
            </div>

            {/* ── Suscripción (solo SERVICIO, y solo con el módulo Servicios: en el
                catálogo del mostrador no hay acuerdos que contratar) ── */}
            {esServicio && usaSuscripciones && (
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
                      <div className="form-label-with-help">
                        <label>Periodicidad por defecto</label>
                        <FormHelp text="Se usará al crear una suscripción; se puede cambiar por cliente." label="Información sobre la periodicidad" />
                      </div>
                      <select className="input" value={periodicidad}
                        onChange={e => setPeriodicidad(e.target.value)}>
                        <option value="MENSUAL">Mensual</option>
                        <option value="TRIMESTRAL">Trimestral</option>
                        <option value="SEMESTRAL">Semestral</option>
                        <option value="ANUAL">Anual</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Stock (solo PRODUCTO físico) ── */}
            {tipo === 'PRODUCTO' && llevaExistencias && (
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
                        <div className="form-label-with-help">
                          <label>Stock actual</label>
                          <FormHelp text="Ajusta el stock desde el botón correspondiente." label="Cómo ajustar el stock" />
                        </div>
                        <input className="input input-static" readOnly
                          value={`${producto?.stock_actual ?? 0} ${producto?.unidad ?? ''}`} />
                      </div>
                    )}
                    <div className="input-group ter-col-span-3">
                      <div className="form-label-with-help">
                        <label>Stock mínimo (todos los almacenes)</label>
                        <FormHelp text="Aviso cuando el stock baje de este nivel. Puedes afinarlo por almacén desde la ficha del producto." label="Información sobre el stock mínimo" />
                      </div>
                      <input className="input" type="text" inputMode="decimal" name="stock_minimo"
                        defaultValue={textoNumeroEs(producto?.stock_minimo ?? 0)} placeholder="0" />
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
