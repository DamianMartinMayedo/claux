'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useMemo, useEffect, useTransition } from 'react'
import { useRouter }            from 'next/navigation'
import Link                   from 'next/link'
import {
  Copy, FileText, Plus, Send, Check, Ban, Clock, FileCheck,
  Archive, ArchiveRestore, Trash2,
} from 'lucide-react'
import {
  ESTADO_OFERTA_LABEL,
  ESTADO_OFERTA_BADGE,
  ESTADO_FACTURA_LABEL,
  ESTADO_FACTURA_BADGE,
  formatearMoneda,
  type EstadoOferta,
  type EstadoFactura,
} from './_ventas-helpers'
import {
  cambiarEstadoOfertasEnLote,
  cambiarEstadoFacturasEnLote,
  duplicarOfertasEnLote,
  duplicarFacturasEnLote,
  archivarOfertasEnLote,
  archivarFacturasEnLote,
  eliminarOfertasEnLote,
  eliminarFacturasEnLote,
  type ResultadoLote,
  type VentasResumenData,
  type Oferta,
  type Factura,
} from '@/app/actions/portal/ventas'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import EmpresaPills                    from '@/components/portal/EmpresaPills'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso                 from '@/components/portal/PrerequisitoAviso'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import { ConfirmDialog }               from '@/components/portal/Dialog'
import BulkBar                         from '@/components/portal/BulkBar'
import { useRowSelection }             from '@/components/portal/useRowSelection'
import IaTouchpoint                    from '@/components/portal/ia/IaTouchpoint'

interface Props { data: VentasResumenData }

type Tab = 'ofertas' | 'facturas'

// Estados desde los que es válido cada destino (espejo del server, para UI).
const OFERTA_DESDE: Record<EstadoOferta, EstadoOferta[]> = {
  BORRADOR: [], ENVIADA: ['BORRADOR'], APROBADA: ['BORRADOR', 'ENVIADA'],
  RECHAZADA: ['BORRADOR', 'ENVIADA'], CADUCADA: ['BORRADOR', 'ENVIADA'],
}
const FACTURA_DESDE: Record<EstadoFactura, EstadoFactura[]> = {
  BORRADOR: [], EMITIDA: ['BORRADOR'], COBRADA: [], ANULADA: ['BORRADOR', 'EMITIDA'],
}
const OFERTA_ELIMINABLE:  EstadoOferta[]  = ['BORRADOR', 'RECHAZADA', 'CADUCADA']
const FACTURA_ELIMINABLE: EstadoFactura[] = ['BORRADOR']

type Confirm = { title: string; body?: string; confirmLabel: string; danger: boolean; run: () => void }

