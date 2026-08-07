import Link from 'next/link'
import { Calculator } from 'lucide-react'
import { getPortalSession } from '@/app/actions/portal/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { tieneModulo } from '@/lib/modulos'

// Sugerencia (no bloqueante) para módulos que generan apuntes contables —Inventario
// (compras) y RRHH (nóminas)— cuando el cliente NO tiene contratada la Contabilidad.
// No fuerza ninguna dependencia: cada módulo funciona solo. Si la tiene, no aparece.
//
// VA AL PIE de la pantalla y con aspecto de nota, no de aviso. Estaba arriba del todo,
// como banner de color y ancho completo, así que lo primero que veía el dueño al entrar
// en su módulo era publicidad de otro módulo — por encima del título de la página y de
// la propia pantalla que venía a usar. Un mensaje comercial no puede ocupar el sitio del
// trabajo, y menos en todas las visitas: es una recomendación, y se lee como tal.
export default async function ContabilidadHint({ genera }: { genera: string }) {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const { data } = await db
    .from('clients')
    .select('modulos_activos')
    .eq('client_id', session.client_id)
    .single()

  if (tieneModulo(data?.modulos_activos, 'base')) return null

  // El envoltorio NO es decorativo: la nota va detrás de la vista, o sea FUERA de su
  // `.view-container`, y sin él se pintaba a todo lo ancho de la pantalla mientras las
  // tarjetas de encima se paran en `--content-max`. Se reutiliza el mismo contenedor
  // (con sus tres breakpoints) y solo se le quita el hueco de arriba, que ya lo puso la
  // vista al terminar.
  return (
    <div className="view-container view-container-cola">
      <aside className="modulo-sugerencia">
        <Calculator size={18} strokeWidth={2} className="modulo-sugerencia-icono" />
        <p>
          Los gastos y pagos que generan {genera} se quedan aquí. Con el módulo de{' '}
          <strong>Contabilidad</strong> aparecerían también en tus cuentas y en tesorería.{' '}
          <Link href="/portal/soporte" className="link-primary">Pídelo desde Soporte</Link>.
        </p>
      </aside>
    </div>
  )
}
