'use client'

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useMemo, useEffect, useTransition } from 'react'
import { useRouter }                    from 'next/navigation'
import IaTouchpoint                     from '@/components/portal/ia/IaTouchpoint'
import ExportarMenu from '@/components/portal/ExportarMenu'
import { Eye, Plus, ShoppingCart, Ban, Trash2, Copy, PackageSearch } from 'lucide-react'
import {
  eliminarComprasEnLote,
  anularComprasEnLote,
  duplicarCompra,
  type ResultadoLote,
  type ComprasPageData,
  type EstadoCompra,
} from '@/app/actions/portal/compras'
import RangoBusqueda from '@/components/portal/RangoBusqueda'
import { LIMITE_LISTADO } from '@/lib/listados'
import { CompraFormModal }              from './_CompraFormModal'
import { ReposicionModal }              from './_ReposicionModal'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso                 from '@/components/portal/PrerequisitoAviso'
import { RowActions }                   from '@/components/portal/RowActions'
import { ConfirmDialog }                from '@/components/portal/Dialog'
import BulkBar                          from '@/components/portal/BulkBar'
import { useRowSelection }              from '@/components/portal/useRowSelection'
import { fmtFechaEs } from '@/lib/date-utils'

function fmt(n: number, moneda: string) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)
}
// Columnas `date`: van por el helper compartido, que las parte en local. `new Date(iso)`
// las leería como medianoche UTC y en La Habana saldría el día anterior.
const fmtDate = fmtFechaEs

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
  const [reponiendo,   setReponiendo]   = useState(false)
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

  // La reposición ya no crea nada a ciegas: abre el modal, que enseña qué falta y dónde
  // antes de tocar nada (ver la cabecera de `_ReposicionModal`).
  function alCrearReposicion(compra_id?: string) {
    setReponiendo(false)
    if (compra_id) router.push(`/portal/compras/${compra_id}`)
    else           router.refresh()
  }

  function duplicar(compra_id: string) {
    // El loading se crea FUERA de la transición: dentro no llega a pintarse.
    const ld = toastLoading('Duplicando…')
    startTransition(async () => {
      const r = await duplicarCompra(compra_id)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo duplicar.'); return }
      toastSuccess('Borrador creado a partir de esta compra')
      router.push(`/portal/compras/${r.compra_id}`)
    })
  }

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
          <div className="page-title-ia">
            <h1 className="page-title">Compras</h1>
            <IaTouchpoint tipo="compras" descripcion="una sugerencia de qué reponer" />
          </div>
          <p className="page-subtitle">Compras a tus proveedores para reponer existencias.</p>
        </div>
        <div className="tes-header-actions">
          <ExportarMenu
            clave="compras"
            filtro={{ estado: filtroEstado }}
            resumen={[filtroEstado].filter((x): x is string => Boolean(x))}
          />
          {/* Cierra la cadena del módulo: el mínimo detecta la falta, la cobertura la
              ordena y esto la convierte en la compra. Nada se confirma solo. */}
          <button className="btn btn-secondary" onClick={() => setReponiendo(true)} disabled={sinAlmacenes || isPending}>
            <PackageSearch size={14} strokeWidth={2} /> Comprar lo que falta
          </button>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)} disabled={sinAlmacenes}>
            <Plus size={14} strokeWidth={2.5} /> Nueva compra
          </button>
        </div>
      </div>

      {sinAlmacenes && (
        <PrerequisitoAviso acciones={[{ label: 'Crear almacén', href: '/portal/almacenes' }]}>
          Para registrar compras necesitas <strong>al menos un almacén</strong>.
        </PrerequisitoAviso>
      )}

      <div className="ter-toolbar">
        {/* El rango va en la URL y se aplica en la consulta: antes se traían todas las
            compras de la historia del cliente y el contador «X de Y» mentía. */}
        <RangoBusqueda desde={data.rango.desde} hasta={data.rango.hasta} sinBuscador />
        <select className="input ter-filter-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="BORRADOR">Borrador</option>
          <option value="CONFIRMADA">Confirmada</option>
          <option value="ANULADA">Anulada</option>
        </select>
      </div>

      {data.hay_mas && (
        <p className="listado-tope">
          Se enseñan las primeras {LIMITE_LISTADO} compras del rango. Acota el rango para
          ver el resto — la descarga sí se lleva el rango completo.
        </p>
      )}

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
                        {/* Comprar lo mismo al mismo proveedor es LA operación repetida
                            del módulo, y había que teclearla entera cada vez. */}
                        <button className="row-actions-item" onClick={() => duplicar(c.compra_id)} disabled={isPending}>
                          <Copy size={15} strokeWidth={2} /> Duplicar
                        </button>
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
            tasas:       data.tasas,
          }}
          onClose={() => setModalOpen(false)}
          onSaved={(compra_id) => router.push(`/portal/compras/${compra_id}`)}
        />
      )}

      {reponiendo && (
        <ReposicionModal
          onCerrar={() => setReponiendo(false)}
          onCreadas={alCrearReposicion}
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