export default function VentasView({ data }: Props) {
  const router = useRouter()
  const [tab,          setTab]          = useState<Tab>('ofertas')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [filtroEstado,  setFiltroEstado]  = useState('')
  const [verArchivadas, setVerArchivadas] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [isPending, startTransition] = useTransition()

  const ofertasFiltradas  = useMemo(
    () => filtrarOfertas(data.ofertas, filtroEmpresa, filtroCliente, filtroEstado, verArchivadas),
    [data.ofertas, filtroEmpresa, filtroCliente, filtroEstado, verArchivadas])
  const facturasFiltradas = useMemo(
    () => filtrarFacturas(data.facturas, filtroEmpresa, filtroCliente, filtroEstado, verArchivadas),
    [data.facturas, filtroEmpresa, filtroCliente, filtroEstado, verArchivadas])

  const conteoOfertas  = data.ofertas.length
  const conteoFacturas = data.facturas.length

  const ofertaIds  = useMemo(() => ofertasFiltradas.map(o => o.oferta_id),  [ofertasFiltradas])
  const facturaIds = useMemo(() => facturasFiltradas.map(f => f.factura_id), [facturasFiltradas])
  const selOfertas  = useRowSelection(ofertaIds)
  const selFacturas = useRowSelection(facturaIds)

  // Al cambiar de pestaña, limpiar selección para no arrastrar contexto.
  useEffect(() => { selOfertas.clear(); selFacturas.clear() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const { colorOf } = useEmpresas()
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))

  const empresasConLetra = data.empresas.filter(e => !!e.letra_facturacion)
  const sinSetupEmpresas = data.empresas.length === 0
  const sinLetra         = data.empresas.length > 0 && empresasConLetra.length === 0

  // ── Orquestación de acciones en lote ──
  function ejecutar(fn: () => Promise<ResultadoLote>, sel: { clear: () => void }) {
    startTransition(async () => {
      const r = await fn()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas)          partes.push(`${r.hechas} aplicada${r.hechas === 1 ? '' : 's'}`)
      if (r.omitidas.length) partes.push(`${r.omitidas.length} omitida${r.omitidas.length === 1 ? '' : 's'}`)
      if (r.errores.length)  partes.push(`${r.errores.length} con error`)
      const msg = partes.join(' · ') || 'Nada que hacer'
      if (r.hechas > 0 && r.errores.length === 0) toastSuccess(msg)
      else if (r.hechas > 0)                      toastError(msg)
      else                                        toastError(r.omitidas[0]?.motivo ? `Nada aplicado — ${r.omitidas[0].motivo}` : msg)
      sel.clear()
      router.refresh()
    })
  }
  function pedirConfirmacion(c: Confirm) { setConfirm(c) }

  const selData = tab === 'ofertas'
    ? { sel: selOfertas, items: ofertasFiltradas.filter(o => selOfertas.isSelected(o.oferta_id)) }
    : { sel: selFacturas, items: facturasFiltradas.filter(f => selFacturas.isSelected(f.factura_id)) }

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

      {/* ── Prerrequisitos de configuración ── */}
      {sinSetupEmpresas ? (
        <PrerequisitoAviso acciones={[{ label: 'Crear empresa', href: '/portal/empresas' }]}>
          Para crear ofertas y facturas necesitas <strong>una empresa</strong>.
        </PrerequisitoAviso>
      ) : sinLetra ? (
        <PrerequisitoAviso acciones={[{ label: 'Ir a Empresas', href: '/portal/empresas' }]}>
          Ninguna de tus empresas tiene <strong>letra de facturación</strong> asignada; configúrala para poder crear ofertas y facturas.
        </PrerequisitoAviso>
      ) : null}

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
        <label className="filtro-toggle">
          <input type="checkbox" className="row-check" checked={verArchivadas}
            onChange={e => setVerArchivadas(e.target.checked)} />
          Ver archivadas
        </label>
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
              sel={selOfertas}
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
              sel={selFacturas}
            />
          )
        )}
      </div>

      {/* ── Barra flotante de acciones en lote ── */}
      <BulkBar count={selData.sel.count} onClear={selData.sel.clear}>
        {tab === 'ofertas'
          ? <AccionesOfertas
              items={selData.items as Oferta[]} ids={selOfertas.selectedIds}
              disabled={isPending} verArchivadas={verArchivadas}
              ejecutar={fn => ejecutar(fn, selOfertas)} pedirConfirmacion={pedirConfirmacion} />
          : <AccionesFacturas
              items={selData.items as Factura[]} ids={selFacturas.selectedIds}
              disabled={isPending} verArchivadas={verArchivadas}
              ejecutar={fn => ejecutar(fn, selFacturas)} pedirConfirmacion={pedirConfirmacion} />
        }
      </BulkBar>

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onConfirm={() => { const run = confirm.run; setConfirm(null); run() }}
          onCancel={() => setConfirm(null)}
        />
      )}

    </div>
  )
}

// ── Botones de acción en lote: OFERTAS ────────────────────────────────────────

