/**
 * Índice de la Parte II de la Academia: el catálogo de lo que se vende, más las
 * piezas transversales que vienen con todo CLAUX.
 *
 * Esto es el ESQUELETO: orden, nombre visible, tipo, páginas y la ruta de su
 * ficha en Markdown. Los NÚMEROS y el ESTADO (precio, nombre comercial,
 * activo/archivado) **no se teclean aquí**: se leen en vivo de `modulos_catalogo`
 * —la misma tabla que usa el producto— en `precios.ts`. Así el manual no se
 * desfasa: cambia un precio en el admin y la ficha lo refleja sola.
 *
 * El TEXTO de cada ficha vive en `content/academia/<carpeta>/<slug>.md`.
 */

export type TipoFicha = 'modulo' | 'funcionalidad' | 'addon' | 'capacidad' | 'transversal'

export type FichaCatalogo = {
  /** Ancla en la página y nombre del archivo .md. */
  slug: string
  /**
   * Clave en `modulos_catalogo`, por la que se cruzan nombre y precios en vivo.
   * Las piezas transversales y las de capacidad no están en el catálogo: no se
   * venden ni se gatean por sí solas, así que no la tienen.
   */
  clave?: string
  /** Nombre tal como se ve en el portal. Lo pisa el catálogo si hay clave. */
  nombre: string
  tipo: TipoFicha
  /** Una línea para el índice, mientras la ficha no está escrita. */
  resumen: string
  /** Páginas del portal, solo en módulos multi-página. */
  paginas?: string[]
  /** Dónde vive en el portal, en las que no se venden (no tienen precio que enseñar). */
  donde?: string
}

/** Carpeta de contenido de cada tipo, dentro de `content/academia/`. */
export function carpetaDe(tipo: TipoFicha): string {
  return tipo === 'transversal' ? '3-transversales' : '2-modulos'
}

export type Grupo = {
  tipo: TipoFicha
  /** Rótulo de la sección, en plural. */
  titulo: string
  /** Una línea de qué es esta familia. */
  nota: string
  /** Rótulo de la pastilla de UNA ficha, en singular. */
  pastilla: string
  /**
   * Cómo se dice lo mismo en el centro de ayuda público.
   *
   * «Addon» y «Funcionalidad» son palabras de vender, no de usar: al dueño de un
   * negocio no le dicen nada y encima le hacen pensar que hay una diferencia que
   * le importa. Aquí, y no en la página, para que la sección, la pastilla y el
   * índice lateral no se contradigan — que es lo que pasaba cuando cada uno
   * llevaba su propia lista.
   */
  publico?: { titulo: string; nota: string; pastilla: string }
}

export const GRUPOS: Grupo[] = [
  {
    tipo: 'modulo', titulo: 'Módulos', pastilla: 'Módulo',
    nota: 'Piezas grandes, muchas veces con varias páginas.',
    publico: {
      titulo: 'Las áreas del negocio', pastilla: 'Área',
      nota: 'Las partes grandes del portal, cada una con varias pantallas dentro.',
    },
  },
  {
    tipo: 'funcionalidad', titulo: 'Funcionalidades', pastilla: 'Funcionalidad',
    nota: 'Se venden y funcionan solas.',
    publico: {
      titulo: 'Herramientas', pastilla: 'Herramienta',
      nota: 'Funcionan por su cuenta; se activan si el negocio las necesita.',
    },
  },
  {
    tipo: 'addon', titulo: 'Addons', pastilla: 'Addon',
    nota: 'Amplían algo que el negocio ya tiene.',
    publico: {
      titulo: 'Añadidos', pastilla: 'Añadido',
      nota: 'Amplían algo que el negocio ya tiene.',
    },
  },
  {
    tipo: 'capacidad', titulo: 'Lo decide tu nivel', pastilla: 'Lo decide tu nivel',
    nota: 'No se compran aparte: cuánto cabe lo fija el nivel contratado.',
    publico: {
      titulo: 'Según tu nivel', pastilla: 'Según tu nivel',
      nota: 'No se activan aparte: cuánto cabe lo decide el nivel contratado.',
    },
  },
  {
    tipo: 'transversal', titulo: 'Viene con todo', pastilla: 'Viene con todo',
    nota: 'No se contratan ni se cobran aparte: están desde el primer día.',
    publico: {
      titulo: 'Viene con todo', pastilla: 'Viene con todo',
      nota: 'Están desde el primer día, sin activar nada y sin pagar aparte.',
    },
  },
]

/** Los grupos tal y como los dice la superficie que los pinta. */
export function gruposDe(publico = false): Grupo[] {
  return GRUPOS.map(g => (publico && g.publico ? { ...g, ...g.publico } : g))
}

/** La pastilla de una ficha, en la superficie que la pinta. */
export function pastillaDe(tipo: TipoFicha, publico = false): string {
  return gruposDe(publico).find(g => g.tipo === tipo)?.pastilla ?? ''
}

