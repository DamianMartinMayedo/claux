// ── Los presupuestos de este cliente ──
//
// El enlace ya existía en la BD (`presupuestos_instalacion.client_id`, que escribe el alta
// desde un presupuesto aprobado) pero solo iba en un sentido: del presupuesto a la ficha. Sin
// la vuelta no había forma de mirar lo cotizado contra lo que costó de verdad, ni de saber si
// un pago de configuración tenía horas detrás.

import Link from 'next/link'
import { FileText, Plus } from 'lucide-react'
import { listarPresupuestosDeCliente } from '@/app/actions/presupuestos'

const usd = (n: number) => `$${Number(n ?? 0).toFixed(2)}`

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

function EstadoBadge({ estado }: { estado: string }) {
  if (estado === 'aprobado')  return <span className="badge badge-success">Aprobado</span>
  if (estado === 'instalado') return <span className="badge badge-purple">Instalado</span>
  return <span className="badge badge-info">Guardado</span>
}

export default async function PresupuestosClienteCard({
  clientId,
  nombreEmpresa,
  /** Hay un pago de configuración registrado para este cliente. */
  tienePagoConfiguracion,
}: {
  clientId: string
  nombreEmpresa: string
  tienePagoConfiguracion: boolean
}) {
  const presupuestos = await listarPresupuestosDeCliente(clientId)

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Presupuestos</h2>
        {/* La entrada que faltaba: un cliente que amplía módulos medio año después necesita
            configuración y migración nuevas, y hasta ahora eso no se podía presupuestar. */}
        <Link
          href={`/admin/presupuestos/nuevo?cliente=${encodeURIComponent(clientId)}`}
          className="btn btn-secondary btn-sm"
        >
          <Plus size={14} strokeWidth={2.5} /> Nuevo presupuesto
        </Link>
      </div>

      {presupuestos.length === 0 ? (
        <div className="table-empty table-empty-sm">
          <FileText size={36} strokeWidth={1.5} />
          <p>
            {tienePagoConfiguracion
              /* Un cobro de instalación sin presupuesto detrás no se puede contrastar con
                 horas reales. No es un error —el alta manual es legítima— pero se dice. */
              ? `${nombreEmpresa} tiene un pago de configuración sin presupuesto detrás: no hay horas cotizadas con las que compararlo.`
              : 'Sin presupuestos. Crea uno para cotizar una instalación o una ampliación.'}
          </p>
        </div>
      ) : (
        <div className="table-wrapper table-wrapper-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estado</th>
                <th className="col-num">Horas</th>
                <th className="col-num">Reales</th>
                <th className="col-num">Instalación</th>
              </tr>
            </thead>
            <tbody>
              {presupuestos.map(p => {
                const reales = p.horas_reales
                // La comparación es el punto de la tarjeta: si las reales se pasan de las
                // cotizadas, esa instalación costó más de lo que se cobró.
                const seExcedio = reales != null && reales > p.horas_total
                return (
                  <tr key={p.id}>
                    <td data-label="Fecha" className="table-muted">{fmtFecha(p.created_at)}</td>
                    <td data-label="Estado"><EstadoBadge estado={p.estado} /></td>
                    <td data-label="Horas" className="col-num">{p.horas_total}h</td>
                    <td data-label="Reales" className="col-num">
                      {reales == null
                        ? <span className="text-xs-muted">—</span>
                        : <span className={seExcedio ? 'pres-horas-exceso' : undefined}>{reales}h</span>}
                    </td>
                    <td data-label="Instalación" className="col-num table-price">
                      {usd(p.total_final_usd ?? p.coste_instalacion_usd)}
                      {Number(p.descuento_pct) > 0 && (
                        <span className="text-xs-muted"> · −{Number(p.descuento_pct)}%</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
