// ── Avisar al cliente final, con el dueño en el bucle ─────────────────────────
//
// CLAUX no le escribe al cliente del negocio (decisión de producto: sin correo, sin
// WhatsApp Business API). Lo que sí puede hacer es dejarle el mensaje escrito al dueño
// y abrirle el chat: coste cero, sin API y sin prometer nada que no se cumpla. El veto
// cubano es a la *WhatsApp Business API*, no al chat normal.
//
// Módulo puro: lo usan las dos vistas del portal.

import type { EstadoReserva } from './estados'

/** Prefijo por defecto cuando el teléfono viene sin país. Cuba. */
const PREFIJO_DEFECTO = '53'

/**
 * Teléfono en el formato que quiere `wa.me`: solo dígitos, con país.
 *
 * Devuelve null si no hay nada usable — mejor no ofrecer el botón que abrir un chat
 * con un número inventado.
 */
export function telefonoWa(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digitos = raw.replace(/\D/g, '')
  if (digitos.length < 6) return null
  // Ya trae país si es más largo que un móvil cubano (8 dígitos).
  return digitos.length > 8 ? digitos : `${PREFIJO_DEFECTO}${digitos}`
}

function fmtFecha(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

export interface DatosAviso {
  tipo:      'reserva' | 'cita'
  negocio:   string
  nombre:    string
  fecha:     string
  hora:      string | null
  estado:    EstadoReserva
}

/**
 * El mensaje ya redactado, según en qué estado está.
 *
 * No es un canal automático: no hay envío programado, ni cola, ni registro de
 * entrega. Es el dueño escribiendo, con el trabajo de teclear ya hecho.
 */
export function textoAviso(d: DatosAviso): string {
  const qué    = d.tipo === 'cita' ? 'cita' : 'reserva'
  const cuando = `${fmtFecha(d.fecha)}${d.hora ? ` a las ${d.hora.substring(0, 5)}` : ''}`
  const hola   = d.nombre ? `Hola ${d.nombre}, ` : 'Hola, '

  switch (d.estado) {
    case 'CONFIRMADA':
      return `${hola}te confirmamos tu ${qué} del ${cuando} en ${d.negocio}. ¡Te esperamos!`
    case 'RECHAZADA':
      return `${hola}lo sentimos: no podemos atender tu ${qué} del ${cuando} en ${d.negocio}. ¿Te viene bien otro momento?`
    case 'CANCELADA':
      return `${hola}tu ${qué} del ${cuando} en ${d.negocio} queda cancelada. Cuando quieras la volvemos a hacer.`
    case 'PENDIENTE':
      return `${hola}hemos recibido tu ${qué} para el ${cuando} en ${d.negocio}. Te confirmamos enseguida.`
    default:
      // ATENDIDA / NO_SHOW / CADUCADA son notas internas: si el dueño abre el chat
      // desde ahí, lo natural es un recordatorio neutro, no «no viniste».
      return `${hola}te escribimos de ${d.negocio} por tu ${qué} del ${cuando}.`
  }
}

/**
 * A dónde lleva el botón, por orden de lo que de verdad funciona:
 * WhatsApp (el chat que usa todo el mundo) → Telegram si vino por el bot →
 * llamada a secas.
 */
export function enlaceAviso(
  telefono: string | null | undefined,
  chatTelegram: string | null | undefined,
  texto: string,
): { url: string; canal: 'whatsapp' | 'telegram' | 'llamada' } | null {
  const wa = telefonoWa(telefono)
  if (wa) return { url: `https://wa.me/${wa}?text=${encodeURIComponent(texto)}`, canal: 'whatsapp' }
  // Telegram no admite prellenar el texto de un chat ajeno: se abre el chat y el
  // dueño pega. Aun así es mejor que nada cuando no hay teléfono.
  if (chatTelegram) return { url: `tg://user?id=${chatTelegram}`, canal: 'telegram' }
  if (telefono) return { url: `tel:${telefono.replace(/\s/g, '')}`, canal: 'llamada' }
  return null
}
