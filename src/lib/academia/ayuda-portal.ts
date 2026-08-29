import { CATALOGO } from './catalogo'
import { BASE_AYUDA } from './rutas'

/**
 * De qué módulo del portal habla cada guía del centro de ayuda.
 *
 * No se escribe a mano: la ficha del manual ya lleva la `clave` del módulo del
 * catálogo, la misma con la que el portal decide qué tiene contratado el
 * cliente. Así, un módulo nuevo hereda su guía en cuanto se le escribe la ficha,
 * y renombrarla en el admin no rompe nada.
 *
 * Solo lo usa la pantalla de Ayuda y soporte, que es por donde el cliente entra
 * al manual: se descartó un botón de ayuda en la cabecera del portal —queda un
 * icono suelto que compite con la campana y el tema, y no se sabe qué hace hasta
 * pulsarlo—. La puerta es «Ayuda y soporte», y desde ahí se va a la guía.
 *
 * Que una guía enlazada exista **y tenga texto público** lo vigila
 * `npm run audit:academia`: si una ficha se queda sin apartados `usar`, el enlace
 * llevaría al cliente a un 404 sin que nadie se entere.
 */
export function guiaDeModulo(clave: string): string | null {
  const ficha = CATALOGO.find(f => f.clave === clave)
  return ficha ? `${BASE_AYUDA}/${ficha.slug}` : null
}
