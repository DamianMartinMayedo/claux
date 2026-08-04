'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, PhoneCall } from 'lucide-react'
import { useToast } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import { usePagination, TablePagination } from '@/components/TablePagination'
import VentasTabs from '@/components/admin/VentasTabs'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import { actualizarEstadoAmpliacion, type Ampliacion } from '@/app/actions/soporte'

type Estado = Ampliacion['estado']
type Filtro = 'TODAS' | Estado

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

const FILTROS: { k: Filtro; label: string }[] = [
  { k: 'TODAS',    label: 'Todas' },
  { k: 'NUEVO',    label: 'Sin contactar' },
  { k: 'LEIDO',    label: 'Contactadas' },
  { k: 'RESUELTO', label: 'Activadas' },
]

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function AmpliacionesView({
  solicitudes, rol, permisos,
}: {
  solicitudes: Ampliacion[]
  rol: RolAdmin
  permisos: SeccionKey[]
}) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  const [filtro, setFiltro] = useState<Filtro>('TODAS')
  const [guardando, setGuardando] = useState<number | null>(null)

  const visibles = solicitudes.filter(s => filtro === 'TODAS' || s.estado === filtro)
  const sinContactar = solicitudes.filter(s => s.estado === 'NUEVO').length
  const { pageItems, ...pag } = usePagination(visibles)

  async function marcar(s: Ampliacion, estado: Estado) {
    if (guardando) return
    setGuardando(s.id)
    const r = await actualizarEstadoAmpliacion(s.id, estado)
    setGuardando(null)
    if (!r.ok) { toastError('No se pudo actualizar.'); return }
    toastSuccess(`${s.nombre_empresa}: ${ESTADO_LABEL[estado].toLowerCase()}`)
    router.refresh()
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ampliaciones</h1>
          <p className="page-subtitle">
            {solicitudes.length} en total · {sinContactar} sin contactar. Clientes que piden activar algo desde su portal.
          </p>
        </div>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />

      <div className="ter-toolbar">
        {FILTROS.map(f => (
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
            No hay ampliaciones {filtro === 'TODAS' ? 'todavía' : 'en este estado'}.
          </p>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Cliente</th>
                  <th>Quiere activar</th>
                  <th>Lo pidió</th>
                  <th>Fecha</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(s => (
                  <tr key={s.id}>
                    <td data-label="Estado">
                      <span className={`badge ${ESTADO_BADGE[s.estado]}`}>{ESTADO_LABEL[s.estado]}</span>
                    </td>
                    <td data-label="Cliente">
                      <div className="text-sm-bold cell-clamp">{s.nombre_empresa}</div>
                      {s.contacto && <div className="text-xs-muted">{s.contacto}</div>}
                    </td>
                    <td data-label="Quiere activar"><span className="badge badge-neutral">{s.modulo}</span></td>
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
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} label="ampliación" />
        </div>
      )}
    </div>
  )
}
