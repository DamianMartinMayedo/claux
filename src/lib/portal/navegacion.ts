// ── Qué hay en la navegación del portal, y en qué orden ──
// Pura: ni BD ni React. La lista del menú lateral tiene reglas que NO están en
// `modulos_catalogo` —la página compartida de «Clientes y proveedores», el catálogo
// del mostrador y su etiqueta según lo que le quede por catalogar, los nombres por
// sector— y vivían dentro del render del sidebar. En cuanto hizo falta la MISMA
// lista para el mapa que se le entrega a la IA, quedaron a la vista como dos copias
// esperando a derivar. Ahora el sidebar la pinta y `lib/ia/mapa.ts` la cuenta; las
// reglas se escriben una sola vez.

import type { EtiquetasSector } from '@/lib/sector'

export interface PaginaNav { ruta: string; label: string; orden: number }

export interface ModuloNav {
  clave:   string
  nombre:  string
  tipo:    'base' | 'modulo' | 'funcionalidad' | 'addon'
  paginas: PaginaNav[] | null
  orden:   number
}

export interface Navegacion {
  /** Sin grupo, arriba: el Dashboard y las funcionalidades contratadas. */
  sueltas: PaginaNav[]
  /** Un grupo desplegable por módulo contratado, en el orden del catálogo. */
  grupos:  { clave: string; nombre: string; paginas: PaginaNav[] }[]
}

export const PAGINA_DASHBOARD: PaginaNav = { ruta: '/portal/dashboard', label: 'Dashboard', orden: 0 }

/**
 * «Productos» del mostrador: página REAL (/portal/caja/productos) que no está en
 * `modulos_catalogo.paginas` de `caja` a propósito. Solo tiene sentido para quien NO
 * tiene Inventario —con él, los físicos se catalogan en /portal/productos—, y el
 * catálogo comercial no sabe de esa condición: si se metiera allí, aparecería
 * duplicada para todos los que tienen los dos módulos.
 */
const CAJA_CATALOGO: PaginaNav = { ruta: '/portal/caja/productos', label: 'Catálogo', orden: 15 }

/** Orden de preferencia del grupo que aloja la página compartida de terceros. */
const ANFITRIONES_TERCEROS = ['base', 'inventario', 'servicios']

export function paginasDe(paginas: unknown): PaginaNav[] {
  if (Array.isArray(paginas)) return paginas as PaginaNav[]
  if (typeof paginas === 'string') {
    try { const p = JSON.parse(paginas); return Array.isArray(p) ? p : [] }
    catch { return [] }
  }
  return []
}

export interface OpcionesNav {
  catalogo:        ModuloNav[]
  /** Módulos que ESTE usuario ve (tenant ∩ permisos), no lo que el tenant contrató. */
  modulosVisibles: string[]
  etiquetas:       Pick<EtiquetasSector, 'catalogo' | 'suscripcion'>
}

/** Rótulo de una página tal y como lo lee el dueño (el sector renombra algunas). */
export function etiquetaPagina(ruta: string, label: string, e: OpcionesNav['etiquetas']): string {
  // Restaurante: «Menú digital»; resto: «Catálogo digital» / «Servicios digital».
  if (ruta === '/portal/catalogo' && e.catalogo) return `${e.catalogo} digital`
  // Un gimnasio dice «Membresías» y una peluquería «Bonos». Nunca «Contratos»:
  // esa entrada ya existe y es de RRHH (mig. 164).
  if (ruta === '/portal/suscripciones' && e.suscripcion) return e.suscripcion
  return label
}

export function construirNavegacion({ catalogo, modulosVisibles, etiquetas }: OpcionesNav): Navegacion {
  const tiene = (c: string) => modulosVisibles.includes(c)
  const rotular = (p: PaginaNav): PaginaNav => ({ ...p, label: etiquetaPagina(p.ruta, p.label, etiquetas) })

  const sueltas: PaginaNav[] = [PAGINA_DASHBOARD]
  for (const f of catalogo.filter(c => c.tipo === 'funcionalidad' && tiene(c.clave))) {
    for (const p of paginasDe(f.paginas).sort((a, b) => a.orden - b.orden)) sueltas.push(rotular(p))
  }

  // «Clientes y proveedores» es una ruta COMPARTIDA por base, Inventario y Servicios:
  // se pinta UNA vez, en el grupo del primer módulo contratado de la lista. Vive en
  // las páginas de base; si base no está, se le inyecta al anfitrión que toque.
  const modulos    = catalogo.filter(c => c.tipo === 'modulo')
  const terceros   = paginasDe(modulos.find(m => m.clave === 'base')?.paginas).find(p => p.ruta === '/portal/terceros')
  const anfitrion  = ANFITRIONES_TERCEROS.find(tiene)

  // El mostrador cataloga lo que no tiene módulo propio: los físicos si falta
  // Inventario, los servicios si falta Servicios, los dos si faltan los dos. Con
  // ambos módulos no cataloga nada y la página redirige.
  const cajaCataloga = tiene('caja') && !(tiene('inventario') && tiene('servicios'))
  const cajaPagina: PaginaNav = {
    ...CAJA_CATALOGO,
    // La etiqueta dice lo que la página LLEVA.
    label: tiene('inventario') ? 'Servicios' : tiene('servicios') ? 'Productos' : 'Catálogo',
  }

  const grupos = modulos.filter(m => tiene(m.clave)).map(m => {
    let paginas = paginasDe(m.paginas).sort((a, b) => a.orden - b.orden)
    if (terceros && anfitrion === m.clave && m.clave !== 'base') paginas = [...paginas, terceros]
    if (cajaCataloga && m.clave === 'caja') paginas = [...paginas, cajaPagina].sort((a, b) => a.orden - b.orden)
    return { clave: m.clave, nombre: m.nombre, paginas: paginas.map(rotular) }
  })

  return { sueltas, grupos }
}

/** Todas las rutas realmente pintadas, para resolver cuál está activa. */
export function rutasDe(nav: Navegacion): string[] {
  return [...nav.sueltas.map(p => p.ruta), ...nav.grupos.flatMap(g => g.paginas.map(p => p.ruta))]
}
