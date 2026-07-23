'use client'

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useMemo, useEffect, useTransition } from 'react'
import { useRouter }                    from 'next/navigation'
import { Eye, Plus, ShoppingCart, Ban, Trash2 } from 'lucide-react'
import {
  eliminarComprasEnLote,
  anularComprasEnLote,
  type ResultadoLote,
  type ComprasPageData,
  type EstadoCompra,
} from '@/app/actions/portal/compras'
import { CompraFormModal }              from './_CompraFormModal'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso                 from '@/components/portal/PrerequisitoAviso'
import { RowActions }                   from '@/components/portal/RowActions'
import { ConfirmDialog }                from '@/components/portal/Dialog'
import BulkBar                          from '@/components/portal/BulkBar'
import { useRowSelection }              from '@/components/portal/useRowSelection'

function fmt(n: number, moneda: string) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ESTADO_BADGE: Record<EstadoCompra, string> = {
  BORRADOR: 'badge-neutral', CONFIRMADA: 'badge-success', ANULADA: 'badge-error',
}
const ESTADO_LABEL: Record<EstadoCompra, string> = {
  BORRADOR: 'Borrador', CONFIRMADA: 'Confirmada', ANULADA: 'Anulada',
}

type Confirm = { title: string; body?: string; confirmLabel: string; danger: boolean; run: () => void }

export default function ComprasView({ data }: { data: ComprasPageData }) {
  const router = useRouter()
  const [modalOpen,    setModalOpen]    = useState(false)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtradas = useMemo(
    () => data.compras.filter(c => !filtroEstado || c.estado === filtroEstado),
    [data.compras, filtroEstado],
  )

  const { pageItems, ...pag } = usePagination(filtradas)

  const sinAlmacenes = data.almacenes.length === 0

  // ── Selección múltiple sobre las compras visibles (filtradas) ──
  const ids = useMemo(() => filtradas.map(c => c.compra_id), [filtradas])
  const sel = useRowSelection(ids)
  useEffect(() => { sel.clear() }, [filtroEstado]) // eslint-disable-line react-hooks/exhaustive-deps

  const seleccionadas = filtradas.filter(c => sel.isSelected(c.compra_id))
  const nConfirmadas   = seleccionadas.filter(c => c.estado === 'CONFIRMADA').length
  const nBorradores    = seleccionadas.filter(c => c.estado === 'BORRADOR').length

  // ── Orquestación de acciones en lote (toast de resumen) ──
  function ejecutar(fn: () => Promise<ResultadoLote>, msg: string) {
    const ld = toastLoading(msg)
    startTransition(async () => {
      const r = await fn()
      await ld.dismiss()
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

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Compras</h1>
          <p className="page-subtitle">Compras a proveedores. Al confirmar suben el stock y generan un gasto en Cuentas por pagar.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)} disabled={sinAlmacenes}>
          <Plus size={14} strokeWidth={2.5} /> Nueva compra
        </button>
      </div>

      {sinAlmacenes && (
        <PrerequisitoAviso acciones={[{ label: 'Crear almacén', href: '/portal/almacenes' }]}>
          Para registrar compras necesitas <strong>al menos un almacén</strong>.
        </PrerequisitoAviso>
      )}

      <div className="ter-toolbar">
        <select className="input ter-filter-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="BORRADOR">Borrador</option>
          <option value="CONFIRMADA">Confirmada</option>
          <option value="ANULADA">Anulada</option>
        </select>
      </div>

      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">Compras</h2>
          <span className="text-xs-muted">{filtradas.length} de {data.compras.length}</span>
        </div>

        {filtradas.length === 0 ? (
          <div className="mon-empty">
            <ShoppingCart size={40} strokeWidth={1} opacity={0.2} />
            <p>
              {data.compras.length === 0
                ? 'Aún no hay compras registradas. Crea la primera para reponer stock.'
                : 'No hay compras con ese estado.'}
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-check">
                    <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                  </th>
                  <th>Número</th>
                  <th>Fecha</th>
                  <th>Proveedor</th>
                  <th>Almacén</th>
                  <th>Estado</th>
                  <th className="col-num">Total</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(c => (
                  <tr key={c.compra_id} className="table-row-clickable"
                    onClick={() => router.push(`/portal/compras/${c.compra_id}`)}>
                    <td className="col-check" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="row-check"
                        checked={sel.isSelected(c.compra_id)}
                        onChange={() => sel.toggle(c.compra_id)}
                        aria-label={`Seleccionar ${c.numero}`} />
                    </td>
                    <td data-label="Número"><code className="text-mono">{c.numero}</code></td>
                    <td data-label="Fecha" className="text-sm-muted">{fmtDate(c.fecha)}</td>
                    <td data-label="Proveedor">{c.proveedor_id ? (data.proveedor_nombres[c.proveedor_id] ?? c.proveedor_id) : <span className="text-faint">—</span>}</td>
                    <td data-label="Almacén" className="text-sm-muted">{data.almacen_nombres[c.almacen_id] ?? c.almacen_id}</td>
                    <td data-label="Estado"><span className={`badge ${ESTADO_BADGE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span></td>
                    <td data-label="Total" className="col-num">{fmt(c.total, c.moneda)}</td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => router.push(`/portal/compras/${c.compra_id}`)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="compra" />
      </div>

      {/* ── Barra flotante de acciones en lote ── */}
      <BulkBar count={sel.count} onClear={sel.clear}>
        {nConfirmadas > 0 && (
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => setConfirm({
              title: `¿Anular ${nConfirmadas} compra${nConfirmadas === 1 ? '' : 's'}?`,
              body: `Se anularán ${nConfirmadas} compra${nConfirmadas === 1 ? '' : 's'}: se revierte el stock y se elimina su gasto (junto con los pagos vinculados). El resto de la selección se omite.`,
              confirmLabel: 'Sí, anular', danger: false,
              run: () => ejecutar(() => anularComprasEnLote(sel.selectedIds), 'Anulando…'),
            })}>
            <Ban size={14} strokeWidth={2} /> Anular
          </button>
        )}
        {nBorradores > 0 && (
          <button className="btn btn-danger-text btn-sm" disabled={isPending}
            onClick={() => setConfirm({
              title: `¿Eliminar ${nBorradores} borrador${nBorradores === 1 ? '' : 'es'}?`,
              body: 'Solo se eliminan las compras en borrador. Las confirmadas o anuladas se omiten (anúlalas para revertir su stock y su gasto).',
              confirmLabel: 'Eliminar', danger: true,
              run: () => ejecutar(() => eliminarComprasEnLote(sel.selectedIds), 'Eliminando…'),
            })}>
            <Trash2 size={14} strokeWidth={2} /> Eliminar
          </button>
        )}
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

      {modalOpen && (
        <CompraFormModal
          form={{
            proveedores: data.proveedores,
            almacenes:   data.almacenes,
            productos:   data.productos,
            monedas:     data.monedas,
          }}
          onClose={() => setModalOpen(false)}
          onSaved={(compra_id) => router.push(`/portal/compras/${compra_id}`)}
        />
      )}
    </div>
  )
}

// ── Checkbox de cabecera (con estado indeterminado) ───────────────────────────

function HeaderCheck({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: () => void
}) {
  return (
    <input type="checkbox" className="row-check" checked={checked}
      ref={el => { if (el) el.indeterminate = indeterminate }}
      onChange={onChange} aria-label="Seleccionar todo" />
  )
}
