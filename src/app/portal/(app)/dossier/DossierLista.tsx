'use client'

import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Copy, ExternalLink, Pencil, Files, Trash2, Loader2, X, EyeOff } from 'lucide-react'
import { RowActions } from '@/components/portal/RowActions'
import BulkBar from '@/components/portal/BulkBar'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import {
  duplicarDossier, eliminarDossier,
  eliminarDossiersEnLote, despublicarDossiersEnLote, duplicarDossiersEnLote,
  type ResumenDossier, type ResultadoLote,
} from '@/app/actions/portal/dossier'

// ── Listado de dossiers (addon `multidossier`) ────────────────────────────────
//
// Esta pantalla ES el addon: sin él, /portal/dossier abre el editor directamente y
// esta lista no existe. Por eso no hace falta anunciar la compra en ningún sitio —
// la página deja de ser un editor y pasa a ser «Mis dossiers» con un botón de
// crear, y ese es el primer pixel que ve el dueño al activarlo.
//
// Sistema de tablas ÚNICO (skill UI §3): `.table` + `.table-wrapper`, col-* en th y
// td, data-label en cada td (bajo 640px la tabla se vuelve tarjetas), RowActions
// porque hay más de dos acciones por fila.

function fechaCorta(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })
}

// Solo la parte YYYY-MM-DD, construida a mano: `new Date('2026-01-31')` la parsea
// como UTC y en Cuba puede pintar el día anterior (skill UI §8).
function fechaDia(f: string | null): string {
  if (!f) return '—'
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function DossierLista({
  dossiers, empresas,
}: {
  dossiers: ResumenDossier[]
  empresas: { empresa_id: string; nombre: string }[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [porBorrar, setPorBorrar] = useState<ResumenDossier | null>(null)

  // ── Selección múltiple (acciones en lote) ──
  const ids = useMemo(() => dossiers.map(d => d.dossier_id), [dossiers])
  const sel = useRowSelection(ids)
  const [confirmLote, setConfirmLote] = useState(false)

  function ejecutar(fn: () => Promise<ResultadoLote>) {
    startTransition(async () => {
      const r = await fn()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas)          partes.push(`${r.hechas} aplicado${r.hechas === 1 ? '' : 's'}`)
      if (r.omitidas.length) partes.push(`${r.omitidas.length} omitido${r.omitidas.length === 1 ? '' : 's'}`)
      if (r.errores.length)  partes.push(`${r.errores.length} con error`)
      const msg = partes.join(' · ') || 'Nada que hacer'
      if (r.hechas > 0 && r.errores.length === 0) toastSuccess(msg)
      else if (r.hechas > 0)                      toastError(msg)
      else                                        toastError(r.omitidas[0]?.motivo ? `Nada aplicado — ${r.omitidas[0].motivo}` : msg)
      sel.clear()
      router.refresh()
    })
  }
  function doEliminarLote() { setConfirmLote(false); ejecutar(() => eliminarDossiersEnLote(sel.selectedIds)) }

  const nombreEmpresa = (id: string | null) =>
    id ? (empresas.find(e => e.empresa_id === id)?.nombre ?? 'Mi empresa') : 'Todas las empresas'

  function duplicar(d: ResumenDossier) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', d.dossier_id)
      const res = await duplicarDossier(fd)
      if (!res.ok) { toastError(res.error || 'No se pudo duplicar'); return }
      toastSuccess('Copia creada: tiene sus propios números y su propio enlace')
      router.push(`/portal/dossier/${res.dossier_id}`)
    })
  }

  function borrar() {
    if (!porBorrar) return
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', porBorrar.dossier_id)
      const res = await eliminarDossier(fd)
      if (res.ok) { toastSuccess('Dossier eliminado'); setPorBorrar(null); router.refresh() }
      else toastError(res.error || 'No se pudo eliminar')
    })
  }

  async function copiarEnlace(token: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/d/${token}`)
      toastSuccess('Enlace copiado')
    } catch {
      toastError('No se pudo copiar. Abre el dossier y cópialo desde «Presentación».')
    }
  }

  return (
    <div className="view-container">
      <div className="page-header">
        {/* El texto va acotado: `.page-header` envuelve, así que un bloque sin límite
            de ancho se come la fila entera y echa el botón a la línea de abajo, a la
            izquierda. La acción se queda arriba a la derecha pase lo que pase. */}
        <div className="dos-lista-intro">
          <h1 className="page-title">Mis dossiers</h1>
          <p className="page-subtitle">
            Uno por empresa o por inversor. Cada uno con sus números y su propio enlace.
          </p>
        </div>
        <Link className="btn btn-primary" href="/portal/dossier/nuevo">
          <Plus size={14} strokeWidth={2.5} /> Nuevo dossier
        </Link>
      </div>

      <div className="card card-table">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">
                  <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                </th>
                <th>Dossier</th>
                <th>Empresa</th>
                <th>Período</th>
                <th className="col-center">Estado</th>
                <th className="col-num">Actualizado</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {dossiers.map(d => (
                <tr key={d.dossier_id} className="table-row-clickable"
                  onClick={() => router.push(`/portal/dossier/${d.dossier_id}`)}>
                  <td className="col-check" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="row-check"
                      checked={sel.isSelected(d.dossier_id)}
                      onChange={() => sel.toggle(d.dossier_id)}
                      aria-label={`Seleccionar ${d.titulo}`} />
                  </td>
                  <td data-label="Dossier" className="cell-truncate">
                    <Link href={`/portal/dossier/${d.dossier_id}`} onClick={e => e.stopPropagation()}>
                      {d.titulo}
                    </Link>
                  </td>
                  <td data-label="Empresa">{nombreEmpresa(d.empresa_id)}</td>
                  <td data-label="Período">{fechaDia(d.periodo_desde)} – {fechaDia(d.periodo_hasta)}</td>
                  <td data-label="Estado" className="col-center">
                    <span className="dos-lista-estado">
                      {d.estado === 'PUBLICADO'
                        ? <span className="badge badge-dot badge-success">Publicado</span>
                        : <span className="badge">Borrador</span>}
                      {/* Con varios dossiers, saber de un vistazo cuál tiene los números
                          viejos es media pantalla: es la diferencia entre enviar el
                          enlace bueno y enviar el de la moneda de antes. */}
                      {d.snapshot_stale && d.snapshot_at && (
                        <span className="badge badge-warning">Desfasado</span>
                      )}
                    </span>
                  </td>
                  <td data-label="Actualizado" className="col-num">{fechaCorta(d.updated_at)}</td>
                  <td className="col-actions">
                    <RowActions>
                      <Link className="row-actions-item" href={`/portal/dossier/${d.dossier_id}`}>
                        <Pencil size={15} strokeWidth={2} /> Abrir
                      </Link>
                      <button className="row-actions-item" onClick={() => duplicar(d)} disabled={pending}>
                        <Files size={15} strokeWidth={2} /> Duplicar
                      </button>
                      {d.estado === 'PUBLICADO' && d.token && (
                        <>
                          <button className="row-actions-item" onClick={() => copiarEnlace(d.token!)}>
                            <Copy size={15} strokeWidth={2} /> Copiar enlace
                          </button>
                          <a className="row-actions-item" href={`/d/${d.token}`} target="_blank" rel="noreferrer">
                            <ExternalLink size={15} strokeWidth={2} /> Ver presentación
                          </a>
                        </>
                      )}
                      <button className="row-actions-item row-actions-item-danger"
                        onClick={() => setPorBorrar(d)} disabled={pending}>
                        <Trash2 size={14} strokeWidth={2} /> Eliminar
                      </button>
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <BulkBar count={sel.count} onClear={sel.clear}>
        <button className="btn btn-secondary btn-sm" disabled={pending}
          onClick={() => ejecutar(() => duplicarDossiersEnLote(sel.selectedIds))}>
          <Files size={14} strokeWidth={2} /> Duplicar
        </button>
        <button className="btn btn-secondary btn-sm" disabled={pending}
          onClick={() => ejecutar(() => despublicarDossiersEnLote(sel.selectedIds))}>
          <EyeOff size={14} strokeWidth={2} /> Despublicar
        </button>
        <button className="btn btn-danger-text btn-sm" disabled={pending}
          onClick={() => setConfirmLote(true)}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      </BulkBar>

      {confirmLote && (
        <ConfirmDialog
          title={`¿Eliminar ${sel.count} dossier${sel.count === 1 ? '' : 's'}?`}
          body="Se borran sus números, su relato y su marca. Los que estén publicados dejarán de funcionar para quien ya tenga el enlace. Esta acción no se puede deshacer."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmLote(false)}
          onConfirm={doEliminarLote}
        />
      )}

      {/* Borrar un dossier publicado tumba un enlace que puede estar ya en el correo
          de un inversor: se dice en voz alta antes, no después. */}
      {porBorrar && (
        <div className="modal-backdrop open">
          <div className="modal modal-sm" role="dialog" aria-modal>
            <div className="modal-header">
              <h2 className="modal-title">Eliminar «{porBorrar.titulo}»</h2>
              <button type="button" className="modal-close" onClick={() => setPorBorrar(null)}
                disabled={pending} aria-label="Cerrar">
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="modal-body">
              <p className="dos-section-hint">
                Se borran sus números, su relato y su marca. Esto no se puede deshacer.
                {porBorrar.estado === 'PUBLICADO' && (
                  <> Además, <strong>su enlace dejará de funcionar</strong> para quien ya lo tenga.</>
                )}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPorBorrar(null)} disabled={pending}>Cancelar</button>
              <button className="btn btn-danger" onClick={borrar} disabled={pending}>
                {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Trash2 size={14} strokeWidth={2} />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
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
