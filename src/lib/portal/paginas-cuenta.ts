// ── Páginas del menú de la cuenta (avatar, arriba a la derecha) ──
// Fuente ÚNICA de las páginas que NO cuelgan de `modulos_catalogo.paginas`: no
// pertenecen a ningún módulo, así que ni el sidebar las pinta ni el catálogo las
// conoce. Las consumen dos sitios que están OBLIGADOS a decir lo mismo: el menú de
// verdad (`PortalHeader`) y el mapa del portal que se le entrega a la IA
// (`lib/ia/mapa.ts`). Con dos listas a mano, la segunda deriva en silencio.

export type GrupoCuenta = 'Mi cuenta' | 'Negocio'

export interface PaginaCuenta {
  ruta:  string
  label: string
  grupo: GrupoCuenta
  /** Cosa del dueño: se oculta a un `usuario` no-admin. El candado real vive en el
   *  server guard de cada página; esto es solo navegación. */
  soloAdmin?: boolean
  /** Importador de autoservicio: permiso del usuario ∩ módulo ∩ autoservicio activo ∩
   *  migración no a cargo del equipo. NO cuelga de `soloAdmin`: un «operador
   *  solo-importar» también entra. */
  soloImportador?: boolean
}

export const PAGINAS_CUENTA: PaginaCuenta[] = [
  { ruta: '/portal/perfil',         label: 'Mi perfil',       grupo: 'Mi cuenta' },
  { ruta: '/portal/soporte',        label: 'Soporte',         grupo: 'Mi cuenta' },
  { ruta: '/portal/importar-datos', label: 'Importar datos',  grupo: 'Negocio', soloImportador: true },
  { ruta: '/portal/empresas',       label: 'Empresas',        grupo: 'Negocio', soloAdmin: true },
  // «Monedas y tasas» se queda para todos: hasta solo-lectura puede actualizar tasas.
  { ruta: '/portal/monedas',        label: 'Monedas y tasas', grupo: 'Negocio' },
  { ruta: '/portal/usuarios',       label: 'Usuarios',        grupo: 'Negocio', soloAdmin: true },
  { ruta: '/portal/facturacion',    label: 'Mi plan CLAUX',   grupo: 'Negocio', soloAdmin: true },
]

/** Qué ve en este menú un usuario concreto. */
export function paginasCuentaVisibles(o: { esAdmin: boolean; puedeImportar: boolean }): PaginaCuenta[] {
  return PAGINAS_CUENTA.filter(p => (!p.soloAdmin || o.esAdmin) && (!p.soloImportador || o.puedeImportar))
}

export const GRUPOS_CUENTA: GrupoCuenta[] = ['Mi cuenta', 'Negocio']
