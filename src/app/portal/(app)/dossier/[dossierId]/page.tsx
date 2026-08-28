import { notFound }              from 'next/navigation'
import { requireAccesoModulo }   from '@/app/actions/portal/auth'
import { obtenerDossier } from '@/app/actions/portal/dossier'
import DossierEditor      from '../DossierEditor'

export const dynamic = 'force-dynamic'

// Un dossier concreto. Es la ruta que abre el listado, y no lleva gate propio: con
// un tope de un dossier el cliente solo tiene el suyo, así que llegar aquí a mano no
// le enseña otra cosa. El gate está donde importa —crear y publicar—, no en mirar:
// quien es solo-ver entra y ve, pero el editor le esconde los controles de escritura.
export default async function DossierDetallePage({ params }: { params: Promise<{ dossierId: string }> }) {
  const { puedeEditar } = await requireAccesoModulo('dossier')
  const { dossierId } = await params

  // `obtenerDossier` filtra por client_id además del id: un dossier de otro tenant
  // no llega aquí como fuga, llega como null.
  const data = await obtenerDossier(dossierId)
  if (!data?.dossier) notFound()

  return <DossierEditor data={data} volver="/portal/dossier" puedeEditar={puedeEditar} />
}
