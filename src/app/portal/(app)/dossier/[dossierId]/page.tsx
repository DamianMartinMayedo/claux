import { notFound }              from 'next/navigation'
import { requireAccesoModulo }   from '@/app/actions/portal/auth'
import { obtenerDossier } from '@/app/actions/portal/dossier'
import DossierEditor      from '../DossierEditor'

export const dynamic = 'force-dynamic'

// Un dossier concreto. Es la ruta del addon `multidossier`, pero no lleva gate
// propio: sin el addon el cliente tiene un solo dossier, así que llegar aquí a mano
// solo le enseña el suyo. El gate está donde importa —crear y publicar—, no en mirar:
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
