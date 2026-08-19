import { redirect }            from 'next/navigation'
import { getPortalSession }     from '@/app/actions/portal/auth'
import { obtenerEtiquetasNegocio } from '@/app/actions/portal/sector'
import { accesoImportCliente, etiquetaEntidadImport } from '@/lib/importador/acceso-cliente'
import ImportarClienteWizard    from './ImportarClienteWizard'

export const dynamic = 'force-dynamic'

// Importador de AUTOSERVICIO: el cliente se importa SOLO (el del equipo, por
// impersonación, vive en /portal/importar y no se toca). Regla única de visibilidad
// (plan §6, en `accesoImportCliente`): `autoimport_activo` ∧ el usuario puede importar
// algún módulo contratado ∧ `migracion_estado != 'a_cargo_equipo'`. No está en el
// sidebar; se entra desde el menú de cuenta, con esta MISMA condición.
export default async function ImportarDatosPage() {
  const session = await getPortalSession()
  if (!session)    redirect('/portal/login')
  if (session.imp) redirect('/portal/importar')   // el equipo usa su propio importador

  const acceso = await accesoImportCliente(session)
  if (!acceso.disponible) redirect('/portal/dashboard')

  // El nombre visible de cada entidad sigue al sector del negocio (Carta/Menú,
  // Barberos…), no la etiqueta genérica del adaptador (mig. 164, §`etiquetaEntidadImport`).
  const etiquetas = await obtenerEtiquetasNegocio()
  const entidades = acceso.entidades.map(e => ({
    ...e, etiqueta: etiquetaEntidadImport(e.entidad, e.etiqueta, etiquetas),
  }))

  return <ImportarClienteWizard entidades={entidades} />
}
