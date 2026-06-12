'use client'

import { useState, useTransition } from 'react'
import Link                         from 'next/link'
import { useRouter }                from 'next/navigation'
import {
  archivarTercero,
  restaurarTercero,
  type TerceroDetalleData,
  type Tercero,
  type TipoTercero,
  type ViaPago,
} from '@/app/actions/portal/terceros'
import { TerceroFormModal } from '../_TerceroFormModal'

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

const VIA_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  'Transferencia (VES)':         { label: 'TB-VES',  bg: '#fef3c7', color: '#92400e'  },
  'Transferencia (USD)':         { label: 'TB-USD',  bg: '#d1fae5', color: '#065f46'  },
  'Transferencia Internacional': { label: 'TBI',     bg: '#dbeafe', color: '#1e40af'  },
  'Pago Móvil':                  { label: 'PM',      bg: '#ede9fe', color: '#5b21b6'  },
  'Zelle':                       { label: 'ZELLE',   bg: '#fce7f3', color: '#9d174d'  },
  'TropiPay':                    { label: 'TPPAY',   bg: '#f0fdf4', color: '#166534'  },
  'Efectivo (VES)':              { label: 'EF-VES',  bg: '#f1f5f9', color: '#475569'  },
  'Efectivo (USD)':              { label: 'EF-USD',  bg: '#f1f5f9', color: '#475569'  },
}

const TIPO_STYLE: Record<TipoTercero, React.CSSProperties> = {
  CLIENTE:   { background: '#dbeafe', color: '#1d4ed8' },
  PROVEEDOR: { background: '#dcfce7', color: '#166534' },
  AMBOS:     { background: '#fef9c3', color: '#854d0e' },
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const S = {
  badge: (extra: React.CSSProperties): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center',
    fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.04em', padding: '2px 10px', borderRadius: '999px',
    ...extra,
  }),
  card: {
    background: 'var(--color-surface, #fff)',
    border:     '1px solid var(--color-border, #e2e8f0)',
    borderRadius: '12px',
    padding:    '20px',
    marginBottom: '16px',
  } as React.CSSProperties,
  label: {
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'var(--color-text-muted, #64748b)',
    marginBottom: '4px',
  } as React.CSSProperties,
  value: {
    fontSize: '14px', color: 'var(--color-text, #1e293b)',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: '13px', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: '#64748b',
    marginBottom: '16px', paddingBottom: '8px',
    borderBottom: '1px solid #e2e8f0',
  } as React.CSSProperties,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Campo({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <div style={S.label}>{label}</div>
      <div style={S.value}>{value ?? <span style={{ color: '#cbd5e1' }}>—</span>}</div>
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
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '10px 18px',
        fontSize: '13px', fontWeight: active ? 700 : 500,
        color:   active ? 'var(--color-primary, #0ea5e9)' : '#64748b',
        borderTop: 'none', borderLeft: 'none', borderRight: 'none',
        borderBottom: active ? '2px solid var(--color-primary, #0ea5e9)' : '2px solid transparent',
        background: 'transparent', borderRadius: '0',
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {label}
      {badge !== undefined && (
        <span style={{
          fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px',
          background: active ? 'var(--color-primary, #0ea5e9)' : '#e2e8f0',
          color: active ? '#fff' : '#64748b',
        }}>
          {badge}
        </span>
      )}
    </button>
  )
}

// ── Pill de vía de pago ───────────────────────────────────────────────────────

