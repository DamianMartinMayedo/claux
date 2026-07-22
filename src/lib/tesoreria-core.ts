// Núcleo de Tesorería (sin 'use server'): generadores de código y la cuenta
// técnica de «Apertura». Lo comparten las server actions de tesorería/gastos y
// el importador de datos.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

function corto(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
}

export function generarCuentaId():     string { return `CTA-${corto()}` }
export function generarMovimientoId(): string { return `MOV-${corto()}` }

/**
 * Cuenta de «Apertura» de una (empresa, moneda): la crea si no existe.
 *
 * Es el contrapeso técnico de la migración (mig. 130). El estado de un gasto o
 * cobro se DERIVA de los movimientos que lo referencian, así que un gasto que el
 * cliente ya había pagado antes de entrar en CLAUX necesita un movimiento que lo
 * salde; si saliera de una caja real, falsearía el efectivo de hoy. Sale de aquí,
 * fechado en el período del gasto, y `es_apertura` la mantiene fuera de saldos,
 * flujo de caja y selectores de pago.
 *
 * Una por moneda porque `cuentas.moneda` es fija: así la liquidación va a la par
 * (tasa 1) y no hay conversión que inventar.
 */
export async function obtenerCuentaApertura(
  db: Db, client_id: string, empresa_id: string, moneda: string,
): Promise<string> {
  const { data } = await db.from('cuentas')
    .select('cuenta_id')
    .eq('client_id', client_id).eq('empresa_id', empresa_id)
    .eq('moneda', moneda).eq('es_apertura', true)
    .limit(1).maybeSingle()
  if (data?.cuenta_id) return data.cuenta_id as string

  const cuenta_id = generarCuentaId()
  const { error } = await db.from('cuentas').insert({
    cuenta_id,
    client_id,
    empresa_id,
    nombre:        `Apertura · ${moneda}`,
    tipo:          'OTRO',
    moneda,
    saldo_inicial: 0,
    activa:        true,
    es_apertura:   true,
    notas:         'Cuenta técnica de la migración de datos. No es dinero real: sirve para saldar el histórico que el cliente ya había pagado o cobrado antes de entrar en CLAUX.',
    updated_at:    new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  return cuenta_id
}
