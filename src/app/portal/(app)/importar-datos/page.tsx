import { redirect }            from 'next/navigation'
import { getPortalSession }     from '@/app/actions/portal/auth'
import { obtenerEtiquetasNegocio } from '@/app/actions/portal/sector'
import { accesoImportCliente, etiquetaEntidadImport } from '@/lib/importador/acceso-cliente'
import { obtenerEmpresas } from '@/app/actions/portal/empresas'
import { createAdminClient } from '@/lib/supabase/admin'
import ImportarPrerequisitos from '@/components/portal/ImportarPrerequisitos'
import ImportarClienteWizard    from './ImportarClienteWizard'

export const dynamic = 'force-dynamic'

// Importador de AUTOSERVICIO: el cliente se importa SOLO. El del equipo es otro
// (/portal/importar) y no se toca. Regla única de visibilidad (plan §6, en
// `accesoImportCliente`): `autoimport_activo` ∧ el usuario puede importar algún
// módulo contratado ∧ `migracion_estado != 'a_cargo_equipo'`. No está en el sidebar;
// se entra desde el menú de cuenta y desde la guía de puesta en marcha, con esta
// MISMA condición.
//
// Impersonando SÍ se entra aquí. Antes se desviaba a /portal/importar, y eso dejaba
// esta pantalla sin ninguna forma de revisarla: el menú de cuenta y la guía la
// ofrecen impersonando (su regla no mira `imp`), así que el enlace existía y
// rebotaba. Quien impersona ve el banner que le recuerda quién es, y el importador
// del equipo —el bueno para HACER una migración, con sus entidades `soloEquipo`—
// sigue en su sitio.
export default async function ImportarDatosPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const acceso = await accesoImportCliente(session)
  if (!acceso.disponible) redirect('/portal/dashboard')

  // El nombre visible de cada entidad sigue al sector del negocio (Carta/Menú,
  // Barberos…), no la etiqueta genérica del adaptador (mig. 164, §`etiquetaEntidadImport`).
  const etiquetas = await obtenerEtiquetasNegocio()
  const entidades = acceso.entidades.map(e => ({
    ...e, etiqueta: etiquetaEntidadImport(e.entidad, e.etiqueta, etiquetas),
  }))

  const [empresas, monedas] = await Promise.all([
    obtenerEmpresas(),
    createAdminClient().from('monedas').select('moneda_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id).eq('activa', true),
  ])
  const faltanPrerequisitos = empresas.length === 0 || !monedas.count

  return <>
    <ImportarPrerequisitos empresa={empresas.length === 0} moneda={!monedas.count} />
    {!faltanPrerequisitos && <ImportarClienteWizard entidades={entidades} />}
  </>
}