function ViaPill({ via }: { via: ViaPago | null }) {
  if (!via?.tipo) return <span style={{ color: '#cbd5e1' }}>—</span>
  const info = VIA_BADGE[via.tipo]
  if (!info) return <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{via.tipo}</span>
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 10px', borderRadius: '6px',
      fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em',
      background: info.bg, color: info.color,
    }} title={via.tipo}>
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
    <div style={{
      border: '1px solid #e2e8f0', borderRadius: '10px',
      padding: '14px 18px', marginBottom: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <span style={{ fontWeight: 700, fontSize: '13px', color: '#1e293b' }}>{title}</span>
        <ViaPill via={via} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
        {fields.map(([label, value]) => (
          <div key={label}>
            <div style={S.label}>{label}</div>
            <div style={{ ...S.value, wordBreak: 'break-all' }}>{value}</div>
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
    <div style={{ padding: '24px 0' }}>
      {/* Identificación — fila fija de 4 columnas */}
      <div style={S.card}>
        <div style={S.sectionTitle}>Identificación</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
          <Campo label="Nombre"         value={tercero.nombre} />
          <Campo label="Tipo"           value={
            <span style={S.badge(TIPO_STYLE[tercero.tipo])}>
              {TIPO_LABEL[tercero.tipo]}
            </span>
          } />
          <Campo label="Identificación" value={tercero.identificacion} />
          <Campo label="Estado"         value={
            <span style={S.badge(tercero.activo
              ? { background: '#dcfce7', color: '#16a34a' }
              : { background: '#f1f5f9', color: '#64748b' }
            )}>
              {tercero.activo ? 'Activo' : 'Inactivo'}
            </span>
          } />
        </div>
      </div>

      {/* Contacto */}
      <div style={S.card}>
        <div style={S.sectionTitle}>Contacto</div>
        {/* Fila 1: Representante · Cargo · Teléfono · Email */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '20px' }}>
          <Campo label="Representante" value={tercero.representante} />
          <Campo label="Cargo"         value={tercero.cargo} />
          <Campo label="Teléfono"      value={tercero.telefono} />
          <Campo label="Email"         value={tercero.email
            ? <a href={`mailto:${tercero.email}`} style={{ color: 'var(--color-primary, #0ea5e9)', textDecoration: 'none' }}>{tercero.email}</a>
            : null}
          />
        </div>
        {/* Fila 2: Dirección (2 cols) · Ciudad · País */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
          <div style={{ gridColumn: 'span 2' }}>
            <Campo label="Dirección" value={tercero.direccion} />
          </div>
          <Campo label="Ciudad" value={tercero.ciudad} />
          <Campo label="País"   value={tercero.pais} />
        </div>
      </div>

      {/* Condiciones comerciales */}
      <div style={S.card}>
        <div style={S.sectionTitle}>Condiciones comerciales</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
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
        <div style={S.card}>
          <div style={S.sectionTitle}>Vías de pago</div>
          <ViaDetalle via={tercero.via_primaria}   title="Vía primaria"   />
          <ViaDetalle via={tercero.via_secundaria} title="Vía secundaria" />
        </div>
      )}

      {/* Contrato */}
      {(tercero.num_contrato || tercero.contrato_url || tercero.fecha_inicio_contrato) && (
        <div style={S.card}>
          <div style={S.sectionTitle}>Contrato</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '20px' }}>
            <Campo label="N° contrato"  value={tercero.num_contrato} />
            <Campo label="Inicio"       value={fmtDate(tercero.fecha_inicio_contrato)} />
            <Campo label="Vencimiento"  value={fmtDate(tercero.fecha_fin_contrato)} />
            {tercero.contrato_url && (
              <div>
                <div style={S.label}>Documento</div>
                <a href={tercero.contrato_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--color-primary, #0ea5e9)', textDecoration: 'none', fontSize: '14px', fontWeight: 600 }}>
                  <IconFileLink /> Ver contrato
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notas */}
      {tercero.notas && (
        <div style={S.card}>
          <div style={S.sectionTitle}>Notas</div>
          <div style={{ ...S.value, whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{tercero.notas}</div>
        </div>
      )}

      {/* Metadatos */}
      <div style={S.card}>
        <div style={S.sectionTitle}>Registro</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '20px' }}>
          <Campo label="Creado"      value={fmtDate(tercero.created_at)} />
          <Campo label="Actualizado" value={fmtDate(tercero.updated_at)} />
          <Campo label="ID interno"  value={<code style={{ fontFamily: 'monospace', fontSize: '12px', color: '#94a3b8' }}>{tercero.tercero_id}</code>} />
        </div>
      </div>

    </div>
  )
}

// ── Tab: Productos del proveedor (placeholder) ────────────────────────────────

function TabProductos({ count, terceroId }: { count: number; terceroId: string }) {
  return (
    <div style={{ padding: '24px 0' }}>
      {count === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
            <IconBoxLg />
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: '#64748b' }}>
            Sin productos asignados
          </div>
          <div style={{ fontSize: '13px' }}>
            Este proveedor no tiene productos vinculados en el catálogo.
          </div>
        </div>
      ) : (
        <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
            <IconBoxLg />
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: '#64748b' }}>
            {count} producto{count !== 1 ? 's' : ''} de este proveedor
          </div>
          <div style={{ fontSize: '13px', marginBottom: '20px' }}>
            Listado detallado disponible próximamente.
          </div>
          <Link
            href={`/portal/productos`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '10px 20px', borderRadius: '8px',
              background: 'var(--color-primary, #0ea5e9)', color: '#fff',
              textDecoration: 'none', fontWeight: 600, fontSize: '14px',
            }}
          >
            Ver catálogo de productos →
          </Link>
        </div>
      )}
    </div>
  )
}

