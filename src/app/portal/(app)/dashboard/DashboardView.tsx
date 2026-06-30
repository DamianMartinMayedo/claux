import { Calendar, CalendarDays } from 'lucide-react'
import type { DashboardData } from '@/app/actions/portal/dashboard'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { fechaLarga } from './format'
import ContabilidadWidget from './ContabilidadWidget'
import InventarioWidget from './InventarioWidget'
import RrhhWidget from './RrhhWidget'
import AgendaWidget from './AgendaWidget'
import AccesosRapidos from './AccesosRapidos'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-error', VENCIDO: 'badge-error',
}

export default function DashboardView({ data }: { data: DashboardData }) {
  const { contabilidad, inventario, rrhh, reservas, citas, etiquetas, suscripcion, nombreEmpresa, empresas, fecha, accesos, tieneIa } = data
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
          <h1 className="page-title">Hola, {nombreEmpresa}</h1>
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

      {/* Puntos de entrada de IA (addon). El gating real está en la server action. */}
      {tieneIa && (
        <div className="dash-ia-row">
          <IaTouchpoint tipo="general" label="Análisis del negocio"
            tip="La IA resume cómo va tu negocio y te sugiere acciones." />
          {contabilidad && <>
            <IaTouchpoint tipo="ventas" label="Análisis de ventas"
              tip="La IA analiza la evolución de tus ventas y la tendencia." />
            <IaTouchpoint tipo="gastos" label="Análisis de gastos"
              tip="La IA revisa tus gastos y dónde podrías ahorrar." />
            <IaTouchpoint tipo="proyeccion" label="Proyección"
              tip="La IA proyecta tus ingresos del próximo mes según la tendencia." />
          </>}
        </div>
      )}

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
      </div>
    </div>
  )
}
