// ── Conversión de importes entre monedas del tenant (server-only) ──
// Reutiliza el modelo de monedas del cliente: `monedas` (código + símbolo) y
// `tasas_cambio` (tasa más reciente por par origen→destino). La lógica de factor
// es la misma que la consolidación del dashboard (dashboard.ts): un par
// A→B con tasa T significa "1 A = T B"; para convertir en la otra dirección se
// usa el inverso. Si no hay tasa para un par, `convertir` devuelve null y el
// llamador decide el fallback (normalmente, mostrar el importe en su moneda).

import { createAdminClient } from '@/lib/supabase/admin'

export interface Conversor {
  /** Convierte `monto` de `origen` a `destino`. null si no hay tasa para el par. */
  convertir(monto: number, origen: string, destino: string): number | null
  /** Símbolo de una moneda (o su código si no tiene símbolo). */
  simbolo(codigo: string): string
}

export async function construirConversor(
  db: ReturnType<typeof createAdminClient>,
  clientId: string,
): Promise<Conversor> {
  const [{ data: monedas }, { data: tasas }] = await Promise.all([
    db.from('monedas').select('codigo, simbolo').eq('client_id', clientId),
    db.from('tasas_cambio')
      .select('moneda_origen, moneda_destino, tasa, fecha')
      .eq('client_id', clientId)
      .order('fecha', { ascending: false }),
  ])

  // Tasa más reciente por par (la primera al venir ordenado por fecha desc).
  const rateMap = new Map<string, number>()
  for (const t of (tasas ?? [])) {
    const k = `${t.moneda_origen}__${t.moneda_destino}`
    if (!rateMap.has(k)) rateMap.set(k, Number(t.tasa))
  }
  const simbolos = new Map<string, string>(
    (monedas ?? []).map((m: { codigo: string; simbolo: string | null }) => [m.codigo, m.simbolo || m.codigo]),
  )

  function factor(origen: string, destino: string): number | null {
    if (origen === destino) return 1
    const saliente = rateMap.get(`${destino}__${origen}`) // 1 destino = X origen
    if (saliente && saliente > 0) return 1 / saliente
    const entrante = rateMap.get(`${origen}__${destino}`) // 1 origen = X destino
    if (entrante && entrante > 0) return entrante
    return null
  }

  return {
    convertir(monto, origen, destino) {
      const f = factor(origen, destino)
      return f == null ? null : Math.round(monto * f * 100) / 100
    },
    simbolo(codigo) {
      return simbolos.get(codigo) ?? codigo
    },
  }
}
