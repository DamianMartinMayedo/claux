import { notFound }         from 'next/navigation'
import { requireModulo }     from '@/app/actions/portal/auth'
import { obtenerTesoreria } from '@/app/actions/portal/tesoreria'
import { TOPE_VER_MAS }     from '@/lib/listados'
import { filtrosDeUrl }     from '@/lib/filtros'
import { obtenerCuentasPorCobrar, obtenerCuentasPorPagar } from '@/app/actions/portal/cobranza'
import { obtenerGavetaPendiente } from '@/app/actions/portal/caja-gaveta'
import TesoreriaView        from './TesoreriaView'

export const dynamic = 'force-dynamic'

export default async function TesoreriaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireModulo('base')
  // El rango acota el LISTADO de movimientos, no los saldos: un saldo es la suma de toda
  // la historia de la cuenta y filtrarlo sería enseñar un saldo que no existe.
  const sp = await searchParams
  const { desde, hasta, q, limite } = sp
  // Los filtros de la barra se aplican EN LA CONSULTA solo cuando la vista los escala
  // (`?srv=1`), o sea cuando el listado está recortado por el techo.
  const enServidor = filtrosDeUrl(sp, [
    { clave: 'empresa_id', param: 'empresa' },
    { clave: 'cuenta_id',  param: 'cuenta' },
    { clave: 'tipo' },
    { clave: 'categoria',  param: 'cat' },
  ])
  // `limite` lo sube «Traer más». El techo protege el primer pintado, que es el que se
  // paga en 3G, pero tiene que haber forma de llegar a lo VIEJO —el techo recorta por
  // fecha descendente— sin adivinar un rango a mano.
  const pedido = Number(limite)
  const [data, cxc, cxp, gaveta] = await Promise.all([
    obtenerTesoreria({ desde, hasta, q, ...enServidor,
      limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined }),
    obtenerCuentasPorCobrar(),
    obtenerCuentasPorPagar(),
    // La bandeja de la gaveta del TPV (mig. 193). Va aquí y no dentro de
    // `obtenerTesoreria` porque no depende del rango ni de los filtros del listado:
    // una salida sin clasificar de hace dos meses tiene que salir igual, o el aviso
    // desaparecería justo cuando más falta hace.
    obtenerGavetaPendiente(),
  ])
  if (!data) notFound()
  return (
    <TesoreriaView
      data={data}
      pendientes={{ cobrar: cxc?.documentos ?? [], pagar: cxp?.documentos ?? [] }}
      gaveta={gaveta}
    />
  )
}
