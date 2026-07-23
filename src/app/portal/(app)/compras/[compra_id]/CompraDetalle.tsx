'use client'

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition }  from 'react'
import Link                         from 'next/link'
import { useRouter }                from 'next/navigation'
import { CheckCircle2, Pencil, Trash2, Ban, X } from 'lucide-react'
import {
  confirmarCompra, anularCompra, eliminarCompra,
  type CompraDetalleData,
} from '@/app/actions/portal/compras'
import { CompraFormModal } from '../_CompraFormModal'
import { RowActions } from '@/components/portal/RowActions'

function fmt(n: number, moneda: string) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Campo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="det-label">{label}</div>
      <div className="det-value">{value ?? <span className="text-faint">—</span>}</div>
    </div>
  )
}

// ── Modal de confirmación genérico ──────────────────────────────────────────────

function ConfirmModal({
  titulo, children, confirmLabel, danger, isPending, onConfirm, onClose,
}: {
  titulo: string; children: React.ReactNode; confirmLabel: string
  danger?: boolean; isPending: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{titulo}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body"><div className="modal-body-text">{children}</div></div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm} disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Procesando…</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

const ESTADO_BADGE = { BORRADOR: 'badge-neutral', CONFIRMADA: 'badge-success', ANULADA: 'badge-error' } as const
const ESTADO_LABEL = { BORRADOR: 'Borrador', CONFIRMADA: 'Confirmada', ANULADA: 'Anulada' } as const

export default function CompraDetalle({ data }: { data: CompraDetalleData }) {
  const router = useRouter()
  const { compra, lineas } = data
  const [isPending, startTransition] = useTransition()
  const [showEdit,    setShowEdit]    = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showAnular,  setShowAnular]  = useState(false)
  const [showDelete,  setShowDelete]  = useState(false)

  const esBorrador  = compra.estado === 'BORRADOR'
  const esConfirmada = compra.estado === 'CONFIRMADA'

  function doConfirmar() {
    const ld = toastLoading('Confirmando…')
    startTransition(async () => {
      const res = await confirmarCompra(compra.compra_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      toastSuccess('Compra confirmada. Existencias actualizadas.')
      setShowConfirm(false); router.refresh()
    })
  }
  function doAnular() {
    const ld = toastLoading('Anulando…')
    startTransition(async () => {
      const res = await anularCompra(compra.compra_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      toastSuccess('Compra anulada.')
      setShowAnular(false); router.refresh()
    })
  }
  function doEliminar() {
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarCompra(compra.compra_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      toastSuccess('Borrador eliminado')
      router.push('/portal/compras')
    })
  }

  return (
    <div className="view-container">
      <div className="breadcrumb">
        <Link href="/portal/compras">Compras</Link>
        <span>›</span>
        <span className="breadcrumb-current">{compra.numero}</span>
      </div>

      <div className="det-page-header">
        <div>
          <div className="det-title-group">
            <h1 className="det-page-title">{compra.numero}</h1>
            <span className={`badge ${ESTADO_BADGE[compra.estado]}`}>{ESTADO_LABEL[compra.estado]}</span>
          </div>
          <div className="det-meta-row">
            <span>{data.proveedor?.nombre ?? 'Sin proveedor'}</span>
            <span className="ml-3">{fmtDate(compra.fecha)}</span>
          </div>
        </div>

        <div className="det-actions">
          {esBorrador && (
            <>
              <button className="btn btn-secondary" onClick={() => setShowEdit(true)}>
                <Pencil size={14} strokeWidth={2} /> Editar
              </button>
              <button className="btn btn-primary" onClick={() => setShowConfirm(true)} disabled={isPending}>
                <CheckCircle2 size={14} strokeWidth={2} /> Confirmar
              </button>
              <RowActions>
                <button className="row-actions-item row-actions-item-danger" onClick={() => setShowDelete(true)} disabled={isPending}>
                  <Trash2 size={15} strokeWidth={2} /> Eliminar
                </button>
              </RowActions>
            </>
          )}
          {esConfirmada && (
            <RowActions>
              <button className="row-actions-item row-actions-item-danger" onClick={() => setShowAnular(true)} disabled={isPending}>
                <Ban size={15} strokeWidth={2} /> Anular
              </button>
            </RowActions>
          )}
        </div>
      </div>

      {/* Integración contable (confirmada) */}
      {esConfirmada && (
        <div className="alert alert-success mb-4">
          <div>
            Esta compra generó un gasto <strong>«Compras»</strong> en Cuentas por pagar.{' '}
            Pagado: <strong>{fmt(data.pagado, compra.moneda)}</strong> · Saldo: <strong>{fmt(data.saldo, compra.moneda)}</strong>.{' '}
            <Link href="/portal/cxp" className="link-primary">Ir a Cuentas por pagar</Link> para registrar el pago.
          </div>
        </div>
      )}
      {compra.estado === 'ANULADA' && (
        <div className="alert alert-warning mb-4">
          Compra anulada. Se deshicieron las existencias y el gasto de esta compra.
        </div>
      )}

      {/* Datos */}
      <div className="det-card">
        <div className="det-section-title">Datos de la compra</div>
        <div className="det-field-grid">
          <Campo label="Proveedor" value={data.proveedor ? (
            <Link href={`/portal/terceros/${data.proveedor.tercero_id}`} className="link-primary">{data.proveedor.nombre}</Link>
          ) : null} />
          <Campo label="Almacén de entrada" value={data.almacen?.nombre} />
          <Campo label="Empresa" value={data.empresa_nombre} />
          <Campo label="Fecha" value={fmtDate(compra.fecha)} />
          <Campo label="Moneda" value={compra.moneda} />
          <Campo label="Estado" value={<span className={`badge ${ESTADO_BADGE[compra.estado]}`}>{ESTADO_LABEL[compra.estado]}</span>} />
        </div>
        {compra.notas && (
          <div className="mt-5">
            <div className="det-label">Notas</div>
            <div className="det-value det-value-pre">{compra.notas}</div>
          </div>
        )}
      </div>

      {/* Líneas */}
      <div className="det-card">
        <div className="det-section-title">Líneas</div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Producto / descripción</th>
                <th className="col-num">Cantidad</th>
                <th className="col-num">Costo unit.</th>
                <th className="col-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map(l => (
                <tr key={l.linea_id}>
                  <td data-label="Producto / descripción">
                    <strong>{l.descripcion}</strong>
                    {!l.producto_id && <span className="text-xs-muted"> (texto libre — no afecta stock)</span>}
                  </td>
                  <td data-label="Cantidad" className="col-num">{l.cantidad.toLocaleString('es-ES')}</td>
                  <td data-label="Costo unit." className="col-num">{fmt(l.costo_unitario, compra.moneda)}</td>
                  <td data-label="Total" className="col-num">{fmt(l.total, compra.moneda)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="col-num"><strong>Total</strong></td>
                <td className="col-num"><strong>{fmt(compra.total, compra.moneda)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Modales */}
      {showEdit && (
        <CompraFormModal
          form={{ proveedores: data.proveedores, almacenes: data.almacenes, productos: data.productos, monedas: data.monedas }}
          compra={compra}
          lineasIniciales={lineas}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); router.refresh() }}
        />
      )}
      {showConfirm && (
        <ConfirmModal titulo="Confirmar compra" confirmLabel="Confirmar compra"
          isPending={isPending} onConfirm={doConfirmar} onClose={() => setShowConfirm(false)}>
          Se sumará el stock de las líneas al almacén <strong>{data.almacen?.nombre}</strong> y se creará
          un gasto de <strong>{fmt(compra.total, compra.moneda)}</strong> en Cuentas por pagar. ¿Continuar?
        </ConfirmModal>
      )}
      {showAnular && (
        <ConfirmModal titulo="Anular compra" confirmLabel="Anular compra" danger
          isPending={isPending} onConfirm={doAnular} onClose={() => setShowAnular(false)}>
          Se revertirá el stock ingresado y se eliminará el gasto asociado en Cuentas por pagar.
          Si la compra tiene pagos registrados, primero debes anularlos. Esta acción no se puede
          deshacer. ¿Anular <strong>{compra.numero}</strong>?
        </ConfirmModal>
      )}
      {showDelete && (
        <ConfirmModal titulo="Eliminar borrador" confirmLabel="Eliminar" danger
          isPending={isPending} onConfirm={doEliminar} onClose={() => setShowDelete(false)}>
          Se eliminará el borrador <strong>{compra.numero}</strong> de forma permanente. ¿Continuar?
        </ConfirmModal>
      )}
    </div>
  )
}
