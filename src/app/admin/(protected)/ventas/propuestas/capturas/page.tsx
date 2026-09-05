import { requireAccesoPagina } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { listarCapturas } from '@/app/actions/capturas'
import CapturasView from './CapturasView'

export const dynamic = 'force-dynamic'

// La biblioteca de capturas: se sube una vez y la reutilizan todas las
// propuestas. Vive dentro de Propuestas porque es su material, y con su mismo
// permiso — el segmento estático gana al dinámico `[id]`, así que no choca.
export default async function CapturasPage() {
  const ctx = await requireAccesoPagina('propuestas')
  const db = createAdminClient()

  const [capturas, modRes, secRes] = await Promise.all([
    listarCapturas(),
    db.from('modulos_catalogo').select('clave, nombre').eq('activo', true).order('orden'),
    db.from('plantillas_sector').select('sector, nombre').order('nombre'),
  ])

  return (
    <CapturasView
      capturas={capturas}
      modulos={(modRes.data ?? []) as { clave: string; nombre: string }[]}
      sectores={(secRes.data ?? []) as { sector: string; nombre: string }[]}
      rol={ctx.rol}
      permisos={ctx.permisos}
    />
  )
}
