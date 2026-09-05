'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Copy, Eye, Images, Link2, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import BulkBar from '@/components/portal/BulkBar'
import HeaderCheck from '@/components/portal/HeaderCheck'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden } from '@/components/TableSort'
import VentasTabs from '@/components/admin/VentasTabs'
import PropuestasTabs from '@/components/admin/PropuestasTabs'
import { DIAS_CADUCA_CAPTURA } from '@/lib/propuesta/secciones'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import { importeClaux } from '@/lib/moneda-claux'
import {
  crearPropuesta, eliminarPropuesta, eliminarPropuestasEnLote,
  type PropuestaRow,
} from '@/app/actions/propuestas'

type Filtro = 'TODAS' | 'BORRADOR' | 'PUBLICADA' | 'ABIERTAS'

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function PropuestasView({
  propuestas, capturasViejas, rol, permisos,
}: {
  propuestas: PropuestaRow[]
  /** Capturas activas de más de {DIAS_CADUCA_CAPTURA} días. El aviso se ve donde se trabaja. */
  capturasViejas: number
  rol: RolAdmin
  permisos: SeccionKey[]
}) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<Filtro>('TODAS')
  const [porBorrar, setPorBorrar] = useState<PropuestaRow | null>(null)
  const [confirmLote, setConfirmLote] = useState(false)
  const [nueva, setNueva] = useState(false)
  const [nombreNueva, setNombreNueva] = useState('')
  const [pending, startTransition] = useTransition()

  const visibles = useMemo(() => propuestas.filter(p =>
    filtro === 'TODAS' ? true
      : filtro === 'ABIERTAS' ? p.aperturas > 0
      : p.estado === filtro,
  ), [propuestas, filtro])

  const publicadas = propuestas.filter(p => p.estado === 'PUBLICADA').length
  const abiertas   = propuestas.filter(p => p.aperturas > 0).length

  const ord = useOrden(visibles, {
    negocio:  { label: 'Negocio',  valor: p => p.nombre_negocio },
    comercial:{ label: 'Comercial', valor: p => p.comercial_nombre ?? '' },
    estado:   { label: 'Estado',   valor: p => p.estado },
    // Se ordena por el número de aperturas, no por el texto de la celda: «3 veces»
    // y «12 veces» se ordenan al revés como cadenas.
    acuse:    { label: 'Acuse',    valor: p => p.aperturas },
    fecha:    { label: 'Creada',   valor: p => p.created_at },
  })
  const { pageItems, ...pag } = usePagination(ord.filas)

  const sel = useRowSelection(visibles.map(p => String(p.id)))

  function cambiarFiltro(f: Filtro) {
    setFiltro(f)
    sel.clear()
  }

  function crear() {
    const nombre = nombreNueva.trim()
    if (!nombre) return
    setNueva(false)
    setNombreNueva('')
    // El toast de carga se crea ANTES de la transición: dentro no llega a pintarse.
    const ld = toastLoading('Creando…')
    startTransition(async () => {
      const r = await crearPropuesta({ nombreNegocio: nombre })
      await ld.dismiss()
      if (!r.ok || !r.id) { toastError(r.error ?? 'No se pudo crear'); return }
      router.push(`/admin/ventas/propuestas/${r.id}`)
    })
  }

  function borrar() {
    if (!porBorrar) return
    const p = porBorrar
    setPorBorrar(null)
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await eliminarPropuesta(p.id)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo eliminar'); return }
      toastSuccess(`Propuesta de ${p.nombre_negocio} eliminada`)
      router.refresh()
    })
  }

  function borrarLote() {
    const ids = sel.selectedIds.map(Number)
    setConfirmLote(false)
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await eliminarPropuestasEnLote(ids)
      await ld.dismiss()
      if (r.error) { toastError(r.error); return }
      toastSuccess(`${r.hechas} eliminada${r.hechas === 1 ? '' : 's'}`)
      sel.clear()
      router.refresh()
    })
  }

  // El origen se lee en el CLIC, nunca al pintar: `window.location` en el render
  // devuelve una cosa en el servidor y otra en el navegador, y eso es un desajuste
  // de hidratación —que en esta tabla se traduce en un enlace sin dominio—.
  function compartirWhatsApp(p: PropuestaRow) {
    if (!p.token) return
    const texto = `${p.titulo}\n${window.location.origin}/p/${p.token}`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
  }

  async function copiarEnlace(p: PropuestaRow) {
    if (!p.token) return
    const url = `${window.location.origin}/p/${p.token}`
    try {
      await navigator.clipboard.writeText(url)
      toastSuccess('Enlace copiado')
    } catch {
      toastError('No se pudo copiar. El enlace está en la propuesta.')
    }
  }

  const FILTROS: { k: Filtro; label: string; n?: number }[] = [
    { k: 'TODAS',     label: 'Todas' },
    { k: 'BORRADOR',  label: 'Borradores' },
    { k: 'PUBLICADA', label: 'Publicadas', n: publicadas },
    { k: 'ABIERTAS',  label: 'Abiertas por el cliente', n: abiertas },
  ]

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Propuestas</h1>
          <p className="page-subtitle">
            {propuestas.length} en total · {publicadas} publicada{publicadas === 1 ? '' : 's'}.
            Los precios y las horas salen del presupuesto vinculado.
          </p>
        </div>
        <button className="btn btn-primary" disabled={pending} onClick={() => setNueva(true)}>
          <Plus size={16} strokeWidth={2} /> Nueva propuesta
        </button>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />
      <PropuestasTabs rol={rol} permisos={permisos} />

      {/* El aviso se ve AQUÍ, que es donde se trabaja: dentro de la biblioteca lo
          lee quien ya iba a mirarla. */}
      {capturasViejas > 0 && (
        <div className="alert alert-warning">
          <span>
            {capturasViejas === 1 ? 'Una captura pasa' : `${capturasViejas} capturas pasan`} de {DIAS_CADUCA_CAPTURA} días.
          </span>
          <Link href="/admin/ventas/propuestas/capturas" className="btn btn-sm btn-aviso">
            <Images size={14} strokeWidth={2} /> Revisarlas
          </Link>
        </div>
      )}

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
            {filtro === 'TODAS'
              ? 'No hay propuestas. Se crean desde una solicitud, desde un presupuesto o aquí mismo.'
              : 'No hay propuestas en este estado.'}
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
                  <ThOrden orden={ord} clave="negocio" />
                  <ThOrden orden={ord} clave="estado" />
                  <ThOrden orden={ord} clave="comercial" />
                  <th>Presupuesto</th>
                  <ThOrden orden={ord} clave="acuse">Acuse</ThOrden>
                  <th>Qué marcó</th>
                  <ThOrden orden={ord} clave="fecha" />
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(p => (
                  <tr key={p.id}>
                    <td className="col-check">
                      <input type="checkbox" className="row-check"
                        checked={sel.isSelected(String(p.id))}
                        onChange={() => sel.toggle(String(p.id))}
                        aria-label={`Seleccionar la propuesta de ${p.nombre_negocio}`} />
                    </td>
                    <td data-label="Negocio">
                      <Link href={`/admin/ventas/propuestas/${p.id}`} className="text-sm-bold cell-clamp" title={p.nombre_negocio}>
                        {p.nombre_negocio}
                      </Link>
                      <div className="text-xs-muted">{p.modulos.length} módulo{p.modulos.length === 1 ? '' : 's'}</div>
                    </td>
                    <td data-label="Estado">
                      {p.estado === 'PUBLICADA'
                        ? <span className="badge badge-success">Publicada</span>
                        : <span className="badge badge-neutral">Borrador</span>}
                    </td>
                    <td data-label="Comercial" className="cell-truncate">{p.comercial_nombre ?? '—'}</td>
                    <td data-label="Presupuesto">
                      {p.presupuesto_id
                        ? <span className="text-sm">#{p.presupuesto_id}</span>
                        : <span className="badge badge-warning">Sin vincular</span>}
                    </td>
                    <td data-label="Acuse">
                      {p.aperturas === 0
                        ? <span className="text-xs-muted">Sin abrir</span>
                        : (
                          <>
                            <span className="text-sm-bold">{p.aperturas}</span>
                            {p.ultima_apertura && <div className="text-xs-muted">{fmtFechaHora(p.ultima_apertura)}</div>}
                          </>
                        )}
                    </td>
                    <td data-label="Qué marcó">
                      {p.seleccion
                        ? (
                          <>
                            <span className="text-sm-bold">{importeClaux(p.seleccion.cuota, p.seleccion.moneda)}/mes</span>
                            <div className="text-xs-muted">{p.seleccion.modulos.length} módulos</div>
                          </>
                        )
                        : <span className="text-xs-muted">—</span>}
                    </td>
                    <td data-label="Creada" className="table-muted">{fmtFecha(p.created_at)}</td>
                    <td className="col-actions">
                      <RowActions>
                        <Link href={`/admin/ventas/propuestas/${p.id}`} className="row-actions-item">
                          <Pencil size={15} strokeWidth={2} /> Editar
                        </Link>
                        <Link href={`/p/preview/${p.id}`} target="_blank" className="row-actions-item">
                          <Eye size={15} strokeWidth={2} /> Presentar
                        </Link>
                        {p.estado === 'PUBLICADA' && p.token && (
                          <>
                            <button className="row-actions-item" onClick={() => copiarEnlace(p)}>
                              <Copy size={15} strokeWidth={2} /> Copiar enlace
                            </button>
                            <button className="row-actions-item" onClick={() => compartirWhatsApp(p)}>
                              <Send size={15} strokeWidth={2} /> Enviar por WhatsApp
                            </button>
                            <Link href={`/p/${p.token}`} target="_blank" className="row-actions-item">
                              <Link2 size={15} strokeWidth={2} /> Abrir el enlace
                            </Link>
                          </>
                        )}
                        <button className="row-actions-item row-actions-item-danger"
                          disabled={pending} onClick={() => setPorBorrar(p)}>
                          <Trash2 size={15} strokeWidth={2} /> Eliminar
                        </button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} label="propuesta" />
        </div>
      )}

      <BulkBar count={sel.count} onClear={sel.clear}>
        <button className="btn btn-danger btn-sm" disabled={pending} onClick={() => setConfirmLote(true)}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      </BulkBar>

      {nueva && (
        <div className="modal-backdrop open" onClick={() => setNueva(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2 className="modal-title">Nueva propuesta</h2></div>
            <div className="modal-body">
              <div className="input-group">
                <label htmlFor="prp-nombre">Nombre del negocio</label>
                <input
                  id="prp-nombre" className="input" autoFocus value={nombreNueva}
                  onChange={e => setNombreNueva(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') crear() }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setNueva(false)}>Cancelar</button>
              <button className="btn btn-primary" disabled={pending || !nombreNueva.trim()} onClick={crear}>
                Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {porBorrar && (
        <ConfirmDialog
          danger
          title="Eliminar la propuesta"
          body={`Se elimina la propuesta de ${porBorrar.nombre_negocio}${porBorrar.estado === 'PUBLICADA' ? ' y su enlace deja de funcionar' : ''}. No se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={borrar}
          onCancel={() => setPorBorrar(null)}
        />
      )}

      {confirmLote && (
        <ConfirmDialog
          danger
          title={`Eliminar ${sel.count} propuesta${sel.count === 1 ? '' : 's'}`}
          body="Los enlaces publicados dejan de funcionar. No se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={borrarLote}
          onCancel={() => setConfirmLote(false)}
        />
      )}
    </div>
  )
}
