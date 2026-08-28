import { createAdminClient } from '@/lib/supabase/admin'
import { hoyEnTz } from '@/lib/fecha-tz'
import { COLUMNAS_EXENCION, desactivable, socioMalSuspendido, estadoAlRetirarGracia } from './ciclo-vida'

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
//
// DOS EXENTOS (ver `desactivable`), los mismos que el guardia del portal: el
// cliente de PRUEBA y el Socio CLAUX vigente. No basta con que el portal los deje
// pasar por fecha: si este barrido les escribe DESACTIVADO, el portal bloquea por
// ESTADO y el escudo de allí deja de servir. Los dos sitios tienen que estar de
// acuerdo, o gana el que escribe. Cuando la condición de socio caduca deja de
// estar exento, y el barrido del día siguiente lo trata como a cualquiera — que
// es justo lo que dice la mig. 215: el socio conserva su ciclo de vida por debajo
// y vence cuando la relación acaba.

export async function barrerVencidos(): Promise<{ suspendidos: number; rescatados: number }> {
  const db = createAdminClient()
  // «Hoy» es el de La Habana, no el del servidor. Con la fecha UTC, entre las 20:00
  // y la medianoche cubanas ya es mañana para el servidor, y un cliente cuya fecha
  // vence HOY se suspendía esa misma tarde: perdía su última noche pagada. Este
  // barrido corre a las 08:00 UTC (04:00 en Cuba, mismo día), pero su gemelo del
  // admin corre a cualquier hora, y la regla tiene que ser una sola.
  const hoy = hoyEnTz()

  // Campos que deja de tener sentido conservar cuando la gracia termina.
  const LIMPIAR_GRACIA = { fecha_fin_gracia: null, motivo_gracia: null, notas_gracia: null }

  // 1. GRACIA con fecha_fin_gracia pasada → al estado que lo sostenga POR DEBAJO,
  //    que no es DESACTIVADO por defecto. Escribir DESACTIVADO a todos suspendía a
  //    quien tenía el mes pagado y solo había recibido la gracia como extra: la
  //    gracia se acaba, el mes que pagó no. `estadoAlRetirarGracia` es la misma
  //    función que usa el botón de retirar el período especial de la ficha, así que
  //    el barrido automático y la decisión manual no pueden dar resultados
  //    distintos — y de paso el exento (prueba / socio) deja de quedarse clavado en
  //    GRACIA para siempre, que era lo que pasaba al saltárselo entero.
  const { data: graciaRaw } = await db
    .from('clients')
    .select(`client_id, fecha_expiracion, ${COLUMNAS_EXENCION}`)
    .eq('estado', 'GRACIA')
    .lt('fecha_fin_gracia', hoy)
  const filasGracia = graciaRaw ?? []

  // Agrupadas por destino (DESACTIVADO / ACTIVO / TRIAL) para no escribir una a una.
  const porDestino = new Map<string, string[]>()
  for (const c of filasGracia) {
    const destino = estadoAlRetirarGracia(c, hoy)
    porDestino.set(destino, [...(porDestino.get(destino) ?? []), c.client_id])
  }
  for (const [estado, ids] of porDestino) {
    await db.from('clients').update({ estado, ...LIMPIAR_GRACIA }).in('client_id', ids)
  }
  const graciaVencidos = filasGracia.filter(c => estadoAlRetirarGracia(c, hoy) === 'DESACTIVADO')
  const graciaExentos  = filasGracia.length - graciaVencidos.length

  // 2. ACTIVO/TRIAL con fecha_expiracion pasada → DESACTIVADO
  const { data: expRaw } = await db
    .from('clients')
    .select(`client_id, ${COLUMNAS_EXENCION}`)
    .in('estado', ['ACTIVO', 'TRIAL'])
    .lt('fecha_expiracion', hoy)
  const expVencidos = (expRaw ?? []).filter(desactivable)

  if (expVencidos.length > 0) {
    await db
      .from('clients')
      .update({ estado: 'DESACTIVADO' })
      .in('client_id', expVencidos.map(c => c.client_id))
  }

  // 3. Y la operación inversa: el socio vigente que quedó DESACTIVADO/VENCIDO.
  // El barrido no solo suspende; también deshace la contradicción que él mismo
  // pudo escribir antes de que la exención existiera. Sin esto el socio entra
  // igual (el guardia del portal lo deja pasar) pero la ficha y el dashboard del
  // admin siguen diciendo «suspendido», que es un dato falso a la vista.
  const { data: socioRaw } = await db
    .from('clients')
    .select(`client_id, estado, ${COLUMNAS_EXENCION}`)
    .in('estado', ['DESACTIVADO', 'VENCIDO'])
    .eq('es_socio', true)
  const rescatados = (socioRaw ?? []).filter(c => socioMalSuspendido(c, hoy))

  if (rescatados.length > 0) {
    await db
      .from('clients')
      .update({ estado: 'ACTIVO' })
      .in('client_id', rescatados.map(c => c.client_id))
  }

  // `rescatados` cuenta TODO lo que el barrido devolvió a su sitio sin suspenderlo:
  // el socio mal suspendido y el exento que se había quedado clavado en GRACIA.
  return {
    suspendidos: graciaVencidos.length + expVencidos.length,
    rescatados:  rescatados.length + graciaExentos,
  }
}
