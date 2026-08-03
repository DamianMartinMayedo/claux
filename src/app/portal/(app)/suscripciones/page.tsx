import { cookies }              from 'next/headers'
import { redirect }             from 'next/navigation'
import { requireModulo }        from '@/app/actions/portal/auth'
import { obtenerSuscripciones } from '@/app/actions/portal/suscripciones'
import { obtenerEtiquetasNegocio } from '@/app/actions/portal/sector'
import SuscripcionesView        from './SuscripcionesView'

export const dynamic = 'force-dynamic'

export default async function SuscripcionesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  await requireModulo('servicios')
  // El rango viaja en la URL y se aplica EN LA CONSULTA (sobre `fecha_proximo_cobro`).
  // Sin parámetros no hay rango, a propósito: un acuerdo vivo no puede desaparecer del
  // listado por un filtro que nadie ha puesto (mismo criterio que CxC/CxP).
  const { desde, hasta } = await searchParams
  const data = await obtenerSuscripciones({ desde, hasta })
  if (!data) redirect('/portal/login')
  // La última empresa mirada en «Facturación del período», resuelta en servidor para que
  // el primer pintado ya sea el bueno (patrón de `rep_ver` en Reportes).
  const empresaInicial = (await cookies()).get('sus_empresa')?.value ?? ''
  // La palabra la pone el negocio: «Membresías» en un gimnasio, «Bonos» en una
  // peluquería (mig. 164). Si el menú dice una cosa y el título otra, la etiqueta no
  // sirve de nada.
  const etiquetas = await obtenerEtiquetasNegocio()
  return (
    <SuscripcionesView data={data} empresaInicial={empresaInicial}
      etiqueta={etiquetas.suscripcion} />
  )
}
