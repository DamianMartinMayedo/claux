'use client'

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link                         from 'next/link'
import { useRouter }                from 'next/navigation'
import {
  archivarProducto,
  restaurarProducto,
  guardarStockMinimoAlmacen,
  type ProductoDetalleData,
  type MovimientoProducto,
} from '@/app/actions/portal/productos'
import { estadoStock, minimoAplicable, ESTADO_STOCK_BADGE, ESTADO_STOCK_LABEL } from '@/lib/inventario/stock'
import { parseNumeroEs, textoNumeroEs } from '@/lib/numeros'
import { ProductoFormModal } from '../_ProductoFormModal'
import { StockAjusteModal } from '../_StockAjusteModal'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { RowActions } from '@/components/portal/RowActions'
import Tabs, { type TabItem } from '@/components/Tabs'
import { useOrden, ThOrden } from '@/components/TableSort'
import { AlertTriangle, Archive, CalendarClock, ExternalLink, Layers, Package, Pencil, RotateCcw, TrendingUp } from 'lucide-react'
import { fmtFechaEs } from '@/lib/date-utils'

// ── Config de movimientos ───────────────────────────────────────────────────────

const MOV_TIPO_LABEL: Record<MovimientoProducto['tipo'], string> = {
  ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste', TRANSFERENCIA: 'Transferencia',
}
const MOV_TIPO_BADGE: Record<MovimientoProducto['tipo'], string> = {
  ENTRADA: 'badge-success', SALIDA: 'badge-warning', AJUSTE: 'badge-info', TRANSFERENCIA: 'badge-purple',
}
function signoMov(m: MovimientoProducto): { txt: string; cls: string } {
  const n = Math.abs(m.cantidad).toLocaleString('es-ES')
  if (m.tipo === 'ENTRADA') return { txt: `+${n}`, cls: 'mov-cant-pos' }
  if (m.tipo === 'SALIDA')  return { txt: `−${n}`, cls: 'mov-cant-neg' }
  if (m.tipo === 'AJUSTE')  return { txt: m.cantidad >= 0 ? `+${n}` : `−${n}`, cls: m.cantidad >= 0 ? 'mov-cant-pos' : 'mov-cant-neg' }
  return { txt: n, cls: 'mov-cant-neutral' }
}

// ── Helpers de formato ────────────────────────────────────────────────────────

