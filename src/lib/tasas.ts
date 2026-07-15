// ── Conversión de importes entre monedas del tenant (server-only) ──
// Reutiliza el modelo de monedas del cliente: `monedas` (código + símbolo) y
// `tasas_cambio` (tasa más reciente por par origen→destino). La lógica de factor
// es la misma que la consolidación del dashboard (dashboard.ts): un par
// A→B con tasa T significa "1 A = T B"; para convertir en la otra dirección se
// usa el inverso. Si no hay tasa para un par, `convertir` devuelve null y el
// llamador decide el fallback (normalmente, mostrar el importe en su moneda).

import { createAdminClient } from '@/lib/supabase/admin'

export interface DetalleTasa {
  /** Factor origen→destino ("1 origen = tasa destino"). Para imprimir la tasa usada. */
  tasa: number
  /** Fecha de la tasa aplicada (YYYY-MM-DD), o null si es la misma moneda. */
  fecha: string | null
}

export interface Conversor {
  /** Convierte `monto` de `origen` a `destino`. null si no hay tasa para el par. */
  convertir(monto: number, origen: string, destino: string): number | null
  /** Símbolo de una moneda (o su código si no tiene símbolo). */
  simbolo(codigo: string): string
  /**
   * Tasa aplicada y su fecha para el par `origen→destino`, null si no hay tasa.
   * Para imprimir la conversión ("1 USD = 320 CUP (01/07/2026)") llama con la
   * moneda de presentación como `origen` y la foránea como `destino`.
   */
  detalle(origen: string, destino: string): DetalleTasa | null
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
  // Guardamos {tasa, fecha}: la fecha alimenta detalle() y el select ya la trae.
  const rateMap = new Map<string, DetalleTasa>()
  for (const t of (tasas ?? [])) {
    const k = `${t.moneda_origen}__${t.moneda_destino}`
    if (!rateMap.has(k)) rateMap.set(k, { tasa: Number(t.tasa), fecha: t.fecha ?? null })
  }
  const simbolos = new Map<string, string>(
    (monedas ?? []).map((m: { codigo: string; simbolo: string | null }) => [m.codigo, m.simbolo || m.codigo]),
  )

  // Factor origen→destino con la fecha de la tasa aplicada.
  function factorDetalle(origen: string, destino: string): DetalleTasa | null {
    if (origen === destino) return { tasa: 1, fecha: null }
    const saliente = rateMap.get(`${destino}__${origen}`) // 1 destino = X origen
    if (saliente && saliente.tasa > 0) return { tasa: 1 / saliente.tasa, fecha: saliente.fecha }
    const entrante = rateMap.get(`${origen}__${destino}`) // 1 origen = X destino
    if (entrante && entrante.tasa > 0) return { tasa: entrante.tasa, fecha: entrante.fecha }
    return null
  }

  return {
    convertir(monto, origen, destino) {
      const d = factorDetalle(origen, destino)
      return d == null ? null : Math.round(monto * d.tasa * 100) / 100
    },
    simbolo(codigo) {
      return simbolos.get(codigo) ?? codigo
    },
    detalle(origen, destino) {
      const d = factorDetalle(origen, destino)
      if (d == null) return null
      // Redondeo defensivo: 320 se queda 320; un inverso queda con precisión suficiente.
      return { tasa: Math.round(d.tasa * 1e6) / 1e6, fecha: d.fecha }
    },
  }
}
