'use client'

import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
import { useRouter }                        from 'next/navigation'
import Link                                 from 'next/link'
import { Check, DollarSign, ExternalLink, Trash2, X } from 'lucide-react'
import {
  registrarPagoDoc,
  anularPagoDoc,
  type CuentasPageData,
  type DocumentoPendiente,
  type Tramo,
} from '@/app/actions/portal/cobranza'
import LiquidarCuentaFields, { type LiquidarState } from '@/app/portal/(app)/_shared/LiquidarCuentaFields'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { RowActions }                  from '@/components/portal/RowActions'
import { usePagination, TablePagination } from '@/components/TablePagination'
import EmpresaPills                    from '@/components/portal/EmpresaPills'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'

// ── Constantes ────────────────────────────────────────────────────────────────

const TRAMO_LABEL: Record<Tramo, string> = {
  AL_DIA: 'Al día', V_1_30: '1–30 días', V_31_60: '31–60 días', V_60: '+60 días',
}
const TRAMO_BADGE: Record<Tramo, string> = {
  AL_DIA: 'badge-neutral', V_1_30: 'badge-warning', V_31_60: 'badge-warning', V_60: 'badge-error',
}
const TRAMOS: Tramo[] = ['AL_DIA', 'V_1_30', 'V_31_60', 'V_60']

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function formatFecha(f: string | null): string {
  if (!f) return '—'
  const [y, m, d] = f.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Modal: registrar cobro / pago + historial ───────────────────────────────────

function PagoModal({
  doc, cuentas, modo, onClose, onChanged,
}: {
  doc:      DocumentoPendiente
  cuentas:  CuentasPageData['cuentas']
  modo:     CuentasPageData['modo']
  onClose:  () => void
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()

  const esCobro        = modo === 'COBRAR'
  // Mostrar TODAS las cuentas (sin filtro por empresa).
  // Las de la misma moneda aparecen primero; las de otra moneda aplican tasa.
  const cuentasOrdenadas = [...cuentas].sort((a, b) =>
    (a.moneda === doc.moneda ? 0 : 1) - (b.moneda === doc.moneda ? 0 : 1))
  const [liq, setLiq]  = useState<LiquidarState | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!liq || !liq.valido) return
    const fd = new FormData(e.currentTarget)
    fd.set('doc_tipo', doc.doc_tipo)
    fd.set('doc_id', doc.doc_id)
    fd.set('cuenta_id', liq.cuentaId)
    fd.set('monto', liq.monto)
    fd.set('tasa_cambio', String(liq.tasa))
    const ld = toastLoading('Registrando…')
    startTransition(async () => {
      const res = await registrarPagoDoc(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  function handleAnular(movimiento_id: string) {
    const ld = toastLoading('Anulando…')
    startTransition(async () => {
      const res = await anularPagoDoc(movimiento_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{esCobro ? 'Registrar cobro' : 'Registrar pago'}</h2>
            <p className="text-xs-muted mt-1">
              {doc.numero} · {doc.tercero_nombre ? `${doc.tercero_nombre} · ` : ''}
              Total {formatMonto(doc.monto)} {doc.moneda} · Pendiente <strong>{formatMonto(doc.saldo)} {doc.moneda}</strong>
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          {doc.saldo > 0.005 ? (
            cuentasOrdenadas.length === 0 ? (
              <div className="alert alert-warning">
                No tienes cajas disponibles. Crea una en Tesorería para registrar el {esCobro ? 'cobro' : 'pago'}.
              </div>
            ) : (
               <form id="cobro-form" onSubmit={handleSubmit} className="gc-liq-form">
                <div className="ter-form-grid">
                  <LiquidarCuentaFields
                    cuentas={cuentasOrdenadas}
                    docMoneda={doc.moneda}
                    saldo={doc.saldo}
                    onChange={setLiq}
                  />
                  <div className="input-group ter-col-span-3">
                    <label>Fecha <span className="required">*</span></label>
                    <input className="input" name="fecha" type="date" defaultValue={hoyISO()} required />
                  </div>
                  <div className="input-group ter-col-full">
                    <label>Notas</label>
                    <input className="input" name="notas" placeholder="Referencia…" />
                  </div>
                </div>
              </form>
            )
          ) : (
            <div className="alert alert-success">{esCobro ? 'Cobrado' : 'Pagado'} por completo.</div>
          )}
          {doc.liquidaciones.length > 0 && (
            <div className="gc-liq-historial">
              <span className="ter-form-section-title">{esCobro ? 'Cobros' : 'Pagos'} registrados</span>
              {doc.liquidaciones.map(l => (
                <div key={l.movimiento_id} className="gc-liq-row">
                  <span className="text-sm-muted tes-nowrap">{formatFecha(l.fecha)}</span>
                  <span className="gc-liq-cuenta">{l.cuenta_nombre}</span>
                  <span className="gc-liq-monto">{formatMonto(l.monto)} {doc.moneda}</span>
                  <button className="ter-action-btn ter-action-danger" title="Anular"
                    onClick={() => handleAnular(l.movimiento_id)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          {doc.saldo > 0.005 && cuentasOrdenadas.length > 0 && (
            <button type="submit" form="cobro-form" className="btn btn-primary" disabled={isPending || !liq?.valido}>
              {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : esCobro ? 'Registrar cobro' : 'Registrar pago'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ─────────────────────────────────────────────────────────────

export default function CuentasView({ data }: { data: CuentasPageData }) {
  const router = useRouter()
  const { colorOf, nombreOf } = useEmpresas()
  const esCobro = data.modo === 'COBRAR'
  const multiempresa = data.empresas.length > 1
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))

  const [pagoDoc,      setPagoDoc]      = useState<DocumentoPendiente | null>(null)
  const [filtroTramo,  setFiltroTramo]  = useState<Tramo | ''>('')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')

  const documentos = useMemo(() => {
    return data.documentos.filter(d => {
      if (filtroTramo   && d.tramo      !== filtroTramo)   return false
      if (filtroEmpresa && d.empresa_id !== filtroEmpresa) return false
      return true
    })
  }, [data.documentos, filtroTramo, filtroEmpresa])

  const { pageItems, ...pag } = usePagination(documentos)

  // Total pendiente por moneda
  const porMoneda = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of data.documentos) m.set(d.moneda, (m.get(d.moneda) ?? 0) + d.saldo)
    return Array.from(m.entries()).map(([moneda, saldo]) => ({ moneda, saldo })).sort((a, b) => a.moneda.localeCompare(b.moneda))
  }, [data.documentos])

  // Conteo por tramo
  const conteoTramo = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of data.documentos) m[d.tramo] = (m[d.tramo] ?? 0) + 1
    return m
  }, [data.documentos])

  // Re-sincroniza el doc abierto tras refresh
  const pagoVivo = pagoDoc
    ? data.documentos.find(d => d.doc_id === pagoDoc.doc_id) ?? null
    : null

  function onChanged() { router.refresh() }

  const titulo   = esCobro ? 'Cuentas por cobrar' : 'Cuentas por pagar'
  const subtitulo = esCobro
    ? 'Facturas emitidas y cobros pendientes, ordenados por antigüedad.'
    : 'Gastos pendientes de pago, ordenados por antigüedad.'

  return (
    <div className="view-container">

      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">{titulo}</h1>
            <IaTouchpoint tipo="deudas" descripcion={esCobro ? 'un análisis de lo que te deben' : 'un análisis de lo que debes'} />
          </div>
          <p className="page-subtitle">{subtitulo}</p>
        </div>
      </div>

      {/* Totales por moneda */}
      {porMoneda.length > 0 && (
        <div className="tes-saldos-grid">
          {porMoneda.map(s => (
            <div key={s.moneda} className="tes-saldo-card">
              <div className="tes-saldo-moneda">{s.moneda}</div>
              <div className="tes-saldo-monto">{formatMonto(s.saldo)}</div>
              <div className="tes-saldo-label">{esCobro ? 'por cobrar' : 'por pagar'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Chips de antigüedad */}
      {data.documentos.length > 0 && (
        <div className="cxx-chips">
          <button className={`cxx-chip${filtroTramo === '' ? ' active' : ''}`} onClick={() => setFiltroTramo('')}>
            Todos <span className="cxx-chip-count">{data.documentos.length}</span>
          </button>
          {TRAMOS.map(t => (
            (conteoTramo[t] ?? 0) > 0 && (
              <button key={t} className={`cxx-chip${filtroTramo === t ? ' active' : ''}`} onClick={() => setFiltroTramo(t)}>
                {TRAMO_LABEL[t]} <span className="cxx-chip-count">{conteoTramo[t]}</span>
              </button>
            )
          ))}
          <EmpresaPills
            empresas={empresasFiltro}
            value={filtroEmpresa}
            onChange={setFiltroEmpresa}
            todasLabel="Todas las empresas"
          />
        </div>
      )}

      {/* Tabla */}
      <div className="card card-table">
        {documentos.length === 0 ? (
          <div className="mon-empty">
            <Check size={40} strokeWidth={1} opacity={0.2} />
            <p>{data.documentos.length === 0
              ? (esCobro ? 'No hay nada pendiente de cobro. Todo al día.' : 'No hay nada pendiente de pago. Todo al día.')
              : 'No hay documentos para los filtros seleccionados.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>{esCobro ? 'Cliente' : 'Proveedor'}</th>
                  <th>Vencimiento</th>
                  <th className="col-num">Total</th>
                  <th className="col-num">Pendiente</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(d => (
                  <tr
                    key={d.doc_id}
                    className={multiempresa ? 'row-empresa-accent' : undefined}
                    style={multiempresa ? empresaColorVar(colorOf(d.empresa_id)) : undefined}
                  >
                    <td data-label="Documento">
                      <strong>{d.numero}</strong>
                      <div className="tes-mov-sub">
                        <span className="badge badge-neutral tes-origen-badge">{d.doc_tipo === 'FACTURA' ? 'Factura' : 'Directo'}</span>
                        <span className="tes-mov-cat">{formatFecha(d.fecha)}</span>
                        {multiempresa && (
                          <EmpresaTag color={colorOf(d.empresa_id)} nombre={nombreOf(d.empresa_id) ?? d.empresa_id} />
                        )}
                      </div>
                    </td>
                    <td data-label={esCobro ? 'Cliente' : 'Proveedor'} className="text-sm-muted">{d.tercero_nombre ?? '—'}</td>
                    <td data-label="Vencimiento" className="tes-nowrap">
                      {formatFecha(d.vencimiento)}
                      {d.dias_vencido != null && (
                        <span className={`badge ${TRAMO_BADGE[d.tramo]} cxx-dias`}>{d.dias_vencido} d</span>
                      )}
                    </td>
                    <td data-label="Total" className="col-num tes-monto-cell">{formatMonto(d.monto)} {d.moneda}</td>
                    <td data-label="Pendiente" className="col-num tes-monto-cell">{formatMonto(d.saldo)} {d.moneda}</td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item"
                          onClick={() => setPagoDoc(d)}><DollarSign size={15} strokeWidth={2} /> {esCobro ? 'Cobrar' : 'Pagar'}</button>
                        {d.ref_url && d.doc_tipo === 'FACTURA' && (
                          <Link className="row-actions-item" href={d.ref_url}><ExternalLink size={15} strokeWidth={2} /> Ver factura</Link>
                        )}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="documento" />
      </div>

      {pagoVivo && (
        <PagoModal doc={pagoVivo} cuentas={data.cuentas} modo={data.modo}
          onClose={() => setPagoDoc(null)} onChanged={onChanged} />
      )}
    </div>
  )
}

