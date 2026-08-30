'use client'

import { Download, Eye, Search, User } from 'lucide-react'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { suscripcionLabel, precioMensualEfectivo, monedaDelCliente, esSocioHoy, type CondicionesCliente } from '@/lib/billing'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { RowActions } from '@/components/portal/RowActions'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-warning', VENCIDO: 'badge-error',
}

type Cliente = CondicionesCliente & {
  client_id: string; nombre_empresa: string; nombre_contacto: string | null
  email_admin: string; estado: string
  ciclo_facturacion: string | null
  fecha_expiracion: string | null; fecha_inicio: string | null
  fecha_fin_gracia: string | null
  created_at: string | null; notas: string | null
  archivado_at: string | null
  es_prueba: boolean | null
}

function cicloLabel(ciclo: string | null) {
  return ciclo === 'anual' ? 'Anual' : 'Mensual'
}

function formatFecha(fecha: string | null) {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

type DiasInfo = { label: string; variant: 'error' | 'warning' | 'success' | 'muted' }

/**
 * La fecha que de verdad gobierna a este cliente.
 *
 * Un Socio CLAUX no paga, así que su `fecha_expiracion` se queda congelada en el
 * último ciclo que pagó y retrocede en el pasado para siempre. Su reloj es
 * `socio_hasta` — el mismo criterio que ya aplican el dashboard del portal
 * (`fechaTope` en `actions/portal/dashboard.ts`) y el escáner de la bandeja del
 * admin. Sin fecha, la condición es indefinida y no hay nada que contar.
 */
function fechaTope(c: Cliente): string | null {
  if (esSocioHoy(c)) return c.socio_hasta ?? null
  return (c.estado === 'GRACIA' && c.fecha_fin_gracia) ? c.fecha_fin_gracia : c.fecha_expiracion
}

function cuentaAtras(fecha: string): DiasInfo {
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  const exp = new Date(y, m - 1, d)
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const dias = Math.ceil((exp.getTime() - hoy.getTime()) / 86_400_000)

  if (dias < 0)   return { label: 'Vencido',   variant: 'error' }
  if (dias === 0) return { label: 'Hoy',        variant: 'error' }
  if (dias <= 5)  return { label: `${dias}d`,   variant: 'error' }
  if (dias <= 14) return { label: `${dias}d`,   variant: 'warning' }
  return              { label: `${dias}d`,       variant: 'success' }
}

/**
 * Los días que le quedan. Esta columna pintaba «Vencido» en rojo sobre un socio con
 * el acceso garantizado —le pasó a DEUS— porque miraba `fecha_expiracion` a secas,
 * cuando el resto del admin (dashboard, bandeja, cron de recordatorios) ya descarta
 * al socio con `esSocioHoy`. Era la única voz de la pantalla que no lo hacía.
 */
function calcDiasRestantes(c: Cliente): DiasInfo {
  if (!esSocioHoy(c) && c.estado === 'DESACTIVADO') return { label: '—', variant: 'muted' }
  const fecha = fechaTope(c)
  if (!fecha) return { label: '—', variant: 'muted' }
  return cuentaAtras(fecha)
}

const DIAS_COLOR: Record<DiasInfo['variant'], string> = {
  error:   'var(--color-error)',
  warning: 'var(--color-warning)',
  success: 'var(--color-success)',
  muted:   'var(--color-text-muted)',
}

function exportCSV(clientes: Cliente[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  // La moneda va en su propia columna, no pegada al número ni en la cabecera: con dos
  // monedas en la misma hoja, «Precio mensual USD» mintiendo en la mitad de las filas
  // es peor que no traerla, y quien abra el CSV va a sumar la columna sin mirar.
  const headers = ['ID Cliente', 'Empresa', 'Contacto', 'Email', 'Precio mensual', 'Moneda', 'Ciclo',
    'Estado', 'Socio CLAUX', 'Expiración', 'Días restantes', 'Fecha alta', 'Notas']
  const rows = clientes.map(c => [
    c.client_id, c.nombre_empresa, c.nombre_contacto ?? '', c.email_admin,
    precioMensualEfectivo(c).toFixed(2), monedaDelCliente(c), cicloLabel(c.ciclo_facturacion), c.estado,
    esSocioHoy(c) ? 'Sí' : '', fechaTope(c) ?? '', calcDiasRestantes(c).label,
    c.fecha_inicio ?? c.created_at ?? '', c.notas ?? '',
  ])
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
  const blob = new Blob(['' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'clientes.csv'; a.click()
  URL.revokeObjectURL(url)
}

export default function ClientesTabla({
  clientes,
  descuentoAnualPct,
}: {
  clientes: Cliente[]
  descuentoAnualPct: number
}) {
  const router = useRouter()
  const [busqueda, setBusqueda]         = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [verArchivados, setVerArchivados] = useState(false)

  const nArchivados = useMemo(() => clientes.filter(c => c.archivado_at).length, [clientes])

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase()
    return clientes.filter(c => {
      // Por defecto, los archivados no aparecen (activar "Ver archivados").
      if (!verArchivados && c.archivado_at) return false
      const coincideBusqueda = !q ||
        c.nombre_empresa.toLowerCase().includes(q) ||
        c.email_admin.toLowerCase().includes(q) ||
        c.client_id.toLowerCase().includes(q)
      const coincideEstado = !filtroEstado || c.estado === filtroEstado
      return coincideBusqueda && coincideEstado
    })
  }, [clientes, busqueda, filtroEstado, verArchivados])

  const { pageItems, ...pag } = usePagination(filtrados)

  return (
    <>
      {/* Filtros */}
      <div className="filters-bar">
        <div className="search-wrapper">
          <Search />
          <input
            type="search" className="search-input"
            placeholder="Buscar por empresa, email o ID…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
        </div>

        <select className="filter-select" value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="ACTIVO">Activo</option>
          <option value="TRIAL">Trial</option>
          <option value="GRACIA">Período especial</option>
          <option value="DESACTIVADO">Suspendido</option>
          <option value="VENCIDO">Vencido</option>
        </select>

        <button className="btn btn-secondary" onClick={() => exportCSV(filtrados)}>
          <Download size={14} />
          Exportar CSV
        </button>

        {nArchivados > 0 && (
          <label className="checkbox-group">
            <input type="checkbox" checked={verArchivados} onChange={e => setVerArchivados(e.target.checked)} />
            <span className="checkbox-label">Ver archivados ({nArchivados})</span>
          </label>
        )}
      </div>

      {filtrados.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <User size={40} strokeWidth={1.5} />
            <p>No se encontraron clientes con los filtros aplicados.</p>
          </div>
        </div>
      ) : (
        <>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Email</th>
                <th>Suscripción</th>
                <th>Estado</th>
                <th>Expiración</th>
                <th className="col-center">Días</th>
                  <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(c => {
                const dias = calcDiasRestantes(c)
                return (
                  <tr key={c.client_id} className="table-row-clickable" onClick={() => router.push(`/admin/clientes/${c.client_id}`)}>
                    <td data-label="Empresa">
                      <Link
                        href={`/admin/clientes/${c.client_id}`}
                        className="table-empresa-link"
                        onClick={e => e.stopPropagation()}
                      >
                        {c.nombre_empresa}
                      </Link>
                      <div className="table-empresa-contact">{c.client_id}</div>
                    </td>
                    <td data-label="Email" className="table-muted">{c.email_admin}</td>
                    <td data-label="Suscripción" className="table-muted">
                      {suscripcionLabel(precioMensualEfectivo(c), c.ciclo_facturacion ?? 'mensual', descuentoAnualPct, monedaDelCliente(c))}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge badge-dot ${ESTADO_BADGE[c.estado] ?? 'badge-neutral'}`}>
                        {c.estado}
                      </span>
                      {c.es_prueba && <span className="badge badge-purple">Prueba</span>}
                      {esSocioHoy(c) && <span className="badge badge-indigo">Socio</span>}
                      {c.archivado_at && <span className="badge badge-neutral">Archivado</span>}
                    </td>
                    <td data-label="Expiración" className="table-muted">{formatFecha(fechaTope(c))}</td>
                    <td data-label="Días" className="col-center">
                      <span className="dias-value" style={{ color: DIAS_COLOR[dias.variant] }}>
                        {dias.label}
                      </span>
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => router.push(`/admin/clientes/${c.client_id}`)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                      </RowActions>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <TablePagination {...pag} label="cliente" />
        </>
      )}
    </>
  )
}
