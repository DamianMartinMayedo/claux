'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useEffect, useRef }   from 'react'
import Link                           from 'next/link'
import { useRouter }                  from 'next/navigation'
import {
  cambiarEstadoFactura,
  duplicarFactura,
  type FacturaDetalleData,
  type VentasResumenData,
} from '@/app/actions/portal/ventas'
import {
  registrarPagoDoc,
  anularPagoDoc,
  type CobrosFacturaData,
} from '@/app/actions/portal/cobranza'
import LiquidarCuentaFields, { type LiquidarState } from '@/app/portal/(app)/_shared/LiquidarCuentaFields'
import { ConfirmDialog, AlertDialog } from '@/components/portal/Dialog'
import { empresaColorVar }            from '@/components/portal/EmpresaTag'
import { Copy, MoreHorizontal, Pencil, Download, Trash2, X } from 'lucide-react'
import {
  AJUSTE_TIPO_LABEL,
  CONDICION_PAGO_LABEL,
  ESTADO_FACTURA_LABEL,
  ESTADO_FACTURA_BADGE,
  TRANSICIONES_FACTURA,
  formatearMoneda,
  type EstadoFactura,
} from '../../_ventas-helpers'

interface Props {
  data:    FacturaDetalleData
  resumen: VentasResumenData
  cobros:  CobrosFacturaData | null
}

