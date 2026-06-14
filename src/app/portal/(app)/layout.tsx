import { redirect }       from 'next/navigation'
import { getPortalSession } from '@/app/actions/portal/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting }        from '@/app/actions/settings'
import { suscripcionLabel }  from '@/lib/billing'
import PortalHeader          from '@/components/portal/PortalHeader'
import PortalSidebar         from '@/components/portal/PortalSidebar'
import BloqueadoScreen       from '@/components/portal/BloqueadoScreen'
import PortalRealtimeSync    from '@/components/portal/PortalRealtimeSync'

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const db = createAdminClient()

  const { data: cliente } = await db
    .from('clients')
    .select('nombre_empresa, estado, modulos_activos, tarifa, precio_mensual_usd, ciclo_facturacion, fecha_expiracion, fecha_fin_gracia')
    .eq('client_id', session.client_id)
    .single()

  if (!cliente) redirect('/portal/login')

  // Módulos activos leídos del cliente (modelo à la carte).
  // 'base' siempre está activo — lo garantizamos aquí para que el sidebar
  // no dependa de que el campo esté bien rellenado en cada fila.
  const modulosActivos: string[] = Array.isArray(cliente.modulos_activos) && cliente.modulos_activos.length > 0
    ? (cliente.modulos_activos.includes('base') ? cliente.modulos_activos : ['base', ...cliente.modulos_activos])
    : ['base']

  // Etiqueta de suscripción para el header (importe real según el ciclo)
  const precioMes   = Number(cliente.precio_mensual_usd ?? 0)
  const descuento   = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const suscripcion = suscripcionLabel(precioMes, cliente.ciclo_facturacion ?? 'mensual', descuento)

  // Bloqueo basado en estado Y en fecha, sin depender de expiración automática:
  // · SUSPENDIDO → siempre bloqueado (nunca han pagado o el admin los suspendió)
  // · VENCIDO    → siempre bloqueado (estado legado; ya no se genera automáticamente)
  // · Fecha expirada → bloqueado, salvo que estén en GRACIA con fecha_fin_gracia vigente
  const hoy = new Date().toISOString().split('T')[0]
  const enGraciaActiva =
    cliente.estado === 'GRACIA' &&
    !!cliente.fecha_fin_gracia &&
    cliente.fecha_fin_gracia.split('T')[0] >= hoy
  const expiradoPorFecha =
    !!cliente.fecha_expiracion &&
    cliente.fecha_expiracion.split('T')[0] < hoy
  const bloqueado =
    cliente.estado === 'SUSPENDIDO' ||
    cliente.estado === 'VENCIDO' ||
    (expiradoPorFecha && !enGraciaActiva)

  return (
    <div className="portal-shell">
      <PortalRealtimeSync clientId={session.client_id} />
      <PortalHeader
        session={session}
        nombreEmpresa={cliente.nombre_empresa}
        estado={cliente.estado}
        suscripcion={suscripcion}
      />
      <PortalSidebar
        rol={session.rol}
        modulosActivos={modulosActivos}
      />
      <main className="portal-main">
        {bloqueado
          ? <BloqueadoScreen estado={cliente.estado} />
          : children}
      </main>
    </div>
  )
}
