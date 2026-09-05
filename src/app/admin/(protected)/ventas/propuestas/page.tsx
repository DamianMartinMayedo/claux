import { requireAccesoPagina } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { listarPropuestas } from '@/app/actions/propuestas'
import { hoyEnTz, sumarDias } from '@/lib/fecha-tz'
import { DIAS_CADUCA_CAPTURA } from '@/lib/propuesta/secciones'
import PropuestasView from './PropuestasView'

export const dynamic = 'force-dynamic'

// La presentación que se enseña en la primera reunión, con su acuse de lectura.
// Vive en Ventas, al lado del presupuesto del que lee los números.
export default async function PropuestasPage() {
  const ctx = await requireAccesoPagina('propuestas')
  const db = createAdminClient()

  // El contador de capturas por revisar se ve AQUÍ, que es donde se trabaja: un
  // aviso que solo aparece al entrar en la biblioteca lo lee quien ya iba a
  // mirarla. La fecha se calcula con los ayudantes del repo y no con `new Date()`:
  // `toISOString()` corta en UTC y en la madrugada cubana cambia de día.
  const [propuestas, viejasRes] = await Promise.all([
    listarPropuestas(),
    db.from('capturas_producto').select('id', { count: 'exact', head: true })
      .eq('activa', true).lt('capturada_at', sumarDias(hoyEnTz(), -DIAS_CADUCA_CAPTURA)),
  ])

  return (
    <PropuestasView
      propuestas={propuestas}
      capturasViejas={viejasRes.count ?? 0}
      rol={ctx.rol}
      permisos={ctx.permisos}
    />
  )
}
