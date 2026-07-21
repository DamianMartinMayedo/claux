'use client'

import { useState, useTransition } from 'react'
import dynamic                      from 'next/dynamic'
import Link                         from 'next/link'
import { useRouter }                from 'next/navigation'
import {
  archivarTercero,
  restaurarTercero,
  copiarTerceroAEmpresa,
  type TerceroDetalleData,
  type TerceroHistorial,
  type TerceroProducto,
  type TerceroCxP,
  type TipoTercero,
  type ViaPago,
} from '@/app/actions/portal/terceros'
import { TerceroFormModal, ViaBadge } from '../_TerceroFormModal'
import CopiarAEmpresaModal from '@/components/portal/CopiarAEmpresaModal'
import { RowActions } from '@/components/portal/RowActions'
import Tabs, { type TabItem } from '@/components/Tabs'
import { Activity, Archive, Copy, CreditCard, FileText, Mail, Package, Pencil, Phone, RotateCcw, Repeat } from 'lucide-react'
import type { TerceroSuscripcion } from '@/lib/suscripciones'

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPO_LABEL: Record<TipoTercero, string> = {
  CLIENTE:   'Cliente',
  PROVEEDOR: 'Proveedor',
  AMBOS:     'Ambos',
}

const CONDICION_LABEL: Record<string, string> = {
  CONTADO: 'Contado',
  '15': '15 días', '30': '30 días', '60': '60 días', '90': '90 días',
}

const TIPO_BADGE: Record<TipoTercero, string> = {
  CLIENTE:   'badge-info',
  PROVEEDOR: 'badge-success',
  AMBOS:     'badge-amber',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const OPTS_FECHA = { day: '2-digit', month: 'short', year: 'numeric' } as const

/** Para timestamptz (created_at/updated_at): el instante es real, se localiza. */
function fmtTimestamp(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('es-ES', OPTS_FECHA)
}

/**
 * Para columnas `date` ('YYYY-MM-DD'): fecha_inicio/fin_contrato y la fecha de
 * los documentos. NO puede pasar por `new Date(iso)`, que la lee como medianoche
 * UTC y en La Habana (UTC−4) la retrasa un día entero.
 */
function fmtFecha(iso: string | null) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', OPTS_FECHA)
}

function fmtMoneda(n: number, moneda: string) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: moneda,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)
}

function Campo({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <div className="det-label">{label}</div>
      <div className="det-value">{value ?? <span className="text-faint">—</span>}</div>
    </div>
  )
}

// ── Detalle de vía de pago ────────────────────────────────────────────────────

