import type { DashboardData } from '@/app/actions/portal/dashboard'
import { fechaLarga } from './format'
import ContabilidadWidget from './ContabilidadWidget'
import InventarioWidget from './InventarioWidget'
import RrhhWidget from './RrhhWidget'
import AgendaWidget from './AgendaWidget'
import AccesosRapidos from './AccesosRapidos'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-error', VENCIDO: 'badge-error',
}

export default function DashboardView({ data }: { data: DashboardData }) {
  const { contabilidad, inventario, rrhh, reservas, citas, etiquetas, suscripcion, nombreEmpresa, fecha, accesos } = data
  const hayPaneles = Boolean(contabilidad || inventario || rrhh || reservas || citas)

  const dias = suscripcion.diasRestantes
  const subSuscripcion = dias !== null && dias >= 0 ? ` · ${dias} d` : ''

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Hola, {nombreEmpresa}</h1>
          <p className="page-subtitle">{fechaLarga(fecha)}</p>
        </div>
        <span className={`badge badge-dot ${ESTADO_BADGE[suscripcion.estado] ?? 'badge-neutral'}`}>
          {suscripcion.estado}{subSuscripcion}
        </span>
      </div>

      <div className="dash-grid">
        {contabilidad && <ContabilidadWidget data={contabilidad} />}
        {reservas && (
          <AgendaWidget data={reservas} titulo={etiquetas.reservas} ruta="/portal/reservas" unidad="reserva" mostrarPersonas />
        )}
        {citas && (
          <AgendaWidget data={citas} titulo="Citas" ruta="/portal/citas" unidad="cita" mostrarPersonas={false} />
        )}
        {inventario && <InventarioWidget data={inventario} />}
        {rrhh && <RrhhWidget data={rrhh} />}
        {!hayPaneles && <AccesosRapidos accesos={accesos} />}
      </div>
    </div>
  )
}
