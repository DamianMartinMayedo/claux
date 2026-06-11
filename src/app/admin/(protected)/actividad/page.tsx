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
    <div style={{ padding: 'var(--space-6)' }}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
          Registro de actividad
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 4 }}>
          Últimas 200 acciones registradas en el sistema
        </p>
      </div>

      <ActividadTabla registros={registros ?? []} />
    </div>
  )
}
