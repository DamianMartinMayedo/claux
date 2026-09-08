'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, Copy, Eye, FileText, Inbox, Presentation, Trash2 } from 'lucide-react'
import { toastError, toastLoading, toastSuccess, toastWarning } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import BulkBar from '@/components/portal/BulkBar'
import HeaderCheck from '@/components/portal/HeaderCheck'
import Filtros from '@/components/portal/Filtros'
import ModalShell from '@/components/portal/ModalShell'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import VentasTabs from '@/components/admin/VentasTabs'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'
import type { FiltroAdmin } from '@/lib/exportar/tablas-admin'
import { etiquetaModo } from '@/lib/publico/modos'
import type { RespuestaTamano } from '@/lib/publico/tamano'
import { pistasDePrueba, explicarPistas } from '@/lib/leads-prueba'
import {
  actualizarEstadoDiagnostico,
  eliminarDiagnostico,
  eliminarDiagnosticosEnLote,
  type DiagnosticoLead,
  type EstadoLead,
} from '@/app/actions/diagnostico'
import { crearPropuesta } from '@/app/actions/propuestas'
import ExportarMenu from '@/components/portal/ExportarMenu'

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Lista de claves → lista de rótulos. La clave que no esté en el mapa se queda
    como está: es un dato del lead y perderlo sería peor que verlo en crudo. */
function rotular(claves: string[] | null, mapa: Record<string, string>): string {
  return (claves ?? []).map((c) => mapa[c] ?? c).join(', ') || '—'
}

/**
 * Por qué esta solicitud no se puede borrar, o null si sí. Quien manda es el
 * candado de la base de datos (`eliminar_lead`, mig. 227); esto lo repite —en el
 * mismo orden— para poder decirlo ANTES de que alguien pulse.
 */
function bloqueoDe(l: DiagnosticoLead): string | null {
  if (l.presupuestos.length > 0) {
    const cliente = l.presupuestos.find((p) => p.client_id)?.client_id
    const cual = l.presupuestos.length === 1
      ? `el presupuesto #${l.presupuestos[0].id}`
      : `${l.presupuestos.length} presupuestos`
    return cliente
      ? `Tiene ${cual}, que ya es del cliente ${cliente}`
      : `Tiene ${cual}: hay que borrarlo antes si también es de prueba`
  }
  if (l.contacto_solicitado_at) return 'Pidió que la llamemos'
  if (l.estado === 'contactado') return 'Está marcada como contactada: pasarla a nueva si era una prueba'
  return null
}

function EstadoBadge({ estado }: { estado: EstadoLead }) {
  return estado === 'contactado'
    ? <span className="badge badge-success">Contactado</span>
    : <span className="badge badge-info">Nuevo</span>
}

