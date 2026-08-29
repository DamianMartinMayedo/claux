#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Centinela del manual: ¿sigue diciendo la Academia lo que hace el sistema?
//
// POR QUÉ EXISTE. El manual está lleno de referencias que NO fallan cuando se
// rompen: se quedan calladas, y quien lo lee cree estar leyendo lo que hay.
// Seis maneras de romperlo sin que nadie se entere:
//
//   · **Una etiqueta mal escrita.** `> etiquetas: vendedor · básico` (o `basico`
//     sin tilde) no es un aviso: `filtro.ts` compara contra las cuatro audiencias
//     y, si no encaja ninguna, el apartado **desaparece de las TRES capas** —de la
//     interna también—. Se pierde texto escrito sin una sola línea roja.
//   · **Una directiva que no resuelve.** ```claux:capas``` en una pieza cuyo grafo
//     no tiene esa cara devuelve `null`: hueco en la página, sin error.
//   · **Un atajo de la portada a un encabezado renombrado.** La portada solo pinta
//     los que existen —a propósito, para no dejar enlaces muertos—, así que la
//     entrada por situación se esfuma en silencio.
//   · **Un `.md` que no lee nadie.** Escribir una pieza y no darla de alta en
//     `piezas.ts` deja el trabajo fuera del manual.
//   · **Una guía sin texto público.** «Ayuda y soporte» ofrece al cliente la guía
//     de cada módulo que tiene contratado, en `/ayuda/<slug>`; si esa ficha se
//     queda sin apartados `usar`, el enlace es un 404 y solo se entera quien lo
//     pulse.
//   · **Un módulo del catálogo sin ficha.** El dueño da de alta un módulo desde
//     /admin y el manual sigue sin saber que existe: quien va a venderlo no tiene
//     qué leer. Es [[listas-a-mano-derivan]] aplicado al manual.
//
// ALCANCE DELIBERADAMENTE ESTRECHO, como los otros centinelas: lee el Markdown y
// las literales de los `.ts` (`slug: 'x'`, `clave: 'y'`). No ejecuta el código ni
// entiende una clave construida. Solo grita cuando está seguro.
//
// El cruce con el catálogo necesita `.env.local`; sin él los otros cuatro
// controles se hacen igual y este se anuncia como NO hecho, en vez de callarse.
//
// Uso:  node scripts/audit-academia.mjs   ·   npm run audit:academia
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CONTENIDO = 'content/academia'
const LIB = 'src/lib/academia'

const AUDIENCIAS = ['usar', 'vender', 'operar', 'confidencial']
const PROFUNDIDADES = ['básico', 'avanzado']
const DIAGRAMAS = ['flujo', 'conexiones', 'capas']

/** Espejo de `carpetaDe()` en catalogo.ts: dónde vive el `.md` de cada tipo. */
const carpetaDe = (tipo) => (tipo === 'transversal' ? '3-transversales' : '2-modulos')

const fallos = []
const notas = []
const fallo = (que, donde) => fallos.push({ que, donde })

// ── Leer las literales de los .ts ────────────────────────────────────────────

const leer = (ruta) => readFileSync(ruta, 'utf8')

/** Los `.md` que el manual da de alta, con el slug de la pieza que los usa. */
function piezasDeclaradas() {
  const piezas = new Map() // archivo → slug

  // Las partes narradas declaran su archivo a mano.
  const partes = leer(join(LIB, 'piezas.ts'))
  const rePartes = /slug:\s*'([^']+)',[\s\S]{0,120}?archivo:\s*'([^']+)'/g
  for (const m of partes.matchAll(rePartes)) piezas.set(m[2], m[1])

  // Las fichas del catálogo lo componen: `${carpetaDe(tipo)}/${slug}.md`.
  const catalogo = leer(join(LIB, 'catalogo.ts'))
  const reFichas = /slug:\s*'([^']+)',(?:\s*clave:\s*'([^']+)',)?[\s\S]{0,160}?tipo:\s*'([^']+)'/g
  const fichas = []
  for (const m of catalogo.matchAll(reFichas)) {
    const [, slug, clave, tipo] = m
    piezas.set(`${carpetaDe(tipo)}/${slug}.md`, slug)
    fichas.push({ slug, clave, tipo })
  }
  return { piezas, fichas }
}

