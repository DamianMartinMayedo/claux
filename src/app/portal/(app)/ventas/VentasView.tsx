'use client'

import { useState, useMemo } from 'react'
import { useRouter }            from 'next/navigation'
import Link                     from 'next/link'
import {
  ESTADO_OFERTA_LABEL,
  ESTADO_OFERTA_BADGE,
  ESTADO_FACTURA_LABEL,
  ESTADO_FACTURA_BADGE,
  formatearMoneda,
  type EstadoOferta,
  type EstadoFactura,
} from './_ventas-helpers'
import type {
  VentasResumenData,
  Oferta,
  Factura,
} from '@/app/actions/portal/ventas'

interface Props { data: VentasResumenData }

type Tab = 'ofertas' | 'facturas'

export default function VentasView({ data }: Props) {
  const [tab,          setTab]          = useState<Tab>('ofertas')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [filtroEstado,  setFiltroEstado]  = useState('')

  const ofertasFiltradas  = useMemo(() => filtrarOfertas(data.ofertas, filtroEmpresa, filtroCliente, filtroEstado),
    [data.ofertas, filtroEmpresa, filtroCliente, filtroEstado])
  const facturasFiltradas = useMemo(() => filtrarFacturas(data.facturas, filtroEmpresa, filtroCliente, filtroEstado),
    [data.facturas, filtroEmpresa, filtroCliente, filtroEstado])

  const conteoOfertas  = data.ofertas.length
  const conteoFacturas = data.facturas.length

  const empresasConLetra = data.empresas.filter(e => !!e.letra_facturacion)
  const sinSetupEmpresas = data.empresas.length === 0
  const sinLetra         = data.empresas.length > 0 && empresasConLetra.length === 0

  return (
    <div className="view-container">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Ventas</h1>
          <p className="page-subtitle">
            Gestiona ofertas comerciales y facturas. Las ofertas aprobadas generan factura automáticamente.
          </p>
        </div>
        {tab === 'ofertas' ? (
          sinSetupEmpresas || sinLetra ? (
            <button
              className="btn btn-primary"
              disabled
              title={sinSetupEmpresas ? 'Primero crea una empresa.' : 'Asigna letra de facturación a alguna empresa.'}
            >
              <IconPlus /> Nueva oferta
            </button>
          ) : (
            <Link href="/portal/ventas/ofertas/nueva" className="btn btn-primary">
              <IconPlus /> Nueva oferta
            </Link>
          )
        ) : (
          sinSetupEmpresas || sinLetra ? (
            <button
              className="btn btn-primary"
              disabled
              title={sinSetupEmpresas ? 'Primero crea una empresa.' : 'Asigna letra de facturación a alguna empresa.'}
            >
              <IconPlus /> Nueva factura
            </button>
          ) : (
            <Link href="/portal/ventas/facturas/nueva" className="btn btn-primary">
              <IconPlus /> Nueva factura
            </Link>
          )
        )}
      </div>

      {/* ── Alertas de configuración ── */}
      {sinLetra && (
        <div className="alert alert-warning mb-4">
          Ninguna de tus empresas tiene <strong>letra de facturación</strong> asignada. Configúrala en{' '}
          <Link href="/portal/empresas" className="link-primary">Mis Empresas</Link>{' '}
          para poder crear ofertas y facturas.
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="ven-tabs">
        <button
          className={`ven-tab${tab === 'ofertas' ? ' active' : ''}`}
          onClick={() => setTab('ofertas')}
        >
          Ofertas
          <span className="ven-tab-count">{conteoOfertas}</span>
        </button>
        <button
          className={`ven-tab${tab === 'facturas' ? ' active' : ''}`}
          onClick={() => setTab('facturas')}
        >
          Facturas
          <span className="ven-tab-count">{conteoFacturas}</span>
        </button>
      </div>

      {/* ── Toolbar de filtros ── */}
      <div className="ter-toolbar">
        {data.empresas.length > 1 && (
          <select className="input ter-filter-select" value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}>
            <option value="">Todas las empresas</option>
            {data.empresas.map(e => (
              <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>
            ))}
          </select>
        )}
        <select className="input ter-filter-select" value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}>
          <option value="">Todos los clientes</option>
          {data.clientes.map(c => (
            <option key={c.tercero_id} value={c.tercero_id}>{c.nombre}</option>
          ))}
        </select>
        <select className="input ter-filter-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {tab === 'ofertas'
            ? Object.entries(ESTADO_OFERTA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)
            : Object.entries(ESTADO_FACTURA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)
          }
        </select>
      </div>

      {/* ── Tabla ── */}
      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">
            {tab === 'ofertas' ? 'Ofertas comerciales' : 'Facturas'}
          </h2>
          <span className="text-xs-muted">
            {tab === 'ofertas'
              ? `${ofertasFiltradas.length} de ${conteoOfertas}`
              : `${facturasFiltradas.length} de ${conteoFacturas}`}
          </span>
        </div>

        {tab === 'ofertas' ? (
          ofertasFiltradas.length === 0 ? (
            <div className="mon-empty">
              <IconDocLg />
              <p>{conteoOfertas === 0
                ? 'Aún no has creado ninguna oferta. Crea la primera para empezar.'
                : 'No hay ofertas que coincidan con los filtros.'}</p>
            </div>
          ) : (
            <TablaOfertas
              ofertas={ofertasFiltradas}
              empresaNombres={data.empresa_nombres}
              clienteNombres={data.cliente_nombres}
              mostrarEmpresa={data.empresas.length > 1}
            />
          )
        ) : (
          facturasFiltradas.length === 0 ? (
            <div className="mon-empty">
              <IconDocLg />
              <p>{conteoFacturas === 0
                ? 'Aún no has emitido ninguna factura. Crea una directa o aprueba una oferta.'
                : 'No hay facturas que coincidan con los filtros.'}</p>
            </div>
          ) : (
            <TablaFacturas
              facturas={facturasFiltradas}
              empresaNombres={data.empresa_nombres}
              clienteNombres={data.cliente_nombres}
              mostrarEmpresa={data.empresas.length > 1}
            />
          )
        )}
      </div>

    </div>
  )
}

