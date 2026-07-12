'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Copy, Eye, FileText, X } from 'lucide-react'
import { useToast } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
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

function EstadoBadge({ estado }: { estado: EstadoLead }) {
  return estado === 'contactado'
    ? <span className="badge badge-success">Contactado</span>
    : <span className="badge badge-info">Nuevo</span>
}

export default function SolicitudesView({ leads }: { leads: DiagnosticoLead[] }) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [detalle, setDetalle] = useState<DiagnosticoLead | null>(null)
  const [saving, setSaving] = useState(false)

  const visibles = leads.filter((l) => filtro === 'todos' || l.estado === filtro)
  const nNuevos = leads.filter((l) => l.estado === 'nuevo').length

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
                {visibles.map((l) => (
                  <tr key={l.id} className="table-row-clickable" onClick={() => setDetalle(l)}>
                    <td data-label="Estado"><EstadoBadge estado={l.estado} /></td>
                    <td data-label="Nombre">{l.nombre}</td>
                    <td data-label="Contacto">
                      <div>{l.telefono}</div>
                      {l.email && <div className="text-xs-muted">{l.email}</div>}
                    </td>
                    <td data-label="Sector">{l.sector}</td>
                    <td data-label="Fecha">{fmtFecha(l.created_at)}</td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setDetalle(l)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detalle && (
        <div className="modal-backdrop" onClick={() => setDetalle(null)}>
          <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
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
                  <span className="sol-value">{detalle.sector}</span>
                </div>
                <div className="sol-row">
                  <span className="sol-label">Necesidades</span>
                  <span className="sol-value">{(detalle.necesidades ?? []).join(', ') || '—'}</span>
                </div>
                <div className="sol-row">
                  <span className="sol-label">Cómo lo hace hoy</span>
                  <span className="sol-value">{detalle.modo_actual || '—'}</span>
                </div>
                <div className="sol-row">
                  <span className="sol-label">Módulos recomendados</span>
                  <span className="sol-value">{(detalle.modulos_rec ?? []).join(', ') || '—'}</span>
                </div>
                <div className="sol-row">
                  <span className="sol-label">Fecha</span>
                  <span className="sol-value">{fmtFecha(detalle.created_at)}</span>
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
