import { redirect }          from 'next/navigation'
import { getPortalSession }  from '@/app/actions/portal/auth'
import { obtenerEmpresas }   from '@/app/actions/portal/empresas'
import { createAdminClient } from '@/lib/supabase/admin'
import { cargarContextoLimites } from '@/lib/limites'
import EmpresasGrid          from './EmpresasGrid'

export const dynamic = 'force-dynamic'

export default async function EmpresasPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const db = createAdminClient()

  // Empresas, monedas y límite del nivel en paralelo.
  const [empresas, { data: monedas }, ctxLimites] = await Promise.all([
    obtenerEmpresas(),
    db.from('monedas').select('codigo, nombre, simbolo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    cargarContextoLimites(db, session.client_id),
  ])

  // Cuántas empresas caben: lo dice el NIVEL contratado, no un addon. Antes esto
  // lo decidía `multiempresa` (1 sin él, ilimitadas con él), que es justo el eje
  // que los niveles sustituyen: con el addon puesto, un cliente Inicial veía
  // «ilimitadas» mientras el servidor le bloqueaba la segunda. `null` = sin tope.
  const maxEmpresas: number | null = ctxLimites.limites.empresas ?? null

  return (
    <EmpresasGrid
      empresas={empresas}
      monedas={(monedas ?? []) as { codigo: string; nombre: string; simbolo: string }[]}
      maxEmpresas={maxEmpresas}
      nivelNombre={ctxLimites.nivelNombre}
      esAdmin={session.rol === 'admin_empresa'}
      soloLectura={session.solo_lectura}
    />
  )
}
