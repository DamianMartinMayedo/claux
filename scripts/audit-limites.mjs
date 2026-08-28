#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Centinela de límites de nivel: ¿puede alguien crear por encima de su cupo?
//
// POR QUÉ EXISTE. El límite de capacidad es lo que separa Inicial de Empresa y de
// Pro: si no se aplica, los tres niveles son el mismo producto a tres precios —
// exactamente el problema que este cambio vino a resolver—. Y falla en silencio
// por dos caminos distintos, ninguno de los cuales da error en pantalla:
//
//   · **Una tabla limitada con un `insert` que no pasa por `comprobarLimite`.**
//     Nadie lo nota: el cliente crea de más y el sistema le deja. Basta un módulo
//     nuevo, un adaptador nuevo o una acción que se le olvidó a alguien.
//   · **La tabla `DIMENSIONES` de `lib/limites.ts` desalineada con la BD.** Es el
//     punto frágil que su propia cabecera declara: no hay convención para «esto
//     está activo» (`estado`, `activo`, `activa`, `fecha_baja is null`), y
//     **PostgREST no ignora la columna que sobra: falla la consulta entera**. El
//     conteo cae a 0, `usado + 1 <= limite` siempre se cumple y el límite deja de
//     existir sin que se rompa nada visible.
//
// Este script mira las dos cosas:
//   A. La tabla `DIMENSIONES` contra el esquema VIVO (tabla, `pk`, `client_id` y
//      cada columna de filtro), el `modulo` contra `modulos_catalogo`, y las filas
//      de `nivel_limites` contra las dimensiones del código (en los dos sentidos:
//      dimensión sin filas = ilimitada por accidente; filas huérfanas = número que
//      el dueño edita en /admin y no aplica nadie).
//   B. Todo `insert`/`upsert` en tabla limitada, con la exigencia de que alguna
//      función que lo contenga llame a `comprobarLimite` / `huecoDisponible` (o a
//      un helper local que acabe llamándolos). Lo que a propósito no comprueba va
//      en ALLOWLIST, con su motivo escrito.
//
// ALCANCE DELIBERADAMENTE ESTRECHO, como los otros centinelas: lee cadenas
// literales (`.from('tabla').insert(`). No entiende un nombre de tabla construido
// ni un `insert` escondido en una función de la base. Solo grita cuando está seguro.
//
// Uso:  node scripts/audit-limites.mjs   ·   npm run audit:limites
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ    = 'src'
const LIMITES = 'src/lib/limites.ts'

// Sitios que a propósito insertan en tabla limitada SIN comprobar cupo. Cada uno,
// con su motivo. Añadir aquí es una decisión CONSCIENTE, no la vía rápida para
// callar al centinela: si la fila la crea el cliente y la ve en su listado,
// consume cupo y va gateada.
const ALLOWLIST = {
  // Alta de cliente desde el admin: el primer usuario admin_empresa del tenant.
  // Un cliente recién creado tiene cero usuarios y ningún nivel permite menos de
  // cinco, así que el límite no puede saltar; y si algún día saltara, dejaría al
  // cliente sin ninguna forma de entrar en lo que acaba de contratar.
  'src/app/actions/clientes.ts': ['crearCliente'],
  // Cuenta técnica de «Apertura» (mig. 130): no la pide el dueño ni la ve en su
  // listado, y sin ella el histórico importado se queda sin saldar. Por eso mismo
  // tampoco cuenta para el cupo — `es_apertura: false` está en sus filtros.
  'src/lib/tesoreria-core.ts': ['obtenerCuentaApertura'],
  // Adaptadores del importador: el cupo lo aplica el MOTOR antes de llamarlos
  // (`presupuesto` en `motor.ts`, recontado contra la base en cada tanda). Se
  // comprueba una vez por lote y no una vez por fila, que es lo que permite meter
  // las 58 que caben y dejar escrito por qué las otras 342 no entraron.
  'src/lib/importador/adaptadores/personal.ts': ['insertar'],
  'src/lib/importador/adaptadores/catalogo.ts': ['insertar'],
}

