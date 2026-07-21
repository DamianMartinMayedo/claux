import { Calendar, CalendarDays } from 'lucide-react'
import type { DashboardData } from '@/app/actions/portal/dashboard'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
// En pausa (no convence de momento): checklist de onboarding ('./OnboardingChecklist').
import { EmpresaTag } from '@/components/portal/EmpresaTag'
import { fechaLarga } from './format'
import ContabilidadWidget from './ContabilidadWidget'
import InventarioWidget from './InventarioWidget'
import PuntoVentaWidget from './PuntoVentaWidget'
import RrhhWidget from './RrhhWidget'
import ServiciosWidget from './ServiciosWidget'
import AgendaWidget from './AgendaWidget'
import AccesosRapidos from './AccesosRapidos'
import ContratarMasBanner from './ContratarMasBanner'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-error', VENCIDO: 'badge-error',
}

export default function DashboardView({ data }: { data: DashboardData }) {
  const { contabilidad, inventario, puntoVenta, rrhh, servicios, reservas, citas, etiquetas, suscripcion, nombreEmpresa, empresas, setupPendiente, fecha, accesos } = data
  const hayPaneles = Boolean(contabilidad || inventario || puntoVenta || rrhh || servicios || reservas || citas)

  const dias = suscripcion.diasRestantes
  const subSuscripcion = dias !== null && dias >= 0 ? ` · ${dias} d` : ''

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Hola, {nombreEmpresa}</h1>
            <IaTouchpoint tipo="general" descripcion="un análisis general de tu negocio" />
          </div>
          <p className="page-subtitle">{fechaLarga(fecha)}</p>
          {/* La lista sale SIEMPRE, también con una sola empresa. Antes, con una, el
              encabezado llevaba un borde de su color y nada más: una raya de color no
              dice de qué empresa es, y el «Hola, X» del título es el nombre de la
              CUENTA, no el de la empresa. Mismo bloque para todos, y al añadir la
              segunda empresa no cambia la interfaz de sitio. */}
          {empresas.length > 0 && (
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

      {(setupPendiente.empresa || setupPendiente.moneda) && (
        <PrerequisitoAviso acciones={[
          ...(setupPendiente.empresa ? [{ label: 'Crear empresa', href: '/portal/empresas' }] : []),
          ...(setupPendiente.moneda  ? [{ label: 'Configurar moneda', href: '/portal/monedas' }] : []),
        ]}>
          {setupPendiente.empresa && setupPendiente.moneda
            ? <>Para empezar a operar, crea <strong>tu empresa</strong> y configura <strong>una moneda</strong>.</>
            : setupPendiente.empresa
              ? <>Para empezar a operar necesitas <strong>una empresa</strong>.</>
              : <>Configura <strong>una moneda</strong> para registrar importes, ventas y cobros.</>}
        </PrerequisitoAviso>
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
        {puntoVenta && <PuntoVentaWidget data={puntoVenta} />}
        {inventario && <InventarioWidget data={inventario} />}
        {rrhh && <RrhhWidget data={rrhh} />}
        {servicios && <ServiciosWidget data={servicios} />}
        {!hayPaneles && <AccesosRapidos accesos={accesos} />}
        {!hayPaneles && <ContratarMasBanner />}
      </div>
    </div>
  )
}
