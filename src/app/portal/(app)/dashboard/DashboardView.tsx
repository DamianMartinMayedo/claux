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
import DossierWidget   from './DossierWidget'
import AgendaWidget from './AgendaWidget'
import AccesosRapidos from './AccesosRapidos'
import ContratarMasBanner from './ContratarMasBanner'
import PendienteFranja from './PendienteFranja'
import DeudasWidget from './DeudasWidget'
import TasasWidget  from './TasasWidget'
import CatalogoWidget from './CatalogoWidget'
import Zona, { type TarjetaZona } from './Zona'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-error', VENCIDO: 'badge-error',
}

export default function DashboardView({ data }: { data: DashboardData }) {
  const { contabilidad, deudas, tasas, inventario, puntoVenta, rrhh, servicios, dossier, catalogo, reservas, citas, etiquetas, suscripcion, nombreEmpresa, empresas, setupPendiente, fecha, accesos, pendiente, captacion } = data
  const hayPaneles = Boolean(contabilidad || inventario || puntoVenta || rrhh || servicios || dossier || catalogo || reservas || citas)

  // ── Zonas ──────────────────────────────────────────────────────────────────
  // Cada widget declara dónde vive y cuánto pesa; el ancho lo reparte la zona
  // (ver Zona.tsx). Añadir un módulo es añadir una línea a la zona que le toca,
  // no otra tarjeta al final de una lista de ocho.
  //
  // COLOR DEL ICONO: seis familias (`metric-icon-*` en 03-components.css) y la
  // regla es no repetir DENTRO de una zona, que es lo que se ve de un vistazo.
  // Antes siete de las once tarjetas eran el mismo teal —cuatro de ellas en dos
  // pálidos casi iguales— y el color dejaba de decir nada. El reparto:
  //   Tu dinero  → Contabilidad teal · Cobros y pagos rosa · Tasas ámbar
  //   Tu día     → Reservas indigo · Citas violeta · Punto de venta verde
  //   Tu negocio → Inventario ámbar · Personal verde · Servicios teal ·
  //                Dossier violeta · Catálogo indigo
  // El teal se reserva para el dinero y lo que lo genera (contabilidad y los
  // acuerdos de servicios), y el ámbar —que es el único, y es el de aviso— para
  // lo que se mueve solo y hay que vigilar (existencias y tasas de cambio).
  // Fila 1: contabilidad a todo lo ancho. Fila 2: las deudas (lo que hay que
  // cobrar y pagar) con las tasas al lado, que son las que convierten sus cifras.
  const zonaDinero: TarjetaZona[] = []
  if (contabilidad) zonaDinero.push({ clave: 'contabilidad', peso: 'principal', ancho: 'full', nodo: <ContabilidadWidget data={contabilidad} /> })
  if (deudas)       zonaDinero.push({ clave: 'deudas',       peso: 'operativo', nodo: <DeudasWidget data={deudas} /> })
  if (tasas)        zonaDinero.push({ clave: 'tasas',        peso: 'estado',    nodo: <TasasWidget data={tasas} /> })

  const zonaDia: TarjetaZona[] = []
  if (reservas) zonaDia.push({
    clave: 'reservas', peso: 'operativo',
    nodo: (
      <AgendaWidget
        data={reservas} titulo={etiquetas.reservas} ruta="/portal/reservas"
        unidad="reserva" mostrarPersonas
        icon={<Calendar size={18} />} tone="metric-icon-indigo"
      />
    ),
  })
  if (citas) zonaDia.push({
    clave: 'citas', peso: 'operativo',
    nodo: (
      <AgendaWidget
        data={citas} titulo="Citas" ruta="/portal/citas"
        unidad="cita" mostrarPersonas={false}
        icon={<CalendarDays size={18} />} tone="metric-icon-purple"
      />
    ),
  })
  if (puntoVenta) zonaDia.push({ clave: 'punto-venta', peso: 'operativo', nodo: <PuntoVentaWidget data={puntoVenta} /> })

  const zonaNegocio: TarjetaZona[] = []
  if (inventario) zonaNegocio.push({ clave: 'inventario', peso: 'estado', nodo: <InventarioWidget data={inventario} /> })
  if (rrhh)       zonaNegocio.push({ clave: 'rrhh',       peso: 'estado', nodo: <RrhhWidget data={rrhh} /> })
  if (servicios)  zonaNegocio.push({ clave: 'servicios',  peso: 'estado', nodo: <ServiciosWidget data={servicios} /> })
  if (dossier)    zonaNegocio.push({ clave: 'dossier',    peso: 'estado', nodo: <DossierWidget data={dossier} /> })
  if (catalogo)   zonaNegocio.push({ clave: 'catalogo',   peso: 'estado', nodo: <CatalogoWidget data={catalogo} etiqueta={etiquetas.catalogo} /> })

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

      <div className="dash-zonas">
        <PendienteFranja items={pendiente} />
        <Zona titulo="Tu dinero"  tarjetas={zonaDinero} />
        <Zona titulo="Tu día"     tarjetas={zonaDia} />
        <Zona titulo="Tu negocio" tarjetas={zonaNegocio} />
        {/* Los accesos rápidos solo tienen sentido cuando NO hay ningún panel:
            con widgets delante, repetir el enlace del menú lateral es ruido. */}
        {!hayPaneles && <AccesosRapidos accesos={accesos} />}
        {/* Destacado con ≤2 módulos CON PANEL; con más, una línea al pie. */}
        <ContratarMasBanner
          faltan={captacion.faltan}
          destacado={captacion.conPanel <= 2}
          email={captacion.email}
        />
      </div>
    </div>
  )
}
