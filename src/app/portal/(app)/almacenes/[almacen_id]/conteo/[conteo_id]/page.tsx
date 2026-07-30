import { notFound } from 'next/navigation'
import { requireModulo } from '@/app/actions/portal/auth'
import { obtenerConteo } from '@/app/actions/portal/conteos'
import ConteoView from '../ConteoView'

export const dynamic = 'force-dynamic'

/**
 * Un conteo CONCRETO: la hoja mientras se cuenta y el acta cuando ya se aplicó.
 *
 * Es la ÚNICA ruta de conteo, y solo LEE. Hubo otra (`/conteo`, sin id) que abría el
 * borrador durante el render; como el botón que llevaba a ella era un `<Link>` y Next
 * prefetcha los enlaces, pasar el ratón por encima creaba un conteo — 352 en el entorno
 * de prueba. Abrir un conteo es una escritura y vive detrás de un botón (mig. 160).
 */
export default async function ActaConteoPage({
  params,
}: {
  params: Promise<{ almacen_id: string; conteo_id: string }>
}) {
  await requireModulo('inventario')
  const { almacen_id, conteo_id } = await params

  const data = await obtenerConteo(conteo_id)
  if (!data) notFound()
  // El conteo tiene que ser DE ESTE almacén: si no, la miga de pan diría un almacén y
  // la tabla enseñaría otro.
  if (data.conteo.almacen_id !== almacen_id) notFound()

  return <ConteoView data={data} />
}
