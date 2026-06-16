'use client'

import { useState, useTransition } from 'react'
import Link                         from 'next/link'
import { useRouter }                from 'next/navigation'
import {
  archivarTercero,
  restaurarTercero,
  type TerceroDetalleData,
  type TipoTercero,
  type ViaPago,
} from '@/app/actions/portal/terceros'
import { TerceroFormModal } from '../_TerceroFormModal'
import { Activity, Archive, CreditCard, FileText, Mail, Package, Pencil, Phone, RotateCcw } from 'lucide-react'

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

const VIA_BADGE: Record<string, { label: string; cls: string }> = {
  'Transferencia (VES)':         { label: 'TB-VES',  cls: 'via-badge-ves'      },
  'Transferencia (USD)':         { label: 'TB-USD',  cls: 'via-badge-usd'      },
  'Transferencia Internacional': { label: 'TBI',     cls: 'via-badge-intl'     },
  'Pago Móvil':                  { label: 'PM',      cls: 'via-badge-pm'       },
  'Zelle':                       { label: 'ZELLE',   cls: 'via-badge-zelle'    },
  'TropiPay':                    { label: 'TPPAY',   cls: 'via-badge-tropipay' },
  'Efectivo (VES)':              { label: 'EF-VES',  cls: 'via-badge-ef'       },
  'Efectivo (USD)':              { label: 'EF-USD',  cls: 'via-badge-ef'       },
}