function AccionesOfertas({
  items, ids, disabled, verArchivadas, ejecutar, pedirConfirmacion,
}: {
  items: Oferta[]; ids: string[]; disabled: boolean; verArchivadas: boolean
  ejecutar: (fn: () => Promise<ResultadoLote>) => void
  pedirConfirmacion: (c: Confirm) => void
}) {
  const n = ids.length
  const puede = (destino: EstadoOferta) => items.some(o => OFERTA_DESDE[destino].includes(o.estado))
  const hayArchivadas    = items.some(o => o.archivado)
  const hayNoArchivadas  = items.some(o => !o.archivado)
  const hayEliminables   = items.some(o => OFERTA_ELIMINABLE.includes(o.estado) && !o.factura_id)

  return (
    <>
      {puede('ENVIADA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => cambiarEstadoOfertasEnLote(ids, 'ENVIADA'))}>
          <Send size={14} strokeWidth={2} /> Enviar
        </button>
      )}
      {puede('APROBADA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Aprobar ${n} oferta${n === 1 ? '' : 's'}?`,
            body: 'Cada oferta aprobada genera automáticamente su factura en borrador.',
            confirmLabel: 'Sí, aprobar', danger: false,
            run: () => ejecutar(() => cambiarEstadoOfertasEnLote(ids, 'APROBADA')),
          })}>
          <Check size={14} strokeWidth={2} /> Aprobar
        </button>
      )}
      {puede('RECHAZADA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Rechazar ${n} oferta${n === 1 ? '' : 's'}?`,
            confirmLabel: 'Rechazar', danger: true,
            run: () => ejecutar(() => cambiarEstadoOfertasEnLote(ids, 'RECHAZADA')),
          })}>
          <Ban size={14} strokeWidth={2} /> Rechazar
        </button>
      )}
      {puede('CADUCADA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => cambiarEstadoOfertasEnLote(ids, 'CADUCADA'))}>
          <Clock size={14} strokeWidth={2} /> Caducar
        </button>
      )}
      <button className="btn btn-secondary btn-sm" disabled={disabled}
        onClick={() => ejecutar(() => duplicarOfertasEnLote(ids))}>
        <Copy size={14} strokeWidth={2} /> Duplicar
      </button>
      {hayNoArchivadas && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => archivarOfertasEnLote(ids, true))}>
          <Archive size={14} strokeWidth={2} /> Archivar
        </button>
      )}
      {verArchivadas && hayArchivadas && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => archivarOfertasEnLote(ids, false))}>
          <ArchiveRestore size={14} strokeWidth={2} /> Desarchivar
        </button>
      )}
      {hayEliminables && (
        <button className="btn btn-danger-text btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Eliminar ${n} oferta${n === 1 ? '' : 's'}?`,
            body: 'Solo se eliminan borradores y ofertas rechazadas o caducadas. Esta acción no se puede deshacer.',
            confirmLabel: 'Eliminar', danger: true,
            run: () => ejecutar(() => eliminarOfertasEnLote(ids)),
          })}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      )}
    </>
  )
}

// ── Botones de acción en lote: FACTURAS ───────────────────────────────────────

