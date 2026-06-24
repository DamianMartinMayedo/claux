import { redirect }       from 'next/navigation'
import { getPortalSession } from '@/app/actions/portal/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import PortalHeader          from '@/components/portal/PortalHeader'
import PortalSidebar, { type CatalogoItem } from '@/components/portal/PortalSidebar'
import BloqueadoScreen       from '@/components/portal/BloqueadoScreen'
import PortalRealtimeSync    from '@/components/portal/PortalRealtimeSync'
import PortalToastWrapper     from '@/components/portal/PortalToastWrapper'

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const db = createAdminClient()

  const [{ data: cliente }, { data: catalogo }] = await Promise.all([
    db
      .from('clients')
      .select('nombre_empresa, estado, modulos_activos, tarifa, precio_mensual_usd, ciclo_facturacion, fecha_expiracion, fecha_fin_gracia')
      .eq('client_id', session.client_id)
      .single(),
    db
      .from('modulos_catalogo')
      .select('clave, nombre, tipo, paginas, orden')
      .eq('activo', true)
      .order('orden'),
  ])

  if (!cliente) redirect('/portal/login')

  // Módulos activos leídos del cliente (modelo à la carte). La contabilidad
  // 'base' es un módulo más: si el cliente no la contrató, no aparece activa.
  const modulosActivos: string[] = Array.isArray(cliente.modulos_activos)
    ? (cliente.modulos_activos as string[])
    : []

  // Bloqueo basado en estado Y en fecha, sin depender de expiración automática:
  // · DESACTIVADO → siempre bloqueado (nunca han pagado o el admin los desactivó)
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
    cliente.estado === 'DESACTIVADO' ||
    cliente.estado === 'VENCIDO' ||
    (expiradoPorFecha && !enGraciaActiva)

  return (
    <div className="portal-shell">
      <PortalRealtimeSync clientId={session.client_id} />
      <PortalHeader
        session={session}
        nombreEmpresa={cliente.nombre_empresa}
      />
      <PortalSidebar
        modulosActivos={modulosActivos}
        catalogo={(catalogo ?? []) as CatalogoItem[]}
      />
      <main className="portal-main">
        <PortalToastWrapper>
        {bloqueado
          ? <BloqueadoScreen estado={cliente.estado} />
          : children}
        </PortalToastWrapper>
      </main>
    </div>
  )
}