// ── Tab: Cuentas por pagar (placeholder) ─────────────────────────────────────

function TabCuentasPorPagar() {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
        <IconCreditCardLg />
      </div>
      <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: '#64748b' }}>
        Cuentas por pagar
      </div>
      <div style={{ fontSize: '13px' }}>
        Aquí se mostrarán las facturas y saldos pendientes con este proveedor.
      </div>
    </div>
  )
}

// ── Tab: Historial de transacciones (placeholder) ─────────────────────────────

function TabHistorial() {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
        <IconActivityLg />
      </div>
      <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: '#64748b' }}>
        Historial de transacciones
      </div>
      <div style={{ fontSize: '13px' }}>
        Aquí se mostrará el historial de ventas y compras con este contacto.
      </div>
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

  const { tercero, empresa_nombre, productos_count, empresas } = data

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', fontSize: '13px', color: '#64748b' }}>
        <Link href="/portal/terceros" style={{ color: '#64748b', textDecoration: 'none' }}>
          Terceros
        </Link>
        <span>›</span>
        <span style={{ color: '#1e293b', fontWeight: 600 }}>{tercero.nombre}</span>
      </div>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: '16px', flexWrap: 'wrap', marginBottom: '8px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800 }}>{tercero.nombre}</h1>
            <span style={S.badge(TIPO_STYLE[tercero.tipo])}>
              {TIPO_LABEL[tercero.tipo]}
            </span>
            <span style={S.badge(tercero.activo
              ? { background: '#dcfce7', color: '#16a34a' }
              : { background: '#f1f5f9', color: '#64748b' }
            )}>
              {tercero.activo ? 'Activo' : 'Inactivo'}
            </span>
          </div>
          <div style={{ marginTop: '6px', fontSize: '13px', color: '#64748b', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {tercero.identificacion && <span>RIF/CI: <strong>{tercero.identificacion}</strong></span>}
            {tercero.telefono       && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><IconPhone />{tercero.telefono}</span>}
            {tercero.email          && <a href={`mailto:${tercero.email}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#0ea5e9', textDecoration: 'none' }}><IconMail />{tercero.email}</a>}
          </div>
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowEdit(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
              border: '1px solid #e2e8f0', background: '#fff', color: '#1e293b', cursor: 'pointer',
            }}
          >
            <IconEdit /> Editar
          </button>
          <button
            onClick={toggleActivo}
            disabled={pending}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
              border: '1px solid #e2e8f0', background: '#fff',
              color: tercero.activo ? '#dc2626' : '#16a34a',
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {tercero.activo ? <><IconArchive /> Archivar</> : <><IconRestore /> Restaurar</>}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div style={{
          padding: '10px 16px', borderRadius: '8px',
          background: '#f0fdf4', color: '#16a34a',
          fontSize: '13px', fontWeight: 600, marginBottom: '16px',
        }}>
          {statusMsg}
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #e2e8f0',
        overflowX: 'auto', marginBottom: '4px',
      }}>
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
      {tab === 'productos' && <TabProductos count={productos_count} terceroId={tercero.tercero_id} />}
      {tab === 'cp'        && <TabCuentasPorPagar />}
      {tab === 'historial' && <TabHistorial />}

      {/* Modal edición — mismo formulario que en la lista */}
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

// ── Iconos (Feather, stroke, currentColor) ────────────────────────────────────

function IconX()           { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function IconEdit()        { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function IconArchive()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> }
function IconRestore()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg> }
function IconPhone()       { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12 19.79 19.79 0 011.61 3.37 2 2 0 013.6 1.21h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 8.77a16 16 0 006.29 6.29l1.63-1.63a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg> }
function IconMail()        { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> }
function IconFileLink()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg> }
function IconBoxLg()       { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" style={{ opacity: 0.2 }}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> }
function IconCreditCardLg(){ return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" style={{ opacity: 0.2 }}><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> }
function IconActivityLg()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" style={{ opacity: 0.2 }}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> }
