import { requireAccesoPagina } from '@/lib/admin-guard'
import { Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/app/actions/settings'
import { cargarParametros } from '@/lib/presupuesto/parametros'
import { COLUMNAS_PRECIO } from '@/lib/niveles'
import { COLUMNAS_CONDICIONES } from '@/lib/billing'
import { nombresDeNiveles } from '@/lib/niveles-server'
import { hoyEnTz } from '@/lib/fecha-tz'
import { TOPE_VER_MAS } from '@/lib/listados'
import NuevoClienteModal from './NuevoClienteModal'
import ClientesTabla, { type Cliente } from './ClientesTabla'

/**
 * Lo que esta pantalla pinta, y nada más.
 *
 * Antes era `select('*')`, y `ClientesTabla` es un componente de cliente: la fila
 * ENTERA de cada tenant viajaba al navegador dentro del payload RSC —incluidos
 * `bot_config` y `bot_config_citas`, que llevan el token del bot de Telegram de
 * cada negocio, más `datos_firma` y `ia_config`. Y lo veía también el rol
 * `vendedor`, que es justo quien revende CLAUX de puertas afuera.
 *
 * El cast al pasarla al componente es por esto mismo: al venir la lista de una
 * constante y no escrita a mano en el `select`, PostgREST no puede tipar la
 * respuesta. Mismo apaño que en el dashboard, y a cambio la lista no se
 * desincroniza del componente.
 */
const COLUMNAS_LISTA =
  'client_id, nombre_empresa, nombre_contacto, email_admin, estado, '
  + 'ciclo_facturacion, fecha_expiracion, fecha_inicio, fecha_fin_gracia, '
  + `created_at, notas, archivado_at, es_prueba, ${COLUMNAS_CONDICIONES}`

export default async function ClientesPage() {
  await requireAccesoPagina('clientes')
  const supabase = await createClient()

  const [{ data: clientes }, { data: catalogo }, { data: plantillas }, nombresNivel] = await Promise.all([
    // TECHO EXPLÍCITO. Sin `.limit()` el techo lo pone PostgREST por su cuenta y recorta sin
    // decir nada; escrito aquí, el día que CLAUX se acerque a esa cifra se ve en el código y
    // no en una lista a la que le faltan clientes.
    //
    // No lleva el tratamiento completo de los pagos —`escalado` + «Ver más»— a propósito:
    // `clients` no crece sola con el uso, crece cuando se vende, y está tres órdenes de
    // magnitud por debajo del techo. Montar la escalada aquí sería código que no se ejecuta
    // nunca; el centinela de la Fase 8 vigila que siga siendo verdad.
    supabase.from('clients').select(COLUMNAS_LISTA)
      .order('created_at', { ascending: false }).limit(TOPE_VER_MAS),
    supabase
      .from('modulos_catalogo')
      .select(`clave, nombre, descripcion, ${COLUMNAS_PRECIO}, es_base, tipo`)
      .eq('activo', true)
      .order('orden'),
    supabase
      .from('plantillas_sector')
      .select('sector, nombre, modulos, etiquetas')
      .eq('activa', true)
      .order('orden'),
    nombresDeNiveles(),
  ])

  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  // Los mismos precios que usa el presupuesto: el alta manual estima con ellos en vez de
  // pedir un importe inventado.
  const parametros = await cargarParametros()
  const total = clientes?.length ?? 0

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">
            {total} cliente{total !== 1 ? 's' : ''} registrado{total !== 1 ? 's' : ''}
          </p>
        </div>
        <NuevoClienteModal
          catalogo={catalogo ?? []}
          plantillas={plantillas ?? []}
          nombresNivel={nombresNivel}
          descuentoAnualPct={descuentoAnual}
          parametros={parametros}
        />
      </div>

      {!clientes || clientes.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <Users size={40} strokeWidth={1.5} />
            <h3 className="table-empty-title">Sin clientes registrados</h3>
            <p>Crea tu primer cliente con el botón de arriba.</p>
          </div>
        </div>
      ) : (
        <ClientesTabla
          clientes={clientes as unknown as Cliente[]}
          descuentoAnualPct={descuentoAnual}
          hoy={hoyEnTz()}
        />
      )}
    </div>
  )
}
