// ── Los presupuestos de este cliente ──
//
// El enlace ya existía en la BD (`presupuestos_instalacion.client_id`, que escribe el alta
// desde un presupuesto aprobado) pero solo iba en un sentido: del presupuesto a la ficha. Sin
// la vuelta no había forma de mirar lo cotizado contra lo que costó de verdad, ni de saber si
// un pago de configuración tenía horas detrás.

import Link from 'next/link'
import { FileText, Plus } from 'lucide-react'
import { listarPresupuestosDeCliente } from '@/app/actions/presupuestos'
import PresupuestosClienteTabla from './PresupuestosClienteTabla'

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
        <PresupuestosClienteTabla presupuestos={presupuestos} />
      )}
    </div>
  )
}
