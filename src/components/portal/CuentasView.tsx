'use client'

import { toastError } from '@/app/contexts/ToastContext'
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
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
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

  const esCobro       = modo === 'COBRAR'
  const cuentasCompat = cuentas.filter(c => c.moneda === doc.moneda)
  const [cuentaId, setCuentaId] = useState(cuentasCompat[0]?.cuenta_id ?? '')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('doc_tipo', doc.doc_tipo)
    fd.set('doc_id', doc.doc_id)
    fd.set('cuenta_id', cuentaId)
    startTransition(async () => {
      const res = await registrarPagoDoc(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  function handleAnular(movimiento_id: string) {
    startTransition(async () => {
      const res = await anularPagoDoc(movimiento_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{esCobro ? 'Registrar cobro' : 'Registrar pago'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">

          <div className="info-box">
            <strong className="info-box-title">{doc.numero}</strong>
            <span className="text-xs-muted">
              {doc.tercero_nombre ? `${doc.tercero_nombre} · ` : ''}
              Total {formatMonto(doc.monto)} {doc.moneda} ·
              <strong> Pendiente {formatMonto(doc.saldo)} {doc.moneda}</strong>
            </span>
          </div>

          {doc.saldo > 0.005 ? (
            cuentasCompat.length === 0 ? (
              <div className="alert alert-warning mt-3">
                No tienes cuentas en {doc.moneda}. Crea una en Tesorería para registrar el {esCobro ? 'cobro' : 'pago'}.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="gc-liq-form">
                <div className="ter-form-grid">
                  <div className="input-group ter-col-full">
                    <label>Cuenta <span className="required">*</span></label>
                    <select className="input" value={cuentaId} onChange={e => setCuentaId(e.target.value)} required>
                      {cuentasCompat.map(c => <option key={c.cuenta_id} value={c.cuenta_id}>{c.nombre} · {c.moneda}</option>)}
                    </select>
                  </div>
                  <div className="input-group ter-col-span-3">
                    <label>Monto ({doc.moneda}) <span className="required">*</span></label>
                    <input className="input" name="monto" type="number" min="0" step="0.01" required
                      defaultValue={doc.saldo.toFixed(2)} />
                  </div>
                  <div className="input-group ter-col-span-3">
                    <label>Fecha <span className="required">*</span></label>
                    <input className="input" name="fecha" type="date" defaultValue={hoyISO()} required />
                  </div>
                  <div className="input-group ter-col-full">
                    <label>Notas</label>
                    <input className="input" name="notas" placeholder="Referencia…" />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary btn-sm mt-2" disabled={isPending}>
                  {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : esCobro ? 'Registrar cobro' : 'Registrar pago'}
                </button>
              </form>
            )
          ) : (
            <div className="alert alert-success mt-3">{esCobro ? 'Cobrado' : 'Pagado'} por completo.</div>
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
          <h1 className="page-title">{titulo}</h1>
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
                  <th className="tes-col-monto">Total</th>
                  <th className="tes-col-monto">Pendiente</th>
                  <th className="alm-col-act"></th>
                </tr>
              </thead>
              <tbody>
                {documentos.map(d => (
                  <tr
                    key={d.doc_id}
                    className={multiempresa ? 'row-empresa-accent' : undefined}
                    style={multiempresa ? empresaColorVar(colorOf(d.empresa_id)) : undefined}
                  >
                    <td>
                      <strong>{d.numero}</strong>
                      <div className="tes-mov-sub">
                        <span className="badge badge-neutral tes-origen-badge">{d.doc_tipo === 'FACTURA' ? 'Factura' : 'Directo'}</span>
                        <span className="tes-mov-cat">{formatFecha(d.fecha)}</span>
                        {multiempresa && (
                          <EmpresaTag color={colorOf(d.empresa_id)} nombre={nombreOf(d.empresa_id) ?? d.empresa_id} />
                        )}
                      </div>
                    </td>
                    <td className="text-sm-muted">{d.tercero_nombre ?? '—'}</td>
                    <td className="tes-nowrap">
                      {formatFecha(d.vencimiento)}
                      {d.dias_vencido != null && (
                        <span className={`badge ${TRAMO_BADGE[d.tramo]} cxx-dias`}>{d.dias_vencido} d</span>
                      )}
                    </td>
                    <td className="tes-col-monto tes-monto-cell">{formatMonto(d.monto)} {d.moneda}</td>
                    <td className="tes-col-monto tes-monto-cell">{formatMonto(d.saldo)} {d.moneda}</td>
                    <td>
                      <div className="ter-actions">
                        <button className="ter-action-btn ter-action-money" title={esCobro ? 'Cobrar' : 'Pagar'}
                          onClick={() => setPagoDoc(d)}><DollarSign size={15} strokeWidth={2} /></button>
                        {d.ref_url && d.doc_tipo === 'FACTURA' && (
                          <Link className="ter-action-btn" title="Ver factura" href={d.ref_url}><ExternalLink size={15} strokeWidth={2} /></Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagoVivo && (
        <PagoModal doc={pagoVivo} cuentas={data.cuentas} modo={data.modo}
          onClose={() => setPagoDoc(null)} onChanged={onChanged} />
      )}
    </div>
  )
}

