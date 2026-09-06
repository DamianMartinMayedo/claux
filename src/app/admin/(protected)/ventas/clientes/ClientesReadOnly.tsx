'use client'

import { Users } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { suscripcionLabel, precioMensualEfectivo, monedaDelCliente, type CondicionesCliente } from '@/lib/billing'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import { claveOrdenImporte } from '@/lib/moneda-claux'
import Filtros from '@/components/portal/Filtros'
import VentasTabs from '@/components/admin/VentasTabs'
import type { RolAdmin, SeccionKey } from '@/lib/roles'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-warning', VENCIDO: 'badge-error',
}

export type ClienteRO = CondicionesCliente & {
  client_id: string
  nombre_empresa: string
  nombre_contacto: string | null
  email_admin: string
  estado: string
  ciclo_facturacion: string | null
  es_prueba: boolean | null
}

const COLUMNAS: ColumnasOrden<ClienteRO> = {
  empresa:  { label: 'Empresa',  valor: c => c.nombre_empresa },
  contacto: { label: 'Contacto', valor: c => c.nombre_contacto },
  email:    { label: 'Email',    valor: c => c.email_admin },
  // El importe con su moneda delante: la lista mezcla dólares y euros.
  suscripcion: { label: 'Suscripción', valor: c => claveOrdenImporte(precioMensualEfectivo(c), monedaDelCliente(c)) },
  estado:   { label: 'Estado',   valor: c => c.estado },
}

export default function ClientesReadOnly({
  clientes,
  descuentoAnualPct,
  rol,
  permisos,
}: {
  clientes: ClienteRO[]
  descuentoAnualPct: number
  rol: RolAdmin
  permisos: SeccionKey[]
}) {
  // La búsqueda vive en la URL, como en el resto de listados: en `useState` no
  // sobrevivía a un refresco —ni a que se caiga la conexión, que en Cuba es lo
  // normal— y no se podía enlazar.
  const busqueda = useSearchParams().get('q') ?? ''

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase()
    if (!q) return clientes
    return clientes.filter(c =>
      c.nombre_empresa.toLowerCase().includes(q) ||
      c.email_admin.toLowerCase().includes(q) ||
      c.client_id.toLowerCase().includes(q) ||
      (c.nombre_contacto ?? '').toLowerCase().includes(q),
    )
  }, [clientes, busqueda])

  const orden = useOrden(filtrados, COLUMNAS, { clave: 'empresa', dir: 'asc' })
  const { pageItems, ...pag } = usePagination(orden.filas)

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">{clientes.length} en total · vista de solo lectura.</p>
        </div>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />

      {/* Sin filtros declarados: aquí solo se busca. La barra es la misma del
          sistema para que el buscador se comporte igual que en todas partes. */}
      <Filtros filtros={[]} q={busqueda} placeholder="Buscar por empresa, contacto, email o ID…" />

      {filtrados.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <Users size={40} strokeWidth={1.5} />
            <p>No se encontraron clientes.</p>
          </div>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <ThOrden orden={orden} clave="empresa" />
                  <ThOrden orden={orden} clave="contacto" />
                  <ThOrden orden={orden} clave="email" />
                  <ThOrden orden={orden} clave="suscripcion" />
                  <ThOrden orden={orden} clave="estado" />
                </tr>
              </thead>
              <tbody>
                {pageItems.map(c => (
                  <tr key={c.client_id}>
                    <td data-label="Empresa">
                      <div className="table-empresa">{c.nombre_empresa}</div>
                      <div className="table-empresa-contact">{c.client_id}</div>
                    </td>
                    <td data-label="Contacto" className="table-muted">{c.nombre_contacto || '—'}</td>
                    <td data-label="Email" className="table-muted">{c.email_admin}</td>
                    <td data-label="Suscripción" className="table-muted">
                      {suscripcionLabel(precioMensualEfectivo(c), c.ciclo_facturacion ?? 'mensual', descuentoAnualPct, monedaDelCliente(c))}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge badge-dot ${ESTADO_BADGE[c.estado] ?? 'badge-neutral'}`}>
                        {c.estado}
                      </span>
                      {c.es_prueba && <span className="badge badge-purple">Prueba</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} label="cliente" />
        </div>
      )}
    </div>
  )
}