function AccionesFacturas({
  items, ids, disabled, verArchivadas, ejecutar, pedirConfirmacion,
}: {
  items: Factura[]; ids: string[]; disabled: boolean; verArchivadas: boolean
  ejecutar: (fn: () => Promise<ResultadoLote>) => void
  pedirConfirmacion: (c: Confirm) => void
}) {
  const n = ids.length
  const puede = (destino: EstadoFactura) => items.some(f => FACTURA_DESDE[destino].includes(f.estado))
  const hayArchivadas   = items.some(f => f.archivado)
  const hayNoArchivadas = items.some(f => !f.archivado)
  const hayEliminables  = items.some(f => FACTURA_ELIMINABLE.includes(f.estado))

  return (
    <>
      {puede('EMITIDA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Emitir ${n} factura${n === 1 ? '' : 's'}?`,
            body: 'Una vez emitidas ya no se pueden editar; solo cobrar o anular.',
            confirmLabel: 'Sí, emitir', danger: false,
            run: () => ejecutar(() => cambiarEstadoFacturasEnLote(ids, 'EMITIDA')),
          })}>
          <FileCheck size={14} strokeWidth={2} /> Emitir
        </button>
      )}
      {puede('ANULADA') && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Anular ${n} factura${n === 1 ? '' : 's'}?`,
            body: 'Anular deja registro pero invalida el documento. No se puede deshacer.',
            confirmLabel: 'Anular', danger: true,
            run: () => ejecutar(() => cambiarEstadoFacturasEnLote(ids, 'ANULADA')),
          })}>
          <Ban size={14} strokeWidth={2} /> Anular
        </button>
      )}
      <button className="btn btn-secondary btn-sm" disabled={disabled}
        onClick={() => ejecutar(() => duplicarFacturasEnLote(ids))}>
        <Copy size={14} strokeWidth={2} /> Duplicar
      </button>
      {hayNoArchivadas && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => archivarFacturasEnLote(ids, true))}>
          <Archive size={14} strokeWidth={2} /> Archivar
        </button>
      )}
      {verArchivadas && hayArchivadas && (
        <button className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => ejecutar(() => archivarFacturasEnLote(ids, false))}>
          <ArchiveRestore size={14} strokeWidth={2} /> Desarchivar
        </button>
      )}
      {hayEliminables && (
        <button className="btn btn-danger-text btn-sm" disabled={disabled}
          onClick={() => pedirConfirmacion({
            title: `¿Eliminar ${n} factura${n === 1 ? '' : 's'}?`,
            body: 'Solo se eliminan facturas en borrador. Las emitidas se anulan, no se borran. No se puede deshacer.',
            confirmLabel: 'Eliminar', danger: true,
            run: () => ejecutar(() => eliminarFacturasEnLote(ids)),
          })}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      )}
    </>
  )
}

// ── Checkbox de cabecera (con estado indeterminado) ───────────────────────────

function HeaderCheck({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: () => void
}) {
  return (
    <input
      type="checkbox" className="row-check"
      checked={checked}
      ref={el => { if (el) el.indeterminate = indeterminate }}
      onChange={onChange}
      aria-label="Seleccionar todo"
    />
  )
}

type SelApi = ReturnType<typeof useRowSelection>

// ── Tabla de ofertas ──────────────────────────────────────────────────────────

function TablaOfertas({
  ofertas, empresaNombres, clienteNombres, mostrarEmpresa, sel,
}: {
  ofertas: Oferta[]
  empresaNombres: Record<string, string>
  clienteNombres: Record<string, string>
  mostrarEmpresa: boolean
  sel: SelApi
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
            <th className="col-check">
              <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
            </th>
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
              <td className="col-check" onClick={e => e.stopPropagation()}>
                <input type="checkbox" className="row-check"
                  checked={sel.isSelected(o.oferta_id)}
                  onChange={() => sel.toggle(o.oferta_id)}
                  aria-label={`Seleccionar ${o.numero}`} />
              </td>
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
              <td data-label="Estado">
                <BadgeOferta estado={o.estado} />
                {o.archivado && <span className="badge badge-neutral ven-badge-archivada">Archivada</span>}
              </td>
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
  facturas, empresaNombres, clienteNombres, mostrarEmpresa, sel,
}: {
  facturas: Factura[]
  empresaNombres: Record<string, string>
  clienteNombres: Record<string, string>
  mostrarEmpresa: boolean
  sel: SelApi
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
            <th className="col-check">
              <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
            </th>
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
              <td className="col-check" onClick={e => e.stopPropagation()}>
                <input type="checkbox" className="row-check"
                  checked={sel.isSelected(f.factura_id)}
                  onChange={() => sel.toggle(f.factura_id)}
                  aria-label={`Seleccionar ${f.numero}`} />
              </td>
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
              <td data-label="Estado">
                <BadgeFactura estado={f.estado} />
                {f.archivado && <span className="badge badge-neutral ven-badge-archivada">Archivada</span>}
              </td>
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
  arr: Oferta[], empresa: string, cliente: string, estado: string, verArchivadas: boolean,
): Oferta[] {
  return arr.filter(o => {
    if (!verArchivadas && o.archivado) return false
    if (empresa && o.empresa_id !== empresa) return false
    if (cliente && o.cliente_id !== cliente) return false
    if (estado  && o.estado     !== estado)  return false
    return true
  })
}

function filtrarFacturas(
  arr: Factura[], empresa: string, cliente: string, estado: string, verArchivadas: boolean,
): Factura[] {
  return arr.filter(f => {
    if (!verArchivadas && f.archivado) return false
    if (empresa && f.empresa_id !== empresa) return false
    if (cliente && f.cliente_id !== cliente) return false
    if (estado  && f.estado     !== estado)  return false
    return true
  })
}
