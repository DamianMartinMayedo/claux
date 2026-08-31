import { redirect }               from 'next/navigation'
import { getPortalSession }        from '@/app/actions/portal/auth'
import { puedeEditarAlgunModulo }  from '@/app/actions/portal/auth'
import { obtenerEmpresas }         from '@/app/actions/portal/empresas'
import { createAdminClient }        from '@/lib/supabase/admin'
import { ADAPTADORES }              from '@/lib/importador/adaptadores'
import ImportarPrerequisitos        from '@/components/portal/ImportarPrerequisitos'
import ImportarWizard              from './ImportarWizard'

export const dynamic = 'force-dynamic'

// Herramienta interna del equipo: SOLO en modo configuración (impersonación).
// No se declara en el sidebar; se entra desde el banner de impersonación.
export default async function ImportarPage() {
  const session = await getPortalSession()
  if (!session)      redirect('/portal/login')
  if (!session.imp)  redirect('/portal/dashboard')

  const [empresas, monedas, entidadesPermitidas] = await Promise.all([
    obtenerEmpresas(),
    createAdminClient().from('monedas').select('moneda_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id).eq('activa', true),
    Promise.all(Object.entries(ADAPTADORES).map(async ([entidad, adaptador]) =>
      (await puedeEditarAlgunModulo(adaptador.modulos)) ? entidad : null,
    )).then(xs => xs.filter((x): x is string => x !== null)),
  ])
  const faltanPrerequisitos = empresas.length === 0 || !monedas.count

  return <>
    <ImportarPrerequisitos empresa={empresas.length === 0} moneda={!monedas.count} />
    {!faltanPrerequisitos && <ImportarWizard entidadesPermitidas={entidadesPermitidas} />}
  </>
}