const GUARDA_BASE = /comprobarLimite\s*\(|huecoDisponible\s*\(/

// ── Esquema y datos vivos ────────────────────────────────────────────────────

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
const CAB = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function pedir(ruta, reintento = true) {
  // Con timeout: un centinela que se cuelga esperando a la red deja de correrse.
  // Y con UN reintento: Supabase devuelve algún 401 suelto que no es un problema
  // de credenciales, y un centinela que se pone rojo solo deja de creerse.
  const r = await fetch(`${URL}/rest/v1/${ruta}`, { headers: CAB, signal: AbortSignal.timeout(30_000) })
    .catch(() => null)
  if (!r || !r.ok) {
    if (reintento) {
      await new Promise(ok => setTimeout(ok, 1500))
      return pedir(ruta, false)
    }
    console.log(`✗ No se pudo consultar la BD${r ? ` (${r.status})` : ''} en /rest/v1/${ruta}.`)
    process.exit(1)
  }
  return r.json()
}

/** Tablas → columnas, del documento OpenAPI de PostgREST (la BD, no las migraciones). */
async function leerEsquema() {
  const doc  = await pedir('')
  const defs = doc.definitions ?? doc.components?.schemas ?? {}
  const mapa = new Map()
  for (const [tabla, def] of Object.entries(defs)) mapa.set(tabla, new Set(Object.keys(def?.properties ?? {})))
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
 * Copia del fuente con el CONTENIDO de cadenas, comentarios y regex en blanco,
 * conservando longitud y saltos de línea (las posiciones siguen valiendo para el
 * original). Sin esto, una llave dentro de un comentario o de un texto —«{ col }»,
 * `/[^}]/`— descuadra el emparejado de llaves y el centinela señalaría la función
 * equivocada, que es peor que no señalar ninguna.
 */
function neutralizar(src) {
  const out = src.split('')
  const blanquear = (desde, hasta) => {
    for (let k = desde; k < hasta && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }
  const previo = (i) => { let k = i - 1; while (k >= 0 && /\s/.test(src[k])) k--; return k >= 0 ? src[k] : '' }

  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i); if (j === -1) j = src.length
      blanquear(i, j); i = j; continue
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i); j = j === -1 ? src.length : j + 2
      blanquear(i, j); i = j; continue
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) { j++; break }
        j++
      }
      blanquear(i + 1, j - 1)                       // deja las comillas, vacía el texto
      i = j; continue
    }
    // Regex literal: solo donde no puede ser una división (tras `(`, `,`, `=`, …).
    if (c === '/' && '(,=:[!&|?{;+return'.includes(previo(i)) ) {
      let j = i + 1, dentroClase = false, cerrada = false
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') dentroClase = true
        else if (src[j] === ']') dentroClase = false
        else if (src[j] === '/' && !dentroClase) { j++; cerrada = true; break }
        j++
      }
      if (cerrada) { blanquear(i + 1, j - 1); i = j; continue }
    }
    i++
  }
  return out.join('')
}

const lineaDe = (src, pos) => src.slice(0, pos).split('\n').length

/** Índice del `}` que cierra el `{` de `abre`. */
function cierreDe(neutro, abre) {
  let d = 0
  for (let k = abre; k < neutro.length; k++) {
    if (neutro[k] === '{') d++
    else if (neutro[k] === '}') { d--; if (d === 0) return k }
  }
  return neutro.length
}

// Palabras que abren un bloque con paréntesis pero NO son funciones. Sin esta
// lista, `if (…) {` se cuenta como función y el aviso señala `if()` en vez de la
// acción que hay que arreglar.
const NO_FUNCION = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'try', 'with', 'return'])

/** Índice del `(` que abre el `)` de `cierra`. */
function parAbre(neutro, cierra) {
  let d = 0
  for (let k = cierra; k >= 0; k--) {
    if (neutro[k] === ')') d++
    else if (neutro[k] === '(') { d--; if (d === 0) return k }
  }
  return -1
}

/**
 * ¿Qué función abre el `{` de `abre`? Se lee HACIA ATRÁS y por estructura —el `)`
 * de los parámetros, luego el identificador— en vez de con un patrón sobre el
 * texto de delante: un patrón encuentra el primer identificador de la ventana, que
 * casi nunca es el nombre de la función (acaba diciendo `if()` o `return()`).
 *
 * Devuelve `null` si ese `{` no abre una función (un `if`, un objeto literal): el
 * recorrido sigue hacia afuera, que es donde estará la guarda.
 */
