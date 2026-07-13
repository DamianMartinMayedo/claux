import { Resend } from 'resend'

let instancia: Resend | null = null

export function getResend(): Resend {
  if (!instancia) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY no configurado.')
    instancia = new Resend(key)
  }
  return instancia
}
