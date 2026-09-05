// ── Los textos fijos de la propuesta, editables sin desplegar ───────────────
//
// Cuatro diapositivas de las dieciséis no hablan del cliente: qué es CLAUX (3),
// el antes y el después (4), por qué confiar (15) y cómo empezamos (16). Más el
// reparto del pago de la instalación, que hoy es 50 % / 50 % y mañana puede no
// serlo.
//
// Estaban escritas en `AJUSTES_POR_DEFECTO`, dentro del motor. Eso significa que
// cambiar una coma es un despliegue, y un despliegue por una coma es una coma que
// no se cambia: la plantilla de PowerPoint acabó vendiendo planes retirados en
// agosto por exactamente esta razón.
//
// El código sigue siendo el valor por defecto —una propuesta nunca se queda sin
// texto porque nadie haya entrado en Configuración—, y `settings` solo pisa lo
// que tenga escrito. Es el mismo trato que los textos legales.

import type { Tarjeta } from './tipos'

export const CLAVES_AJUSTES = {
  queEs:     'propuesta_que_es',
  problema:  'propuesta_problema',
  confianza: 'propuesta_confianza',
  empecemos: 'propuesta_empecemos',
  pago:      'propuesta_pago',
} as const

export const CLAVES_AJUSTES_LISTA: string[] = Object.values(CLAVES_AJUSTES)

/**
 * Las tarjetas guardadas, o las del código si no hay o vienen mal.
 *
 * Se valida cada elemento, no solo que sea un array: esto lo pinta una página
 * pública y una tarjeta a medias («título sin cuerpo») es la diapositiva rota
 * delante del cliente que la propuesta vino a evitar. Ante la duda, el valor por
 * defecto, que siempre está completo.
 */
export function tarjetasDesde(raw: string | undefined, def: Tarjeta[]): Tarjeta[] {
  if (!raw?.trim()) return def
  try {
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return def
    const buenas = v
      .map((t) => {
        const o = (t ?? {}) as Record<string, unknown>
        const titulo = typeof o.titulo === 'string' ? o.titulo.trim() : ''
        const cuerpo = typeof o.cuerpo === 'string' ? o.cuerpo.trim() : ''
        return titulo && cuerpo ? { titulo, cuerpo } : null
      })
      .filter((t): t is Tarjeta => t !== null)
    return buenas.length > 0 ? buenas : def
  } catch {
    return def
  }
}

/** El texto a JSON, para guardarlo. Las tarjetas incompletas se caen aquí. */
export function tarjetasComoJson(tarjetas: Tarjeta[]): string {
  const buenas = tarjetas
    .map(t => ({ titulo: t.titulo.trim(), cuerpo: t.cuerpo.trim() }))
    .filter(t => t.titulo && t.cuerpo)
  return JSON.stringify(buenas)
}

/** Una línea por punto. Vacío = las del código. */
export function lineasDesde(raw: string | undefined, def: string[]): string[] {
  const lineas = (raw ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  return lineas.length > 0 ? lineas : def
}

/** Un texto suelto (el reparto del pago). Vacío = el del código. */
export function textoDesde(raw: string | undefined, def: string): string {
  const t = (raw ?? '').trim()
  return t.length > 0 ? t : def
}
