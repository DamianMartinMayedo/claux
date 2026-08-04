import { requireModulo } from '@/app/actions/portal/auth'
import { listarCierres }  from '@/app/actions/portal/caja'
import { TOPE_VER_MAS }   from '@/lib/listados'
import CierresView        from './CierresView'

export const dynamic = 'force-dynamic'

export default async function CierresPage({
  searchParams,
}: {
  searchParams: Promise<{ limite?: string }>
}) {
  await requireModulo('caja')
  // Techo con «Traer más»: `.limit(500)` mudo escondía los cierres viejos, y con ellos la
  // serie de números Z. Sin rango de fechas a propósito — un cierre se busca por su número.
  const { limite } = await searchParams
  const pedido = Number(limite)
  const data = await listarCierres({
    limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined,
  })
  return <CierresView data={data} />
}
