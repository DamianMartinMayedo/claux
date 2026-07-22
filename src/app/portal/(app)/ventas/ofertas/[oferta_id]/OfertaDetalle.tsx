'use client'

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition, useEffect, useRef }   from 'react'
import Link                           from 'next/link'
import { useRouter }                  from 'next/navigation'
import {
  cambiarEstadoOferta,
  duplicarOferta,
  type OfertaDetalleData,
  type VentasResumenData,
} from '@/app/actions/portal/ventas'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { empresaColorVar }            from '@/components/portal/EmpresaTag'
import { Copy, MoreHorizontal, Pencil, Download, Send, Check, Ban, Clock, RotateCcw } from 'lucide-react'
import {
  AJUSTE_TIPO_LABEL,
  CONDICION_PAGO_LABEL,
  ESTADO_OFERTA_LABEL,
  ACCION_OFERTA_LABEL,
  ESTADO_OFERTA_BADGE,
  TRANSICIONES_OFERTA,
  formatearMoneda,
  type EstadoOferta,
} from '../../_ventas-helpers'

interface Props {
  data:    OfertaDetalleData
  resumen: VentasResumenData
}

export default function OfertaDetalle({ data }: Props) {
  const router = useRouter()
  const [isPending,    startTransition] = useTransition()
  const [duplicating,  setDuplicating] = useState(false)
  const [dialog, setDialog] = useState<{
    title: string; body?: string; danger?: boolean; confirmLabel?: string;
    onConfirm: () => void
  } | null>(null)
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

  const { oferta, empresa, cliente, lineas, ajustes, factura } = data

  const puedeEditar = oferta.estado === 'BORRADOR' || oferta.estado === 'ENVIADA'
  const transiciones = TRANSICIONES_OFERTA[oferta.estado] ?? []

  // Descarga directa: se genera en cliente con los datos ya cargados, sin abrir
  // otra página ni recargar (principio de descargas directas — contexto Cuba).
  async function handleDescargarPdf() {
    if (descargandoPdf) return
    setDescargandoPdf(true)
    try {
      const { descargarDocumentoVenta } = await import('@/lib/pdf/venta')
      await descargarDocumentoVenta({
        titulo:          'OFERTA COMERCIAL',
        numero:          oferta.numero,
        fechaEmision:    oferta.fecha_emision,
        fechaSecundaria: oferta.fecha_validez ? { label: 'Válida hasta', valor: oferta.fecha_validez } : undefined,
        condicionPago:   oferta.condicion_pago,
        empresa, cliente, moneda: oferta.moneda, lineas, ajustes,
        subtotal:        Number(oferta.subtotal),
        total:           Number(oferta.total),
        notas:           oferta.notas,
      })
    } finally {
      setDescargandoPdf(false)
    }
  }

  async function handleDuplicar() {
    setDialog({
      title: '¿Duplicar esta oferta?',
      body: 'Se creará un nuevo borrador con las mismas líneas y ajustes.',
      confirmLabel: 'Duplicar',
      onConfirm: async () => {
        setDuplicating(true)
        const ld = toastLoading('Duplicando…')
        const res = await duplicarOferta(oferta.oferta_id)
        await ld.dismiss()
        setDuplicating(false)
        if (!res.ok) { toastError(res.error ?? 'Error al duplicar.'); return }
        router.push(`/portal/ventas/ofertas/${res.oferta_id}`)
      },
    })
  }

  function ejecutarCambioEstado(nuevo: EstadoOferta) {
    // toastLoading fuera de startTransition (si no, no se pinta el estado de carga).
    const cargando = { BORRADOR: 'Reabriendo…', ENVIADA: 'Enviando…', APROBADA: 'Aprobando…', RECHAZADA: 'Rechazando…', CADUCADA: 'Caducando…' }[nuevo] ?? 'Guardando…'
    const ld = toastLoading(cargando)
    startTransition(async () => {
      const res = await cambiarEstadoOferta(oferta.oferta_id, nuevo)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error al cambiar estado.'); return }
      if (res.factura_id) {
        toastSuccess('Oferta aprobada. Factura generada.')
        router.push(`/portal/ventas/facturas/${res.factura_id}`)
      } else {
        toastSuccess('Estado actualizado.')
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
      <div className="ven-breadcrumb">
        <Link href="/portal/ventas?t=ofertas" className="ven-breadcrumb-link">
          ← Volver a Ventas
        </Link>
      </div>

      {/* ── Cabecera ── */}
      <div className="page-header page-header-top">
        <div>
          <h1 className="page-title page-title-row">
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
        <div className="ven-btn-group ven-btn-group-relative">
          {puedeEditar && (
            <Link href={`/portal/ventas/ofertas/${oferta.oferta_id}/editar`} className="btn btn-secondary">
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
                    {transiciones.map(t => {
                      const Icon = { ENVIADA: Send, APROBADA: Check, RECHAZADA: Ban, CADUCADA: Clock, BORRADOR: RotateCcw }[t]
                      return (
                        <button
                          key={t}
                          className="ven-dropdown-item"
                          onClick={() => cambiarEstado(t)}
                          disabled={isPending}
                        >
                          <Icon size={14} strokeWidth={2} /> {ACCION_OFERTA_LABEL[t]}
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {factura && (
        <div className="alert alert-success mb-4 alert-between">
          <span>Esta oferta generó la factura <strong>{factura.numero}</strong>.</span>
          <Link href={`/portal/ventas/facturas/${factura.factura_id}`} className="btn btn-secondary btn-sm">
            Ir a la factura
          </Link>
        </div>
      )}

      {/* ── Información: empresa y cliente ── */}
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

      {/* ── Líneas y totales ── */}
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
                  <td data-label="Precio unit." className="col-num">{formatearMoneda(Number(l.precio_unitario), oferta.moneda)}</td>
                  {lineas.some(x => Number(x.descuento_pct) > 0) && (
                    <td data-label="Dto. %" className="col-num text-muted">
                      {Number(l.descuento_pct) > 0 ? `${Number(l.descuento_pct)}%` : '—'}
                    </td>
                  )}
                  <td data-label="Total" className="col-num">{formatearMoneda(Number(l.total), oferta.moneda)}</td>
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
                <span className={`ven-ajuste-tag-sm ven-ajuste-tag-${a.tipo.toLowerCase()}`}>
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
    </div>
  )
}

function BadgeOferta({ estado }: { estado: EstadoOferta }) {
  return (
    <span className={`badge ${ESTADO_OFERTA_BADGE[estado] ?? 'badge-neutral'}`}>
      {ESTADO_OFERTA_LABEL[estado]}
    </span>
  )
}

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

