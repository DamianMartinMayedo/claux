import { redirect }       from 'next/navigation'
import { getPortalSession } from '@/app/actions/portal/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import PortalHeader          from '@/components/portal/PortalHeader'
import PortalSidebar         from '@/components/portal/PortalSidebar'
import BloqueadoScreen       from '@/components/portal/BloqueadoScreen'

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const db = createAdminClient()

  const { data: cliente } = await db
    .from('clients')
    .select('nombre_empresa, estado, modulos_activos, tarifa, precio_mensual_usd, ciclo_facturacion')
    .eq('client_id', session.client_id)
    .single()

  if (!cliente) redirect('/portal/login')

  // Módulos activos leídos del cliente (modelo à la carte).
  // 'base' siempre está activo — lo garantizamos aquí para que el sidebar
  // no dependa de que el campo esté bien rellenado en cada fila.
  const modulosActivos: string[] = Array.isArray(cliente.modulos_activos) && cliente.modulos_activos.length > 0
    ? (cliente.modulos_activos.includes('base') ? cliente.modulos_activos : ['base', ...cliente.modulos_activos])
    : ['base']

  // Etiqueta de suscripción para el header (precio mensual + ciclo)
  const precioMes  = Number(cliente.precio_mensual_usd ?? 0)
  const suscripcion = `$${precioMes.toFixed(2)}/mes${cliente.ciclo_facturacion === 'anual' ? ' · anual' : ''}`

  const bloqueado = ['SUSPENDIDO', 'VENCIDO'].includes(cliente.estado)

  return (
    <div className="portal-shell">
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
