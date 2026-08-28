import { notFound, redirect }   from 'next/navigation'
import { requireAccesoModulo }   from '@/app/actions/portal/auth'
import { obtenerDossier, obtenerDossiers } from '@/app/actions/portal/dossier'
import { obtenerEmpresas }       from '@/app/actions/portal/empresas'
import { createAdminClient }     from '@/lib/supabase/admin'
import { cargarContextoLimites } from '@/lib/limites'
import DossierEditor             from './DossierEditor'
import DossierLista              from './DossierLista'
import CupoNivel                 from '@/components/portal/CupoNivel'

export const dynamic = 'force-dynamic'

// La home del módulo: listado o editor directo, según cuántos dossiers quepan.
//
// Antes esto lo decidía el addon `multidossier` (sin él, editor de uno solo). Ese
// addon ya no existe: cuántos caben lo dice el NIVEL, igual que las empresas o los
// productos. Con un tope de 1 no hay lista que enseñar y se va al editor; con más,
// la página es «Mis dossiers» con su botón de crear.
export default async function DossierPage() {
  const { session, puedeEditar } = await requireAccesoModulo('dossier')

  const db  = createAdminClient()
  const ctx = await cargarContextoLimites(db, session.client_id)

  if (ctx.limites.dossiers === 1) {
    const data = await obtenerDossier()
    if (!data) notFound()
    return <DossierEditor data={data} puedeEditar={puedeEditar} />
  }

  const [dossiers, empresas] = await Promise.all([obtenerDossiers(), obtenerEmpresas()])
  // Sin ninguno todavía (recién contratado y aún sin dossier): al wizard directo.
  // Una lista vacía con un botón es una pantalla de más para llegar al mismo sitio.
  // Solo si puede editar: a quien es «solo ver» /nuevo lo devolvería aquí (redirect),
  // y el par de redirecciones se convierte en un bucle. Ve la lista vacía y ya está.
  if (dossiers.length === 0 && puedeEditar) redirect('/portal/dossier/nuevo')

  return (
    <DossierLista
      dossiers={dossiers}
      empresas={empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre }))}
      puedeEditar={puedeEditar}
    >
      <CupoNivel dim="dossiers" />
    </DossierLista>
  )
}
