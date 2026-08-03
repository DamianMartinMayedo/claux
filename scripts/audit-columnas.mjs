#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Centinela de columnas: ¿pide el código alguna columna que la BD no tiene?
//
// POR QUÉ EXISTE. **PostgREST no ignora la columna que sobra: falla la consulta
// entera.** Y como casi todas las lecturas hacen `?? []`, el resultado no es un
// error visible sino un «no hay nada» perfectamente creíble. Ha pasado cuatro
// veces en este repo (la mig. 125 dejó el calendario de cobros ciego; la 116 y la
// 121/124 apagaron el widget de Servicios, su insight de IA y la descarga de
// Suscripciones), siempre por lo mismo: una migración renombra o borra una
// columna y queda un `select` con el nombre viejo.
//
// La regla ya estaba escrita —«al borrar una columna, grep de su nombre por todo
// src/»— y aun así se coló dos veces más. Una regla que se incumple sola no es
// una regla: es una nota. Esto la ejecuta.
//
// ALCANCE DELIBERADAMENTE ESTRECHO, para que sea fiable en vez de listo. Solo
// mira cadenas LITERALES en dos formas:
//   · `.from('tabla')` … `.select('a, b, c')` en la misma cadena;
//   · los dos helpers de `lib/exportar/tablas.ts` con la tabla y las columnas
//     literales en la llamada (`leer(db, 'tabla', cid, 'a, b')`, `diccionario(...)`),
//     que es donde vivía justamente el fallo de la descarga de Suscripciones.
// Ignora `select('*')`, los recursos anidados (`tabla(col)`), los alias, los
// castings y los caminos JSON. Una tabla que no esté en el esquema (una vista, un
// nombre construido) se salta: este script solo grita cuando está seguro.
//
// El esquema se lee de la BASE DE DATOS (el documento OpenAPI de PostgREST, que
// enumera tablas y columnas), nunca de las migraciones del repo: una migración
// puede estar sin aplicar, y entonces el centinela mentiría en la dirección
// peligrosa.
//
// Uso:  node scripts/audit-columnas.mjs   ·   npm run audit:columnas
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'src'

// ── Esquema real ─────────────────────────────────────────────────────────────

function env() {
  const txt = readFileSync('.env.local', 'utf8')
  const out = {}
  for (const linea of txt.split('\n')) {
    const t = linea.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    out[t.slice(0, t.indexOf('=')).trim()] = t.slice(t.indexOf('=') + 1).trim()
  }
  return out
}

async function leerEsquema() {
  const e = env()
  const url = e.NEXT_PUBLIC_SUPABASE_URL
  const key = e.SUPABASE_SERVICE_ROLE_KEY || e.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.log('· Sin credenciales de Supabase en .env.local: no se puede comprobar el esquema.')
    process.exit(0)
  }
  // Con timeout: un centinela que se cuelga esperando a la red deja de correrse.
  const r = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal:  AbortSignal.timeout(30_000),
  }).catch(e => { console.log(`✗ No se pudo leer el esquema de la BD: ${e.message}`); process.exit(1) })
  if (!r.ok) {
    console.log(`✗ No se pudo leer el esquema de la BD (${r.status}).`)
    process.exit(1)
  }
  const doc = await r.json()
  const defs = doc.definitions ?? doc.components?.schemas ?? {}
  const mapa = new Map()
  for (const [tabla, def] of Object.entries(defs)) {
    mapa.set(tabla, new Set(Object.keys(def?.properties ?? {})))
  }
  return mapa
}

// ── Lectura del código ───────────────────────────────────────────────────────

function ficheros(dir) {
  const out = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) { out.push(...ficheros(ruta)); continue }
    if (/\.(ts|tsx|mts)$/.test(nombre)) out.push(ruta)
  }
  return out
}

/**
 * Las columnas de una cadena de `select`. Devuelve `null` cuando la cadena tiene
 * algo que este script no sabe leer con certeza (un recurso anidado, un alias con
 * relación): callarse es mejor que inventarse un falso positivo.
 */
