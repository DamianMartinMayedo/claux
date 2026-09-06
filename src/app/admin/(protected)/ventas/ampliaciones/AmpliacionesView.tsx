'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ExternalLink, PackagePlus, PhoneCall, Trash2 } from 'lucide-react'
import { toastError, toastLoading, toastSuccess, toastWarning } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import BulkBar from '@/components/portal/BulkBar'
import HeaderCheck from '@/components/portal/HeaderCheck'
import Filtros from '@/components/portal/Filtros'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import VentasTabs from '@/components/admin/VentasTabs'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import type { Filtro as FiltroDecl } from '@/lib/filtros'
import {
  actualizarEstadoAmpliacion,
  eliminarAmpliacion,
  eliminarAmpliacionesEnLote,
  type Ampliacion,
} from '@/app/actions/soporte'

type Estado = Ampliacion['estado']

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

// Para ordenar por estado: el que hay que atender primero, primero. Alfabético
// pondría «Activado» antes que «Sin contactar», que es justo al revés.
const ESTADO_PRIORIDAD: Record<Estado, number> = { NUEVO: 0, LEIDO: 1, RESUELTO: 2 }

const COLUMNAS: ColumnasOrden<Ampliacion> = {
  estado:  { label: 'Estado',         valor: s => ESTADO_PRIORIDAD[s.estado] },
  cliente: { label: 'Cliente',        valor: s => s.nombre_empresa },
  modulo:  { label: 'Quiere activar', valor: s => s.modulo },
  email:   { label: 'Lo pidió',       valor: s => s.email },
  fecha:   { label: 'Fecha',          valor: s => s.created_at },
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
  // En la URL, no en `useState`: el enlace a «sin contactar» se puede mandar, y
  // volver de la ficha de un cliente no deja la lista entera otra vez.
  const filtro = useSearchParams().get('estado') ?? ''
  const [guardando, setGuardando] = useState<number | null>(null)
  const [porBorrar, setPorBorrar] = useState<Ampliacion | null>(null)
  const [confirmLote, setConfirmLote] = useState(false)
  const [pending, startTransition] = useTransition()

  const visibles = useMemo(() => solicitudes.filter(s =>
    filtro === '' ? true : filtro === 'PRUEBAS' ? s.es_prueba : s.estado === filtro,
  ), [solicitudes, filtro])

  const orden = useOrden(visibles, COLUMNAS, { clave: 'fecha', dir: 'desc' })
  const { pageItems, ...pag } = usePagination(orden.filas)

  const pruebas = solicitudes.filter(s => s.es_prueba).length
  // El contador que decide a quién se llama no puede contar las de prueba: era
  // lo que hacía que la pantalla dijese cuatro cuando había una. Por eso el
  // subtítulo dice «de clientes reales» y las pastillas no: el número de una
  // pastilla es cuántas filas va a enseñar, sin excepciones.
  const sinContactar = solicitudes.filter(s => s.estado === 'NUEVO' && !s.es_prueba).length

  const borrables = useMemo(
    () => visibles.filter(s => !bloqueoDe(s)).map(s => String(s.id)),
    [visibles],
  )
  const sel = useRowSelection(borrables)

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

  /**
   * LA DECLARACIÓN. `cliente`: las ampliaciones vienen enteras y son pocas, así
   * que el navegador filtra sobre el conjunto completo y no miente.
   *
   * «De clientes de prueba» no es un estado, pero se pregunta en el mismo sitio
   * que ellos: son las cuatro formas de acotar la misma lista.
   */
  const declaracion: FiltroDecl[] = useMemo(() => {
    const cuenta = (e: Estado) => solicitudes.filter(s => s.estado === e).length
    return [{
      clave: 'estado', label: 'Todas', rotulo: 'Estado',
      valor: filtro, widget: 'pastillas', donde: 'cliente',
      todasCount: solicitudes.length,
      opciones: [
        { valor: 'NUEVO',    label: 'Sin contactar',         count: cuenta('NUEVO') },
        { valor: 'LEIDO',    label: 'Contactadas',           count: cuenta('LEIDO') },
        { valor: 'RESUELTO', label: 'Activadas',             count: cuenta('RESUELTO') },
        { valor: 'PRUEBAS',  label: 'De clientes de prueba', count: solicitudes.filter(s => s.es_prueba).length },
      ],
    }]
  }, [filtro, solicitudes])

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ampliaciones</h1>
          <p className="page-subtitle">
            {solicitudes.length} en total · {sinContactar} de clientes reales sin contactar
            {pruebas > 0 && ` · ${pruebas} de clientes de prueba`}. Clientes que piden activar algo desde su portal.
          </p>
        </div>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />

      <Filtros filtros={declaracion} />

      {visibles.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <PackagePlus size={40} strokeWidth={1.5} />
            <h3 className="table-empty-title">Sin ampliaciones</h3>
            <p>{filtro === ''
              ? 'Las piden los clientes desde su portal.'
              : 'No hay ampliaciones en este estado.'}</p>
          </div>
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
                  <ThOrden orden={orden} clave="estado" />
                  <ThOrden orden={orden} clave="cliente" />
                  <ThOrden orden={orden} clave="modulo" />
                  <ThOrden orden={orden} clave="email" />
                  <ThOrden orden={orden} clave="fecha" />
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
                          {/* La fila NO es clicable: una ampliación no tiene ficha
                              propia. Lo que sí la tiene es el cliente, y a ella se
                              entra por su nombre. */}
                          <Link href={`/admin/clientes/${s.client_id}`} className="table-name-link cell-clamp">
                            {s.nombre_empresa}
                          </Link>
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
