import { CATALOGO, carpetaDe, type FichaCatalogo } from './catalogo'

/**
 * El manual, pieza a pieza y en orden de lectura.
 *
 * Cada pieza es UNA página con su propia URL (`/academia/<slug>`): el índice
 * lateral, la portada, el «Anterior / Siguiente» y la ruta dinámica salen todos
 * de esta lista, así que añadir una parte o una ficha no obliga a tocar cuatro
 * archivos.
 *
 * Dos clases de pieza:
 *  · las PARTES, que son un documento suelto escrito a mano;
 *  · las FICHAS de la Parte II, que son el catálogo (`catalogo.ts`) con su
 *    cabecera de datos —tipo, páginas, precios en vivo— además del texto.
 */

/**
 * Cómo se llama y qué promete una pieza en el CENTRO DE AYUDA público, cuando el
 * rótulo del manual no vale ahí.
 *
 * Pasa solo en las partes narradas, y por dos razones: la numeración y el
 * recorte. Un cliente ve la I y la VI y ninguna de las cuatro de en medio, así
 * que «Parte VI» le nombra un tomo de un libro que no tiene; y su resumen
 * promete cosas —«lo último que ha cambiado en el producto»— que en su capa no
 * sobreviven al filtro. Las fichas del catálogo no lo necesitan: se llaman como
 * en el portal, que es como el cliente las conoce.
 */
export type Publico = { titulo: string; resumen: string }

export type Parte = {
  slug: string
  titulo: string
  archivo: string
  /** Una línea de qué trae, para la portada. */
  resumen: string
  /** ¿Va después de la Parte II (el catálogo)? La I va antes; de la III en adelante, después. */
  trasCatalogo: boolean
  /** Su rótulo en `/ayuda`. Sin esto, la pieza pública hereda el habla del manual. */
  publico?: Publico
}

/**
 * Las partes que son un documento suelto. La Parte II no está aquí: no es un
 * archivo, es el catálogo, y por eso cada parte declara de qué lado de ella cae.
 */
export const PARTES: Parte[] = [
  {
    slug: 'de-un-vistazo', titulo: 'Parte I — De un vistazo',
    archivo: '1-claux-de-un-vistazo.md', trasCatalogo: false,
    resumen: 'Qué es CLAUX, contra qué problema se levanta, a quién le sirve y cómo se arma cada instalación.',
    publico: {
      titulo: 'Qué es CLAUX',
      resumen: 'Qué resuelve, a qué negocios les sirve, cómo se arma tu cuenta y cómo circula la información entre sus piezas.',
    },
  },
  {
    slug: 'vender', titulo: 'Parte III — Vender',
    archivo: '4-vender.md', trasCatalogo: true,
    resumen: 'Del primer contacto al primer cobro: qué proponer, cómo armar el presupuesto y qué contestar a cada objeción.',
  },
  {
    slug: 'poner-en-marcha', titulo: 'Parte IV — Poner en marcha y sostener',
    archivo: '5-poner-en-marcha.md', trasCatalogo: true,
    resumen: 'La instalación, la migración de los datos de antes, la vida de la cuenta en el panel y el soporte del día a día.',
  },
  {
    slug: 'especializado', titulo: 'Parte V — Especializado',
    archivo: '6-especializado.md', trasCatalogo: true,
    resumen: 'La norma fiscal cubana aplicada a la nómina, cómo está montado el sistema por dentro y lo que no sale del equipo.',
  },
  {
    slug: 'referencia', titulo: 'Parte VI — Referencia',
    archivo: '7-referencia.md', trasCatalogo: true,
    resumen: 'El glosario canónico —un término, una palabra— y lo último que ha cambiado en el producto.',
    publico: {
      titulo: 'Glosario',
      resumen: 'Qué significa exactamente cada palabra del portal, y por qué algunas cambian de nombre según el sector del negocio.',
    },
  },
]

/**
 * Lo que falta por escribir. No es una lista de deseos: es el esqueleto cerrado
 * del manual, y la portada lo enseña para que se vea dónde termina lo que hay.
 * Cuando una se escribe, pasa a `PARTES` de arriba y desaparece de aquí.
 *
 * **Vacía desde el 2026-08-24**: las seis partes del esqueleto están escritas.
 * Se conserva porque la portada la sigue leyendo —y con ella basta anunciar una
 * parte nueva sin tocar la página—; vacía, esa sección no se pinta.
 */
export const PARTES_PREVISTAS: { titulo: string; resumen: string }[] = [
]

export type Pieza = {
  /** Segmento de URL y prefijo de todas sus anclas. */
  slug: string
  /** Nombre visible. En las fichas lo pisa el nombre del catálogo en vivo. */
  titulo: string
  /** Ruta del .md dentro de `content/academia/`. */
  archivo: string
  /** Una línea de qué trae: de la parte o de su ficha de catálogo. */
  resumen: string
  /** Solo las de la Parte II: sus datos de catálogo. */
  ficha?: FichaCatalogo
  /** Su rótulo en `/ayuda`, si el del manual no sirve ahí. */
  publico?: Publico
}

function dePartes(trasCatalogo: boolean): Pieza[] {
  return PARTES
    .filter(p => p.trasCatalogo === trasCatalogo)
    .map(p => ({
      slug: p.slug, titulo: p.titulo, archivo: p.archivo, resumen: p.resumen, publico: p.publico,
    }))
}

/** Todas las piezas en el orden en que se leen: Parte I → catálogo → Parte III. */
export const ORDEN: Pieza[] = [
  ...dePartes(false),
  ...CATALOGO.map(f => ({
    slug: f.slug,
    titulo: f.nombre,
    archivo: `${carpetaDe(f.tipo)}/${f.slug}.md`,
    resumen: f.resumen,
    ficha: f,
  })),
  ...dePartes(true),
]

/* Las rutas viven en `rutas.ts` (las necesita el portal sin cargar esta tabla);
   se reexportan para no cambiar a quien ya las importaba de aquí. */
export { BASE_MANUAL, BASE_AYUDA, rutaDe } from './rutas'

export function piezaPorSlug(slug: string): Pieza | undefined {
  return ORDEN.find(p => p.slug === slug)
}