function fmt(n: number, moneda: string) {
  return new Intl.NumberFormat('es-ES', {
    style:    'currency',
    currency: moneda,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/** Solo para `timestamptz` (created_at/updated_at): el instante es real. Una columna
 *  `date` va por `fmtFechaEs`, o en La Habana se retrasa un día. */
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Campos info ───────────────────────────────────────────────────────────────

function Campo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="det-label">{label}</div>
      <div className="det-value">{value ?? <span className="text-faint">—</span>}</div>
    </div>
  )
}

// ── Mínimo por almacén (mig. 153) ─────────────────────────────────────────────
//
// El mínimo de la ficha es UNO para todo el cliente, pero el stock vive por
// almacén y los almacenes son de empresas distintas: un local puede quedarse a
// cero mientras el consolidado va sobrado. Aquí se afina, que es donde ya se ve el
// reparto. Vacío = «este almacén se rige por el global», no «mínimo cero».

function FilaAlmacen({
  fila, unidad, minimoGlobal, producto_id, puedeEditar,
}: {
  fila: ProductoDetalleData['stock_por_almacen'][number]
  unidad: string
  minimoGlobal: number
  producto_id: string
  puedeEditar: boolean
}) {
  const [editando, setEditando] = useState(false)
  const [texto,    setTexto]    = useState(fila.minimo != null ? textoNumeroEs(fila.minimo) : '')
  const [pending,  start]       = useTransition()
  const router = useRouter()

  const minimo = minimoAplicable(fila.minimo, minimoGlobal)
  const estado = estadoStock(fila.cantidad, minimo)

  function guardar() {
    const limpio = texto.trim()
    if (limpio && !/^\d+([.,]\d+)?$/.test(limpio)) { toastError('Escribe un número, o déjalo vacío.'); return }
    // El toast de carga se crea ANTES de la transición: dentro no llega a pintarse.
    const t = toastLoading('Guardando mínimo…')
    start(async () => {
      const r = await guardarStockMinimoAlmacen(producto_id, fila.almacen_id, limpio ? parseNumeroEs(limpio) : null)
      t.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo guardar.'); return }
      toastSuccess(limpio ? 'Mínimo actualizado.' : 'Este almacén vuelve al mínimo general.')
      setEditando(false)
      router.refresh()
    })
  }

  return (
    <div className="det-stock-alm-row">
      <span className="det-stock-alm-nombre">{fila.nombre}</span>
      {estado !== 'ok' && (
        <span className={`badge ${ESTADO_STOCK_BADGE[estado]}`}>{ESTADO_STOCK_LABEL[estado]}</span>
      )}
      <strong>{fila.cantidad.toLocaleString('es-ES')} {unidad}</strong>
      {editando ? (
        <span className="det-stock-alm-min">
          <input className="input input-sm det-stock-alm-input" type="text" inputMode="decimal"
            aria-label={`Stock mínimo en ${fila.nombre}`} value={texto} autoFocus
            placeholder={`General: ${minimoGlobal.toLocaleString('es-ES')}`}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardar() } }} />
          <button type="button" className="btn btn-primary btn-sm" onClick={guardar} disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditando(false)} disabled={pending}>
            Cancelar
          </button>
        </span>
      ) : puedeEditar ? (
        <button type="button" className="det-stock-alm-min-btn" onClick={() => setEditando(true)}
          aria-label={`Editar el stock mínimo en ${fila.nombre}`}>
          {fila.minimo != null
            ? <>Mín. {fila.minimo.toLocaleString('es-ES')}</>
            : <span className="text-faint">Mín. general</span>}
          <Pencil size={12} strokeWidth={2} />
        </button>
      ) : (
        // Sin permiso de edición: el mínimo sigue siendo información, pero no se toca.
        <span className="det-stock-alm-min">
          {fila.minimo != null
            ? <span className="text-xs-muted">Mín. {fila.minimo.toLocaleString('es-ES')}</span>
            : <span className="text-faint">Mín. general</span>}
        </span>
      )}
    </div>
  )
}

// ── Tab: Información ──────────────────────────────────────────────────────────