/** Las claves del grafo, con qué caras trae cada una. */
function carasDelGrafo() {
  const src = leer(join(LIB, 'grafo.ts'))
  const cuerpo = src.slice(src.indexOf('export const GRAFO'))
  const caras = new Map()
  // Una clave de primer nivel: dos espacios de sangría y `:` con llave detrás.
  const re = /^ {2}'?([\w-]+)'?:\s*\{/gm
  const marcas = [...cuerpo.matchAll(re)]
  for (let i = 0; i < marcas.length; i++) {
    const desde = marcas[i].index
    const hasta = i + 1 < marcas.length ? marcas[i + 1].index : cuerpo.length
    const trozo = cuerpo.slice(desde, hasta)
    caras.set(marcas[i][1], new Set(DIAGRAMAS.filter(d => new RegExp(`^ {4}${d}:`, 'm').test(trozo))))
  }
  return caras
}

/** Las dimensiones de tope que existen de verdad. */
function dimensiones() {
  const src = leer('src/lib/limites.ts')
  const cuerpo = src.slice(src.indexOf('const DIMENSIONES'))
  const dims = new Set([...cuerpo.matchAll(/^ {2}(\w+):\s*\{/gm)].map(m => m[1]))
  dims.add('ia_conversaciones') // se añade a mano en DIMENSIONES_LIMITE
  return dims
}

/** Los atajos de la portada: pieza + texto exacto del encabezado. */
function atajos() {
  const src = leer(join(LIB, 'atajos.ts'))
  const re = /pieza:\s*'([^']+)',\s*encabezado:\s*'((?:[^'\\]|\\.)*)'/g
  return [...src.matchAll(re)].map(m => ({ pieza: m[1], encabezado: m[2].replace(/\\'/g, "'") }))
}

// ── Recorrer el contenido ────────────────────────────────────────────────────

function ficherosMd(dir) {
  const salida = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) salida.push(...ficherosMd(p))
    else if (e.endsWith('.md')) salida.push(p)
  }
  return salida
}

const { piezas, fichas } = piezasDeclaradas()
const caras = carasDelGrafo()
const dims = dimensiones()
const encabezadosPorPieza = new Map() // slug → Set de textos
const conTextoPublico = new Set()     // slugs con al menos un apartado `usar`

for (const ruta of ficherosMd(CONTENIDO)) {
  const rel = ruta.slice(CONTENIDO.length + 1)
  // El README es la nota de la carpeta, no una pieza.
  if (rel === 'README.md') continue

  const slug = piezas.get(rel)
  if (!slug) {
    fallo('escrito pero no dado de alta en `piezas.ts`: no lo lee nadie', rel)
    continue
  }

  const lineas = leer(ruta).split('\n')
  const encabezados = new Set()
  let enCerca = false
  let ultimoEnc = null       // el encabezado vivo
  let etiquetadoYa = false   // ¿ya llevaba etiqueta este encabezado?

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim()
    const num = i + 1

    // ── Bloques cercados: directivas y código literal ──
    const cerca = /^(```+)(.*)$/.exec(l)
    if (cerca) {
      const unaLinea = cerca[2].trimEnd().endsWith('```')
      const info = (unaLinea ? cerca[2].trimEnd().replace(/`+$/, '') : cerca[2]).trim()
      if (!unaLinea) enCerca = !enCerca
      if (!info.startsWith('claux:')) continue

      const dir = /^claux:(\w+)(?::([\w,-]+))?$/.exec(info)
      if (!dir) { fallo(`directiva mal escrita: \`${info}\``, `${rel}:${num}`); continue }
      const [, tipo, clave] = dir

      if (tipo === 'limites') {
        for (const d of (clave ?? '').split(',').filter(Boolean)) {
          if (!dims.has(d)) fallo(`\`claux:limites\` pide la dimensión \`${d}\`, que no existe`, `${rel}:${num}`)
        }
      } else if (DIAGRAMAS.includes(tipo)) {
        const destino = clave ?? slug
        const cara = caras.get(destino)
        if (!cara) fallo(`\`claux:${tipo}\` apunta a \`${destino}\`, que no está en \`grafo.ts\``, `${rel}:${num}`)
        else if (!cara.has(tipo)) fallo(`\`${destino}\` no tiene \`${tipo}\` en \`grafo.ts\`: sale un hueco`, `${rel}:${num}`)
      } else {
        fallo(`\`claux:${tipo}\` no es una directiva: se pinta como bloque de código`, `${rel}:${num}`)
      }
      continue
    }
    if (enCerca) continue

    // ── Encabezados ──
    const he = /^(#{1,6})\s+(.*)$/.exec(l)
    if (he) {
      ultimoEnc = he[2].trim()
      etiquetadoYa = false
      encabezados.add(ultimoEnc)
      continue
    }

    // ── Etiquetas ──
    const etq = /^>\s*etiquetas:\s*(.*)$/i.exec(l)
    if (!etq) continue

    if (!ultimoEnc) {
      fallo('línea `> etiquetas:` sin encabezado delante: no marca nada', `${rel}:${num}`)
      continue
    }
    if (etiquetadoYa) {
      fallo(`«${ultimoEnc}» lleva dos líneas de etiquetas: solo cuenta la primera`, `${rel}:${num}`)
      continue
    }
    etiquetadoYa = true

    const partes = etq[1].split('·').map(s => s.trim().toLowerCase())
    // `usar` es la única audiencia que llega a la capa `cliente`, o sea a /ayuda.
    if (partes[0] === 'usar') conTextoPublico.add(slug)
    if (!AUDIENCIAS.includes(partes[0])) {
      fallo(`audiencia \`${partes[0] || '(vacía)'}\` en «${ultimoEnc}»: el apartado desaparece de las TRES capas`, `${rel}:${num}`)
    }
    if (partes.length < 2) {
      fallo(`«${ultimoEnc}» no dice profundidad`, `${rel}:${num}`)
    } else if (!PROFUNDIDADES.includes(partes[1])) {
      fallo(`profundidad \`${partes[1]}\` en «${ultimoEnc}»: no se pliega (se espera ${PROFUNDIDADES.join(' o ')})`, `${rel}:${num}`)
    }
  }

  encabezadosPorPieza.set(slug, encabezados)
}

// Piezas declaradas cuyo `.md` todavía no existe: es legítimo («en preparación»),
// pero conviene saber cuántas quedan.
for (const [archivo, slug] of piezas) {
  if (!existsSync(join(CONTENIDO, archivo))) notas.push(`«${slug}» sigue en preparación (falta ${archivo})`)
}

// ── Atajos de la portada ─────────────────────────────────────────────────────
for (const a of atajos()) {
  const encs = encabezadosPorPieza.get(a.pieza)
  if (!encs) fallo(`atajo a la pieza \`${a.pieza}\`, que no existe`, 'atajos.ts')
  else if (!encs.has(a.encabezado)) {
    fallo(`atajo a «${a.encabezado}» en \`${a.pieza}\`: ese encabezado ya no existe`, 'atajos.ts')
  }
}

// ── Guías que el portal ofrece al cliente ────────────────────────────────────
// «Ayuda y soporte» enlaza la guía de cada módulo contratado cruzando la `clave`
// de la ficha con el catálogo (`guiaDeModulo`). Ese enlace apunta a `/ayuda`, que
// solo publica los apartados `usar`: una ficha vendible sin nada `usar` no es una
// ficha a medias, es un 404 servido desde dentro del portal.
for (const f of fichas) {
  if (!f.clave) continue                       // transversales: no se venden ni se enlazan
  if (!existsSync(join(CONTENIDO, `${carpetaDe(f.tipo)}/${f.slug}.md`))) continue  // en preparación, ya sale como nota
  if (!conTextoPublico.has(f.slug)) {
    fallo(`\`${f.slug}\` se vende y no tiene ningún apartado \`usar\`: su guía en «Ayuda y soporte» da 404`, `${carpetaDe(f.tipo)}/${f.slug}.md`)
  }
}

// ── Catálogo vivo ↔ fichas del manual ────────────────────────────────────────
async function cruzarCatalogo() {
  if (!existsSync('.env.local')) {
    notas.push('sin `.env.local`: NO se ha cruzado el manual con `modulos_catalogo`')
    return
  }
  const env = {}
  for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
    const t = l.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    env[t.slice(0, t.indexOf('=')).trim()] = t.slice(t.indexOf('=') + 1).trim()
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    notas.push('sin credenciales en `.env.local`: NO se ha cruzado el manual con `modulos_catalogo`')
    return
  }

  const r = await fetch(`${url}/rest/v1/modulos_catalogo?select=clave,nombre,activo`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null)
  if (!r?.ok) {
    notas.push(`no se pudo consultar \`modulos_catalogo\`${r ? ` (${r.status})` : ''}: el cruce NO se ha hecho`)
    return
  }

  const catalogo = await r.json()
  const conFicha = new Set(fichas.map(f => f.clave).filter(Boolean))
  for (const m of catalogo) {
    if (m.activo === false) continue
    if (!conFicha.has(m.clave)) fallo(`el módulo \`${m.clave}\` («${m.nombre}») se vende y no tiene ficha`, 'modulos_catalogo')
  }
  const claves = new Set(catalogo.map(m => m.clave))
  for (const f of fichas) {
    if (f.clave && !claves.has(f.clave)) {
      fallo(`la ficha \`${f.slug}\` dice ser el módulo \`${f.clave}\`, que no está en el catálogo`, 'catalogo.ts')
    }
  }
}

await cruzarCatalogo()

// ── Salida ───────────────────────────────────────────────────────────────────
for (const n of notas) console.log(`· ${n}`)

if (fallos.length === 0) {
  console.log('✓ Academia OK: etiquetas, directivas, atajos y fichas cuadran con el sistema.')
  process.exit(0)
}

console.log(`\n✗ ${fallos.length} problema(s) en el manual:\n`)
for (const f of fallos) console.log(`  ${f.donde}\n    ${f.que}`)
process.exit(1)