// La moneda no se lista: ya va en el badge de la cabecera.
function ViaDetalle({ via, title }: { via: ViaPago | null; title: string }) {
  if (!via?.tipo) return null
  const fields: [string, string | undefined][] = [
    ['Titular',       via.titular],
    ['Cuenta',        via.cuenta],
    ['Banco',         via.banco],
    ['Tipo cuenta',   via.tipo_cuenta],
    ['SWIFT',         via.swift],
    ['Routing',       via.routing],
    ['Nombre',        via.nombre],
    ['Contacto',      via.contacto],
    ['Email link',    via.email_link],
    ['Teléfono',      via.telefono],
    ['Dirección',     via.direccion],
    ['Referencia',    via.referencia],
  ].filter(([, v]) => !!v) as [string, string][]

  return (
    <div className="det-via-box">
      <div className="det-via-header">
        <span className="det-via-title">{title}</span>
        <ViaBadge via={via} />
      </div>
      <div className="det-field-grid-sm">
        {fields.map(([label, value]) => (
          <div key={label}>
            <div className="det-label">{label}</div>
            <div className="det-value det-value-break">{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tab: Datos ────────────────────────────────────────────────────────────────

function TabDatos({ data }: { data: TerceroDetalleData }) {
  const { tercero, empresa_nombre } = data

  return (
    <div className="det-tab-body">
      {/* Identificación — fila fija de 4 columnas */}
      <div className="det-card">
        <div className="det-section-title">Identificación</div>
        <div className="det-grid-4">
          <Campo label="Nombre"         value={tercero.nombre} />
          <Campo label="Tipo"           value={
            <span className={`badge ${TIPO_BADGE[tercero.tipo]}`}>
              {TIPO_LABEL[tercero.tipo]}
            </span>
          } />
          <Campo label="Identificación" value={tercero.identificacion} />
          <Campo label="Estado"         value={
            <span className={`badge ${tercero.activo ? 'badge-success' : 'badge-neutral'}`}>
              {tercero.activo ? 'Activo' : 'Inactivo'}
            </span>
          } />
        </div>
      </div>

      {/* Contacto */}
      <div className="det-card">
        <div className="det-section-title">Contacto</div>
        {/* Fila 1: Representante · Cargo · Teléfono · Email */}
        <div className="det-grid-4 mb-5">
          <Campo label="Representante" value={tercero.representante} />
          <Campo label="Cargo"         value={tercero.cargo} />
          <Campo label="Teléfono"      value={tercero.telefono} />
          <Campo label="Email"         value={tercero.email
            ? <a href={`mailto:${tercero.email}`} className="link-primary">{tercero.email}</a>
            : null}
          />
        </div>
        {/* Fila 2: Dirección (2 cols) · Ciudad · País */}
        <div className="det-grid-4">
          <div className="det-col-span-2">
            <Campo label="Dirección" value={tercero.direccion} />
          </div>
          <Campo label="Ciudad" value={tercero.ciudad} />
          <Campo label="País"   value={tercero.pais} />
        </div>
      </div>

      {/* Condiciones comerciales */}
      <div className="det-card">
        <div className="det-section-title">Condiciones comerciales</div>
        <div className="det-grid-4">
          <Campo label="Condición de pago" value={CONDICION_LABEL[tercero.condicion_pago] ?? tercero.condicion_pago} />
          <Campo label="Límite de crédito" value={
            tercero.limite_credito !== null
              ? `${tercero.limite_credito.toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${tercero.moneda_defecto ?? ''}`.trim()
              : null
          } />
          <Campo label="Moneda predeterminada" value={tercero.moneda_defecto} />
          <Campo label="Empresa"               value={empresa_nombre} />
        </div>
      </div>

      {/* Vías de pago */}
      {(tercero.via_primaria || tercero.via_secundaria) && (
        <div className="det-card">
          <div className="det-section-title">Vías de pago</div>
          <ViaDetalle via={tercero.via_primaria}   title="Vía primaria"   />
          <ViaDetalle via={tercero.via_secundaria} title="Vía secundaria" />
        </div>
      )}

      {/* Contrato */}
      {(tercero.num_contrato || tercero.contrato_url || tercero.fecha_inicio_contrato) && (
        <div className="det-card">
          <div className="det-section-title">Contrato</div>
          <div className="det-field-grid">
            <Campo label="N° contrato"  value={tercero.num_contrato} />
            <Campo label="Inicio"       value={fmtFecha(tercero.fecha_inicio_contrato)} />
            <Campo label="Vencimiento"  value={fmtFecha(tercero.fecha_fin_contrato)} />
            {tercero.contrato_url && (
              <div>
                <div className="det-label">Documento</div>
                <a href={tercero.contrato_url} target="_blank" rel="noopener noreferrer" className="det-link-icon">
                  <FileText size={13} strokeWidth={2} /> Ver contrato
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notas */}
      {tercero.notas && (
        <div className="det-card">
          <div className="det-section-title">Notas</div>
          <div className="det-value det-value-pre">{tercero.notas}</div>
        </div>
      )}

      {/* Metadatos */}
      <div className="det-card">
        <div className="det-section-title">Registro</div>
        <div className="det-field-grid">
          <Campo label="Creado"      value={fmtTimestamp(tercero.created_at)} />
          <Campo label="Actualizado" value={fmtTimestamp(tercero.updated_at)} />
          <Campo label="ID interno"  value={<code className="code-id">{tercero.tercero_id}</code>} />
        </div>
      </div>
    </div>
  )
}

// ── Tab: Productos del proveedor ──────────────────────────────────────────────

function TabProductos({ productos }: { productos: TerceroProducto[] }) {
  if (productos.length === 0) {
    return (
      <div className="det-tab-body">
        <div className="det-empty">
          <div className="det-empty-icon"><Package size={40} strokeWidth={1} opacity={0.2} /></div>
          <div className="det-empty-title">Sin productos asignados</div>
          <div className="det-empty-text mb-5">Este proveedor no tiene productos vinculados en el catálogo.</div>
          <Link href="/portal/productos" className="btn btn-secondary">Ir a Productos</Link>
        </div>
      </div>
    )
  }
  return (
    <div className="det-tab-body">
      <div className="card card-table">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th className="col-num">Stock</th>
                <th>Estado</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {productos.map(p => (
                <tr key={p.producto_id} className={p.estado === 'INACTIVO' ? 'row-inactive' : ''}>
                  <td data-label="Código" className="text-sm-muted">{p.codigo || '—'}</td>
                  <td data-label="Producto"><span className="table-empresa">{p.nombre}</span></td>
                  <td data-label="Stock" className="col-num">{p.stock.toLocaleString('es-ES')} {p.unidad}</td>
                  <td data-label="Estado">
                    <span className={`badge ${p.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
                      {p.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="col-actions">
                    <Link href={`/portal/productos/${p.producto_id}`} className="link-primary">Ver</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Cuentas por pagar ────────────────────────────────────────────────────

function tramoCxP(dias: number | null): { cls: string; label: string } | null {
  if (dias == null) return null
  if (dias > 0)  return { cls: 'badge-error',   label: `Vencido ${dias} d` }
  if (dias === 0) return { cls: 'badge-warning', label: 'Vence hoy' }
  return { cls: 'badge-neutral', label: `Vence en ${-dias} d` }
}

function TabCuentasPorPagar({ cxp }: { cxp: TerceroCxP }) {
  if (cxp.docs.length === 0) {
    return (
      <div className="det-tab-body">
        <div className="det-empty">
          <div className="det-empty-icon"><CreditCard size={40} strokeWidth={1} opacity={0.2} /></div>
          <div className="det-empty-title">Sin saldos pendientes</div>
          <div className="det-empty-text">No le debes nada a este proveedor ahora mismo.</div>
        </div>
      </div>
    )
  }
  return (
    <div className="det-tab-body">
      <div className="det-card">
        <div className="dash-kpis">
          {cxp.porMoneda.map(m => (
            <div key={m.moneda} className="dash-kpi">
              <span className="dash-kpi-label">Pendiente {m.moneda}</span>
              <span className="dash-kpi-value dash-kpi-value-sm">{fmtMoneda(m.saldo, m.moneda)}</span>
            </div>
          ))}
        </div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Fecha</th>
                <th className="col-num">Saldo</th>
                <th>Vencimiento</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {cxp.docs.map(d => {
                const t = tramoCxP(d.dias_vencido)
                return (
                  <tr key={d.doc_id}>
                    <td data-label="Concepto" className="cell-truncate">{d.numero}</td>
                    <td data-label="Fecha" className="text-sm-muted">{fmtFecha(d.fecha)}</td>
                    <td data-label="Saldo" className="col-num"><strong>{fmtMoneda(d.saldo, d.moneda)}</strong></td>
                    <td data-label="Vencimiento">
                      {t ? <span className={`badge ${t.cls}`}>{t.label}</span> : <span className="text-faint">—</span>}
                    </td>
                    <td className="col-actions">
                      <Link href="/portal/cxp" className="link-primary">Ver</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Historial de transacciones ───────────────────────────────────────────

// recharts fuera del SSR (mide el contenedor al montar), igual que el gráfico
// del historial de precios en ProductoDetalle.
const TerceroHistorialChart = dynamic(() => import('./TerceroHistorialChart'), { ssr: false })

const ESTADO_DOC: Record<string, { cls: string; label: string }> = {
  BORRADOR:   { cls: 'badge-neutral', label: 'Borrador' },
  EMITIDA:    { cls: 'badge-info',    label: 'Emitida' },
  COBRADA:    { cls: 'badge-success', label: 'Cobrada' },
  CONFIRMADA: { cls: 'badge-success', label: 'Confirmada' },
  ANULADA:    { cls: 'badge-error',   label: 'Anulada' },
}

function TabHistorial({ historial }: { historial: TerceroHistorial }) {
  const { docs, porMoneda, consolidado } = historial

  // Consolidado primero (si hay), luego cada moneda: mismo switch que la card de
  // Contabilidad del dashboard (ContabResumen).
  const opciones = [
    ...(consolidado ? [{ key: 'consolidado', label: 'Consolidado', entry: consolidado }] : []),
    ...porMoneda.map(pm => ({ key: pm.moneda, label: pm.moneda, entry: pm })),
  ]
  const [monedaSel, setMonedaSel] = useState(opciones[0]?.key ?? '')

  if (docs.length === 0) {
    return (
      <div className="det-empty">
        <div className="det-empty-icon"><Activity size={40} strokeWidth={1} opacity={0.2} /></div>
        <div className="det-empty-title">Historial de transacciones</div>
        <div className="det-empty-text">Aquí se mostrará el historial de ventas y compras con este contacto.</div>
      </div>
    )
  }

  const activa = opciones.find(o => o.key === monedaSel) ?? opciones[0]
  const e = activa?.entry
  // Un mes con movimiento real; los meses vacíos del tramo van a 0 y no cuentan.
  const mesesConDatos = e ? e.serie.filter(s => s.ventas > 0 || s.compras > 0).length : 0

  return (
    <div className="det-tab-body">
      <div className="det-card">
        <div className="det-section-head">
          <div className="det-section-title">Historial de transacciones</div>
        </div>

        <div className="dash-split">
          <div className="dash-split-main">
            {e ? (
              <>
                {opciones.length > 1 && (
                  <div className="dash-moneda-switch" role="tablist" aria-label="Moneda">
                    {opciones.map(o => (
                      <button
                        key={o.key}
                        type="button"
                        role="tab"
                        aria-selected={o.key === activa.key}
                        className={o.key === activa.key ? 'active' : ''}
                        onClick={() => setMonedaSel(o.key)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="dash-kpis">
                  {e.ventasTotal > 0 && (
                    <div className="dash-kpi">
                      <span className="dash-kpi-label">Facturado</span>
                      <span className="dash-kpi-value dash-kpi-value-sm">{fmtMoneda(e.ventasTotal, e.moneda)}</span>
                    </div>
                  )}
                  {e.comprasTotal > 0 && (
                    <div className="dash-kpi">
                      <span className="dash-kpi-label">Comprado</span>
                      <span className="dash-kpi-value dash-kpi-value-sm">{fmtMoneda(e.comprasTotal, e.moneda)}</span>
                    </div>
                  )}
                </div>

                {/* Con un solo mes el gráfico es una barra suelta: no dice nada
                    que no diga ya el KPI, así que no se dibuja. */}
                {mesesConDatos >= 2 ? (
                  <TerceroHistorialChart
                    serie={e.serie}
                    moneda={e.moneda}
                    hayVentas={e.ventasTotal > 0}
                    hayCompras={e.comprasTotal > 0}
                  />
                ) : (
                  <p className="text-xs-hint">Se necesitan al menos dos meses con movimiento para dibujar la evolución.</p>
                )}
              </>
            ) : (
              <p className="text-xs-hint">
                Hay documentos, pero ninguno cuenta todavía: los borradores y los anulados no suman.
              </p>
            )}
          </div>

          <div className="dash-split-side">
            <div className="dash-subtitle"><span>Documentos</span></div>
            <ul className="dash-list">
              {docs.map(d => (
                <li key={`${d.clase}-${d.doc_id}`} className="dash-list-item">
                  <Link
                    href={d.clase === 'VENTA'
                      ? `/portal/ventas/facturas/${d.doc_id}`
                      : `/portal/compras/${d.doc_id}`}
                    className="dash-list-main"
                  >
                    <span className="dash-list-title">{d.numero}</span>
                    <span className="dash-list-meta">
                      {d.clase === 'VENTA' ? 'Venta' : 'Compra'} · {fmtFecha(d.fecha)}
                    </span>
                  </Link>
                  <span className="dash-list-aside">
                    <span className="dash-list-amount">{fmtMoneda(d.total, d.moneda)}</span>
                    <span className={`badge ${ESTADO_DOC[d.estado]?.cls ?? 'badge-neutral'}`}>
                      {ESTADO_DOC[d.estado]?.label ?? d.estado}
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

// ── Tab: Suscripciones (cliente) ──────────────────────────────────────────────

const PERIODICIDAD_SUB_LABEL: Record<string, string> = {
  MENSUAL: 'Mensual', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual',
}
const ESTADO_SUB_BADGE: Record<string, string> = {
  ACTIVA: 'badge-success', PAUSADA: 'badge-info', VENCIDA: 'badge-warning', CANCELADA: 'badge-neutral',
}
const ESTADO_SUB_LABEL: Record<string, string> = {
  ACTIVA: 'Activa', PAUSADA: 'Pausada', VENCIDA: 'Vencida', CANCELADA: 'Cancelada',
}

function TabSuscripciones({ suscripciones }: { suscripciones: TerceroSuscripcion[] }) {
  if (suscripciones.length === 0) {
    return (
      <div className="det-tab-body">
        <div className="det-empty">
          <div className="det-empty-icon"><Repeat size={40} strokeWidth={1} opacity={0.2} /></div>
          <div className="det-empty-title">Sin suscripciones</div>
          <div className="det-empty-text mb-5">Este cliente no tiene servicios contratados.</div>
          <Link href="/portal/suscripciones" className="btn btn-secondary">Ir a Suscripciones</Link>
        </div>
      </div>
    )
  }
  return (
    <div className="det-tab-body">
      <div className="card card-table">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Servicio</th>
                <th className="col-num">Precio</th>
                <th>Periodicidad</th>
                <th>Próximo cobro</th>
                <th>Estado</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {suscripciones.map(s => (
                <tr key={s.suscripcion_id}>
                  {/* Un acuerdo presta varios servicios: se listan todos, que es lo que
                      el cliente verá en su factura. */}
                  <td data-label="Servicio"><span className="table-empresa">{s.servicios.join(', ') || '—'}</span></td>
                  <td data-label="Precio" className="col-num">
                    {s.importe_cobro.toLocaleString('es-ES', { minimumFractionDigits: 2 })} {s.moneda}
                  </td>
                  <td data-label="Periodicidad" className="text-sm-muted">{PERIODICIDAD_SUB_LABEL[s.periodicidad] ?? s.periodicidad}</td>
                  <td data-label="Próximo cobro" className="text-sm-muted">{fmtFecha(s.fecha_proximo_cobro)}</td>
                  <td data-label="Estado">
                    <span className={`badge ${ESTADO_SUB_BADGE[s.estado_efectivo] ?? 'badge-neutral'}`}>
                      {ESTADO_SUB_LABEL[s.estado_efectivo] ?? s.estado_efectivo}
                    </span>
                  </td>
                  <td className="col-actions"><Link href="/portal/suscripciones" className="link-primary">Ver</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

type TabId = 'datos' | 'productos' | 'suscripciones' | 'cp' | 'historial'

export default function TerceroDetalle({ data: initialData }: { data: TerceroDetalleData }) {
  const [data,      setData]      = useState(initialData)
  const [tab,       setTab]       = useState<TabId>('datos')
  const [showEdit,  setShowEdit]  = useState(false)
  const [copiar,    setCopiar]    = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [pending,   startT]       = useTransition()
  const router = useRouter()

  const { tercero, empresas } = data

  function toggleActivo() {
    startT(async () => {
      const fn = tercero.activo ? archivarTercero : restaurarTercero
      const res = await fn(tercero.tercero_id)
      if (!res.ok) { setStatusMsg(res.error ?? 'Error'); return }
      setData(prev => ({
        ...prev,
        tercero: { ...prev.tercero, activo: !prev.tercero.activo },
      }))
      setStatusMsg(tercero.activo ? 'Tercero archivado' : 'Tercero restaurado')
      setTimeout(() => setStatusMsg(''), 3000)
    })
  }

  // Gating de pestañas: por TIPO de tercero Y por MÓDULO visible. Contabilidad
  // (base) ya no es un cimiento obligatorio, así que la ficha no asume que exista.
  // Si una pestaña no se puede engranar con lo que el cliente tiene, no se muestra.
  const esProveedor = tercero.tipo === 'PROVEEDOR' || tercero.tipo === 'AMBOS'
  const esCliente   = tercero.tipo === 'CLIENTE'   || tercero.tipo === 'AMBOS'
  const verProductos = esProveedor && data.tieneInventario          // productos son de Inventario
  const verCxP       = esProveedor && data.tieneBase && !!data.cuentasPorPagar // deuda = Contabilidad
  // Ventas (a clientes) con Contabilidad; compras (a proveedores) con Inventario.
  // Un proveedor en un cliente solo-Contabilidad no ve Historial (su deuda está en
  // CxP), y un cliente en solo-Inventario tampoco (no hay ventas sin base).
  const verHistorial = (esCliente && data.tieneBase) || (esProveedor && data.tieneInventario)
  const verSuscripciones = esCliente && data.tieneServicios   // suscripciones son de clientes

  const tabs: TabItem<TabId>[] = [
    { id: 'datos', label: 'Datos' },
    ...(verProductos ? [{ id: 'productos' as const, label: 'Productos', count: data.productos_count }] : []),
    ...(verSuscripciones ? [{ id: 'suscripciones' as const, label: 'Suscripciones', count: data.suscripciones.length }] : []),
    ...(verCxP ? [{ id: 'cp' as const, label: 'Cuentas por pagar' }] : []),
    ...(verHistorial ? [{ id: 'historial' as const, label: 'Historial' }] : []),
  ]

  return (
    <div className="view-container">

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/portal/terceros">Clientes y proveedores</Link>
        <span>›</span>
        <span className="breadcrumb-current">{tercero.nombre}</span>
      </div>

      {/* Header */}
      <div className="det-page-header">
        <div>
          <div className="det-title-group">
            <h1 className="det-page-title">{tercero.nombre}</h1>
            <span className={`badge ${TIPO_BADGE[tercero.tipo]}`}>
              {TIPO_LABEL[tercero.tipo]}
            </span>
            <span className={`badge ${tercero.activo ? 'badge-success' : 'badge-neutral'}`}>
              {tercero.activo ? 'Activo' : 'Inactivo'}
            </span>
          </div>
          <div className="det-meta-row">
            {tercero.identificacion && <span>NIT/CI: <strong>{tercero.identificacion}</strong></span>}
            {tercero.telefono       && <span className="det-meta-inline"><Phone size={11} strokeWidth={2} />{tercero.telefono}</span>}
            {tercero.email          && (
              <a href={`mailto:${tercero.email}`} className="det-meta-inline link-primary">
                <Mail size={11} strokeWidth={2} />{tercero.email}
              </a>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="det-actions">
          <button onClick={() => setShowEdit(true)} className="btn btn-secondary">
            <Pencil size={14} strokeWidth={2} /> Editar
          </button>
          <RowActions>
            {empresas.length > 1 && (
              <button className="row-actions-item" onClick={() => setCopiar(true)}>
                <Copy size={15} strokeWidth={2} /> Copiar a otra empresa
              </button>
            )}
            <button
              className={`row-actions-item${tercero.activo ? ' row-actions-item-danger' : ''}`}
              onClick={toggleActivo}
              disabled={pending}
            >
              {tercero.activo ? <><Archive size={15} strokeWidth={2} /> Archivar</> : <><RotateCcw size={15} strokeWidth={2} /> Restaurar</>}
            </button>
          </RowActions>
        </div>
      </div>

      {statusMsg && (
        <div className="alert alert-success mb-4">{statusMsg}</div>
      )}

      {/* Tabs */}
      <Tabs ariaLabel="Secciones del contacto" active={tab} onChange={setTab} tabs={tabs} />

      {/* Contenido */}
      {tab === 'datos'     && <TabDatos    data={data} />}
      {tab === 'productos' && verProductos && <TabProductos productos={data.productos} />}
      {tab === 'suscripciones' && verSuscripciones && <TabSuscripciones suscripciones={data.suscripciones} />}
      {tab === 'cp'        && verCxP && data.cuentasPorPagar && <TabCuentasPorPagar cxp={data.cuentasPorPagar} />}
      {tab === 'historial' && verHistorial && <TabHistorial historial={data.historial} />}

      {copiar && (
        <CopiarAEmpresaModal
          titulo="Copiar a otra empresa"
          descripcion="Se creará una ficha independiente en esa empresa, con sus propios saldos."
          empresas={empresas.filter(e => e.empresa_id !== tercero.empresa_id)}
          monedas={data.monedas}
          monedaOrigen={tercero.moneda_defecto}
          empresaOrigen={data.empresa_nombre}
          importe={tercero.limite_credito
            ? { label: 'Límite de crédito', valor: tercero.limite_credito, seConvierte: true }
            : undefined}
          tasas={data.tasas}
          onCopiar={(empresaId, moneda, limite) =>
            copiarTerceroAEmpresa(tercero.tercero_id, empresaId, moneda, limite)}
          onClose={() => setCopiar(false)}
          onCopiado={() => setCopiar(false)}
        />
      )}

      {/* Modal edición */}
      {showEdit && (
        <TerceroFormModal
          tercero={tercero}
          empresas={empresas}
          monedas={data.monedas}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false)
            setStatusMsg('Cambios guardados')
            setTimeout(() => setStatusMsg(''), 3000)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