export default function FacturaDetalle({ data, cobros }: Props) {
  const router = useRouter()
  const [isPending,   startTransition] = useTransition()
  const [statusMsg,   setStatusMsg] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  const [dialog, setDialog] = useState<{
    title: string; body?: string; danger?: boolean; confirmLabel?: string;
    onConfirm: () => void
  } | null>(null)
  const [alertMsg, setAlertMsg] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [descargandoPdf, setDescargandoPdf] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const { factura, empresa, cliente, lineas, ajustes, oferta } = data

  const puedeEditar  = factura.estado === 'BORRADOR'
  const transiciones = TRANSICIONES_FACTURA[factura.estado] ?? []

  // Descarga directa: se genera en cliente con los datos ya cargados, sin abrir
  // otra página ni recargar (principio de descargas directas — contexto Cuba).
  async function handleDescargarPdf() {
    if (descargandoPdf) return
    setDescargandoPdf(true)
    try {
      const { descargarDocumentoVenta } = await import('@/lib/pdf/venta')
      await descargarDocumentoVenta({
        titulo:          'FACTURA',
        numero:          factura.numero,
        fechaEmision:    factura.fecha_emision,
        fechaSecundaria: factura.fecha_vencimiento ? { label: 'Vencimiento', valor: factura.fecha_vencimiento } : undefined,
        condicionPago:   factura.condicion_pago,
        empresa, cliente, moneda: factura.moneda, lineas, ajustes,
        subtotal:        Number(factura.subtotal),
        total:           Number(factura.total),
        notas:           factura.notas,
      })
    } finally {
      setDescargandoPdf(false)
    }
  }

  async function handleDuplicar() {
    setDialog({
      title: '¿Duplicar esta factura?',
      body: 'Se creará un nuevo borrador con las mismas líneas y ajustes.',
      confirmLabel: 'Duplicar',
      onConfirm: async () => {
        setDuplicating(true)
        const res = await duplicarFactura(factura.factura_id)
        setDuplicating(false)
        if (!res.ok) { setAlertMsg(res.error ?? 'Error al duplicar.'); return }
        router.push(`/portal/ventas/facturas/${res.factura_id}`)
      },
    })
  }

  function ejecutarCambioEstado(nuevo: EstadoFactura) {
    startTransition(async () => {
      const res = await cambiarEstadoFactura(factura.factura_id, nuevo)
      if (!res.ok) { setAlertMsg(res.error ?? 'Error al cambiar estado.'); return }
      setStatusMsg('Estado actualizado.')
      setTimeout(() => setStatusMsg(''), 2500)
      router.refresh()
    })
  }

  function cambiarEstado(nuevo: EstadoFactura) {
    if (nuevo === 'ANULADA' && factura.estado === 'COBRADA') {
      setDialog({
        title: 'Anular factura cobrada',
        body: 'Estás a punto de anular una factura COBRADA. Esto deja registro pero invalida el documento fiscal. Esta acción no se puede deshacer.',
        danger: true,
        confirmLabel: 'Sí, anular de todos modos',
        onConfirm: () => ejecutarCambioEstado(nuevo),
      })
    } else if (nuevo === 'ANULADA') {
      setDialog({
        title: '¿Anular esta factura?',
        body: 'La acción queda registrada por trazabilidad y no se puede deshacer.',
        danger: true,
        confirmLabel: 'Anular',
        onConfirm: () => ejecutarCambioEstado(nuevo),
      })
    } else if (nuevo === 'EMITIDA') {
      setDialog({
        title: '¿Emitir esta factura?',
        body: 'Una vez emitida no podrás editarla. El documento queda como referencia fiscal.',
        confirmLabel: 'Sí, emitir',
        onConfirm: () => ejecutarCambioEstado(nuevo),
      })
    } else {
      ejecutarCambioEstado(nuevo)
    }
  }

  return (
    <div className="view-container">

      <div className="ven-breadcrumb">
        <Link href="/portal/ventas" className="ven-breadcrumb-link">
          ← Volver a Ventas
        </Link>
      </div>

      <div className="page-header page-header-top">
        <div>
          <h1 className="page-title page-title-row">
            {factura.numero}
            <BadgeFactura estado={factura.estado} />
          </h1>
          <p className="page-subtitle">
            Factura · {fmtFecha(factura.fecha_emision)}
            {factura.fecha_vencimiento && <> · Vence {fmtFecha(factura.fecha_vencimiento)}</>}
            {factura.condicion_pago && (
              <> · {CONDICION_PAGO_LABEL[factura.condicion_pago] ?? factura.condicion_pago}</>
            )}
          </p>
        </div>
        <div className="ven-btn-group ven-btn-group-relative">
          {puedeEditar && (
            <Link href={`/portal/ventas/facturas/${factura.factura_id}/editar`} className="btn btn-secondary">
              <Pencil size={14} strokeWidth={2} /> Editar
            </Link>
          )}
          <button className="btn btn-secondary" onClick={handleDescargarPdf} disabled={descargandoPdf}>
            <Download size={14} strokeWidth={2} /> {descargandoPdf ? 'Generando…' : 'Descargar PDF'}
          </button>
          <div className="ven-dropdown-wrap" ref={menuRef}>
            <button className="btn btn-secondary" onClick={() => setMenuOpen(v => !v)}>
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="ven-dropdown-menu" onClick={() => setMenuOpen(false)}>
                <button className="ven-dropdown-item" onClick={handleDuplicar} disabled={duplicating}>
                  <Copy size={14} strokeWidth={2} /> {duplicating ? 'Duplicando…' : 'Duplicar'}
                </button>
                {transiciones.length > 0 && (
                  <>
                    <div className="ven-dropdown-sep" />
                    {transiciones.map(t => (
                      <button
                        key={t}
                        className={`ven-dropdown-item${t === 'ANULADA' ? ' ven-dropdown-item-danger' : ''}`}
                        onClick={() => cambiarEstado(t)}
                        disabled={isPending}
                      >
                        {t === 'ANULADA' ? <Trash2 size={14} strokeWidth={2} /> : null}
                        Cambiar a {ESTADO_FACTURA_LABEL[t]}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {statusMsg && (
        <div className="alert alert-success mb-4">{statusMsg}</div>
      )}

      {oferta && (
        <div className="alert alert-info mb-4 alert-between">
          <span>Esta factura proviene de la oferta <strong>{oferta.numero}</strong>.</span>
          <Link href={`/portal/ventas/ofertas/${oferta.oferta_id}`} className="btn btn-secondary btn-sm">
            Ver oferta
          </Link>
        </div>
      )}

      {/* ── Información ── */}
      <div className="ven-info-grid">
        <div className="ven-info-card ven-info-card-empresa" style={empresaColorVar(empresa.color)}>
          <div className="ven-info-label">Empresa emisora</div>
          <div className="ven-info-nombre">
            {empresa.letra_facturacion && (
              <span className="ven-letra-badge" style={empresaColorVar(empresa.color)}>
                {empresa.letra_facturacion}
              </span>
            )}
            {empresa.nombre}
          </div>
          {empresa.nombre_fiscal && <div className="ven-info-line">{empresa.nombre_fiscal}</div>}
          {empresa.rif_nit       && <div className="ven-info-line">NIF/NIT: {empresa.rif_nit}</div>}
          {(empresa.direccion || empresa.ciudad || empresa.pais) && (
            <div className="ven-info-line">
              {[empresa.direccion, empresa.ciudad, empresa.pais].filter(Boolean).join(', ')}
            </div>
          )}
        </div>

        <div className="ven-info-card">
          <div className="ven-info-label">Cliente</div>
          <div className="ven-info-nombre">{cliente.nombre}</div>
          {cliente.identificacion && <div className="ven-info-line">ID: {cliente.identificacion}</div>}
          {(cliente.direccion || cliente.ciudad || cliente.pais) && (
            <div className="ven-info-line">
              {[cliente.direccion, cliente.ciudad, cliente.pais].filter(Boolean).join(', ')}
            </div>
          )}
          {cliente.email    && <div className="ven-info-line">{cliente.email}</div>}
          {cliente.telefono && <div className="ven-info-line">{cliente.telefono}</div>}
        </div>
      </div>

      {/* ── Detalle ── */}
      <div className="card card-table mt-4">
        <div className="mon-card-header">
          <h2 className="mon-section-title">Detalle</h2>
        </div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Descripción</th>
                <th className="col-num">Cantidad</th>
                <th className="col-num">Precio unit.</th>
                {lineas.some(l => Number(l.descuento_pct) > 0) && (
                  <th className="col-num">Dto. %</th>
                )}
                <th className="col-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map(l => (
                <tr key={l.linea_id}>
                  <td data-label="Descripción">{l.descripcion}</td>
                  <td data-label="Cantidad" className="col-num">{Number(l.cantidad)}</td>
                  <td data-label="Precio unit." className="col-num">{formatearMoneda(Number(l.precio_unitario), factura.moneda)}</td>
                  {lineas.some(x => Number(x.descuento_pct) > 0) && (
                    <td data-label="Dto. %" className="col-num text-muted">
                      {Number(l.descuento_pct) > 0 ? `${Number(l.descuento_pct)}%` : '—'}
                    </td>
                  )}
                  <td data-label="Total" className="col-num">{formatearMoneda(Number(l.total), factura.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ven-totales-resumen ven-totales-detalle">
          <div className="ven-total-row">
            <span>Subtotal</span>
            <strong>{formatearMoneda(Number(factura.subtotal), factura.moneda)}</strong>
          </div>
          {ajustes.map(a => (
            <div key={a.ajuste_id} className="ven-total-row ven-total-ajuste">
              <span>
                <span className={`ven-ajuste-tag-sm ven-ajuste-tag-${a.tipo.toLowerCase()}`}>
                  {AJUSTE_TIPO_LABEL[a.tipo]}
                </span>{' '}
                {a.nombre}
              </span>
              <span>
                {a.tipo === 'DESCUENTO' ? '−' : '+'} {formatearMoneda(Number(a.monto_calculado), factura.moneda)}
              </span>
            </div>
          ))}
          <div className="ven-total-row ven-total-final">
            <span>Total</span>
            <strong>{formatearMoneda(Number(factura.total), factura.moneda)}</strong>
          </div>
        </div>
      </div>

      {/* ── Cobros (solo facturas emitidas/cobradas) ── */}
      {cobros && (factura.estado === 'EMITIDA' || factura.estado === 'COBRADA') && (
        <CobrosFacturaCard cobros={cobros} numero={factura.numero} />
      )}

      {factura.notas && (
        <div className="ven-notas">
          <div className="ven-info-label">Notas</div>
          <p>{factura.notas}</p>
        </div>
      )}

      {factura.notas_internas && (
        <div className="ven-notas ven-notas-internas">
          <div className="ven-info-label">Notas internas <span className="ven-notas-internas-badge">No se imprime</span></div>
          <p>{factura.notas_internas}</p>
        </div>
      )}

      {/* editOpen no longer used (edit → full page) */}

      {/* ── Dialogs ── */}
      {dialog && (
        <ConfirmDialog
          {...dialog}
          onCancel={() => setDialog(null)}
          onConfirm={() => { const fn = dialog.onConfirm; setDialog(null); fn() }}
        />
      )}
      {alertMsg && <AlertDialog title="Error" body={alertMsg} onClose={() => setAlertMsg(null)} />}
    </div>
  )
}

function BadgeFactura({ estado }: { estado: EstadoFactura }) {
  return (
    <span className={`badge ${ESTADO_FACTURA_BADGE[estado] ?? 'badge-neutral'}`}>
      {ESTADO_FACTURA_LABEL[estado]}
    </span>
  )
}

// ── Panel de cobros de la factura ───────────────────────────────────────────────

function CobrosFacturaCard({ cobros, numero }: { cobros: CobrosFacturaData; numero: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [modalOpen, setModalOpen] = useState(false)

  const [liq, setLiq] = useState<LiquidarState | null>(null)
  const puedeCobrar = cobros.estado === 'EMITIDA' && cobros.saldo > 0.005

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!liq || !liq.valido) return
    const fd = new FormData(e.currentTarget)
    fd.set('doc_tipo', 'FACTURA')
    fd.set('doc_id', cobros.factura_id)
    fd.set('cuenta_id', liq.cuentaId)
    fd.set('monto', liq.monto)
    fd.set('tasa_cambio', String(liq.tasa))
    startTransition(async () => {
      const res = await registrarPagoDoc(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      setModalOpen(false); router.refresh()
    })
  }

  function handleAnular(movimiento_id: string) {
    startTransition(async () => {
      const res = await anularPagoDoc(movimiento_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      router.refresh()
    })
  }

  return (
    <div className="card card-table mt-4">
      <div className="mon-card-header">
        <h2 className="mon-section-title">Cobros</h2>
        <span className={`badge ${cobros.saldo > 0.005 ? 'badge-warning' : 'badge-success'}`}>
          {cobros.saldo > 0.005
            ? `Pendiente ${formatearMoneda(cobros.saldo, cobros.moneda)}`
            : 'Cobrada por completo'}
        </span>
      </div>

      <div className="gc-fac-cobros">
        {cobros.liquidaciones.length === 0 ? (
          <p className="text-sm-muted gc-fac-empty">Sin cobros registrados.</p>
        ) : (
          cobros.liquidaciones.map(l => (
            <div key={l.movimiento_id} className="gc-liq-row">
              <span className="text-sm-muted tes-nowrap">{fmtFecha(l.fecha)}</span>
              <span className="gc-liq-cuenta">{l.cuenta_nombre}</span>
              <span className="gc-liq-monto">{formatearMoneda(l.monto, cobros.moneda)}</span>
              <button className="ter-action-btn ter-action-danger" title="Anular cobro"
                onClick={() => handleAnular(l.movimiento_id)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
            </div>
          ))
        )}

        {puedeCobrar && (
          <button className="btn btn-primary btn-sm gc-fac-cobrar" onClick={() => setModalOpen(true)}>
            Registrar cobro
          </button>
        )}
      </div>

      {modalOpen && (
        <div className="modal-backdrop open">
          <div className="modal modal-md" role="dialog" aria-modal>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Registrar cobro · {numero}</h2>
                <p className="text-xs-muted mt-1">
                  Total {formatearMoneda(cobros.total, cobros.moneda)} · Pendiente <strong>{formatearMoneda(cobros.saldo, cobros.moneda)}</strong>
                </p>
              </div>
              <button type="button" className="modal-close" onClick={() => setModalOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              {cobros.cuentas.length === 0 ? (
                <div className="alert alert-warning">
                  No tienes cajas disponibles. Crea una en Tesorería para registrar el cobro.
                </div>
              ) : (
                <form id="cobro-form" onSubmit={handleSubmit} className="gc-liq-form">
                  <div className="ter-form-grid">
                    <LiquidarCuentaFields
                      cuentas={cobros.cuentas}
                      docMoneda={cobros.moneda}
                      saldo={cobros.saldo}
                      onChange={setLiq}
                    />
                    <div className="input-group ter-col-span-3">
                      <label>Fecha <span className="required">*</span></label>
                      <input className="input" name="fecha" type="date" required defaultValue={new Date().toISOString().split('T')[0]} />
                    </div>
                    <div className="input-group ter-col-full">
                      <label>Notas</label>
                      <input className="input" name="notas" placeholder="Referencia del cobro…" />
                    </div>
                  </div>
                </form>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              {cobros.cuentas.length > 0 && (
                <button type="submit" form="cobro-form" className="btn btn-primary" disabled={isPending || !liq?.valido}>
                  {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : 'Registrar cobro'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

