import { notFound }        from 'next/navigation'
import { requireModulo }   from '@/app/actions/portal/auth'
import { obtenerDossier }  from '@/app/actions/portal/dossier'
import DossierEditor        from './DossierEditor'

export const dynamic = 'force-dynamic'

export default async function DossierPage() {
  await requireModulo('dossier')
  const data = await obtenerDossier()
  if (!data) notFound()
  return <DossierEditor data={data} />
}
