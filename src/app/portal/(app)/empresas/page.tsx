import { redirect }          from 'next/navigation'
import { getPortalSession }  from '@/app/actions/portal/auth'
import { obtenerEmpresas }   from '@/app/actions/portal/empresas'
import { createAdminClient } from '@/lib/supabase/admin'
import EmpresasGrid          from './EmpresasGrid'

export const dynamic = 'force-dynamic'

export default async function EmpresasPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const db = createAdminClient()

  // Empresas y monedas en paralelo
  const [empresas, { data: monedas }, { data: clienteData }] = await Promise.all([
    obtenerEmpresas(),
    db.from('monedas').select('codigo, nombre, simbolo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    db.from('clients').select('plan_id').eq('client_id', session.client_id).single(),
  ])

  // Límite del plan
  let maxEmpresas: number | null = null
  if (clienteData?.plan_id) {
    const { data: plan } = await db
      .from('plans')
      .select('max_empresas')
      .eq('plan_id', clienteData.plan_id)
      .single()
    maxEmpresas = plan?.max_empresas ?? null
  }

  return (
    <EmpresasGrid
      empresas={empresas}
      monedas={(monedas ?? []) as { codigo: string; nombre: string; simbolo: string }[]}
      maxEmpresas={maxEmpresas}
      esAdmin={session.rol === 'admin_empresa'}
    />
  )
}
