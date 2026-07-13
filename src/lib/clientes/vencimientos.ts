import { createAdminClient } from '@/lib/supabase/admin'
import { toDateStr } from '@/lib/date-utils'

// Barrido de clientes vencidos para el CRON (Fase 2). Corre con service_role, sin
// sesión de Supabase Auth ni guard de rol — por eso NO reutiliza el action
// `desactivarClientesVencidos` de src/app/actions/clientes.ts (que exige
// requirePermiso + createClient). Ambos aplican la MISMA regla; si cambia la
// política de vencimiento, actualizar los dos. El action sigue corriendo al abrir
// el admin; este barrido mantiene el estado fresco a diario sin depender de eso.
//
// El bloqueo de acceso del portal es por FECHA (no por estado), así que un cliente
// expirado ya queda bloqueado aunque su `estado` tarde en pasar a DESACTIVADO
// (ver src/app/portal/(app)/layout.tsx). Este barrido solo sincroniza el estado.
export async function barrerVencidos(): Promise<{ suspendidos: number }> {
  const db = createAdminClient()
  const hoy = toDateStr(new Date())

  // 1. GRACIA con fecha_fin_gracia pasada → DESACTIVADO (limpia campos de gracia)
  const { data: graciaVencidos } = await db
    .from('clients')
    .select('client_id')
    .eq('estado', 'GRACIA')
    .lt('fecha_fin_gracia', hoy)

  if (graciaVencidos && graciaVencidos.length > 0) {
    await db
      .from('clients')
      .update({ estado: 'DESACTIVADO', fecha_fin_gracia: null, motivo_gracia: null, notas_gracia: null })
      .in('client_id', graciaVencidos.map(c => c.client_id))
  }

  // 2. ACTIVO/TRIAL con fecha_expiracion pasada → DESACTIVADO
  const { data: expVencidos } = await db
    .from('clients')
    .select('client_id')
    .in('estado', ['ACTIVO', 'TRIAL'])
    .lt('fecha_expiracion', hoy)

  if (expVencidos && expVencidos.length > 0) {
    await db
      .from('clients')
      .update({ estado: 'DESACTIVADO' })
      .in('client_id', expVencidos.map(c => c.client_id))
  }

  return { suspendidos: (graciaVencidos?.length ?? 0) + (expVencidos?.length ?? 0) }
}
