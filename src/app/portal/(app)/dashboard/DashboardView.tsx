import { Calendar, CalendarDays } from 'lucide-react'
import type { DashboardData } from '@/app/actions/portal/dashboard'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { fechaLarga } from './format'
import ContabilidadWidget from './ContabilidadWidget'
import InventarioWidget from './InventarioWidget'
import RrhhWidget from './RrhhWidget'
import AgendaWidget from './AgendaWidget'
import AccesosRapidos from './AccesosRapidos'
import ContratarMasBanner from './ContratarMasBanner'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-error', VENCIDO: 'badge-error',
}

export default function DashboardView({ data }: { data: DashboardData }) {
  const { contabilidad, inventario, rrhh, reservas, citas, etiquetas, suscripcion, nombreEmpresa, empresas, fecha, accesos } = data
  const hayPaneles = Boolean(contabilidad || inventario || rrhh || reservas || citas)

  // Una sola empresa → su color tiñe el acento del encabezado (identidad).
  const empresaUnica = empresas.length === 1 ? empresas[0] : null

  const dias = suscripcion.diasRestantes
  const subSuscripcion = dias !== null && dias >= 0 ? ` · ${dias} d` : ''

  return (
    <div className="view-container">
      <div className="page-header">
        <div
          className={empresaUnica ? 'dash-identidad' : undefined}
          style={empresaUnica ? empresaColorVar(empresaUnica.color) : undefined}
        >
          <div className="page-title-ia">
            <h1 className="page-title">Hola, {nombreEmpresa}</h1>
            <IaTouchpoint tipo="general" descripcion="un análisis general de tu negocio" />
          </div>
          <p className="page-subtitle">{fechaLarga(fecha)}</p>
          {empresas.length > 1 && (
            <div className="dash-empresas-legend">
              {empresas.map(e => (
                <EmpresaTag key={e.empresa_id} color={e.color} nombre={e.nombre} />
              ))}
            </div>
          )}
        </div>
        <span className={`badge badge-dot ${ESTADO_BADGE[suscripcion.estado] ?? 'badge-neutral'}`}>
          {suscripcion.estado}{subSuscripcion}
        </span>
      </div>

      <div className="dash-grid">
        {contabilidad && <ContabilidadWidget data={contabilidad} />}
        {reservas && (
          <AgendaWidget
            data={reservas} titulo={etiquetas.reservas} ruta="/portal/reservas"
            unidad="reserva" mostrarPersonas
            icon={<Calendar size={18} />} tone="metric-icon-primary"
          />
        )}
        {citas && (
          <AgendaWidget
            data={citas} titulo="Citas" ruta="/portal/citas"
            unidad="cita" mostrarPersonas={false}
            icon={<CalendarDays size={18} />} tone="metric-icon-teal"
          />
        )}
        {inventario && <InventarioWidget data={inventario} />}
        {rrhh && <RrhhWidget data={rrhh} />}
        {!hayPaneles && <AccesosRapidos accesos={accesos} />}
        {!hayPaneles && <ContratarMasBanner />}
      </div>
    </div>
  )
}
