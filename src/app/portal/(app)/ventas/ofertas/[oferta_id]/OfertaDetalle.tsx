'use client'

import { useState, useTransition }   from 'react'
import Link                           from 'next/link'
import { useRouter }                  from 'next/navigation'
import {
  cambiarEstadoOferta,
  duplicarOferta,
  type OfertaDetalleData,
  type VentasResumenData,
} from '@/app/actions/portal/ventas'
import { ConfirmDialog, AlertDialog } from '@/components/portal/Dialog'
import {
  AJUSTE_TIPO_LABEL,
  AJUSTE_TIPO_STYLE,
  CONDICION_PAGO_LABEL,
  ESTADO_OFERTA_LABEL,
  ESTADO_OFERTA_STYLE,
  TRANSICIONES_OFERTA,
  formatearMoneda,
  type EstadoOferta,
} from '../../_ventas-helpers'

interface Props {
  data:    OfertaDetalleData
  resumen: VentasResumenData
}

export default function OfertaDetalle({ data, resumen }: Props) {
  const router = useRouter()
  const [isPending,    startTransition] = useTransition()
  const [statusMsg,    setStatusMsg] = useState('')
  const [duplicating,  setDuplicating] = useState(false)
  const [dialog, setDialog] = useState<{
    title: string; body?: string; danger?: boolean; confirmLabel?: string;
    onConfirm: () => void
  } | null>(null)
  const [alertMsg, setAlertMsg] = useState<string | null>(null)

  const { oferta, empresa, cliente, lineas, ajustes, factura } = data

  const puedeEditar = oferta.estado === 'BORRADOR' || oferta.estado === 'ENVIADA'
  const transiciones = TRANSICIONES_OFERTA[oferta.estado] ?? []

  async function handleDuplicar() {
    setDialog({
      title: '¿Duplicar esta oferta?',
      body: 'Se creará un nuevo borrador con las mismas líneas y ajustes.',
      confirmLabel: 'Duplicar',
      onConfirm: async () => {
        setDuplicating(true)
        const res = await duplicarOferta(oferta.oferta_id)
        setDuplicating(false)
        if (!res.ok) { setAlertMsg(res.error ?? 'Error al duplicar.'); return }
        router.push(`/portal/ventas/ofertas/${res.oferta_id}`)
      },
    })
  }

  function ejecutarCambioEstado(nuevo: EstadoOferta) {
    startTransition(async () => {
      const res = await cambiarEstadoOferta(oferta.oferta_id, nuevo)
      if (!res.ok) { setAlertMsg(res.error ?? 'Error al cambiar estado.'); return }
      if (res.factura_id) {
        setStatusMsg('Oferta aprobada. Factura generada.')
        setTimeout(() => router.push(`/portal/ventas/facturas/${res.factura_id}`), 1200)
      } else {
        setStatusMsg('Estado actualizado.')
        setTimeout(() => setStatusMsg(''), 2500)
        router.refresh()
      }
    })
  }

  function cambiarEstado(nuevo: EstadoOferta) {
    if (nuevo === 'APROBADA') {
      setDialog({
        title: '¿Aprobar esta oferta?',
        body: 'Se generará automáticamente una factura en BORRADOR con las mismas líneas.',
        confirmLabel: 'Sí, aprobar',
        onConfirm: () => ejecutarCambioEstado(nuevo),
      })
      return
    }
    ejecutarCambioEstado(nuevo)
  }

  return (
    <div className="view-container">

      {/* ── Breadcrumb ── */}
      <div style={{ marginBottom: 12 }}>
        <Link href="/portal/ventas" style={{
          fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textDecoration: 'none',
        }}>
          ← Volver a Ventas
        </Link>
      </div>

      {/* ── Cabecera ── */}
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {oferta.numero}
            <BadgeOferta estado={oferta.estado} />
          </h1>
          <p className="page-subtitle">
            Oferta comercial · {fmtFecha(oferta.fecha_emision)}
            {oferta.fecha_validez && <> · Válida hasta {fmtFecha(oferta.fecha_validez)}</>}
            {oferta.condicion_pago && (
              <> · {CONDICION_PAGO_LABEL[oferta.condicion_pago] ?? oferta.condicion_pago}</>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href={`/portal/pdf/oferta/${oferta.oferta_id}`} target="_blank" className="btn btn-secondary">
            <IconPrinter /> Ver / Descargar PDF
          </Link>
          {puedeEditar && (
            <Link href={`/portal/ventas/ofertas/${oferta.oferta_id}/editar`} className="btn btn-secondary">
              <IconEdit /> Editar
            </Link>
          )}
          <button className="btn btn-secondary" onClick={handleDuplicar} disabled={duplicating}>
            <IconCopy /> {duplicating ? 'Duplicando…' : 'Duplicar'}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>{statusMsg}</div>
      )}

      {/* ── Transiciones de estado ── */}
      {transiciones.length > 0 && (
        <div className="ven-acciones-estado">
          <span className="ven-acciones-label">Cambiar estado a:</span>
          {transiciones.map(t => (
            <button
              key={t}
              className="btn btn-secondary btn-sm"
              onClick={() => cambiarEstado(t)}
              disabled={isPending}
            >
              {ESTADO_OFERTA_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      {factura && (
        <div className="alert alert-success" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Esta oferta generó la factura <strong>{factura.numero}</strong>.</span>
          <Link href={`/portal/ventas/facturas/${factura.factura_id}`} className="btn btn-secondary btn-sm">
            Ir a la factura
          </Link>
        </div>
      )}

      {/* ── Información: empresa y cliente ── */}
      <div className="ven-info-grid">
        <div className="ven-info-card">
          <div className="ven-info-label">Empresa emisora</div>
          <div className="ven-info-nombre">
            {empresa.letra_facturacion && (
              <span className="ven-letra-badge" style={{ background: empresa.color }}>
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

      {/* ── Líneas y totales ── */}
      <div className="card card-table" style={{ marginTop: 16 }}>
        <div className="mon-card-header">
          <h2 className="mon-section-title">Detalle</h2>
        </div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Descripción</th>
                <th style={{ textAlign: 'right' }}>Cantidad</th>
                <th style={{ textAlign: 'right' }}>Precio unit.</th>
                {lineas.some(l => Number(l.descuento_pct) > 0) && (
                  <th style={{ textAlign: 'right' }}>Dto. %</th>
                )}
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map(l => (
                <tr key={l.linea_id}>
                  <td>{l.descripcion}</td>
                  <td style={{ textAlign: 'right' }}>{Number(l.cantidad)}</td>
                  <td style={{ textAlign: 'right' }}>{formatearMoneda(Number(l.precio_unitario), oferta.moneda)}</td>
                  {lineas.some(x => Number(x.descuento_pct) > 0) && (
                    <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                      {Number(l.descuento_pct) > 0 ? `${Number(l.descuento_pct)}%` : '—'}
                    </td>
                  )}
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatearMoneda(Number(l.total), oferta.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ven-totales-resumen ven-totales-detalle">
          <div className="ven-total-row">
            <span>Subtotal</span>
            <strong>{formatearMoneda(Number(oferta.subtotal), oferta.moneda)}</strong>
          </div>
          {ajustes.map(a => (
            <div key={a.ajuste_id} className="ven-total-row ven-total-ajuste">
              <span>
                <span className="ven-ajuste-tag-sm" style={{ background: AJUSTE_TIPO_STYLE[a.tipo].bg, color: AJUSTE_TIPO_STYLE[a.tipo].color }}>
                  {AJUSTE_TIPO_LABEL[a.tipo]}
                </span>{' '}
                {a.nombre}
              </span>
              <span>
                {a.tipo === 'DESCUENTO' ? '−' : '+'} {formatearMoneda(Number(a.monto_calculado), oferta.moneda)}
              </span>
            </div>
          ))}
          <div className="ven-total-row ven-total-final">
            <span>Total</span>
            <strong>{formatearMoneda(Number(oferta.total), oferta.moneda)}</strong>
          </div>
        </div>
      </div>

      {oferta.notas && (
        <div className="ven-notas">
          <div className="ven-info-label">Notas</div>
          <p>{oferta.notas}</p>
        </div>
      )}

      {oferta.notas_internas && (
        <div className="ven-notas ven-notas-internas">
          <div className="ven-info-label">Notas internas <span className="ven-notas-internas-badge">No se imprime</span></div>
          <p>{oferta.notas_internas}</p>
        </div>
      )}

      {/* editOpen is no longer used (edit → full page) */}

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

function BadgeOferta({ estado }: { estado: EstadoOferta }) {
  const s = ESTADO_OFERTA_STYLE[estado]
  return (
    <span style={{
      display: 'inline-block', fontSize: '12px', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      padding: '4px 10px', borderRadius: '999px',
      background: s.bg, color: s.color,
    }}>
      {ESTADO_OFERTA_LABEL[estado]}
    </span>
  )
}

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

function IconPrinter() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
}
function IconEdit() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
}
function IconCopy() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
}
