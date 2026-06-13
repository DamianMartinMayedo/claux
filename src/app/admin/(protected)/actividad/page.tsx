import { createClient } from '@/lib/supabase/server'
import ActividadTabla from './ActividadTabla'

export const dynamic = 'force-dynamic'

export default async function ActividadPage() {
  const supabase = await createClient()

  const { data: registros } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Registro de actividad</h1>
          <p className="page-subtitle">Últimas 200 acciones registradas en el sistema</p>
        </div>
      </div>

      <ActividadTabla registros={registros ?? []} />
    </div>
  )
}