function nombreDeFuncion(neutro, abre) {
  let k = abre - 1
  const blancos = () => { while (k >= 0 && /\s/.test(neutro[k])) k-- }
  blancos()
  if (k < 0) return null

  if (neutro[k] === '>' && neutro[k - 1] === '=') {          // arrow: `… => {`
    const antes = neutro.slice(Math.max(0, k - 200), k - 1)
    return /(?:const|let|var)\s+([A-Za-z0-9_$]+)[^;{}]*$/.exec(antes)?.[1] ?? '<anónima>'
  }

  if (neutro[k] !== ')') {                                   // tipo de retorno: `): Promise<…> {`
    const desde = Math.max(0, k - 300)
    const trozo = neutro.slice(desde, k + 1)
    const cierre = trozo.lastIndexOf(')')
    if (cierre === -1) return null
    // Lo que puede haber entre `)` y `{` es un tipo de retorno y nada más. La
    // clase incluye `?` y `;` porque los tipos de este repo son objetos literales
    // (`): Promise<{ ok: boolean; error?: string }> {`), y sin ellos la cabecera
    // no se reconoce y la función entera pasa por anónima.
    if (!/^[\s:|&<>[\]{}(),.;?!=\w'"]*$/.test(trozo.slice(cierre + 1))) return null
    k = desde + cierre
  }

  const paren = parAbre(neutro, k)
  if (paren < 0) return null
  k = paren - 1; blancos()
  if (neutro[k] === '>') {                                   // genéricos: `f<T>(…)`
    let d = 0
    while (k >= 0) { if (neutro[k] === '>') d++; else if (neutro[k] === '<') { d--; if (d === 0) break }; k-- }
    k--; blancos()
  }
  const fin = k + 1
  while (k >= 0 && /[A-Za-z0-9_$]/.test(neutro[k])) k--
  const nombre = neutro.slice(k + 1, fin)
  if (!nombre) return null
  if (nombre === 'function') return '<anónima>'
  if (NO_FUNCION.has(nombre)) return null                    // bloque de control
  return nombre
}

/**
 * Las funciones que ENVUELVEN una posición, de dentro a fuera. Se devuelven todas
 * —no solo la más interna— porque la guarda casi nunca está en el mismo bloque que
 * el `insert`: está arriba del todo de la acción, y entre medias hay un `if`, un
 * `map` o un `try`. Que la comprobación esté en cualquier función que contenga el
 * `insert` es exactamente lo que se quiere exigir.
 */
function envolturas(neutro, pos) {
  const out = []
  let i = pos, prof = 0
  while (i > 0) {
    i--
    const c = neutro[i]
    if (c === '}') { prof++; continue }
    if (c !== '{') continue
    if (prof > 0) { prof--; continue }
    const nombre = nombreDeFuncion(neutro, i)
    if (nombre) out.push({ nombre, cuerpo: neutro.slice(i, cierreDe(neutro, i)) })
  }
  return out
}

// ── A. La tabla DIMENSIONES contra la BD ─────────────────────────────────────

/** Las dimensiones declaradas en `lib/limites.ts`, leídas del propio literal. */
function leerDimensiones() {
  const src   = readFileSync(LIMITES, 'utf8')
  const desde = src.indexOf('export const DIMENSIONES')
  const bloque = src.slice(desde, src.indexOf('\n}', desde))
  const dims = {}
  const re = /^ {2}([a-z_]+):\s*\{([\s\S]*?)\n {2}\},/gm
  let m
  while ((m = re.exec(bloque)) !== null) {
    const cuerpo = m[2]
    const tabla  = /tabla:\s*'([^']+)'/.exec(cuerpo)?.[1]
    const pk     = /pk:\s*'([^']+)'/.exec(cuerpo)?.[1]
    const modulo = /modulo:\s*(null|'[^']+')/.exec(cuerpo)?.[1]
    const filtros = [...(/filtros:\s*\[([^\]]*)\]/.exec(cuerpo)?.[1] ?? '').matchAll(/col:\s*'([^']+)'/g)].map(x => x[1])
    dims[m[1]] = { tabla, pk, modulo: modulo === 'null' ? null : modulo?.slice(1, -1) ?? null, filtros }
  }
  return dims
}

const hallazgos = []
const apunta = (que, porque) => hallazgos.push({ que, porque })

