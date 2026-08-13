import { requireModulo }      from '@/app/actions/portal/auth'
import { listarOperaciones }   from '@/app/actions/portal/caja'
import { resumenGavetaPortal }  from '@/app/actions/portal/caja-gaveta'
import { TOPE_VER_MAS }        from '@/lib/listados'
import OperacionesView         from './OperacionesView'

export const dynamic = 'force-dynamic'

export default async function OperacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; limite?: string }>
}) {
  await requireModulo('caja')
  // Rango y techo en la URL, como los listados de Contabilidad: esta pantalla se traía
  // 1.000 tickets sin rango y sin decirlo, así que un mostrador con historia no veía
  // los viejos. `limite` lo sube «Traer más».
  const { desde, hasta, limite } = await searchParams
  const pedido = Number(limite)
  // El aviso de la gaveta ignora el rango: lo pendiente es pendiente aunque sea de
  // un mes que esta pantalla no esté mirando.
  const [data, gaveta] = await Promise.all([
    listarOperaciones({
      desde, hasta,
      limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined,
    }),
    resumenGavetaPortal(),
  ])
  return <OperacionesView data={data} gaveta={gaveta} />
}
