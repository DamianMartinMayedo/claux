// ── Lo que cuesta la IA interna, en dinero ───────────────────────────────────
// `ia_uso_interno` ya guarda tokens de entrada y de salida por origen, así que el
// coste es una multiplicación. Lo que faltaba era la tarifa, que ahora vive en
// `ia_modelos` (mig. 236) y la teclea el dueño en /admin/ia.
//
// Sin tarifa NO se estima: el panel dice «sin tarifa». Un coste inventado se lee
// una vez, se cree, y se decide con él.

export interface Tarifa {
  /** USD por millón de tokens de ENTRADA. */
  precioIn:  number | null
  /** USD por millón de tokens de SALIDA. Aquí caen los tokens de razonamiento. */
  precioOut: number | null
}

export function tarifaDe(m: { precio_in?: number | string | null; precio_out?: number | string | null } | null | undefined): Tarifa {
  const n = (v: unknown) => {
    const x = Number(v)
    return Number.isFinite(x) && x > 0 ? x : null
  }
  return { precioIn: n(m?.precio_in), precioOut: n(m?.precio_out) }
}

/** null = no hay tarifa que aplicar (y entonces no se enseña un número). */
export function costeUsd(tokensIn: number, tokensOut: number, t: Tarifa): number | null {
  if (t.precioIn == null && t.precioOut == null) return null
  return (tokensIn / 1e6) * (t.precioIn ?? 0) + (tokensOut / 1e6) * (t.precioOut ?? 0)
}

/** Por debajo de esto no se enseña la cifra: un mes normal cuesta céntimos y un
 *  «0,00» redondeado se lee como «no cuesta nada», que no es lo mismo. */
const MINIMO_VISIBLE = 0.01

export function formatearUsd(v: number): string {
  if (v > 0 && v < MINIMO_VISIBLE) return `< ${formatearUsd(MINIMO_VISIBLE)}`
  return `$${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