const TIPO_BADGE: Record<TipoTercero, string> = {
  CLIENTE:   'badge-info',
  PROVEEDOR: 'badge-success',
  AMBOS:     'badge-amber',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Campo({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <div className="det-label">{label}</div>
      <div className="det-value">{value ?? <span className="text-faint">—</span>}</div>
    </div>
  )
}

// ── Tab ───────────────────────────────────────────────────────────────────────

function Tab({ active, onClick, label, badge }: {
  active:  boolean
  onClick: () => void
  label:   string
  badge?:  number
}) {
  return (
    <button onClick={onClick} className={`detail-tab${active ? ' active' : ''}`}>
      {label}
      {badge !== undefined && (
        <span className="detail-tab-count">{badge}</span>
      )}
    </button>
  )
}

// ── Pill de vía de pago ───────────────────────────────────────────────────────

function ViaPill({ via }: { via: ViaPago | null }) {
  if (!via?.tipo) return <span className="text-faint">—</span>
  const info = VIA_BADGE[via.tipo]
  if (!info) return <span className="text-xs-muted">{via.tipo}</span>
  return (
    <span className={`via-badge ${info.cls}`} title={via.tipo}>
      {info.label}
    </span>
  )
}

// ── Detalle de vía de pago ────────────────────────────────────────────────────

function ViaDetalle({ via, title }: { via: ViaPago | null; title: string }) {
  if (!via?.tipo) return null
  const fields: [string, string | undefined][] = [
    ['Titular',       via.titular],
    ['Cuenta',        via.cuenta],
    ['Banco',         via.banco],
    ['Tipo cuenta',   via.tipo_cuenta],
    ['Moneda',        via.moneda],
    ['SWIFT',         via.swift],
    ['Routing',       via.routing],
    ['Cédula',        via.cedula],
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
        <ViaPill via={via} />
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
              ? `${tercero.moneda_defecto ?? ''} ${tercero.limite_credito.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`.trim()
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
            <Campo label="Inicio"       value={fmtDate(tercero.fecha_inicio_contrato)} />
            <Campo label="Vencimiento"  value={fmtDate(tercero.fecha_fin_contrato)} />
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
          <Campo label="Creado"      value={fmtDate(tercero.created_at)} />
          <Campo label="Actualizado" value={fmtDate(tercero.updated_at)} />
          <Campo label="ID interno"  value={<code className="code-id">{tercero.tercero_id}</code>} />
        </div>
      </div>
    </div>
  )
}

// ── Tab: Productos del proveedor (placeholder) ────────────────────────────────

function TabProductos({ count }: { count: number }) {
  return (
    <div className="det-tab-body">
      <div className="det-empty">
        <div className="det-empty-icon"><Package size={40} strokeWidth={1} opacity={0.2} /></div>
        {count === 0 ? (
          <>
            <div className="det-empty-title">Sin productos asignados</div>
            <div className="det-empty-text">Este proveedor no tiene productos vinculados en el catálogo.</div>
          </>
        ) : (
          <>
            <div className="det-empty-title">{count} producto{count !== 1 ? 's' : ''} de este proveedor</div>
            <div className="det-empty-text mb-5">Listado detallado disponible próximamente.</div>
            <Link href="/portal/productos" className="btn btn-primary">
              Ver catálogo de productos →
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

// ── Tab: Cuentas por pagar (placeholder) ─────────────────────────────────────

function TabCuentasPorPagar() {
  return (
    <div className="det-empty">
      <div className="det-empty-icon"><CreditCard size={40} strokeWidth={1} opacity={0.2} /></div>
      <div className="det-empty-title">Cuentas por pagar</div>
      <div className="det-empty-text">Aquí se mostrarán las facturas y saldos pendientes con este proveedor.</div>
    </div>
  )
}

// ── Tab: Historial de transacciones (placeholder) ─────────────────────────────

function TabHistorial() {
  return (
    <div className="det-empty">
      <div className="det-empty-icon"><Activity size={40} strokeWidth={1} opacity={0.2} /></div>
      <div className="det-empty-title">Historial de transacciones</div>
      <div className="det-empty-text">Aquí se mostrará el historial de ventas y compras con este contacto.</div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

type TabId = 'datos' | 'productos' | 'cp' | 'historial'

export default function TerceroDetalle({ data: initialData }: { data: TerceroDetalleData }) {
  const [data,      setData]      = useState(initialData)
  const [tab,       setTab]       = useState<TabId>('datos')
  const [showEdit,  setShowEdit]  = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [pending,   startT]       = useTransition()
  const router = useRouter()

  const { tercero, productos_count, empresas } = data

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

  const esProveedor = tercero.tipo === 'PROVEEDOR' || tercero.tipo === 'AMBOS'
  const esCliente   = tercero.tipo === 'CLIENTE'   || tercero.tipo === 'AMBOS'

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
            {tercero.identificacion && <span>RIF/CI: <strong>{tercero.identificacion}</strong></span>}
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
          <button
            onClick={toggleActivo}
            disabled={pending}
            className="btn btn-secondary"
            style={{ color: tercero.activo ? 'var(--color-error)' : 'var(--color-success)' }}
          >
            {tercero.activo ? <><Archive size={14} strokeWidth={2} /> Archivar</> : <><RotateCcw size={14} strokeWidth={2} /> Restaurar</>}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="alert alert-success mb-4">{statusMsg}</div>
      )}

      {/* Tabs */}
      <div className="detail-tabs">
        <Tab active={tab === 'datos'}    onClick={() => setTab('datos')}    label="Datos" />
        {esProveedor && (
          <Tab active={tab === 'productos'} onClick={() => setTab('productos')} label="Productos" badge={productos_count} />
        )}
        {esProveedor && (
          <Tab active={tab === 'cp'}      onClick={() => setTab('cp')}      label="Cuentas por pagar" />
        )}
        {esCliente && (
          <Tab active={tab === 'historial'} onClick={() => setTab('historial')} label="Historial" />
        )}
        {tercero.tipo === 'AMBOS' && (
          <Tab active={tab === 'historial'} onClick={() => setTab('historial')} label="Historial" />
        )}
      </div>

      {/* Contenido */}
      {tab === 'datos'     && <TabDatos    data={data} />}
      {tab === 'productos' && <TabProductos count={productos_count} />}
      {tab === 'cp'        && <TabCuentasPorPagar />}
      {tab === 'historial' && <TabHistorial />}

      {/* Modal edición */}
      {showEdit && (
        <TerceroFormModal
          tercero={tercero}
          empresas={empresas}
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

