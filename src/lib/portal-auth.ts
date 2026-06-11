/**
 * JWT sin dependencias externas — usa Web Crypto API (Node 18+ / Next.js edge).
 * Cookie httpOnly: claux_portal
 */

export const PORTAL_COOKIE = 'claux_portal'
export const SESSION_DURATION = 60 * 60 * 24 // 24 h en segundos

export interface PortalSession {
  user_id:      string
  client_id:    string
  email:        string
  rol:          'admin_empresa' | 'usuario'
  solo_lectura: boolean
  exp:          number
  iat:          number
}

// ── Base64url helpers ─────────────────────────────────────────────────────────

function b64uEncode(input: string | ArrayBuffer): string {
  const str =
    typeof input === 'string'
      ? input
      : String.fromCharCode(...new Uint8Array(input))
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function b64uDecode(str: string): string {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'))
}

// ── Clave HMAC ────────────────────────────────────────────────────────────────

async function getHmacKey(usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const secret = process.env.PORTAL_JWT_SECRET
  if (!secret || secret.startsWith('REEMPLAZAR')) {
    throw new Error('PORTAL_JWT_SECRET no configurado en .env.local')
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  )
}

// ── Sign / Verify ─────────────────────────────────────────────────────────────

export async function signPortalToken(
  payload: Omit<PortalSession, 'exp' | 'iat'>,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header  = b64uEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body    = b64uEncode(JSON.stringify({ ...payload, iat: now, exp: now + SESSION_DURATION }))
  const data    = `${header}.${body}`
  const key     = await getHmacKey('sign')
  const sigBuf  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${b64uEncode(sigBuf)}`
}

export async function verifyPortalToken(token: string): Promise<PortalSession | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [header, body, sig] = parts
    const data = `${header}.${body}`
    const key  = await getHmacKey('verify')
    const sigBytes = Uint8Array.from(b64uDecode(sig), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data))
    if (!valid) return null
    const payload = JSON.parse(b64uDecode(body)) as PortalSession
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ── Password (mismo algoritmo que el admin — SHA-256 sobre password+salt) ─────

export async function hashPasswordPortal(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(password + salt)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
