import { Calculator } from 'lucide-react'
import { getPortalSession } from '@/app/actions/portal/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { tieneModulo } from '@/lib/modulos'
import { TZ_NEGOCIO } from '@/lib/fecha-tz'
import ContabilidadHintAccion from './ContabilidadHintAccion'

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// «26 jul», en la zona del negocio. Copiada del dashboard a propósito de la misma
// forma: `formatToParts` y no `format().split()` — el orden de día y mes depende del
// locale y partirlo a mano es justo cómo se cuela un «7 de 26».
function fechaCorta(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_NEGOCIO, day: 'numeric', month: 'numeric',
  }).formatToParts(d)
  const dia = Number(partes.find(p => p.type === 'day')?.value)
  const mes = Number(partes.find(p => p.type === 'month')?.value)
  if (!dia || !mes) return undefined
  return `${dia} ${MESES_CORTOS[mes - 1]}`
}

// Sugerencia (no bloqueante) para módulos que generan apuntes contables —Inventario
// (compras) y RRHH (nóminas)— cuando el cliente NO tiene contratada la Contabilidad.
// No fuerza ninguna dependencia: cada módulo funciona solo. Si la tiene, no aparece.
//
// VA AL PIE de la pantalla y con aspecto de nota, no de aviso. Estaba arriba del todo,
// como banner de color y ancho completo, así que lo primero que veía el dueño al entrar
// en su módulo era publicidad de otro módulo — por encima del título de la página y de
// la propia pantalla que venía a usar.
//
// La acción es DIRECTA («Me interesa»), la misma que el banner de captación del
// dashboard: registra el interés en `soporte_mensajes`, avisa al equipo y le contesta
// «te contactamos». Mandarlo a Soporte a escribir un mensaje era pedirle trabajo para
// decirnos que quiere gastar dinero, y encima con otro vocabulario que el dashboard.
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

  // Si ya lo pidió, el botón lo dice con su fecha. Sin esto, «Te contactamos» viviría
  // solo en el estado del componente y se perdería al recargar: el dueño volvería a ver
  // «Me interesa» sin saber si su clic sirvió de algo.
  const { data: previo } = await db
    .from('soporte_mensajes')
    .select('created_at')
    .eq('client_id', session.client_id)
    .eq('modulo_clave', 'base')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <div className="view-container view-container-cola">
      <aside className="modulo-sugerencia">
        <Calculator size={18} strokeWidth={2} className="modulo-sugerencia-icono" />
        <p>
          Los gastos y pagos que generan {genera} se quedan aquí. Con el módulo de{' '}
          <strong>Contabilidad</strong> aparecerían también en tus cuentas y en tesorería.
        </p>
        <ContabilidadHintAccion pedidoEl={fechaCorta(previo?.created_at)} />
      </aside>
    </div>
  )
}
