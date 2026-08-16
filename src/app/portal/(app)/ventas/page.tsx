import { notFound }            from 'next/navigation'
import { requireAccesoModulo }  from '@/app/actions/portal/auth'
import { obtenerVentasResumen } from '@/app/actions/portal/ventas'
import { TOPE_VER_MAS }        from '@/lib/listados'
import { filtrosDeUrl }        from '@/lib/filtros'
import VentasView               from './VentasView'
import SolicitarAcceso           from '@/components/portal/SolicitarAcceso'

export const dynamic = 'force-dynamic'

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { puedeEditar } = await requireAccesoModulo('base')
  // Pestaña, rango y búsqueda viajan en la URL: volver desde el detalle de una factura, o
  // refrescar, conserva lo que el dueño estaba mirando en vez de saltar al estado inicial.
  // El rango se aplica EN LA QUERY (`obtenerVentasResumen`), no filtrando en el cliente.
  const sp = await searchParams
  const { t, desde, hasta, q, limite, archivadas } = sp
  // Los filtros de la barra solo se aplican EN LA CONSULTA cuando la vista los escala
  // (`?srv=1`), o sea cuando el listado está recortado por el techo y filtrar en el navegador
  // solo miraría las filas traídas.
  const enServidor = filtrosDeUrl(sp, [
    { clave: 'empresa_id', param: 'empresa' },
    { clave: 'tercero',    param: 'cliente' },
    { clave: 'estado' },
  ])
  // `limite` lo sube «Traer más». El techo protege el primer pintado, que es el que se
  // paga en 3G, pero tiene que haber forma de llegar a lo VIEJO —el techo recorta por
  // fecha descendente— sin adivinar un rango a mano.
  const pedido = Number(limite)
  const data = await obtenerVentasResumen({
    // `''` explícito = «todo» (sin límite); `undefined` = usa el defecto de 3 meses.
    desde: desde !== undefined ? desde : undefined,
    hasta: hasta !== undefined ? hasta : undefined,
    q,
    ...enServidor,
    limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined,
    // Ver archivadas es filtro de SERVIDOR: si no, ocupan cupo del techo (ver `FiltroListado`).
    archivadas: archivadas === '1',
  })
  if (!data) notFound()
  return (
    <VentasView data={data} initialTab={t === 'facturas' ? 'facturas' : 'ofertas'} puedeEditar={puedeEditar}>
      {!puedeEditar && <SolicitarAcceso modulo="base" />}
    </VentasView>
  )
}
