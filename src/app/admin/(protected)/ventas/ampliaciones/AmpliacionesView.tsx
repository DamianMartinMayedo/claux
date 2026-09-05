'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, PhoneCall, Trash2 } from 'lucide-react'
import { toastError, toastLoading, toastSuccess, toastWarning } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import BulkBar from '@/components/portal/BulkBar'
import HeaderCheck from '@/components/portal/HeaderCheck'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { usePagination, TablePagination } from '@/components/TablePagination'
import VentasTabs from '@/components/admin/VentasTabs'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import {
  actualizarEstadoAmpliacion,
  eliminarAmpliacion,
  eliminarAmpliacionesEnLote,
  type Ampliacion,
} from '@/app/actions/soporte'

type Estado = Ampliacion['estado']
type Filtro = 'TODAS' | Estado | 'PRUEBAS'

// El estado es el de `soporte_mensajes`, pero leído en clave comercial: lo que le
// importa a quien vende es si ya llamó y si acabó activándose.
const ESTADO_LABEL: Record<Estado, string> = {
  NUEVO:    'Sin contactar',
  LEIDO:    'Contactado',
  RESUELTO: 'Activado',
}
const ESTADO_BADGE: Record<Estado, string> = {
  NUEVO:    'badge-info',
  LEIDO:    'badge-warning',
  RESUELTO: 'badge-success',
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Por qué esta ampliación no se puede borrar, o null si sí. Quien manda es el
 * candado de la base de datos (`eliminar_ampliacion`, mig. 228); esto lo repite
 * —en el mismo orden— para poder decirlo ANTES de que alguien pulse.
 */
function bloqueoDe(a: Ampliacion): string | null {
  if (!a.es_prueba) return 'Es de un cliente real: su petición no se borra'
  if (a.respondida) return 'Ya tiene una respuesta escrita'
  return null
}

export default function AmpliacionesView({
  solicitudes, rol, permisos,
}: {
  solicitudes: Ampliacion[]
  rol: RolAdmin
  permisos: SeccionKey[]
}) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<Filtro>('TODAS')
  const [guardando, setGuardando] = useState<number | null>(null)
  const [porBorrar, setPorBorrar] = useState<Ampliacion | null>(null)
  const [confirmLote, setConfirmLote] = useState(false)
  const [pending, startTransition] = useTransition()

  const visibles = solicitudes.filter(s =>
    filtro === 'TODAS' ? true : filtro === 'PRUEBAS' ? s.es_prueba : s.estado === filtro,
  )
  const pruebas = solicitudes.filter(s => s.es_prueba).length
  // El contador que decide a quién se llama no puede contar las de prueba: era
  // lo que hacía que la pantalla dijese cuatro cuando había una.
  const sinContactar = solicitudes.filter(s => s.estado === 'NUEVO' && !s.es_prueba).length

  const { pageItems, ...pag } = usePagination(visibles)

  const borrables = useMemo(
    () => visibles.filter(s => !bloqueoDe(s)).map(s => String(s.id)),
    [visibles],
  )
  const sel = useRowSelection(borrables)

  function cambiarFiltro(f: Filtro) {
    setFiltro(f)
    sel.clear()
  }

  async function marcar(s: Ampliacion, estado: Estado) {
    if (guardando) return
    setGuardando(s.id)
    const r = await actualizarEstadoAmpliacion(s.id, estado)
    setGuardando(null)
    if (!r.ok) { toastError('No se pudo actualizar.'); return }
    toastSuccess(`${s.nombre_empresa}: ${ESTADO_LABEL[estado].toLowerCase()}`)
    router.refresh()
  }

  function borrar() {
    if (!porBorrar) return
    const s = porBorrar
    setPorBorrar(null)
    // El toast de carga se crea ANTES de la transición: dentro no llega a pintarse.
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await eliminarAmpliacion(s.id)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo eliminar'); return }
      toastSuccess(r.yaEliminada ? 'La ampliación ya no estaba' : `Ampliación de ${s.nombre_empresa} eliminada`)
      router.refresh()
    })
  }

  function borrarLote() {
    const ids = sel.selectedIds.map(Number)
    setConfirmLote(false)
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await eliminarAmpliacionesEnLote(ids)
      await ld.dismiss()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas) partes.push(`${r.hechas} eliminada${r.hechas === 1 ? '' : 's'}`)
      if (r.omitidas.length) partes.push(`${r.omitidas.length} sin borrar`)
      const msg = partes.join(' · ') || 'Nada que eliminar'
      // Con mezcla de resultados el aviso no puede ser verde: se dice el motivo
      // de la primera que no salió, que es lo que hay que resolver.
      if (r.hechas > 0 && r.omitidas.length === 0) toastSuccess(msg)
      else if (r.hechas > 0) toastWarning(`${msg} — ${r.omitidas[0].motivo}`)
      else toastError(r.omitidas[0]?.motivo ?? msg)
      sel.clear()
      router.refresh()
    })
  }

  const FILTROS: { k: Filtro; label: string; n?: number }[] = [
    { k: 'TODAS',    label: 'Todas' },
    { k: 'NUEVO',    label: 'Sin contactar' },
    { k: 'LEIDO',    label: 'Contactadas' },
    { k: 'RESUELTO', label: 'Activadas' },
    { k: 'PRUEBAS',  label: 'De clientes de prueba', n: pruebas },
  ]

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ampliaciones</h1>
          <p className="page-subtitle">
            {solicitudes.length} en total · {sinContactar} sin contactar
            {pruebas > 0 && ` · ${pruebas} de clientes de prueba`}. Clientes que piden activar algo desde su portal.
          </p>
        </div>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />

      <div className="ter-toolbar">
        {FILTROS.map(f => (
          <button
            key={f.k}
            className={`btn btn-sm ${filtro === f.k ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => cambiarFiltro(f.k)}
          >
            {f.label}{f.n != null && f.n > 0 ? ` (${f.n})` : ''}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <div className="card">
          <p className="text-sm-muted">
            No hay ampliaciones {filtro === 'TODAS' ? 'todavía' : 'en este estado'}.
          </p>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-check">
                    <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                  </th>
                  <th>Estado</th>
                  <th>Cliente</th>
                  <th>Quiere activar</th>
                  <th>Lo pidió</th>
                  <th>Fecha</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(s => {
                  const bloqueo = bloqueoDe(s)
                  return (
                    <tr key={s.id}>
                      <td className="col-check">
                        {bloqueo ? (
                          <input type="checkbox" className="row-check" checked={false} readOnly disabled
                            title={bloqueo} aria-label={`${s.nombre_empresa}: no se puede eliminar`} />
                        ) : (
                          <input type="checkbox" className="row-check"
                            checked={sel.isSelected(String(s.id))}
                            onChange={() => sel.toggle(String(s.id))}
                            aria-label={`Seleccionar la ampliación de ${s.nombre_empresa}`} />
                        )}
                      </td>
                      <td data-label="Estado">
                        <span className={`badge ${ESTADO_BADGE[s.estado]}`}>{ESTADO_LABEL[s.estado]}</span>
                      </td>
                      <td data-label="Cliente">
                        <div className="cell-nombre">
                          <span className="text-sm-bold cell-clamp">{s.nombre_empresa}</span>
                          {s.es_prueba && <span className="badge badge-purple">Prueba</span>}
                        </div>
                        {s.contacto && <div className="text-xs-muted">{s.contacto}</div>}
                      </td>
                      <td data-label="Quiere activar">
                        <span className={`badge ${s.es_reactivacion ? 'badge-warning' : 'badge-neutral'}`}>{s.modulo}</span>
                      </td>
                      <td data-label="Lo pidió" className="cell-truncate">{s.email ?? '—'}</td>
                      <td data-label="Fecha" className="table-muted">{fmtFecha(s.created_at)}</td>
                      <td className="col-actions">
                        <RowActions>
                          {/* Activar el módulo se hace en la ficha del cliente: es
                              donde vive el toggle y donde se recalcula el precio. */}
                          <Link href={`/admin/clientes/${s.client_id}`} className="row-actions-item">
                            <ExternalLink size={15} strokeWidth={2} /> Abrir ficha del cliente
                          </Link>
                          {s.estado === 'NUEVO' && (
                            <button className="row-actions-item" onClick={() => marcar(s, 'LEIDO')}>
                              <PhoneCall size={15} strokeWidth={2} /> Marcar contactado
                            </button>
                          )}
                          {s.estado !== 'RESUELTO' && (
                            <button className="row-actions-item row-actions-item-success" onClick={() => marcar(s, 'RESUELTO')}>
                              <Check size={15} strokeWidth={2} /> Marcar activado
                            </button>
                          )}
                          {!bloqueo && (
                            <button className="row-actions-item row-actions-item-danger"
                              disabled={pending} onClick={() => setPorBorrar(s)}>
                              <Trash2 size={15} strokeWidth={2} /> Eliminar
                            </button>
                          )}
                        </RowActions>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} label="ampliación" />
        </div>
      )}

      <BulkBar count={sel.count} onClear={sel.clear}>
        <button className="btn btn-danger btn-sm" disabled={pending} onClick={() => setConfirmLote(true)}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      </BulkBar>

      {porBorrar && (
        <ConfirmDialog
          danger
          title="Eliminar la ampliación"
          body={`Se elimina lo que ${porBorrar.nombre_empresa} pidió activar (${porBorrar.modulo}). No se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={borrar}
          onCancel={() => setPorBorrar(null)}
        />
      )}

      {confirmLote && (
        <ConfirmDialog
          danger
          title={`Eliminar ${sel.count} ampliación${sel.count === 1 ? '' : 'es'}`}
          body="No se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={borrarLote}
          onCancel={() => setConfirmLote(false)}
        />
      )}
    </div>
  )
}
