'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Copy, Eye, FileText, X } from 'lucide-react'
import { useToast } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import { usePagination, TablePagination } from '@/components/TablePagination'
import VentasTabs from '@/components/admin/VentasTabs'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import { etiquetaModo } from '@/lib/publico/modos'
import type { RespuestaTamano } from '@/lib/publico/tamano'
import {
  actualizarEstadoDiagnostico,
  type DiagnosticoLead,
  type EstadoLead,
} from '@/app/actions/diagnostico'

type Filtro = 'todos' | 'nuevo' | 'contactado'

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
  const { success: toastSuccess, error: toastError } = useToast()
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [detalle, setDetalle] = useState<DiagnosticoLead | null>(null)
  const [saving, setSaving] = useState(false)

  const visibles = leads.filter((l) => filtro === 'todos' || l.estado === filtro)
  const nNuevos = leads.filter((l) => l.estado === 'nuevo').length
  const { pageItems, ...pag } = usePagination(visibles)

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
    if (!r.ok) { toastError(r.error ?? 'Error al guardar'); return }
    toastSuccess(estado === 'contactado' ? 'Marcada como contactada' : 'Marcada como nueva')
    setDetalle({ ...l, estado })
    router.refresh()
  }

  const FILTROS: { k: Filtro; label: string }[] = [
    { k: 'todos', label: 'Todas' },
    { k: 'nuevo', label: 'Nuevas' },
    { k: 'contactado', label: 'Contactadas' },
  ]

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Solicitudes de diagnóstico</h1>
          <p className="page-subtitle">{leads.length} en total · {nNuevos} sin contactar.</p>
        </div>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />

      <div className="ter-toolbar">
        {FILTROS.map((f) => (
          <button
            key={f.k}
            className={`btn btn-sm ${filtro === f.k ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFiltro(f.k)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <div className="card">
          <p className="text-sm-muted">
            No hay solicitudes {filtro === 'todos' ? 'todavía' : 'en este estado'}.
          </p>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Nombre</th>
                  <th>Contacto</th>
                  <th>Sector</th>
                  <th>Fecha</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((l) => (
                  <tr key={l.id} className="table-row-clickable" onClick={() => setDetalle(l)}>
                    <td data-label="Estado"><EstadoBadge estado={l.estado} /></td>
                    <td data-label="Nombre"><span className="cell-clamp">{l.nombre}</span></td>
                    <td data-label="Contacto">
                      <div>{l.telefono}</div>
                      {l.email && <div className="text-xs-muted">{l.email}</div>}
                    </td>
                    <td data-label="Sector">{l.sector}</td>
                    <td data-label="Fecha">{fmtFecha(l.created_at)}</td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setDetalle(l)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                        <Link href={`/admin/presupuestos/nuevo?lead=${l.id}`} className="row-actions-item"><FileText size={15} strokeWidth={2} /> Crear presupuesto</Link>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} label="solicitud" />
        </div>
      )}

      {detalle && (
        <div className="modal-backdrop">
          <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{detalle.nombre}</h2>
              <button onClick={() => setDetalle(null)} className="modal-close" aria-label="Cerrar">
                <X size={20} strokeWidth={2} />
              </button>
            </div>
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
                  <span className="sol-value">{etiquetas.sectores[detalle.sector] ?? detalle.sector}</span>
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
                <div className="sol-row">
                  <span className="sol-label">Hizo el diagnóstico</span>
                  <span className="sol-value">{fmtFecha(detalle.created_at)}</span>
                </div>
                {/* Las dos fechas juntas, y ésta la última: es la que manda.
                    Un lead que pidió que le llamemos está esperando; uno que
                    hizo el diagnóstico y se fue, no. Se guardaba desde el
                    principio y no se enseñaba en ninguna pantalla. */}
                <div className="sol-row">
                  <span className="sol-label">Pidió que le llamemos</span>
                  <span className="sol-value">
                    {detalle.contacto_solicitado_at
                      ? fmtFecha(detalle.contacto_solicitado_at)
                      : 'No lo ha pedido'}
                  </span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <Link href={`/admin/presupuestos/nuevo?lead=${detalle.id}`} className="btn btn-secondary">
                <FileText size={15} strokeWidth={2} /> Crear presupuesto
              </Link>
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
          </div>
        </div>
      )}
    </div>
  )
}
