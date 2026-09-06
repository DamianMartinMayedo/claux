#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Centinela de constantes que viven en la BD y se tecleaban en el código.
//
// POR QUÉ EXISTE. El 2026-09 se borró el modelo `deepseek-v4-flash-free` de
// `ia_modelos` desde el admin. En `lib/ia/modelo.ts` quedó un `DEFAULT_MODEL` con
// ese id: nadie lo vio, porque el principal y el respaldo seguían puestos y la
// constante solo entraba en juego si faltaban los dos. El día que hubieran
// faltado, CLAUX habría pedido al proveedor un modelo inexistente y el error
// llegaría de fuera, sin decir de dónde salía el nombre. La constante se retiró;
// esto impide que vuelva.
//
// Comprueba DOS cosas, en las dos direcciones (código→BD y BD→BD):
//
//   1. **Modelos de IA.** Ningún id de modelo se teclea en el código. Y los que se
//      guardan como AJUSTE (`settings.ia_model`, `settings.ia_modelo_fallback_gratis`
//      y, cuando exista, `niveles.ia_model`) tienen que existir y estar ACTIVOS en
//      `ia_modelos` — el respaldo, además, marcado como gratis: es lo único que lo
//      hace respaldo.
//   2. **Claves de nivel.** Las que el código escribe como valor por defecto o como
//      filtro (`nivel ?? 'inicial'`, `.eq('nivel', '…')`) tienen que estar en
//      `niveles`. Solo mira esas formas: en los reportes, `nivel` es otra cosa
//      (grupo / subtotal / hija) y confundirlas sería ruido, no vigilancia.
//
// Las CLAVES DE MÓDULO no se miran aquí: las cubre `audit-nivel.mjs` contra el
// catálogo vivo. Un tema, un centinela.
//
// Uso:  node scripts/audit-constantes.mjs   ·   npm run audit:constantes
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'src'

// ── BD ───────────────────────────────────────────────────────────────────────

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

const e   = env()
const URL = e.NEXT_PUBLIC_SUPABASE_URL
const KEY = e.SUPABASE_SERVICE_ROLE_KEY || e.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.log('· Sin credenciales de Supabase en .env.local: estas constantes viven en la BD, no hay contra qué comprobarlas.')
  process.exit(0)
}

async function pedir(ruta) {
  const r = await fetch(`${URL}/rest/v1/${ruta}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) return null   // columna o tabla que aún no existe: no es un fallo, es un «todavía no»
  return r.json()
}

const [modelos, niveles, ajustes, nivelModelo] = await Promise.all([
  pedir('ia_modelos?select=id,activo,gratis'),
  pedir('niveles?select=clave'),
  pedir('settings?select=key,value&key=in.(ia_model,ia_modelo_fallback_gratis)'),
  // La Fase 9 del plan del admin añade `niveles.ia_model` (modelo por nivel). Si la
  // migración no está aplicada, PostgREST responde 400 y aquí no se comprueba nada:
  // el centinela empieza a vigilarla el día que exista, sin tocar una línea.
  pedir('niveles?select=clave,ia_model'),
])

if (!modelos || !niveles) {
  console.log('· No se pudo leer el catálogo de IA o de niveles: se salta.')
  process.exit(0)
}

const porId    = new Map(modelos.map(m => [m.id, m]))
const claves   = new Set(niveles.map(n => n.clave))
const problemas = []
const apunta = (que, porque) => problemas.push({ que, porque })

// ── 1a. Ajustes que nombran un modelo ────────────────────────────────────────

for (const { key, value } of (ajustes ?? [])) {
  const id = (value ?? '').trim()
  if (!id) continue
  const row = porId.get(id)
  if (!row) {
    apunta(`settings.${key} = '${id}', que no está en ia_modelos`,
           'Se resuelve al último recurso del catálogo: la IA responde, pero con un modelo que nadie eligió.')
    continue
  }
  if (!row.activo) {
    apunta(`settings.${key} = '${id}', que está INACTIVO`,
           'Mismo efecto que si no existiera: el ajuste dice una cosa y el cliente habla con otra.')
  }
  if (key === 'ia_modelo_fallback_gratis' && !row.gratis) {
    apunta(`settings.ia_modelo_fallback_gratis = '${id}', que NO está marcado como gratis`,
           'El respaldo existe para no seguir gastando al pasarse del cupo. Uno de pago ahí es gasto sin tope.')
  }
}

// ── 1b. Modelo por nivel (cuando exista la columna) ──────────────────────────

for (const n of (nivelModelo ?? [])) {
  const id = (n.ia_model ?? '').trim?.() ?? ''
  if (!id) continue
  const row = porId.get(id)
  if (!row)        apunta(`niveles.${n.clave}.ia_model = '${id}', que no está en ia_modelos`, 'Ese nivel cae al modelo global sin avisar: se vende un modelo mejor y se sirve el de todos.')
  else if (!row.activo) apunta(`niveles.${n.clave}.ia_model = '${id}', que está INACTIVO`, 'Igual de mudo: el nivel promete un modelo que el catálogo tiene apagado.')
}

// ── 2. Código ────────────────────────────────────────────────────────────────

function fuentes(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) fuentes(p, out)
    else if (/\.tsx?$/.test(f)) out.push(p)
  }
  return out
}

// Formas en que un id de modelo se cuela en el código. Todas son «un id por
// defecto», que es justo lo que fue el `deepseek`.
const MODELO_EN_CODIGO = /(?:DEFAULT_MODEL|MODELO_POR_DEFECTO)\s*=\s*'([^']+)'|ia_model\s*(?:\|\||\?\?)\s*'([^']+)'|\bmodel(?:o)?:\s*'([a-z0-9][a-z0-9.\-]{4,})'/g
// Un nivel escrito a mano: como valor por defecto o como filtro de consulta.
const NIVEL_EN_CODIGO = /nivel[A-Za-z]*\s*(?:\?\?|\|\|)\s*'([a-z_]+)'|\.eq\('nivel',\s*'([a-z_]+)'\)/g

for (const archivo of fuentes(RAIZ)) {
  const src = readFileSync(archivo, 'utf8')
  const linea = (i) => src.slice(0, i).split('\n').length

  for (const m of src.matchAll(MODELO_EN_CODIGO)) {
    const id = m[1] ?? m[2] ?? m[3]
    if (!id || porId.has(id)) continue
    apunta(`${archivo}:${linea(m.index)} teclea el modelo '${id}', que no está en ia_modelos`,
           'El catálogo se edita desde /admin sin desplegar: un id escrito en el código envejece solo.')
  }
  for (const m of src.matchAll(NIVEL_EN_CODIGO)) {
    const clave = m[1] ?? m[2]
    if (!clave || claves.has(clave)) continue
    apunta(`${archivo}:${linea(m.index)} teclea el nivel '${clave}', que no está en la tabla niveles`,
           'Un nivel que no existe no casa con ningún cliente: el filtro devuelve vacío y el defecto no aplica.')
  }
}

// ── Salida ───────────────────────────────────────────────────────────────────

if (problemas.length === 0) {
  console.log(`✓ Constantes OK: ${modelos.length} modelo(s) y ${claves.size} nivel(es); nadie nombra uno que no exista.`)
  process.exit(0)
}

console.log(`✗ ${problemas.length} constante(s) apuntando a algo que no existe:\n`)
for (const p of problemas) console.log(`  · ${p.que}\n    ${p.porque}`)
process.exit(1)