export default function SolicitudesView({
  leads,
  rol,
  permisos,
  nombresNivel,
  tamanos,
  etiquetas,
}: {
  leads: DiagnosticoLead[]
  rol: RolAdmin
  permisos: SeccionKey[]
  /** Nombres vivos de los niveles: el lead guarda la clave, no el rótulo. */
  nombresNivel: Record<string, string>
  /** Por id de lead, el tamaño que declaró ya traducido a bandas legibles. */
  tamanos: Record<number, RespuestaTamano[]>
  /** Rótulos vivos por clave: el lead guarda claves, no lo que el visitante leyó. */
  etiquetas: {
    sectores:    Record<string, string>
    necesidades: Record<string, string>
    modulos:     Record<string, string>
  }
}) {
  const router = useRouter()
  /**
   * Los dos filtros viven en la URL. Y son DOS, no uno: el estado es un dato
   * guardado y «posibles pruebas» una corazonada que se calcula aquí. Juntos en
   * un solo control se excluían —no se podía pedir «las nuevas que además huelen
   * a prueba»—, y la descarga tenía que explicar a mano que ese valor no viajaba.
   */
  const params  = useSearchParams()
  const filtro  = params.get('estado') ?? ''
  const pruebas = params.get('pruebas') ?? ''
  const [detalle, setDetalle] = useState<DiagnosticoLead | null>(null)
  const [saving, setSaving] = useState(false)
  const [porBorrar, setPorBorrar] = useState<DiagnosticoLead | null>(null)
  const [confirmLote, setConfirmLote] = useState(false)
  const [pending, startTransition] = useTransition()

  // Cuáles parecen pruebas de desarrollo. La heurística solo propone (ver
  // `lib/leads-prueba.ts`): marca la fila y llena el filtro, nunca borra.
  const pistas = useMemo(() => pistasDePrueba(leads), [leads])

  // El sector se guarda como CLAVE; el rótulo es el vivo del catálogo. Se resuelve
  // una vez y se usa en la celda, en la ficha y para ordenar: si la tabla ordena por
  // la clave y enseña el rótulo, la columna sale desordenada a la vista.
  const sectorDe = useMemo(
    () => (l: DiagnosticoLead) => etiquetas.sectores[l.sector] ?? l.sector,
    [etiquetas.sectores],
  )

  const visibles = useMemo(() => leads.filter((l) => (
    (!filtro || l.estado === filtro) && (!pruebas || pistas.has(l.id))
  )), [leads, filtro, pruebas, pistas])

  const COLUMNAS: ColumnasOrden<DiagnosticoLead> = useMemo(() => ({
    estado:   { label: 'Estado',   valor: (l) => l.estado },
    nombre:   { label: 'Nombre',   valor: (l) => l.nombre },
    contacto: { label: 'Contacto', valor: (l) => l.telefono },
    sector:   { label: 'Sector',   valor: sectorDe },
    fecha:    { label: 'Fecha',    valor: (l) => l.created_at },
  }), [sectorDe])

  const orden = useOrden(visibles, COLUMNAS, { clave: 'fecha', dir: 'desc' })
  const { pageItems, ...pag } = usePagination(orden.filas)

  const nNuevos      = leads.filter((l) => l.estado === 'nuevo').length
  const nContactados = leads.length - nNuevos

  // La selección solo alcanza a lo BORRABLE: así «seleccionar todo» nunca marca
  // una solicitud protegida y el conteo de la barra no promete de más.
  const borrables = useMemo(
    () => visibles.filter((l) => !bloqueoDe(l)).map((l) => String(l.id)),
    [visibles],
  )
  const sel = useRowSelection(borrables)

  const puedePropuestas = rol === 'super_admin' || permisos.includes('propuestas')

  // La propuesta se CREA aquí y se abre ya: llevar el lead por la barra de
  // direcciones (`?lead=`) obligaría al editor a decidir de dónde salen el nivel
  // y los módulos, que es justo lo que hace la acción. Un viaje, un sitio.
  function nuevaPropuesta(l: DiagnosticoLead) {
    const ld = toastLoading('Creando…')
    startTransition(async () => {
      const r = await crearPropuesta({
        nombreNegocio: l.nombre,
        diagnosticoId: l.id,
        nivel:   l.nivel_rec ?? undefined,
        modulos: l.modulos_rec,
      })
      await ld.dismiss()
      if (!r.ok || !r.id) { toastError(r.error ?? 'No se pudo crear la propuesta'); return }
      router.push(`/admin/ventas/propuestas/${r.id}`)
    })
  }

  async function copiar(texto: string, etiqueta: string) {
    try {
      await navigator.clipboard.writeText(texto)
      toastSuccess(`${etiqueta} copiado`)
    } catch {
      toastError('No se pudo copiar')
    }
  }

  async function marcar(l: DiagnosticoLead, estado: EstadoLead) {
    setSaving(true)
    const r = await actualizarEstadoDiagnostico(l.id, estado)
    setSaving(false)
    if (!r.ok) { toastError(r.error ?? 'No se ha podido guardar'); return }
    toastSuccess(estado === 'contactado' ? 'Marcada como contactada' : 'Marcada como nueva')
    setDetalle({ ...l, estado })
    router.refresh()
  }

  function borrar() {
    if (!porBorrar) return
    const l = porBorrar
    setPorBorrar(null)
    // El toast de carga se crea ANTES de la transición: dentro no llega a pintarse.
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await eliminarDiagnostico(l.id)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo eliminar'); return }
      toastSuccess(r.yaEliminado ? 'La solicitud ya no estaba' : `Solicitud de ${l.nombre} eliminada`)
      setDetalle((d) => (d?.id === l.id ? null : d))
      router.refresh()
    })
  }

  function borrarLote() {
    const ids = sel.selectedIds.map(Number)
    setConfirmLote(false)
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await eliminarDiagnosticosEnLote(ids)
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
   * LA DECLARACIÓN. `cliente` los dos: los leads vienen enteros, así que el
   * navegador filtra sobre el conjunto completo. «Posibles pruebas» va con
   * `sinExportar` —el fichero no puede reproducir una corazonada—, y de eso se
   * encarga el resumen del desplegable sin que nadie escriba la frase.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      clave: 'estado', label: 'Todas', rotulo: 'Estado',
      valor: filtro, widget: 'pastillas', donde: 'cliente',
      todasCount: leads.length,
      opciones: [
        { valor: 'nuevo',      label: 'Nuevas',      count: nNuevos },
        { valor: 'contactado', label: 'Contactadas', count: nContactados },
      ],
    },
    {
      clave: 'pruebas', label: 'Posibles pruebas', rotulo: 'Posibles pruebas',
      valor: pruebas, widget: 'toggle', donde: 'cliente', sinExportar: true,
    },
  ], [filtro, pruebas, leads.length, nNuevos, nContactados])

  const bloqueoDetalle = detalle ? bloqueoDe(detalle) : null

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Solicitudes de diagnóstico</h1>
          <p className="page-subtitle">{leads.length} en total · {nNuevos} sin contactar.</p>
        </div>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />

      <Filtros
        filtros={declaracion}
        acciones={
          <ExportarMenu
            ambito="admin"
            clave="solicitudes"
            filtro={filtroExport<FiltroAdmin>(declaracion)}
            resumen={resumenDe(declaracion)}
            pequeno
            sinPeriodo
          />
        }
      />

      {visibles.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <Inbox size={40} strokeWidth={1.5} />
            <h3 className="table-empty-title">Sin solicitudes</h3>
            <p>{!filtro && !pruebas
              ? 'Aquí llegan las que se envían desde la web.'
              : pruebas && !filtro
                ? 'Ninguna solicitud parece de prueba.'
                : 'No hay solicitudes con los filtros aplicados.'}</p>
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
                  <ThOrden orden={orden} clave="nombre" />
                  <ThOrden orden={orden} clave="contacto" />
                  <ThOrden orden={orden} clave="sector" />
                  <ThOrden orden={orden} clave="fecha" />
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((l) => {
                  const bloqueo = bloqueoDe(l)
                  const pista = pistas.get(l.id)
                  return (
                    <tr key={l.id} className="table-row-clickable" onClick={() => setDetalle(l)}>
                      <td className="col-check" onClick={(e) => e.stopPropagation()}>
                        {bloqueo ? (
                          <input type="checkbox" className="row-check" checked={false} readOnly disabled
                            title={bloqueo} aria-label={`${l.nombre}: no se puede eliminar`} />
                        ) : (
                          <input type="checkbox" className="row-check"
                            checked={sel.isSelected(String(l.id))}
                            onChange={() => sel.toggle(String(l.id))}
                            aria-label={`Seleccionar ${l.nombre}`} />
                        )}
                      </td>
                      <td data-label="Estado"><EstadoBadge estado={l.estado} /></td>
                      <td data-label="Nombre">
                        <div className="cell-nombre">
                          <span className="cell-clamp">{l.nombre}</span>
                          {pista && <span className="badge" title={explicarPistas(pista)}>Prueba</span>}
                        </div>
                      </td>
                      <td data-label="Contacto">
                        <div>{l.telefono}</div>
                        {l.email && <div className="text-xs-muted">{l.email}</div>}
                      </td>
                      <td data-label="Sector">{sectorDe(l)}</td>
                      <td data-label="Fecha">{fmtFecha(l.created_at)}</td>
                      {/* La fila abre la ficha; el menú de acciones no la abre por
                          debajo mientras eliges dentro de él. */}
                      <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                        <RowActions>
                          <button className="row-actions-item" onClick={() => setDetalle(l)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                          <Link href={`/admin/presupuestos/nuevo?lead=${l.id}`} className="row-actions-item"><FileText size={15} strokeWidth={2} /> Crear presupuesto</Link>
                          {puedePropuestas && (
                            <button className="row-actions-item" disabled={pending} onClick={() => nuevaPropuesta(l)}>
                              <Presentation size={15} strokeWidth={2} /> Crear propuesta
                            </button>
                          )}
                          <button
                            className="row-actions-item row-actions-item-danger"
                            onClick={() => setPorBorrar(l)}
                            disabled={!!bloqueo || pending}
                            title={bloqueo ?? undefined}
                          >
                            <Trash2 size={15} strokeWidth={2} /> Eliminar
                          </button>
                        </RowActions>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} label="solicitud" />
        </div>
      )}

      <BulkBar count={sel.count} onClear={sel.clear}>
        <button className="btn btn-danger btn-sm" disabled={pending} onClick={() => setConfirmLote(true)}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      </BulkBar>

      {detalle && (
        <ModalShell
          title={detalle.nombre}
          subtitle={`${sectorDe(detalle)} · ${fmtFecha(detalle.created_at)}`}
          size="modal-xl"
          onClose={() => setDetalle(null)}
        >
          <div className="modal-body">
            <div className="sol-detalle">
              <div className="sol-row">
                <span className="sol-label">Estado</span>
                <span className="sol-value"><EstadoBadge estado={detalle.estado} /></span>
              </div>
              <div className="sol-row">
                <span className="sol-label">Teléfono</span>
                <span className="sol-value">{detalle.telefono}</span>
                <button className="btn btn-secondary btn-xs" onClick={() => copiar(detalle.telefono, 'Teléfono')}>
                  <Copy size={13} strokeWidth={2} /> Copiar
                </button>
              </div>
              {detalle.email && (
                <div className="sol-row">
                  <span className="sol-label">Correo</span>
                  <span className="sol-value">{detalle.email}</span>
                  <button className="btn btn-secondary btn-xs" onClick={() => copiar(detalle.email!, 'Correo')}>
                    <Copy size={13} strokeWidth={2} /> Copiar
                  </button>
                </div>
              )}
              <div className="sol-row">
                <span className="sol-label">Sector</span>
                <span className="sol-value">{sectorDe(detalle)}</span>
              </div>
              <div className="sol-row">
                <span className="sol-label">Necesidades</span>
                <span className="sol-value">{rotular(detalle.necesidades, etiquetas.necesidades)}</span>
              </div>
              <div className="sol-row">
                <span className="sol-label">Cómo lo hace hoy</span>
                <span className="sol-value">{detalle.modo_actual ? etiquetaModo(detalle.modo_actual) : '—'}</span>
              </div>
              <div className="sol-row">
                <span className="sol-label">Módulos recomendados</span>
                <span className="sol-value">{rotular(detalle.modulos_rec, etiquetas.modulos)}</span>
              </div>
              {/* Lo que declaró de tamaño, antes del nivel: primero el dato,
                  después la conclusión que sale de él. La tercera fila cambia
                  con el sector —servicios o productos—, porque son dos topes
                  distintos y la pregunta se le hizo según el suyo.

                  Y si no hay nada, se DICE. Ocultar las filas dejaba la ficha
                  idéntica a la de antes en los 27 leads anteriores al paso de
                  tamaño, que es exactamente como se ve una función rota. */}
              {(tamanos[detalle.id] ?? []).length > 0 ? (
                (tamanos[detalle.id] ?? []).map((t) => (
                  <div key={t.etiqueta} className="sol-row">
                    <span className="sol-label">{t.etiqueta}</span>
                    <span className="sol-value">{t.banda}</span>
                  </div>
                ))
              ) : (
                <div className="sol-row">
                  <span className="sol-label">Tamaño</span>
                  <span className="sol-value">No se le preguntó: hizo el diagnóstico antes de que existiera este paso</span>
                </div>
              )}
              <div className="sol-row">
                <span className="sol-label">Nivel que le corresponde</span>
                <span className="sol-value">
                  {detalle.nivel_rec
                    ? (nombresNivel[detalle.nivel_rec] ?? detalle.nivel_rec)
                    : 'Sin calcular'}
                </span>
              </div>
              {/* La fecha del diagnóstico ya está en el subtítulo. Aquí queda la
                  que MANDA: un lead que pidió que le llamemos está esperando; uno
                  que hizo el diagnóstico y se fue, no. */}
              <div className="sol-row">
                <span className="sol-label">Pidió que le llamemos</span>
                <span className="sol-value">
                  {detalle.contacto_solicitado_at
                    ? fmtFecha(detalle.contacto_solicitado_at)
                    : 'No lo ha pedido'}
                </span>
              </div>
              {/* Los presupuestos que salieron de aquí: es el candado del
                  borrado y, sobre todo, la señal de que esto no es basura. */}
              {detalle.presupuestos.length > 0 && (
                <div className="sol-row">
                  <span className="sol-label">Presupuestos</span>
                  <span className="sol-value">
                    {detalle.presupuestos.map((p) => (
                      <Link key={p.id} href={`/admin/presupuestos/${p.id}`} className="sol-presupuesto">
                        #{p.id} · {p.nombre_negocio}{p.client_id ? ` · ${p.client_id}` : ''}
                      </Link>
                    ))}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="btn btn-danger-text"
              disabled={!!bloqueoDetalle || pending}
              title={bloqueoDetalle ?? undefined}
              onClick={() => setPorBorrar(detalle)}
            >
              <Trash2 size={15} strokeWidth={2} /> Eliminar
            </button>
            <Link href={`/admin/presupuestos/nuevo?lead=${detalle.id}`} className="btn btn-secondary">
              <FileText size={15} strokeWidth={2} /> Crear presupuesto
            </Link>
            {puedePropuestas && (
              <button className="btn btn-secondary" disabled={pending} onClick={() => nuevaPropuesta(detalle)}>
                <Presentation size={15} strokeWidth={2} /> Crear propuesta
              </button>
            )}
            {detalle.estado === 'nuevo' ? (
              <button className="btn btn-primary" disabled={saving} onClick={() => marcar(detalle, 'contactado')}>
                <Check size={15} strokeWidth={2} /> Marcar como contactada
              </button>
            ) : (
              <button className="btn btn-secondary" disabled={saving} onClick={() => marcar(detalle, 'nuevo')}>
                Marcar como nueva
              </button>
            )}
          </div>
        </ModalShell>
      )}

      {porBorrar && (
        <ConfirmDialog
          danger
          title="Eliminar la solicitud"
          body={`Se elimina la solicitud de ${porBorrar.nombre}. No se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={borrar}
          onCancel={() => setPorBorrar(null)}
        />
      )}

      {confirmLote && (
        <ConfirmDialog
          danger
          title={`Eliminar ${sel.count} solicitud${sel.count === 1 ? '' : 'es'}`}
          body="No se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={borrarLote}
          onCancel={() => setConfirmLote(false)}
        />
      )}
    </div>
  )
}
