// ── Páginas del menú de cuenta del panel interno (avatar, arriba a la derecha) ──
// El gemelo de `lib/portal/paginas-cuenta.ts`, y por el mismo motivo: son las
// páginas de AJUSTE, no de trabajo. La barra lateral es para lo que se hace todos
// los días (clientes, pagos, soporte); esto es lo que se toca de vez en cuando y
// no merece un sitio permanente a la izquierda.
//
// Fuente única: la consume el menú (`components/admin/Header`), y cualquier otra
// pantalla que necesite saber qué hay aquí. Con dos listas a mano, la segunda
// deriva en silencio.

import type { SeccionKey } from '@/lib/roles'

export type GrupoCuenta = 'Mi cuenta' | 'Sistema'

export interface PaginaCuenta {
  ruta:  string
  label: string
  grupo: GrupoCuenta
  /** La sección que hay que tener para verla. Sin `key` la ve todo el que entra:
   *  es el caso de «Mi perfil», que son tus propios datos y no los de nadie más.
   *  El candado real vive en el guard de cada página; esto es solo navegación. */
  key?: SeccionKey
}

export const PAGINAS_CUENTA: PaginaCuenta[] = [
  { ruta: '/admin/perfil',         label: 'Mi perfil',      grupo: 'Mi cuenta' },
  { ruta: '/admin/usuarios',       label: 'Usuarios',       grupo: 'Sistema', key: 'usuarios' },
  { ruta: '/admin/configuracion',  label: 'Configuración',  grupo: 'Sistema', key: 'configuracion' },
  { ruta: '/admin/notificaciones', label: 'Notificaciones', grupo: 'Sistema', key: 'notificaciones' },
  { ruta: '/admin/actividad',      label: 'Actividad',      grupo: 'Sistema', key: 'actividad' },
]

/**
 * Qué ve aquí quien está en sesión. Se filtra con el MISMO `puedeAcceder` que la
 * barra lateral y los guards, para que el menú no ofrezca una puerta que la
 * página va a cerrar.
 *
 * A un vendedor sin ninguna sección de Sistema le queda solo «Mi perfil», y eso
 * basta: el menú sigue existiendo, con su perfil, el tema y salir. Un menú que
 * desaparece según el rol es peor que uno corto —el sitio de «Cerrar sesión»
 * tiene que ser el mismo para todo el mundo—.
 */
export function paginasCuentaVisibles(
  puede: (key: SeccionKey) => boolean,
): PaginaCuenta[] {
  return PAGINAS_CUENTA.filter(p => !p.key || puede(p.key))
}

export const GRUPOS_CUENTA: GrupoCuenta[] = ['Mi cuenta', 'Sistema']
