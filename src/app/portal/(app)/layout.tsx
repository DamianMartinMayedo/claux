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
    .select('nombre_empresa, estado, plan_id')
    .eq('client_id', session.client_id)
    .single()

  if (!cliente) redirect('/portal/login')

  // Obtener módulos del plan
  let planNombre     = ''
  let modulosActivos: string[] = []

  if (cliente.plan_id) {
    const { data: plan } = await db
      .from('plans')
      .select('nombre, modulos')
      .eq('plan_id', cliente.plan_id)
      .single()
    if (plan) {
      planNombre     = plan.nombre ?? ''
      modulosActivos = Array.isArray(plan.modulos) ? plan.modulos : []
    }
  }

  const bloqueado = ['SUSPENDIDO', 'VENCIDO'].includes(cliente.estado)

  return (
    <div className="portal-shell">
      <PortalHeader
        session={session}
        nombreEmpresa={cliente.nombre_empresa}
        estado={cliente.estado}
        planNombre={planNombre}
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
