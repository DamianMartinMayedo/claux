// Páginas legales públicas (aviso legal, privacidad, cookies).
//
// El texto de cada una lo escribe el equipo desde /admin/configuracion y vive en
// la tabla `settings` (clave/valor), así que no hace falta tabla nueva ni tocar
// RLS: `leerSetting` usa el cliente de servicio y no exige sesión, que es justo
// lo que necesita una página pública.

/** Formato de escritura del cuerpo (ver `parsearLegal`). Se muestra como ayuda
 *  en el admin, así que vive aquí para no repetirlo en dos sitios. */
export const AYUDA_FORMATO =
  'Una línea en blanco separa párrafos. «## » al principio de una línea es un subtítulo, ' +
  '«### » un apartado, y «- » un punto de lista. El título de la página ya se pone solo.'

interface PaginaLegal {
  /** Título visible; también el <h1> y el <title> de la página. */
  titulo: string
  /** Clave en `settings` donde vive el cuerpo. */
  clave: string
  /** Para el <meta name="description">. */
  descripcion: string
}

// ⚠️ SEGURIDAD: este mapa es una LISTA BLANCA, y por eso el slug de la URL nunca
// se concatena para formar la clave de `settings`. Si se hiciera
// `leerSetting('legal_' + slug)`, una visita a /legal/pago_setup_usd_default
// leería un ajuste interno cualquiera y lo publicaría. Un slug que no esté aquí
// es un 404.
export const PAGINAS_LEGALES: Record<string, PaginaLegal> = {
  'aviso-legal': {
    titulo: 'Aviso legal',
    clave: 'legal_aviso_legal',
    descripcion: 'Información legal y datos identificativos del titular de CLAUX.',
  },
  privacidad: {
    titulo: 'Política de privacidad',
    clave: 'legal_privacidad',
    descripcion: 'Cómo trata CLAUX tus datos personales: qué recogemos, para qué y qué derechos tienes.',
  },
  cookies: {
    titulo: 'Política de cookies',
    clave: 'legal_cookies',
    descripcion: 'Qué cookies utiliza CLAUX, para qué sirven y cómo puedes gestionarlas.',
  },
}

/** Enlaces del pie / perfil. El orden es el que se muestra. */
export const ENLACES_LEGALES = Object.entries(PAGINAS_LEGALES).map(([slug, p]) => ({
  href: `/legal/${slug}`,
  titulo: p.titulo,
}))

export type BloqueLegal =
  | { tipo: 'h2' | 'h3' | 'p'; texto: string }
  | { tipo: 'lista'; items: string[] }

/**
 * Convierte el texto plano del admin en bloques con estructura.
 *
 * Es un subconjunto mínimo de Markdown resuelto a mano: así el texto se
 * renderiza como elementos JSX (React escapa el contenido) en vez de inyectarse
 * con `dangerouslySetInnerHTML`, que sería un vector de XSS. Además no añade
 * ninguna dependencia al bundle público (presupuesto de CONTEXTO §3).
 */
export function parsearLegal(texto: string): BloqueLegal[] {
  const bloques: BloqueLegal[] = []
  let parrafo: string[] = []
  let lista: string[] = []

  const cerrarParrafo = () => {
    if (parrafo.length) bloques.push({ tipo: 'p', texto: parrafo.join(' ') })
    parrafo = []
  }
  const cerrarLista = () => {
    if (lista.length) bloques.push({ tipo: 'lista', items: lista })
    lista = []
  }
  const cerrar = () => { cerrarParrafo(); cerrarLista() }

  for (const linea of texto.replace(/\r\n/g, '\n').split('\n')) {
    const l = linea.trim()
    if (!l)                 { cerrar(); continue }
    if (l.startsWith('### ')) { cerrar(); bloques.push({ tipo: 'h3', texto: l.slice(4).trim() }); continue }
    if (l.startsWith('## '))  { cerrar(); bloques.push({ tipo: 'h2', texto: l.slice(3).trim() }); continue }
    if (l.startsWith('- '))   { cerrarParrafo(); lista.push(l.slice(2).trim()); continue }
    cerrarLista()
    parrafo.push(l)
  }
  cerrar()
  return bloques
}