// ── Tabla de ofertas ──────────────────────────────────────────────────────────

function TablaOfertas({
  ofertas, empresaNombres, clienteNombres, mostrarEmpresa,
}: {
  ofertas: Oferta[]
  empresaNombres: Record<string, string>
  clienteNombres: Record<string, string>
  mostrarEmpresa: boolean
}) {
  const router = useRouter()
  return (
    <div className="table-wrapper">
      <table className="table">
        <thead>
          <tr>
            <th>Número</th>
            <th>Fecha</th>
            {mostrarEmpresa && <th>Empresa</th>}
            <th>Cliente</th>
            <th>Estado</th>
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {ofertas.map(o => (
            <tr key={o.oferta_id} className="table-row-clickable" onClick={() => router.push(`/portal/ventas/ofertas/${o.oferta_id}`)}>
              <td>
                <Link href={`/portal/ventas/ofertas/${o.oferta_id}`} className="ven-link-numero" onClick={(e) => e.stopPropagation()}>
                  {o.numero}
                </Link>
              </td>
              <td className="text-sm-muted">
                {fmtFecha(o.fecha_emision)}
              </td>
              {mostrarEmpresa && (
                <td className="text-sm-muted">
                  {empresaNombres[o.empresa_id] ?? o.empresa_id}
                </td>
              )}
              <td>{clienteNombres[o.cliente_id] ?? o.cliente_id}</td>
              <td><BadgeOferta estado={o.estado} /></td>
              <td className="ven-td-amt">
                {formatearMoneda(Number(o.total), o.moneda)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tabla de facturas ─────────────────────────────────────────────────────────

function TablaFacturas({
  facturas, empresaNombres, clienteNombres, mostrarEmpresa,
}: {
  facturas: Factura[]
  empresaNombres: Record<string, string>
  clienteNombres: Record<string, string>
  mostrarEmpresa: boolean
}) {
  const router = useRouter()
  return (
    <div className="table-wrapper">
      <table className="table">
        <thead>
          <tr>
            <th>Número</th>
            <th>Fecha</th>
            {mostrarEmpresa && <th>Empresa</th>}
            <th>Cliente</th>
            <th>Vencimiento</th>
            <th>Estado</th>
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {facturas.map(f => (
            <tr key={f.factura_id} className="table-row-clickable" onClick={() => router.push(`/portal/ventas/facturas/${f.factura_id}`)}>
              <td>
                <Link href={`/portal/ventas/facturas/${f.factura_id}`} className="ven-link-numero" onClick={(e) => e.stopPropagation()}>
                  {f.numero}
                </Link>
              </td>
              <td className="text-sm-muted">
                {fmtFecha(f.fecha_emision)}
              </td>
              {mostrarEmpresa && (
                <td className="text-sm-muted">
                  {empresaNombres[f.empresa_id] ?? f.empresa_id}
                </td>
              )}
              <td>{clienteNombres[f.cliente_id] ?? f.cliente_id}</td>
              <td className="text-sm-muted">
                {f.fecha_vencimiento ? fmtFecha(f.fecha_vencimiento) : '—'}
              </td>
              <td><BadgeFactura estado={f.estado} /></td>
              <td className="ven-td-amt">
                {formatearMoneda(Number(f.total), f.moneda)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Badges ────────────────────────────────────────────────────────────────────

function BadgeOferta({ estado }: { estado: EstadoOferta }) {
  return (
    <span className={`badge ${ESTADO_OFERTA_BADGE[estado] ?? 'badge-neutral'}`}>
      {ESTADO_OFERTA_LABEL[estado]}
    </span>
  )
}

function BadgeFactura({ estado }: { estado: EstadoFactura }) {
  return (
    <span className={`badge ${ESTADO_FACTURA_BADGE[estado] ?? 'badge-neutral'}`}>
      {ESTADO_FACTURA_LABEL[estado]}
    </span>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

function filtrarOfertas(
  arr: Oferta[], empresa: string, cliente: string, estado: string,
): Oferta[] {
  return arr.filter(o => {
    if (empresa && o.empresa_id !== empresa) return false
    if (cliente && o.cliente_id !== cliente) return false
    if (estado  && o.estado     !== estado)  return false
    return true
  })
}

function filtrarFacturas(
  arr: Factura[], empresa: string, cliente: string, estado: string,
): Factura[] {
  return arr.filter(f => {
    if (empresa && f.empresa_id !== empresa) return false
    if (cliente && f.cliente_id !== cliente) return false
    if (estado  && f.estado     !== estado)  return false
    return true
  })
}

function IconPlus() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function IconDocLg() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" opacity="0.2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
}
