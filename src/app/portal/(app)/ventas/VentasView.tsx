'use client'

import { useState, useMemo }   from 'react'
import { useRouter }            from 'next/navigation'
import Link                   from 'next/link'
import { FileText, Plus } from 'lucide-react'
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
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import EmpresaPills                    from '@/components/portal/EmpresaPills'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import IaTouchpoint                    from '@/components/portal/ia/IaTouchpoint'

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

  const { colorOf } = useEmpresas()
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))

  const empresasConLetra = data.empresas.filter(e => !!e.letra_facturacion)
  const sinSetupEmpresas = data.empresas.length === 0
  const sinLetra         = data.empresas.length > 0 && empresasConLetra.length === 0

  return (
    <div className="view-container">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Ventas</h1>
            <IaTouchpoint tipo="ventas" descripcion="un análisis de tus ventas" />
          </div>
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
              <Plus size={18} strokeWidth={2} /> Nueva oferta
            </button>
          ) : (
            <Link href="/portal/ventas/ofertas/nueva" className="btn btn-primary">
              <Plus size={18} strokeWidth={2} /> Nueva oferta
            </Link>
          )
        ) : (
          sinSetupEmpresas || sinLetra ? (
            <button
              className="btn btn-primary"
              disabled
              title={sinSetupEmpresas ? 'Primero crea una empresa.' : 'Asigna letra de facturación a alguna empresa.'}
            >
              <Plus size={18} strokeWidth={2} /> Nueva factura
            </button>
          ) : (
            <Link href="/portal/ventas/facturas/nueva" className="btn btn-primary">
              <Plus size={18} strokeWidth={2} /> Nueva factura
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
        <EmpresaPills
          empresas={empresasFiltro}
          value={filtroEmpresa}
          onChange={setFiltroEmpresa}
          todasLabel="Todas las empresas"
        />
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
              <FileText size={18} strokeWidth={2} />
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
              <FileText size={18} strokeWidth={2} />
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
  const { colorOf } = useEmpresas()
  const { pageItems, ...pag } = usePagination(ofertas)
  return (
    <>
    <div className="table-wrapper">
      <table className="table">
        <thead>
          <tr>
            <th>Número</th>
            <th>Fecha</th>
            {mostrarEmpresa && <th>Empresa</th>}
            <th>Cliente</th>
            <th>Estado</th>
            <th className="col-num">Total</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map(o => (
            <tr
              key={o.oferta_id}
              className={`table-row-clickable${mostrarEmpresa ? ' row-empresa-accent' : ''}`}
              style={mostrarEmpresa ? empresaColorVar(colorOf(o.empresa_id)) : undefined}
              onClick={() => router.push(`/portal/ventas/ofertas/${o.oferta_id}`)}
            >
              <td data-label="Número">
                <Link href={`/portal/ventas/ofertas/${o.oferta_id}`} className="ven-link-numero" onClick={(e) => e.stopPropagation()}>
                  {o.numero}
                </Link>
              </td>
              <td data-label="Fecha" className="text-sm-muted">
                {fmtFecha(o.fecha_emision)}
              </td>
              {mostrarEmpresa && (
                <td data-label="Empresa">
                  <EmpresaTag color={colorOf(o.empresa_id)} nombre={empresaNombres[o.empresa_id] ?? o.empresa_id} />
                </td>
              )}
              <td data-label="Cliente">{clienteNombres[o.cliente_id] ?? o.cliente_id}</td>
              <td data-label="Estado"><BadgeOferta estado={o.estado} /></td>
              <td data-label="Total" className="col-num">
                {formatearMoneda(Number(o.total), o.moneda)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <TablePagination {...pag} label="oferta" />
    </>
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
  const { colorOf } = useEmpresas()
  const { pageItems, ...pag } = usePagination(facturas)
  return (
    <>
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
            <th className="col-num">Total</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map(f => (
            <tr
              key={f.factura_id}
              className={`table-row-clickable${mostrarEmpresa ? ' row-empresa-accent' : ''}`}
              style={mostrarEmpresa ? empresaColorVar(colorOf(f.empresa_id)) : undefined}
              onClick={() => router.push(`/portal/ventas/facturas/${f.factura_id}`)}
            >
              <td data-label="Número">
                <Link href={`/portal/ventas/facturas/${f.factura_id}`} className="ven-link-numero" onClick={(e) => e.stopPropagation()}>
                  {f.numero}
                </Link>
              </td>
              <td data-label="Fecha" className="text-sm-muted">
                {fmtFecha(f.fecha_emision)}
              </td>
              {mostrarEmpresa && (
                <td data-label="Empresa">
                  <EmpresaTag color={colorOf(f.empresa_id)} nombre={empresaNombres[f.empresa_id] ?? f.empresa_id} />
                </td>
              )}
              <td data-label="Cliente">{clienteNombres[f.cliente_id] ?? f.cliente_id}</td>
              <td data-label="Vencimiento" className="text-sm-muted">
                {f.fecha_vencimiento ? fmtFecha(f.fecha_vencimiento) : '—'}
              </td>
              <td data-label="Estado"><BadgeFactura estado={f.estado} /></td>
              <td data-label="Total" className="col-num">
                {formatearMoneda(Number(f.total), f.moneda)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <TablePagination {...pag} label="factura" />
    </>
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

