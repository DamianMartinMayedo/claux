// ── Token del enlace público del deck — fuente única de formato ──────────────
//
// El token ES la credencial (capability URL): la des-adivinabilidad la da la
// ENTROPÍA, no el formato — por eso el guard solo evita escanear basura (no-match
// → 404), no protege nada por sí mismo.
//
// Dos formatos conviven a propósito:
//   · Histórico: 32 hex (uuid v4 sin guiones) — los enlaces ya repartidos.
//   · Nuevo:     16 base62 (~95 bits) — más corto y legible, igual de inadivinable.
// El validador acepta AMBOS para no romper ningún enlace vivo. Centralizado aquí
// para que no vuelva a haber tres regex sueltos que haya que mantener en sync.

/** Los dos formatos emitidos: el histórico de 32 hex y el nuevo base62 de 16. */
export const TOKEN_PAT = '(?:[0-9a-f]{32}|[0-9A-Za-z]{16})'

const TOKEN_RE = new RegExp(`^${TOKEN_PAT}$`)

/** ¿Tiene forma de token del deck? Acepta el hex de 32 y el base62 nuevo. */
export function esTokenValido(token: string): boolean {
  return TOKEN_RE.test(token)
}

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Token nuevo: 16 caracteres base62 (~95 bits). Rechazo de sesgo de módulo
 * (descarta bytes ≥ 248 = 62·4) para que las 62 letras sean equiprobables. Sirve
 * en servidor y en navegador (Web Crypto).
 */
export function nuevoToken(): string {
  const N = 16
  let out = ''
  while (out.length < N) {
    const bytes = crypto.getRandomValues(new Uint8Array(N))
    for (const b of bytes) {
      if (b >= 248) continue
      out += ALFABETO[b % 62]
      if (out.length === N) break
    }
  }
  return out
}