function columnasDe(seleccion) {
  const cols = []
  let profundidad = 0, actual = ''
  const cerrar = () => { if (actual.trim()) cols.push(actual.trim()); actual = '' }
  for (const c of seleccion) {
    if (c === '(') profundidad++
    if (c === ')') profundidad--
    if (c === ',' && profundidad === 0) { cerrar(); continue }
    actual += c
  }
  cerrar()

  const limpias = []
  for (const bruto of cols) {
    if (bruto === '*') continue                       // todo: nada que comprobar
    if (bruto.includes('(')) continue                 // recurso anidado / función
    if (bruto.includes('->') || bruto.includes('::')) continue   // JSON o casting
    // Alias `nombre:columna` → la columna es lo de la derecha.
    const col = (bruto.includes(':') ? bruto.slice(bruto.lastIndexOf(':') + 1) : bruto)
      .replace(/!.*$/, '')                            // pista de FK (`tabla!fk`)
      .trim()
    if (!col || !/^[a-z_][a-z0-9_]*$/i.test(col)) continue
    limpias.push(col)
  }
  return limpias
}

/** Nº de línea (1-indexado) de una posición del fichero. */
const lineaDe = (src, pos) => src.slice(0, pos).split('\n').length

// Cadena literal simple: comillas o backtick SIN interpolación. Una cadena
// construida no se comprueba — no se puede saber qué pide.
const LITERAL = String.raw`'([^'\\]*)'|"([^"\\]*)"|\x60([^\x60$\\]*)\x60`

const hallazgos = []

function revisar(archivo, src, esquema) {
  // ── 1. `.from('tabla')` … `.select('columnas')` ──
  const from = new RegExp(String.raw`\.from\(\s*(?:${LITERAL})\s*\)`, 'g')
  let m
  while ((m = from.exec(src)) !== null) {
    const tabla = m[1] ?? m[2] ?? m[3]
    const cols  = esquema.get(tabla)
    if (!cols) continue                                // vista o tabla desconocida
    // El `select` de ESA cadena: el primero que aparece antes de romperse la
    // cadena (un `;`, un cierre de bloque o el siguiente `.from`).
    const resto = src.slice(m.index + m[0].length, m.index + m[0].length + 1200)
    const corte = resto.search(/\.from\(|\n\s*\}/)
    const trozo = corte === -1 ? resto : resto.slice(0, corte)
    const sel = new RegExp(String.raw`^\s*\.select\(\s*(?:${LITERAL})`).exec(trozo)
    if (!sel) continue
    const seleccion = sel[1] ?? sel[2] ?? sel[3]
    for (const col of columnasDe(seleccion)) {
      if (!cols.has(col)) {
        hallazgos.push({ archivo, linea: lineaDe(src, m.index), tabla, col })
      }
    }
  }

  // ── 2. Los helpers de exportación, con tabla y columnas literales ──
  //    leer(db, 'tabla', cid, 'a, b, c', …)  ·  diccionario(db, 'tabla', cid, 'a', 'b')
  const helper = new RegExp(
    String.raw`\b(leer|diccionario)\(\s*\w+\s*,\s*(?:${LITERAL})\s*,\s*\w+\s*,\s*(?:${LITERAL})`, 'g')
  while ((m = helper.exec(src)) !== null) {
    const tabla = m[2] ?? m[3] ?? m[4]
    const cols  = esquema.get(tabla)
    if (!cols) continue
    const seleccion = m[5] ?? m[6] ?? m[7]
    for (const col of columnasDe(seleccion)) {
      if (!cols.has(col)) {
        hallazgos.push({ archivo, linea: lineaDe(src, m.index), tabla, col })
      }
    }
  }
}

const esquema = await leerEsquema()
for (const archivo of ficheros(RAIZ)) {
  revisar(archivo, readFileSync(archivo, 'utf8'), esquema)
}

if (hallazgos.length === 0) {
  console.log(`✓ Columnas OK: ningún select literal pide una columna que la BD no tenga (${esquema.size} tablas).`)
  process.exit(0)
}

console.log(`✗ ${hallazgos.length} columna(s) inexistente(s) en select literales:\n`)
for (const h of hallazgos) {
  console.log(`  ${h.archivo}:${h.linea}  →  ${h.tabla}.${h.col} no existe`)
}
console.log('\nPostgREST falla la consulta ENTERA por esto, y el `?? []` lo convierte en «no hay nada».')
process.exit(1)
