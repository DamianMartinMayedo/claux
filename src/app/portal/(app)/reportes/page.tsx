import { notFound }        from 'next/navigation'
import { cookies }          from 'next/headers'
import { requireModulo }    from '@/app/actions/portal/auth'
import { obtenerReportes } from '@/app/actions/portal/reportes'
import { obtenerAsesores } from '@/app/actions/portal/asesores'
import { resumenGavetaPortal } from '@/app/actions/portal/caja-gaveta'
import { esModoComparacion } from '@/lib/pl/periodo'
import ReportesView        from './ReportesView'

export const dynamic = 'force-dynamic'

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function periodoAnioActual(): { desde: string; hasta: string } {
  const now = new Date()
  const y = now.getFullYear()
  return { desde: fmt(new Date(y, 0, 1)), hasta: fmt(new Date(y, 11, 31)) }
}

interface PageProps {
  searchParams: Promise<{ desde?: string; hasta?: string; empresa?: string; comparar?: string; ver?: string }>
}

export default async function ReportesPage({ searchParams }: PageProps) {
  await requireModulo('base')
  const sp  = await searchParams
  const def = periodoAnioActual()
  const desde   = sp.desde   || def.desde
  const hasta   = sp.hasta   || def.hasta
  const empresa = sp.empresa || ''
  // Por defecto NO se compara: la comparación es opt-in (con inflación alta un
  // +40% interanual puede ser solo el IPC, y un informe arranca más limpio sin Δ).
  const comparar = esModoComparacion(sp.comparar) ? sp.comparar : 'no'
  // Moneda de la vista ("Ver en"): la URL manda; si no, la última elegida (cookie);
  // si tampoco, `undefined` → el servidor usa la moneda por defecto (es_consolidacion).
  const cookieVer = (await cookies()).get('rep_ver')?.value
  const verArg = sp.ver ?? cookieVer

  // La gaveta pendiente NO se acota al período del informe: lo que falta por
  // clasificar de hace dos meses también falta de este estado de resultados en
  // cuanto el dueño mire un rango que lo incluya, y el aviso es para el dueño, no
  // para el período.
  const [data, asesores, gaveta] = await Promise.all([
    obtenerReportes(desde, hasta, empresa, comparar, verArg),
    obtenerAsesores(),
    resumenGavetaPortal(),
  ])
  if (!data) notFound()
  return <ReportesView data={data} asesores={asesores} gaveta={gaveta} />
}
