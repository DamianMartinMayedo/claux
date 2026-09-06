import { requireAccesoPagina } from '@/lib/admin-guard'
import { CreditCard } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/app/actions/settings'
import { LIMITE_LISTADO, TOPE_VER_MAS } from '@/lib/listados'
import { COLUMNAS_PAGO } from '@/lib/billing'
import { filtrosDeUrl } from '@/lib/filtros'
import type { FiltroAdmin } from '@/lib/exportar/tablas-admin'
import RegistrarPagoModal from './RegistrarPagoModal'
import PagosTabla, { type Pago as PagoLista } from './PagosTabla'

export const dynamic = 'force-dynamic'

/**
 * Los pagos, con techo.
 *
 * Era `select('*')` sin límite: la tabla ENTERA de cobros a un componente de cliente. Es la
 * única del admin que crece sola y para siempre —una fila por cliente y mes, más las de
 * instalación—, así que el día que pase del techo de PostgREST se habría recortado sin
 * decirlo. Con techo explícito hay `<AvisoTope>`, que dice cuántos faltan y los trae.
 *
 * Con techo, los filtros de la barra dejan de poder aplicarse solo en el navegador: filtrar
 * «por confirmar» sobre las 500 filas traídas enseña lo que de eso cayó en las 500, no lo que
 * hay. Por eso suben a la consulta en cuanto el listado esté recortado (`?srv=1`, que pone
 * `<Filtros>` solo entonces).
 */
export default async function PagosPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAccesoPagina('pagos')
  const supabase = await createClient()
  const sp = await searchParams

  const pedido = Number(sp.limite)
  const limite = Number.isFinite(pedido) && pedido > 0
    ? Math.min(pedido, TOPE_VER_MAS)
    : LIMITE_LISTADO

  // La lista de clientes va antes y aparte: hace de diccionario para pintar la columna
  // «Cliente» y, sobre todo, para poder BUSCAR por nombre de empresa en la consulta —el
  // nombre no está en `payments`, así que se resuelve a ids aquí—.
  const { data: clientes } = await supabase.from('clients')
    .select('client_id, nombre_empresa, ciclo_facturacion, es_prueba')
    .order('nombre_empresa')
    // Techo explícito: si a este diccionario le faltara un cliente, su cobro se
    // pintaría con el id crudo en la columna «Cliente» y no se encontraría al
    // buscarlo por el nombre de la empresa. Fallaría la BÚSQUEDA, no la carga.
    .limit(TOPE_VER_MAS)

  const enServidor = filtrosDeUrl<FiltroAdmin>(sp, [
    { clave: 'estado' }, { clave: 'concepto' }, { clave: 'metodo' },
  ])

  let consulta = supabase.from('payments').select(COLUMNAS_PAGO, { count: 'exact' })
  // `estado` y `concepto` son columnas con NULL como valor implícito: la pantalla lee
  // «confirmado» donde la fila tiene NULL —así se guardaban antes de que existiera el
  // estado—, y un `.eq()` a secas se dejaría fuera justo esas.
  if (enServidor.estado === 'confirmado')      consulta = consulta.or('estado.eq.confirmado,estado.is.null')
  else if (enServidor.estado)                  consulta = consulta.eq('estado', enServidor.estado)
  if (enServidor.concepto === 'suscripcion')   consulta = consulta.or('concepto.eq.suscripcion,concepto.is.null')
  else if (enServidor.concepto)                consulta = consulta.eq('concepto', enServidor.concepto)
  if (enServidor.metodo)                       consulta = consulta.eq('metodo', enServidor.metodo)

  // La búsqueda sube con los filtros, y por lo mismo. Busca en lo que dice el buscador
  // —empresa e id— y no en más: si aquí mirase otras columnas, el resultado cambiaría al
  // cruzar el techo, que es la clase de incoherencia que este contrato existe para evitar.
  const texto = (sp.q ?? '').trim().toLowerCase()
  if (sp.srv === '1' && texto) {
    const ids = (clientes ?? [])
      .filter(c => c.nombre_empresa?.toLowerCase().includes(texto) || c.client_id.toLowerCase().includes(texto))
      .map(c => c.client_id)
    // Sin coincidencias no se puede dejar la consulta sin filtro: devolvería la lista
    // entera para una búsqueda que no encontró nada.
    consulta = consulta.in('client_id', ids.length ? ids : ['__ninguno__'])
  }

  const [{ data: pagos, count }, { count: registrados }] = await Promise.all([
    consulta.order('fecha', { ascending: false }).limit(limite),
    // El total DE VERDAD, para la cabecera. El `count` de arriba viene del filtro cuando la
    // consulta filtra, así que usarlo aquí haría que «812 pagos registrados» cambiara al
    // tocar un desplegable — el subtítulo dice cuántos hay, no cuántos se están viendo.
    supabase.from('payments').select('pago_id', { count: 'exact', head: true }),
  ])

  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const clienteNombre = Object.fromEntries((clientes ?? []).map(c => [c.client_id, c.nombre_empresa]))
  const clientesPrueba = (clientes ?? []).filter(c => c.es_prueba).map(c => c.client_id)
  const total = registrados ?? pagos?.length ?? 0
  // Si hay algo puesto, la lista vacía significa «no hay nada QUE CUMPLA», y eso lo dice la
  // tabla con su barra de filtros delante. El cartel de «sin pagos registrados» —con su
  // «registra el primer pago»— solo vale cuando de verdad no hay ninguno.
  const hayFiltro = Boolean(sp.q || sp.estado || sp.concepto || sp.metodo)

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pagos</h1>
          <p className="page-subtitle">
            {total} pago{total !== 1 ? 's' : ''} registrado{total !== 1 ? 's' : ''}
          </p>
        </div>
        <RegistrarPagoModal clientes={clientes ?? []} descuentoAnualPct={descuentoAnual} />
      </div>

      {!hayFiltro && (!pagos || pagos.length === 0) ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <CreditCard size={40} strokeWidth={1.5} />
            <h3 className="table-empty-title">Sin pagos registrados</h3>
            <p>Registra el primer pago con el botón de arriba.</p>
          </div>
        </div>
      ) : (
        <PagosTabla
          pagos={(pagos ?? []) as unknown as PagoLista[]}
          clienteNombre={clienteNombre}
          clientesPrueba={clientesPrueba}
          total={count ?? 0}
          limite={limite}
          hayMas={(pagos?.length ?? 0) >= limite}
        />
      )}
    </div>
  )
}
