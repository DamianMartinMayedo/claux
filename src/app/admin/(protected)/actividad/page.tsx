import { requireAccesoPagina } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import ActividadTabla from './ActividadTabla'

export const dynamic = 'force-dynamic'

/** Lo que cabe en pantalla. La descarga llega a 5.000 (`tablas-admin.ts`). */
const TECHO = 200

export default async function ActividadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAccesoPagina('actividad')
  const sp = await searchParams
  const supabase = await createClient()

  // Las columnas que pinta la tabla, y nada más. Hoy son todas las que tiene
  // `audit_log`, así que no cambia lo que viaja: cambia que el día que la tabla
  // gane una columna, esta pantalla no se la lleve sola al navegador —
  // `ActividadTabla` es un componente de cliente y lo que se selecciona aquí va
  // dentro del payload RSC.
  let consulta = supabase
    .from('audit_log')
    .select('id, created_at, user_email, entity, entity_id, action, description')

  // EL FILTRO SE APLICA AQUÍ, NO EN EL NAVEGADOR. Es la única tabla del admin que crece sin
  // freno y la pantalla se queda con las 200 últimas líneas: filtrar sobre esas 200 no era
  // filtrar, era mirar lo que de «Pago» hubiera caído en las 200 más recientes de TODO. Sin
  // decirlo, además — el listado salía corto y creíble. Ahora se filtra primero y se recortan
  // las 200 después, así que «las últimas 200 de pagos» es literal.
  if (sp.entidad) consulta = consulta.eq('entity', sp.entidad)
  // Los comodines y las comas van fuera: dentro de un `.or()` la coma separa condiciones y
  // un `%` del usuario convertiría su búsqueda en «todo».
  const texto = (sp.q ?? '').replace(/[%,()]/g, ' ').trim()
  if (texto) {
    consulta = consulta.or(
      ['description', 'user_email', 'entity_id'].map(c => `${c}.ilike.%${texto}%`).join(','),
    )
  }

  const { data: registros } = await consulta
    .order('created_at', { ascending: false })
    .limit(TECHO)

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Registro de actividad</h1>
          <p className="page-subtitle">Las {TECHO} acciones más recientes de lo que estés viendo</p>
        </div>
      </div>

      <ActividadTabla registros={registros ?? []} entidad={sp.entidad ?? ''} q={sp.q ?? ''} />
    </div>
  )
}