const DIMS = leerDimensiones()

if (Object.keys(DIMS).length === 0) {
  console.log('✗ No se pudo leer la tabla DIMENSIONES de src/lib/limites.ts. ¿Cambió el formato del literal?')
  process.exit(1)
}

if (URL && KEY) {
  const [esquema, catalogo, filas, nivelesBd] = await Promise.all([
    leerEsquema(),
    pedir('modulos_catalogo?select=clave,activo'),
    pedir('nivel_limites?select=nivel,dimension'),
    pedir('niveles?select=clave'),
  ])

  const claveModulos = new Set(catalogo.map(m => m.clave))
  const activos      = new Set(catalogo.filter(m => m.activo).map(m => m.clave))
  const claveNiveles = nivelesBd.map(n => n.clave)

  for (const [dim, d] of Object.entries(DIMS)) {
    const cols = esquema.get(d.tabla)
    if (!cols) {
      apunta(`${dim}: la tabla '${d.tabla}' no existe en la BD`,
             'El conteo falla entero y `comprobarLimite` propaga: el cliente no puede crear NADA de esa dimensión.')
      continue
    }
    for (const col of [d.pk, 'client_id', ...d.filtros]) {
      if (!cols.has(col)) {
        apunta(`${dim}: ${d.tabla}.${col} no existe`,
               'PostgREST falla la consulta ENTERA por una columna que sobra; el conteo cae a 0 y el límite deja de existir.')
      }
    }
    if (d.modulo && !claveModulos.has(d.modulo)) {
      apunta(`${dim}: el módulo '${d.modulo}' no está en modulos_catalogo`,
             'El escáner del cron nunca avisará de esta dimensión: cree que nadie la tiene contratada.')
    } else if (d.modulo && !activos.has(d.modulo)) {
      apunta(`${dim}: el módulo '${d.modulo}' está INACTIVO en el catálogo`,
             'Nadie puede contratarlo ya; o se reactiva, o la dimensión sobra.')
    }
  }

  // `ia_conversaciones` no está en DIMENSIONES (no se cuenta por filas activas),
  // pero sí tiene fila en `nivel_limites`: la aplica `cupoEfectivo()`.
  const enCodigo = new Set([...Object.keys(DIMS), 'ia_conversaciones'])
  const porDim   = new Map()
  for (const f of filas) {
    if (!porDim.has(f.dimension)) porDim.set(f.dimension, new Set())
    porDim.get(f.dimension).add(f.nivel)
  }
  for (const dim of enCodigo) {
    const niveles = porDim.get(dim)
    if (!niveles) {
      apunta(`${dim}: no tiene ninguna fila en nivel_limites`,
             'Sin fila, `cargarContextoLimites` no trae tope y la dimensión queda ILIMITADA en los tres niveles.')
      continue
    }
    const faltan = claveNiveles.filter(n => !niveles.has(n))
    if (faltan.length) {
      apunta(`${dim}: sin fila en nivel_limites para ${faltan.join(', ')}`,
             'Ese nivel la tiene ilimitada mientras los otros la limitan: el escalón desaparece justo donde se vende.')
    }
  }
  for (const dim of porDim.keys()) {
    if (!enCodigo.has(dim)) {
      apunta(`nivel_limites tiene filas de '${dim}', que no es ninguna dimensión del código`,
             'El dueño edita ese número en /admin/niveles y no lo aplica nadie: promete un tope que no existe.')
    }
  }
  for (const n of claveNiveles) {
    if (!filas.some(f => f.nivel === n)) {
      apunta(`el nivel '${n}' no tiene ningún límite en nivel_limites`,
             'Ese nivel lo permite todo: es el más caro sin serlo, o el más barato sin límite.')
    }
  }
} else {
  console.log('· Sin credenciales de Supabase en .env.local: no se comprueba la tabla DIMENSIONES contra la BD.')
}

