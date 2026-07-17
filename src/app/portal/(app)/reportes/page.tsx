import { notFound }        from 'next/navigation'
import { requireModulo }    from '@/app/actions/portal/auth'
import { obtenerReportes } from '@/app/actions/portal/reportes'
import { obtenerAsesores } from '@/app/actions/portal/asesores'
import ReportesView        from './ReportesView'

export const dynamic = 'force-dynamic'

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function periodoMesActual(): { desde: string; hasta: string } {
  const now = new Date()
  return {
    desde: fmt(new Date(now.getFullYear(), now.getMonth(), 1)),
    hasta: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  }
}

interface PageProps {
  searchParams: Promise<{ desde?: string; hasta?: string; empresa?: string }>
}

export default async function ReportesPage({ searchParams }: PageProps) {
  await requireModulo('base')
  const sp  = await searchParams
  const def = periodoMesActual()
  const desde   = sp.desde   || def.desde
  const hasta   = sp.hasta   || def.hasta
  const empresa = sp.empresa || ''

  const [data, asesores] = await Promise.all([
    obtenerReportes(desde, hasta, empresa),
    obtenerAsesores(),
  ])
  if (!data) notFound()
  return <ReportesView data={data} asesores={asesores} />
}
