import { notFound, redirect }   from 'next/navigation'
import { requireModulo }         from '@/app/actions/portal/auth'
import { obtenerDossier, obtenerDossiers } from '@/app/actions/portal/dossier'
import { obtenerEmpresas }       from '@/app/actions/portal/empresas'
import { createAdminClient }     from '@/lib/supabase/admin'
import { tieneModulo }           from '@/lib/modulos'
import DossierEditor             from './DossierEditor'
import DossierLista              from './DossierLista'

export const dynamic = 'force-dynamic'

// La home del módulo depende del addon `multidossier`:
//   · sin él  → el editor del único dossier, exactamente como antes de que el addon
//               existiera. Quien no lo ha contratado no paga ni un clic de más.
//   · con él  → el listado. Y ese ES el modo de que el dueño se dé cuenta de lo que
//               ha contratado: la página deja de ser un editor y pasa a ser «Mis
//               dossiers» con un botón de crear. No hace falta anunciarlo aparte.
//
// El addon no añade una ruta al sidebar (`paginas` vacío en el catálogo): la ruta
// la sigue aportando la funcionalidad `dossier`, y este archivo bifurca.
export default async function DossierPage() {
  const session = await requireModulo('dossier')

  const db = createAdminClient()
  const { data: cliente } = await db.from('clients').select('modulos_activos')
    .eq('client_id', session.client_id).maybeSingle()

  if (!tieneModulo(cliente?.modulos_activos, 'multidossier')) {
    const data = await obtenerDossier()
    if (!data) notFound()
    return <DossierEditor data={data} />
  }

  const [dossiers, empresas] = await Promise.all([obtenerDossiers(), obtenerEmpresas()])
  // Sin ninguno todavía (recién contratado y aún sin dossier): al wizard directo.
  // Una lista vacía con un botón es una pantalla de más para llegar al mismo sitio.
  if (dossiers.length === 0) redirect('/portal/dossier/nuevo')

  return (
    <DossierLista
      dossiers={dossiers}
      empresas={empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre }))}
    />
  )
}
