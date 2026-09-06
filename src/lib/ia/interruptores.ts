// ── El interruptor de la IA interna (server-only) ────────────────────────────
// Dos ajustes en `settings`, y una regla: APAGAR NO ES ESCONDER EL BOTÓN.
//
//   · `ia_interna_activa` ('1' / '0') — el general.
//   · `ia_funciones_off`  (JSON array de claves) — una a una.
//
// Se guarda lo APAGADO, no lo encendido: así una función nueva del catálogo nace
// encendida sin tener que tocar el ajuste, y una clave vieja que ya no existe se
// ignora sola en vez de apagar algo que no es.
//
// Quien lo comprueba es `chatInterno`, que es la única puerta al proveedor. Que la
// pantalla esconda el botón está bien para no ofrecer lo que no va a funcionar,
// pero no es el control: un consumidor olvidado, un cron o un `fetch` a mano se
// paran igual.
//
// Por qué esto y no el tope a 0 (que ya existía): poner el tope a 0 apaga la IA
// MINTIENDO —el panel dice «bolsa agotada» cuando lo que pasa es que la hemos
// apagado nosotros— y es todo o nada. Esto dice la verdad y va función a función.

import { createAdminClient } from '@/lib/supabase/admin'
import { esFuncionIa, type FnIa } from './funciones'

export interface EstadoInterruptores {
  /** El general. Con esto en false no se llama al proveedor por ninguna función. */
  activa: boolean
  /** Las apagadas una a una (solo claves que existen en el catálogo). */
  apagadas: FnIa[]
}

export const CLAVES_INTERRUPTORES = ['ia_interna_activa', 'ia_funciones_off'] as const

/** Traduce las dos filas de `settings` a un estado. Sin fila = encendida. */
export function interpretarInterruptores(settings: Record<string, string | null | undefined>): EstadoInterruptores {
  const bruto = settings.ia_interna_activa
  // Solo un '0' explícito apaga. Un valor ilegible NO apaga la plataforma entera:
  // un ajuste mal tecleado tiene que dejar el panel como estaba, no dejarlo mudo.
  const activa = String(bruto ?? '1').trim() !== '0'

  let apagadas: FnIa[] = []
  try {
    const lista = JSON.parse(String(settings.ia_funciones_off ?? '[]'))
    if (Array.isArray(lista)) apagadas = lista.filter(esFuncionIa)
  } catch { apagadas = [] }

  return { activa, apagadas }
}

export async function leerInterruptores(): Promise<EstadoInterruptores> {
  const db = createAdminClient()
  const { data } = await db.from('settings').select('key, value').in('key', CLAVES_INTERRUPTORES)
  const S = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  return interpretarInterruptores(S)
}

/** ¿Puede llamarse esta función ahora mismo? (general encendido y ella también) */
export function funcionEncendida(estado: EstadoInterruptores, fn: FnIa): boolean {
  return estado.activa && !estado.apagadas.includes(fn)
}

/**
 * Qué funciones están encendidas ahora mismo, para que una pantalla no ofrezca un
 * botón que va a decir que no. NO sustituye a la comprobación de `chatInterno`:
 * esto es cortesía con el que mira, aquello es el control.
 */
export async function estadoFuncionesIa<T extends FnIa>(fns: readonly T[]): Promise<Record<T, boolean>> {
  const estado = await leerInterruptores()
  return Object.fromEntries(fns.map(f => [f, funcionEncendida(estado, f)])) as Record<T, boolean>
}