export const CATALOGO: FichaCatalogo[] = [
  // ── Módulos ────────────────────────────────────────────────────────────────
  {
    slug: 'contabilidad', clave: 'base', nombre: 'Contabilidad', tipo: 'modulo',
    resumen: 'El dinero del negocio: ventas, gastos, quién debe y si ganas.',
    paginas: ['Ventas', 'Gastos y cobros', 'Cuentas por cobrar', 'Cuentas por pagar', 'Tesorería', 'Reportes', 'Clientes y proveedores', 'Asesores'],
  },
  {
    slug: 'inventario', clave: 'inventario', nombre: 'Inventario', tipo: 'modulo',
    resumen: 'Qué hay, dónde y a cuánto; entradas, salidas y compras.',
    paginas: ['Productos', 'Almacenes', 'Movimientos', 'Compras', 'Conteo físico'],
  },
  {
    slug: 'servicios', clave: 'servicios', nombre: 'Servicios', tipo: 'modulo',
    resumen: 'Lo que se cobra por hacer, y los cobros que se repiten.',
    paginas: ['Servicios', 'Suscripciones'],
  },
  {
    slug: 'rrhh', clave: 'rrhh', nombre: 'RRHH', tipo: 'modulo',
    resumen: 'El personal, sus turnos y la nómina.',
    paginas: ['Personal', 'Turnos', 'Nómina', 'Reportes'],
  },
  {
    slug: 'punto-de-venta', clave: 'caja', nombre: 'Punto de venta', tipo: 'modulo',
    resumen: 'Cobrar en el mostrador, incluso sin conexión.',
    paginas: ['Puntos de venta', 'Operaciones', 'Cierres', 'Sincronizar'],
  },

  // ── Funcionalidades ──────────────────────────────────────────────────────────
  {
    slug: 'catalogo-digital', clave: 'catalogo_qr', nombre: 'Menú / catálogo digital', tipo: 'funcionalidad',
    resumen: 'La carta o el catálogo del negocio, por QR y desde el móvil.',
  },
  {
    slug: 'citas', clave: 'agenda', nombre: 'Citas', tipo: 'funcionalidad',
    resumen: 'La agenda del negocio: quién atiende a quién y cuándo.',
  },
  {
    slug: 'reservas', clave: 'reservas_citas', nombre: 'Reservas', tipo: 'funcionalidad',
    resumen: 'Mesas, clases o pistas por aforo y franja.',
  },
  {
    slug: 'dossier', clave: 'dossier', nombre: 'Dossier del negocio', tipo: 'funcionalidad',
    resumen: 'El documento que presenta el negocio a un inversor o banco.',
  },

  // ── Addons ─────────────────────────────────────────────────────────────────
  {
    slug: 'asistente-ia', clave: 'asistente_ia', nombre: 'Asistente IA', tipo: 'addon',
    resumen: 'Preguntarle al negocio en lenguaje normal.',
  },
  // ── Capacidad del nivel ────────────────────────────────────────────────────
  // Fueron los addons `multiempresa` y `multidossier` hasta la retirada de
  // 2026-08-28. No se venden aparte: cuántas empresas y cuántos dossiers caben lo
  // dice el NIVEL (`nivel_limites`), igual que los productos o los trabajadores.
  // Siguen teniendo ficha propia porque siguen siendo capacidades que hay que
  // saber explicar —y ahora, además, vender el nivel que las da—; lo que ya no
  // tienen es `clave`, porque no hay fila en `modulos_catalogo` que consultar.
  {
    slug: 'varias-empresas', nombre: 'Varias empresas', tipo: 'capacidad',
    resumen: 'Varias empresas bajo el mismo negocio, con su vista consolidada.',
    donde: 'Menú de la cuenta → Mis empresas',
  },
  {
    slug: 'varios-dossiers', nombre: 'Varios dossiers', tipo: 'capacidad',
    resumen: 'Más de un dossier a la vez, cada uno con su enlace.',
    donde: 'Portal → Dossier',
  },

  // ── Piezas transversales ───────────────────────────────────────────────────
  // No están en `modulos_catalogo`: no se contratan, no se cobran y no llevan
  // candado de módulo. Vienen con todo CLAUX, y por eso hay que saber venderlas:
  // la mitad de lo que hace único a CLAUX en Cuba está aquí.
  {
    slug: 'monedas-y-tasas', nombre: 'Monedas y tasas', tipo: 'transversal',
    resumen: 'Cobrar y pagar en varias monedas, con la tasa del día puesta sola.',
    donde: 'Menú de la cuenta → Monedas y tasas',
  },
  {
    slug: 'clientes-y-proveedores', nombre: 'Clientes y proveedores', tipo: 'transversal',
    resumen: 'La agenda del negocio: a quién se le vende y a quién se le compra.',
    donde: 'Menú lateral → Clientes y proveedores',
  },
  {
    slug: 'dashboard', nombre: 'Dashboard', tipo: 'transversal',
    resumen: 'La pantalla de inicio: lo pendiente, tu dinero, tu día y tu negocio.',
    donde: 'Menú lateral → Inicio',
  },
  {
    slug: 'notificaciones', nombre: 'Notificaciones', tipo: 'transversal',
    resumen: 'La campana: lo que el negocio tiene que atender, sin ir a buscarlo.',
    donde: 'Campana de la cabecera → Notificaciones',
  },
]