// ── A bis. Ninguna dimensión declarada y nunca aplicada ──────────────────────
// Una dimensión puede estar perfecta en la tabla y en `nivel_limites` y aun así no
// existir: si nadie la pasa nunca a `comprobarLimite`, el número se pinta en
// /admin/niveles, se enseña en la landing y no bloquea a nadie. Es la forma en que
// «el primer módulo nuevo nace sin límite».
//
// Cuentan las dos vías reales de aplicación: la llamada directa y el campo
// `dimension:` de un adaptador del importador (ahí el cupo lo aplica el motor).
{
  const codigo = ficheros(RAIZ)
    .filter(f => f !== LIMITES)
    .map(f => readFileSync(f, 'utf8'))
    .join('\n')
  for (const dim of Object.keys(DIMS)) {
    const usada = new RegExp(String.raw`(?:comprobarLimite|huecoDisponible|limiteDe)\s*\([^;]{0,200}'${dim}'|dimension:\s*[^,;\n]{0,60}'${dim}'`)
      .test(codigo)
    if (!usada) {
      apunta(`${dim}: declarada en DIMENSIONES y nunca comprobada`,
             'El tope se pinta en /admin y en la landing, y no bloquea a nadie: la dimensión es decorativa.')
    }
  }
}

// ── B. Todo insert en tabla limitada pasa por comprobarLimite ────────────────

const TABLAS = new Set(Object.values(DIMS).map(d => d.tabla))
const huecos = []

for (const archivo of ficheros(RAIZ)) {
  if (archivo === LIMITES) continue                          // es el motor, no un llamador
  const src    = readFileSync(archivo, 'utf8')
  const neutro = neutralizar(src)
  const permitidas = new Set(ALLOWLIST[archivo] ?? [])

  // Helpers locales que acaban llamando a la guarda (`bloqueoCrear` en dossier.ts):
  // llamarlos cuenta, porque comprobar es literalmente lo único que hacen.
  const guardas = [GUARDA_BASE.source]
  for (const vuelta of [0, 1]) {
    const re = new RegExp(guardas.join('|'))
    const decl = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g
    let d
    while ((d = decl.exec(neutro)) !== null) {
      const abre = neutro.indexOf('{', d.index + d[0].length)
      if (abre === -1) continue
      const cuerpo = neutro.slice(abre, cierreDe(neutro, abre))
      const patron = `\\b${d[1]}\\s*\\(`
      if (re.test(cuerpo) && !guardas.includes(patron)) guardas.push(patron)
    }
    if (vuelta === 0 && guardas.length === 1) break          // no hay helpers: no hace falta 2ª vuelta
  }
  const GUARDA = new RegExp(guardas.join('|'))

  for (const tabla of TABLAS) {
    // El nombre de la tabla se busca en el ORIGINAL —en la copia neutralizada el
    // texto de las cadenas está en blanco— y se descarta el hallazgo si en esa
    // misma posición la copia trae espacios: eso significa comentario o cadena.
    const re = new RegExp(String.raw`\.from\(\s*'${tabla}'\s*\)\s*\.\s*(insert|upsert)\s*\(`, 'g')
    let m
    while ((m = re.exec(src)) !== null) {
      if (!neutro.startsWith('.from(', m.index)) continue
      const envs = envolturas(neutro, m.index)
      if (envs.some(f => permitidas.has(f.nombre))) continue
      if (envs.some(f => GUARDA.test(f.cuerpo)))    continue
      huecos.push({
        archivo, linea: lineaDe(src, m.index), tabla,
        fn: envs.find(f => f.nombre !== '<anónima>')?.nombre ?? '<anónima>',
      })
    }
  }
}

// ── Veredicto ────────────────────────────────────────────────────────────────

if (hallazgos.length === 0 && huecos.length === 0) {
  console.log(`✓ Límites OK: las ${Object.keys(DIMS).length} dimensiones cuadran con la BD y ningún insert en tabla limitada se salta el cupo.`)
  process.exit(0)
}

if (hallazgos.length > 0) {
  console.log(`✗ ${hallazgos.length} problema(s) en la declaración de límites:\n`)
  for (const h of hallazgos) console.log(`  ${h.que}\n    → ${h.porque}\n`)
}

if (huecos.length > 0) {
  console.log(`✗ ${huecos.length} insert(s) en tabla limitada SIN comprobar cupo:\n`)
  for (const h of huecos) console.log(`  ${h.archivo}:${h.linea}  →  ${h.fn}() inserta en '${h.tabla}'`)
  console.log('\nLlama a comprobarLimite(db, client_id, <dimensión>) antes del insert, o justifícalo en ALLOWLIST.')
}
process.exit(1)
