import { notFound }            from 'next/navigation'
import { requireModulo }       from '@/app/actions/portal/auth'
import { obtenerReportesRrhh } from '@/app/actions/portal/rrhh'
import { hoyEnTz }             from '@/lib/fecha-tz'
import ReportesView            from './ReportesView'

export const dynamic = 'force-dynamic'

export default async function ReportesRrhhPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireModulo('rrhh')
  const { anio, empresa, ver } = await searchParams
  // El año por defecto sale del reloj del NEGOCIO (America/Havana), no del navegador:
  // un dispositivo con la fecha mal puesta abría el informe en un año inventado.
  const anioActual = hoyEnTz().slice(0, 4)
  const anioVisto  = /^\d{4}$/.test(anio ?? '') ? anio! : anioActual
  // `ver` = la moneda de la vista. Vacío (el defecto) = informe NATIVO, cada moneda con
  // sus datos reales: convertir es opt-in, como en Reportes financieros.
  const data = await obtenerReportesRrhh(anioVisto, empresa ?? '', ver ?? '')
  if (!data) notFound()
  return <ReportesView data={data} anio={anioVisto} />
}
