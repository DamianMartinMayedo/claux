import { notFound }            from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerGastosCobros } from '@/app/actions/portal/gastos'
import { TOPE_VER_MAS }        from '@/lib/listados'
import { filtrosDeUrl }        from '@/lib/filtros'
import { resumenGavetaPortal } from '@/app/actions/portal/caja-gaveta'
import GastosView              from './GastosView'
import SolicitarAcceso          from '@/components/portal/SolicitarAcceso'
import { estadoFuncionesIa }   from '@/lib/ia/interruptores'

export const dynamic = 'force-dynamic'

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { session, puedeEditar } = await requireAccesoModulo('base')
  // Rango y búsqueda viajan en la URL y se aplican EN LA QUERY. Este listado es el que
  // más crece: una nómina confirmada escribe hasta 5 filas (migs. 142-144).
  // `limite` lo sube «Ver más»: el techo protege la conexión, pero tiene que haber
  // una forma de llegar a lo viejo sin adivinar un rango a mano.
  const sp = await searchParams
  const pedido = Number(sp.limite)
  // Los filtros de la barra solo se aplican EN LA CONSULTA cuando la vista los escala
  // (`?srv=1`), o sea cuando el listado está recortado por el techo y filtrar en el navegador
  // solo miraría las filas traídas. Mientras quepa entero, el navegador da el mismo
  // resultado y se ahorra el viaje — que en 3G es lo único que se nota.
  const enServidor = filtrosDeUrl(sp, [
    { clave: 'empresa_id', param: 'empresa' },
    { clave: 'tercero' },
    { clave: 'categoria', param: 'cat' },
  ])
  // El aviso de la gaveta va en paralelo: no depende del rango del listado (una
  // salida sin clasificar de hace dos meses tiene que avisar igual).
  // Colocar en el informe las categorías que llegaron con una migración es
  // trabajo NUESTRO: solo se ofrece en impersonación, y solo si la función está
  // encendida (Configuración → IA → Equipo). El candado real lo pone la acción.
  const [data, gaveta, iaOn] = await Promise.all([
    obtenerGastosCobros({
      desde: sp.desde, hasta: sp.hasta, q: sp.q,
      ...enServidor,
      limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined,
    }),
    resumenGavetaPortal(),
    session.imp && puedeEditar
      ? estadoFuncionesIa(['contabilidad_cuentas'] as const)
      : Promise.resolve(null),
  ])
  if (!data) notFound()
  return (
    <GastosView data={data} puedeEditar={puedeEditar} gaveta={gaveta}
      iaCuentas={!!iaOn?.contabilidad_cuentas}>
      {!puedeEditar && <SolicitarAcceso modulo="base" />}
    </GastosView>
  )
}
