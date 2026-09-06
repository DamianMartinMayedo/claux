#!/usr/bin/env node
/**
 * Centinela de dominios CSS.
 *
 * Regla (skills/ui/SKILL.md §0): una clase que pinta algo que existe en las DOS caras
 * vive en `03-components.css`. `06-portal.css` es solo del portal y `05-admin-*.css`
 * solo del admin. Cuando esa frontera se cruza, la clase sigue funcionando —el CSS es
 * un único bundle— así que nada se rompe y nadie se entera: el estilo compartido queda
 * escondido en el parcial del vecino y el siguiente que retoque el portal se lleva por
 * delante una pantalla del admin sin saber que existía.
 *
 * Esto no lo caza ni `tsc` ni el linter. Por eso hay script.
 *
 * Uso:  node scripts/audit-css-dominios.mjs   (npm run audit:css)
 * Sale 1 si alguna clase está en el parcial equivocado.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const ESTILOS = join(RAIZ, 'src/app/styles')

// ── Qué parcial pertenece a qué cara ──
const PARCIALES = {
  portal: ['06-portal.css'],
  admin:  ['05-admin-paginas.css'],
}
// Dónde vive el código de cada cara. Un `.tsx` que no caiga en ninguna (landing,
// academia, público) no opina: sus clases son suyas y tienen su propio parcial.
const CODIGO = {
  portal: ['src/app/portal', 'src/components/portal'],
  admin:  ['src/app/admin', 'src/components/admin'],
}

function ficheros(dir, exts, acc = []) {
  let entradas
  try { entradas = readdirSync(dir) } catch { return acc }
  for (const e of entradas) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) ficheros(p, exts, acc)
    else if (exts.includes(extname(p))) acc.push(p)
  }
  return acc
}

/** Clases DEFINIDAS en un parcial (el selector, no la mención). */
function clasesDefinidas(fichero) {
  const css = readFileSync(join(ESTILOS, fichero), 'utf8')
  // Fuera comentarios: un nombre citado en una nota no es una definición.
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const set = new Set()
  // Solo la parte de selector (antes de `{`), para no cazar valores ni contenidos.
  for (const bloque of limpio.split('{')) {
    const sel = bloque.split('}').pop() ?? ''
    for (const m of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) set.add(m[1])
  }
  return set
}

/** Clases USADAS en el código de una cara. */
function clasesUsadas(dirs) {
  const set = new Set()
  for (const dir of dirs) {
    for (const f of ficheros(join(RAIZ, dir), ['.tsx', '.ts'])) {
      const src = readFileSync(f, 'utf8')
      // `className="a b"`, template literals, y mapas `X: 'clase-y'`. Se barre a lo
      // ancho: un falso positivo aquí solo añade ruido, un falso negativo esconde
      // justo lo que buscamos.
      for (const m of src.matchAll(/className\s*=\s*[{"'`]([^"'`}]*)/g)) {
        for (const c of m[1].split(/[\s${}]+/)) if (c) set.add(c)
      }
      for (const m of src.matchAll(/['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+){1,5})['"`]/g)) set.add(m[1])
    }
  }
  return set
}

// Lo COMPARTIDO ya definido. Una clase que viva aquí puede aparecer además en el
// parcial de una cara sin que sea un problema: eso es un override con contexto
// (`.portal-shell .btn { … }`), que es exactamente para lo que existe ese parcial.
// Lo que se persigue es la clase que SOLO está en el parcial de una cara.
const compartidas = new Set([
  ...clasesDefinidas('02-base-layout.css'),
  ...clasesDefinidas('03-components.css'),
  ...clasesDefinidas('04-responsive-dark.css'),
])

const defPortal = [...clasesDefinidas(PARCIALES.portal[0])].filter(c => !compartidas.has(c))
const defAdmin  = [...clasesDefinidas(PARCIALES.admin[0])].filter(c => !compartidas.has(c))
const usaPortal = clasesUsadas(CODIGO.portal)
const usaAdmin  = clasesUsadas(CODIGO.admin)

// El cruce: definida SOLO en el parcial de una cara, y usada por la otra.
//
// Una clase que aparece en LOS DOS parciales no cuenta: ahí la definición está en
// su sitio y lo del otro lado es un override con contexto —`.det-section-head
// .dash-moneda-switch { margin-bottom: 0 }` es del admin hablando de una clase del
// portal, y eso es legítimo—. Lo que se persigue es la clase huérfana: definida en
// una sola cara y usada por la otra.
const enPortal = new Set(defPortal)
const enAdmin  = new Set(defAdmin)
const invasoras = {
  'el ADMIN usa clases que solo existen en 06-portal.css':
    defPortal.filter(c => usaAdmin.has(c) && !enAdmin.has(c)).sort(),
  'el PORTAL usa clases que solo existen en 05-admin-paginas.css':
    defAdmin.filter(c => usaPortal.has(c) && !enPortal.has(c)).sort(),
}

let fallos = 0
for (const [titulo, lista] of Object.entries(invasoras)) {
  if (!lista.length) continue
  fallos += lista.length
  console.log(`\n❌ ${titulo} — ${lista.length}`)
  for (const c of lista) console.log(`   .${c}`)
}

if (fallos) {
  console.log(`\n${fallos} clase(s) en el parcial equivocado.`)
  console.log('Lo compartido va a 03-components.css. Ver skills/ui/SKILL.md §0.\n')
  process.exit(1)
}
console.log('✅ Dominios CSS limpios: nada compartido escondido en el parcial de una sola cara.')