function TabInfo({ data, puedeEditar }: { data: ProductoDetalleData; puedeEditar: boolean }) {
  const { producto, categoria, proveedor, stock_por_almacen } = data
  const esServicio = producto.tipo === 'SERVICIO'
  const stockBajo  = producto.stock_actual <= producto.stock_minimo && producto.stock_minimo > 0
  // Sin Inventario no hay existencias que enseñar, ni tipo que distinguir.
  const inv        = data.tieneInventario

  return (
    <div className="det-tab-body">
      {/* Datos generales */}
      <div className="det-card">
        <div className="det-section-title">Datos generales</div>
        <div className="det-field-grid">
          <Campo label="Nombre"      value={producto.nombre} />
          <Campo label="Código"      value={<code className="text-mono">{producto.codigo}</code>} />
          {inv && <Campo label="Tipo" value={
            <span className={`badge ${esServicio ? 'badge-purple' : 'badge-info'}`}>
              {esServicio ? 'Servicio' : 'Producto'}
            </span>
          } />}
          <Campo label="Estado"      value={
            <span className={`badge ${producto.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
              {producto.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
            </span>
          } />
          {!esServicio && <Campo label="Unidad" value={producto.unidad} />}
          <Campo label="Categoría"   value={categoria?.nombre} />
          {/* Proveedor: dos filas que en un cliente solo-Caja dicen «—» y nada más. No hay
              compras ni sugerencias que las lean, y tampoco una página de Terceros donde
              crear uno. Se enseñan si alguien las usa (`usaCostes`) o si esta ficha trae el
              dato de antes: un dato que existe no se esconde. */}
          {(data.usaCostes || proveedor) && (
            <Campo label="Proveedor" value={proveedor ? (
              <Link href={`/portal/terceros/${proveedor.tercero_id}`} className="link-primary">
                {proveedor.nombre}
              </Link>
            ) : null} />
          )}
          {(data.usaCostes || producto.codigo_proveedor) && (
            <Campo label="Cód. proveedor" value={producto.codigo_proveedor} />
          )}
          {esServicio && <Campo label="Se puede suscribir" value={producto.es_suscribible ? 'Sí' : 'No'} />}
        </div>
        {producto.descripcion && (
          <div className="mt-5">
            <div className="det-label">Descripción</div>
            <div className="det-value det-value-pre">{producto.descripcion}</div>
          </div>
        )}
      </div>

      {/* Stock (solo productos, y solo con Inventario) */}
      {inv && !esServicio && (
        <div className="det-card">
          <div className="det-section-title">Inventario</div>
          <div className="det-field-grid-sm">
            <div>
              <div className="det-label">Stock total</div>
              <div className={`det-stock-num${stockBajo ? ' det-stock-num-low' : ''}`}>
                {producto.stock_actual.toLocaleString('es-ES')}
                <span className="det-stock-unit">{producto.unidad}</span>
              </div>
              {stockBajo && (
                <div className="det-stock-alert">
                  <AlertTriangle size={13} strokeWidth={2} /> Stock por debajo del mínimo
                </div>
              )}
            </div>
            <Campo label="Stock mínimo" value={`${producto.stock_minimo.toLocaleString('es-ES')} ${producto.unidad}`} />
          </div>

          {stock_por_almacen.length > 0 ? (
            <div className="det-stock-almacenes">
              {stock_por_almacen.map(s => (
                <FilaAlmacen key={s.almacen_id} fila={s} unidad={producto.unidad}
                  minimoGlobal={producto.stock_minimo} producto_id={producto.producto_id}
                  puedeEditar={puedeEditar} />
              ))}
            </div>
          ) : (
            <div className="text-xs-hint mt-2">Sin stock asignado a almacenes todavía. Usa «Ajustar stock» o confirma una compra.</div>
          )}
        </div>
      )}

      {/* Metadatos */}
      <div className="det-card">
        <div className="det-section-title">Registro</div>
        <div className="det-field-grid">
          <Campo label="Creado"       value={fmtDate(producto.created_at)} />
          <Campo label="Actualizado"  value={fmtDate(producto.updated_at)} />
          <Campo label="ID interno"   value={<code className="code-id">{producto.producto_id}</code>} />
        </div>
      </div>
    </div>
  )
}

// ── Tab: Precios y costos ─────────────────────────────────────────────────────

function TabPrecios({ data }: { data: ProductoDetalleData }) {
  const { producto, monedas } = data
  // Sin `inventario` ni `base` nadie lee los costes, así que «Costo» y «Margen» eran dos
  // columnas de guiones. Si la ficha ya tiene costes escritos (importados, o de cuando el
  // módulo estaba contratado) se enseñan igual: lo que hay, se ve.
  const conCostes = data.usaCostes || Object.keys(producto.costos).length > 0

  const allMonedas = Array.from(new Set([
    ...monedas,
    ...Object.keys(producto.precios),
    ...Object.keys(producto.costos),
  ]))

  // Monedas ACTIVAS del negocio que este servicio no tiene tarifadas.
  const sinTarifa = monedas.filter(m => !(Number(producto.precios[m]) > 0))

  return (
    <div className="det-tab-body">
      <div className="det-card">
        <div className="det-section-title">{conCostes ? 'Tabla de precios y costos' : 'Tabla de precios'}</div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Moneda</th>
                <th className="col-num">Precio de venta</th>
                {conCostes && <th className="col-num">Costo</th>}
                {conCostes && <th className="col-num">Margen</th>}
              </tr>
            </thead>
            <tbody>
              {allMonedas.map((mon) => {
                const precio = producto.precios[mon] ?? 0
                const costo  = producto.costos[mon]  ?? 0
                const margenNum = precio > 0 && costo > 0 ? (precio - costo) / precio * 100 : null
                const margenCls = margenNum === null ? '' : margenNum > 20 ? 'prd-margen-alto' : margenNum > 0 ? 'prd-margen-bajo' : 'prd-margen-neg'

                return (
                  <tr key={mon}>
                    <td data-label="Moneda">
                      <span className="prd-moneda-badge">{mon}</span>
                    </td>
                    <td data-label="Precio de venta" className="col-num">
                      {precio > 0 ? fmt(precio, mon) : <span className="text-faint">—</span>}
                    </td>
                    {conCostes && (
                      <td data-label="Costo" className="col-num">
                        {costo > 0 ? fmt(costo, mon) : <span className="text-faint">—</span>}
                      </td>
                    )}
                    {conCostes && (
                      <td data-label="Margen" className="col-num">
                        {margenNum !== null ? (
                          <span className={`prd-margen ${margenCls}`}>{margenNum.toFixed(1)}%</span>
                        ) : <span className="text-faint">—</span>}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* INFORMACIÓN, nunca bloqueo (el patrón de «Revisar» de Inventario): en un
            servicio suscribible, la moneda sin tarifa no impide nada —el precio se pacta
            en el acuerdo— pero saber cuál falta es lo que permite decidir. */}
        {producto.tipo === 'SERVICIO' && sinTarifa.length > 0 && (
          <p className="det-nota">
            Sin tarifa en {sinTarifa.join(', ')}. No hace falta para contratar —el precio
            se pacta en cada acuerdo—, pero ponerla aquí precarga el alta.
          </p>
        )}
      </div>

      {/* Se agenda: solo lectura y solo si Citas está contratado y hay vínculo. El
          puente es blando y en UNA dirección (mig. 119): Citas sigue funcionando sola. */}
      {data.agenda && (
        <div className="det-card">
          <div className="det-section-title">En tu agenda</div>
          <p className="det-nota det-nota-link">
            <CalendarClock size={15} strokeWidth={2} />
            Se agenda como «{data.agenda.nombre}»: {data.agenda.duracion_minutos} min.
            <Link href="/portal/citas" className="table-name-link">Ver en Citas</Link>
          </p>
        </div>
      )}
    </div>
  )
}

// ── Tab: Contratado por (solo servicios) ──────────────────────────────────────
//
// La pantalla que no existía y sin la cual **subir una tarifa se decide a ciegas**: aquí
// están los diez precios distintos que el mismo servicio tiene pactados, y por eso se
// entiende sin explicarlo que el precio del catálogo NO repise los acuerdos vivos.

const PERIODICIDAD_LABEL: Record<string, string> = {
  MENSUAL: 'Mensual', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual',
}
const ESTADO_ACUERDO_BADGE: Record<string, string> = {
  ACTIVA: 'badge-success', PAUSADA: 'badge-info', VENCIDA: 'badge-warning', CANCELADA: 'badge-neutral',
}
const ESTADO_ACUERDO_LABEL: Record<string, string> = {
  ACTIVA: 'Activa', PAUSADA: 'Pausada', VENCIDA: 'Vencida', CANCELADA: 'Cancelada',
}

function TabContratos({ data }: { data: ProductoDetalleData }) {
  const { contratos } = data
  const ord = useOrden(contratos, {
    cliente:      { label: 'Cliente',              valor: c => c.cliente_nombre },
    precio:       { label: 'Precio pactado / mes', valor: c => c.precio_mensual },
    periodicidad: { label: 'Periodicidad',         valor: c => PERIODICIDAD_LABEL[c.periodicidad] ?? c.periodicidad },
    desde:        { label: 'Desde',                valor: c => c.fecha_inicio },
    estado:       { label: 'Estado',               valor: c => ESTADO_ACUERDO_LABEL[c.estado] ?? c.estado },
  })
  // Lo que aporta al mes, por moneda y SOLO de los vivos: sumar un cancelado sería
  // contar dinero que ya no entra. Nunca se suman monedas distintas.
  const porMoneda = new Map<string, number>()
  for (const c of contratos) {
    if (c.estado !== 'ACTIVA') continue
    porMoneda.set(c.moneda, (porMoneda.get(c.moneda) ?? 0) + c.equivalente_mes)
  }

  return (
    <div className="det-tab-body">
      <div className="det-card">
        <div className="det-section-title">Quién lo tiene contratado</div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <ThOrden orden={ord} clave="cliente" />
                <ThOrden orden={ord} clave="precio" className="col-num" />
                <ThOrden orden={ord} clave="periodicidad" />
                <ThOrden orden={ord} clave="desde" />
                <ThOrden orden={ord} clave="estado" />
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {ord.filas.map(c => (
                <tr key={c.suscripcion_id}>
                  <td data-label="Cliente"><strong className="text-sm-bold cell-clamp">{c.cliente_nombre}</strong></td>
                  <td data-label="Precio pactado / mes" className="col-num">
                    {c.precio_mensual.toLocaleString('es-ES', { minimumFractionDigits: 2 })} {c.moneda}
                  </td>
                  <td data-label="Periodicidad" className="text-sm-muted">
                    {PERIODICIDAD_LABEL[c.periodicidad] ?? c.periodicidad}
                  </td>
                  <td data-label="Desde" className="text-sm-muted">{fmtFechaEs(c.fecha_inicio)}</td>
                  <td data-label="Estado">
                    <span className={`badge ${ESTADO_ACUERDO_BADGE[c.estado] ?? 'badge-neutral'}`}>
                      {ESTADO_ACUERDO_LABEL[c.estado] ?? c.estado}
                    </span>
                  </td>
                  <td className="col-actions">
                    <Link href="/portal/suscripciones" className="ter-action-btn"
                      title="Ver en Suscripciones" aria-label="Ver en Suscripciones">
                      <ExternalLink size={15} strokeWidth={2} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="det-nota">
          Aporta al mes{' '}
          {[...porMoneda.entries()]
            .map(([m, t]) => `${t.toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${m}`)
            .join(' · ') || '—'}
          {' '}(solo los acuerdos vivos, con su descuento aplicado).
        </p>
      </div>
    </div>
  )
}

// ── Tab: Movimientos (placeholder) ────────────────────────────────────────────

function TabMovimientos({ data }: { data: ProductoDetalleData }) {
  const { movimientos, almacen_nombres, producto } = data
  // Ordenar va ANTES de paginar: al revés se ordenaría solo la página visible.
  const ord = useOrden(movimientos, {
    fecha:    { label: 'Fecha',    valor: m => m.fecha },
    tipo:     { label: 'Tipo',     valor: m => m.tipo },
    almacen:  { label: 'Almacén',  valor: m => almacen_nombres[m.almacen_id] ?? m.almacen_id },
    // Con el signo que se ve en la celda: una salida ordena por debajo de una entrada.
    cantidad: { label: 'Cantidad', valor: m => m.tipo === 'SALIDA' ? -m.cantidad : m.cantidad },
    motivo:   { label: 'Motivo',   valor: m => m.motivo },
    origen:   { label: 'Origen',   valor: m => m.origen },
  })
  const { pageItems, ...pag } = usePagination(ord.filas)

  if (movimientos.length === 0) {
    return (
      <div className="det-empty">
        <div className="det-empty-icon"><Package size={40} strokeWidth={1} opacity={0.2} /></div>
        <div className="det-empty-title">Sin movimientos</div>
        <div className="det-empty-text">Aquí se mostrarán entradas, salidas, ajustes y transferencias de este producto.</div>
      </div>
    )
  }

  return (
    <div className="det-tab-body">
      <div className="det-card">
        <div className="det-section-title">Movimientos</div>
        {/* El historial de la ficha lleva techo (los últimos 100). Recortaba sin decirlo, así
            que en un producto con rotación la ficha parecía tener toda su historia y no la
            tenía. Aquí no hay «traer más» a propósito: para el ledger completo está la
            pantalla de Movimientos, que sí filtra por rango. */}
        {data.movimientosTotal > movimientos.length && (
          <p className="listado-tope">
            Se enseñan los <strong>{movimientos.length} más recientes</strong> de {data.movimientosTotal}.
            {' '}El historial completo está en Movimientos, filtrando por rango.
          </p>
        )}
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <ThOrden orden={ord} clave="fecha" />
                <ThOrden orden={ord} clave="tipo" />
                <ThOrden orden={ord} clave="almacen" />
                <ThOrden orden={ord} clave="cantidad" className="col-num" />
                <ThOrden orden={ord} clave="motivo" />
                <ThOrden orden={ord} clave="origen" />
              </tr>
            </thead>
            <tbody>
              {pageItems.map(m => {
                const s = signoMov(m)
                return (
                  <tr key={m.movimiento_id}>
                    <td data-label="Fecha" className="text-sm-muted">{fmtFechaEs(m.fecha)}</td>
                    <td data-label="Tipo"><span className={`badge ${MOV_TIPO_BADGE[m.tipo]}`}>{MOV_TIPO_LABEL[m.tipo]}</span></td>
                    <td data-label="Almacén" className="text-sm-muted">
                      {m.tipo === 'TRANSFERENCIA' && m.almacen_destino_id
                        ? `${almacen_nombres[m.almacen_id] ?? m.almacen_id} → ${almacen_nombres[m.almacen_destino_id] ?? m.almacen_destino_id}`
                        : (almacen_nombres[m.almacen_id] ?? m.almacen_id)}
                    </td>
                    <td data-label="Cantidad" className={`col-num ${s.cls}`}>{s.txt} {producto.unidad}</td>
                    <td data-label="Motivo" className="text-sm-muted"><span className="cell-clamp">{m.motivo ?? '—'}</span></td>
                    <td data-label="Origen">
                      {m.origen === 'MANUAL'
                        ? <span className="text-xs-muted">Manual</span>
                        : <span className="badge badge-neutral">{m.origen === 'COMPRA' ? 'Compra' : 'Venta'}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <TablePagination {...pag} label="movimiento" />
      </div>
    </div>
  )
}

// ── Tab: Historial de precios ──────────────────────────────────────────────────

const HistorialPreciosChart = dynamic(() => import('./HistorialPreciosChart'), { ssr: false })

function TabHistorialPrecios({ data }: { data: ProductoDetalleData }) {
  const { historialPrecios } = data

  // Agrupar por moneda (el historial ya viene ordenado del más reciente al más antiguo)
  const porMoneda = useMemo(() => {
    const m = new Map<string, typeof historialPrecios>()
    for (const h of historialPrecios) {
      const arr = m.get(h.moneda) ?? []
      arr.push(h)
      m.set(h.moneda, arr)
    }
    return m
  }, [historialPrecios])

  const monedas = [...porMoneda.keys()]
  const [monedaSel, setMonedaSel] = useState(monedas[0] ?? '')

  if (historialPrecios.length === 0) {
    return (
      <div className="det-empty">
        <div className="det-empty-icon"><TrendingUp size={40} strokeWidth={1} opacity={0.2} /></div>
        <div className="det-empty-title">Historial de precios</div>
        <div className="det-empty-text">Aquí verás los cambios de precio y costo cuando los edites.</div>
      </div>
    )
  }

  const sel   = porMoneda.has(monedaSel) ? monedaSel : monedas[0]
  const items = porMoneda.get(sel) ?? []

  return (
    <div className="det-tab-body">
      <div className="det-card">
        <div className="det-section-head">
          <div className="det-section-title">Historial de precios</div>
          {monedas.length > 1 && (
            <div className="dash-moneda-switch" role="tablist" aria-label="Moneda">
              {monedas.map(m => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={m === sel}
                  className={m === sel ? 'active' : ''}
                  onClick={() => setMonedaSel(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="dash-split">
          <div className="dash-split-main">
            {items.length >= 2 ? (
              <HistorialPreciosChart historial={items} moneda={sel} />
            ) : (
              <p className="text-xs-hint">Se necesitan al menos dos registros para dibujar la evolución.</p>
            )}
          </div>
          <div className="dash-split-side">
            <div className="dash-subtitle"><span>Cambios registrados</span></div>
            {/* Mismo patrón que «Últimas facturas» del dashboard (.dash-list):
                es una lista de eventos junto a un gráfico, no un dataset que se
                ordene o se recorra en columnas. Cada fila es la FOTO del estado
                tras el cambio (precio y costo vigentes), no un delta: null =
                ese producto no tiene ese importe en esta moneda. */}
            <ul className="dash-list">
              {items.map(h => (
                <li key={h.historial_id} className="dash-list-item">
                  <div className="dash-list-main">
                    <span className="dash-list-title">{fmtDate(h.created_at)}</span>
                    {h.costo != null && (
                      <span className="dash-list-meta">Costo {fmt(h.costo, sel)}</span>
                    )}
                  </div>
                  <span className="dash-list-aside">
                    <span className="dash-list-amount">
                      {h.precio != null ? fmt(h.precio, sel) : '—'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

type TabId = 'info' | 'precios' | 'contratos' | 'movimientos' | 'historial'

export default function ProductoDetalle({ data: initialData, puedeEditar }: { data: ProductoDetalleData; puedeEditar: boolean }) {
  const [data,        setData]        = useState(initialData)
  const [tab,         setTab]         = useState<TabId>('info')
  const [showEdit,    setShowEdit]    = useState(false)
  const [showStock,   setShowStock]   = useState(false)
  const [pending,     startT]         = useTransition()
  const router = useRouter()

  // Mantener el estado local sincronizado con los datos refrescados por router.refresh()
  useEffect(() => { setData(initialData) }, [initialData])

  const { producto } = data
  const esServicio   = producto.tipo === 'SERVICIO'
  const inv          = data.tieneInventario
  // Una ficha SIN su módulo solo puede venir de la página de Caja: es la que cataloga
  // lo que el cliente no tiene dónde poner (un físico sin Inventario, un servicio sin
  // Servicios). Se deduce igual que en la lista.
  const mostrador    = esServicio ? !data.tieneServicios : !inv
  const basePath     = mostrador  ? '/portal/caja/productos'
                     : esServicio ? '/portal/servicios'
                     :              '/portal/productos'
  // En el mostrador de quien no tiene ninguno de los dos módulos, la lista lleva los dos
  // tipos y el rótulo de «volver» tiene que decirlo.
  const tituloLista  = mostrador && !inv && !data.tieneServicios
                     ? `Productos y ${data.etiquetaServicio.toLowerCase()}s`
                     : esServicio ? `${data.etiquetaServicio}s` : 'Productos'

  const tabs: TabItem<TabId>[] = [
    { id: 'info',    label: 'Información' },
    { id: 'precios', label: data.usaCostes || Object.keys(producto.costos).length > 0 ? 'Precios y costos' : 'Precios' },
    // «Contratado por» solo en servicios, y solo si alguien lo tiene: una pestaña vacía
    // en el 90 % de las fichas es ruido.
    ...(esServicio && data.contratos.length
      ? [{ id: 'contratos' as const, label: 'Contratado por', count: data.contratos.length }]
      : []),
    // Movimientos exige Inventario Y que sea un físico: sin el módulo no hay ledger
    // que enseñar, y un servicio no mueve existencias ni teniéndolo.
    ...(inv && !esServicio ? [{ id: 'movimientos' as const, label: 'Movimientos' }] : []),
    { id: 'historial', label: 'Historial de precios' },
  ]

  function handleSaved() {
    setShowStock(false)
    toastSuccess('Stock actualizado')
    router.refresh()
  }

  function toggleEstado() {
    const fn = producto.estado === 'ACTIVO' ? archivarProducto : restaurarProducto
    const ld = toastLoading(producto.estado === 'ACTIVO' ? 'Archivando…' : 'Restaurando…')
    startT(async () => {
      const res = await fn(producto.producto_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      setData(prev => ({
        ...prev,
        producto: { ...prev.producto, estado: prev.producto.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO' },
      }))
      toastSuccess(producto.estado === 'ACTIVO' ? 'Producto archivado' : 'Producto restaurado')
    })
  }

  return (
    <div className="view-container">

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href={basePath}>{tituloLista}</Link>
        <span>›</span>
        <span className="breadcrumb-current">{producto.nombre}</span>
      </div>

      {/* Header */}
      <div className="det-page-header">
        <div>
          <div className="det-title-group">
            <h1 className="det-page-title">{producto.nombre}</h1>
            {inv && (
              <span className={`badge ${esServicio ? 'badge-purple' : 'badge-info'}`}>
                {esServicio ? 'Servicio' : 'Producto'}
              </span>
            )}
            <span className={`badge ${producto.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
              {producto.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
            </span>
          </div>
          <div className="det-meta-row">
            <code className="code-label">{producto.codigo}</code>
            {producto.codigo_proveedor && (
              <span className="ml-3">Cód. proveedor: <strong>{producto.codigo_proveedor}</strong></span>
            )}
          </div>
        </div>

        {/* Acciones (solo con permiso de edición) */}
        {puedeEditar && (
          <div className="det-actions">
            {inv && !esServicio && producto.estado === 'ACTIVO' && (
              <button onClick={() => setShowStock(true)} className="btn btn-primary">
                <Layers size={14} strokeWidth={2} /> Ajustar stock
              </button>
            )}
            <button onClick={() => setShowEdit(true)} className="btn btn-secondary">
              <Pencil size={14} strokeWidth={2} /> Editar
            </button>
            <RowActions>
              <button
                className={`row-actions-item${producto.estado === 'ACTIVO' ? ' row-actions-item-danger' : ''}`}
                onClick={toggleEstado}
                disabled={pending}
              >
                {producto.estado === 'ACTIVO' ? <><Archive size={15} strokeWidth={2} /> Archivar</> : <><RotateCcw size={15} strokeWidth={2} /> Restaurar</>}
              </button>
            </RowActions>
          </div>
        )}
      </div>

      {/* Status message */}

      {/* Tabs */}
      <Tabs ariaLabel="Secciones del producto" active={tab} onChange={setTab} tabs={tabs} />


      {/* Contenido del tab */}
      {tab === 'info'        && <TabInfo     data={data} puedeEditar={puedeEditar} />}
      {tab === 'precios'     && <TabPrecios  data={data} />}
      {tab === 'contratos'   && <TabContratos data={data} />}
      {tab === 'movimientos' && <TabMovimientos data={data} />}
      {tab === 'historial'   && <TabHistorialPrecios data={data} />}

      {/* Modal de ajuste de stock */}
      {showStock && (
        <StockAjusteModal
          producto_id={producto.producto_id}
          nombre={producto.nombre}
          unidad={producto.unidad}
          almacenes={data.almacenes}
          onClose={() => setShowStock(false)}
          onSaved={handleSaved}
        />
      )}

      {/* Modal de edición */}
      {showEdit && (
        <ProductoFormModal
          producto={data.producto}
          categorias={data.categorias}
          proveedores={data.proveedores}
          empresas={data.empresas}
          monedas={data.monedas}
          llevaExistencias={inv}
          hayAlmacenes={data.almacenes.length > 0}
          modo={producto.tipo}
          usaCostes={data.usaCostes}
          usaSuscripciones={data.tieneServicios}
          etiquetaServicio={data.etiquetaServicio}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false)
            toastSuccess('Cambios guardados')
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

