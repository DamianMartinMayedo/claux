#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Centinela del catálogo comercial: ¿nombra alguien un módulo que ya no existe,
// o hay un módulo sin precio en alguna de las seis casillas (moneda × nivel)?
//
// POR QUÉ EXISTE. El catálogo es VIVO: el dueño edita nombre, texto y los tres
// precios desde /admin, y activa o retira módulos sin desplegar nada. El código y
// los datos que lo referencian por CLAVE no se enteran, y las dos direcciones
// fallan calladas:
//
//   · **Una clave que ya no está en el catálogo.** `tieneModulo(modulos, 'x')` no
//     da error: devuelve `false` para siempre. La funcionalidad no se rompe, se
//     APAGA — y apagada se parece mucho a «aún no la han contratado». Es
//     exactamente lo que pasa al retirar Multiempresa y Multidossier (§9 del
//     plan): quedan sitios nombrándolos, y el cliente pierde el selector de
//     empresa de su dossier sin que nadie vea un fallo.
//   · **Un precio a null o a cero en una casilla.** `precioModulo()` hace
//     `Number(… ?? 0)`: el módulo pasa a ser gratis ahí. La suma del presupuesto,
//     la factura y la landing dicen lo mismo, y todas mienten igual. Desde el
//     euro (mig. 225) son SEIS casillas y no tres: un módulo con su precio en
//     dólares y sin poner el de euros se regala entero al cliente que se factura
//     desde España, y en pantalla no se distingue de uno bien puesto.
//   · **Una clave que sigue en el catálogo pero ya no se vende ni la tiene nadie.**
//     Igual de muda que la anterior, y más difícil de ver: la fila existe, así que
//     el ojo la da por buena. Solo se distingue por que su `activo` es false y
//     ningún cliente la lleva.
//   · **Una plantilla de sector o una necesidad del diagnóstico apuntando a una
//     clave muerta.** El visitante recibe una recomendación con un módulo que no
//     puede comprar.
//
// Uso:  node scripts/audit-nivel.mjs   ·   npm run audit:nivel
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'src'

// Claves citadas en código que NO son del catálogo y están justificadas.
const ALLOWLIST = {
  // Nada por ahora. Cuando algo entre aquí, con su motivo escrito.
}

// Módulos que el código cita a propósito estando INACTIVOS: están construidos y
// todavía no se venden. No son restos de una retirada, son inventario esperando
// la decisión comercial; el día que se activen, el código ya está puesto.
const SIN_VENDER_AUN = {
  documentos_imprenta: 'construido entero, sin activar: falta la decisión comercial, no el código',
}

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
  console.log('· Sin credenciales de Supabase en .env.local: el catálogo vive en la BD, no hay nada que comprobar.')
  process.exit(0)
}

async function pedir(ruta, reintento = true) {
  const r = await fetch(`${URL}/rest/v1/${ruta}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    signal:  AbortSignal.timeout(30_000),
  }).catch(() => null)
  if (!r || !r.ok) {
    if (reintento) { await new Promise(ok => setTimeout(ok, 1500)); return pedir(ruta, false) }
    console.log(`✗ No se pudo consultar la BD${r ? ` (${r.status})` : ''} en /rest/v1/${ruta}.`)
    process.exit(1)
  }
  return r.json()
}

// ── Claves citadas en el código ──────────────────────────────────────────────

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
 * Las cadenas literales que son argumento DIRECTO de una llamada (paréntesis
 * equilibrados, y solo a profundidad 0). Los corchetes no cuentan, para que un
 * array de claves —`puedeEditarAlgunModulo(['base', 'inventario'])`— sí entre.
 *
 * Sin la profundidad, una llamada anidada mete sus propios literales: de
 * `tieneModulo((await db.from('clients').select('modulos_activos')…), 'inventario')`
 * salían 'clients' y 'modulos_activos' como si fueran módulos.
 */
function literalesDirectos(src, desdeParen) {
  const out = []
  let d = 0
  for (let k = desdeParen; k < src.length; k++) {
    const c = src[k]
    if (c === '(') { d++; continue }
    if (c === ')') { d--; if (d === 0) break; continue }
    if (c === "'" && d === 1) {
      const cierra = src.indexOf("'", k + 1)
      if (cierra === -1) break
      const txt = src.slice(k + 1, cierra)
      if (/^[a-z_]+$/.test(txt)) out.push(txt)
      k = cierra
    }
  }
  return out
}

// Las guardas: lo que hay dentro de sus paréntesis es SIEMPRE clave de catálogo.
const GUARDA = /\b(?:puedeEditarModulo|puedeEditarAlgunModulo|tieneModulo|tieneAlgunModulo|requireModulo|requireAlgunModulo|requireAccesoModulo|moduloActivo)\s*\(/g
// El campo `modulo(s):` de las tablas declarativas del repo (catálogo de avisos,
// parámetros del presupuesto, dimensiones de límites).
const CAMPO = /\bmodulos?:\s*(\[[^\]]*\]|'[a-z_]+')/g

/**
 * Se descartan dos usos de `modulo:` que NO son claves de catálogo y comparten
 * palabra: el valor de la columna `telegram_sesiones.modulo` (qué conversación
 * lleva el bot: 'reservas' | 'citas') y las anotaciones de tipo con unión. Los dos
 * se reconocen por la línea: un `.upsert(`/`.insert(`/`.update(`/`.eq(` alrededor,
 * o una barra de unión.
 */
function esCampoDeCatalogo(linea) {
  return !/\.(upsert|insert|update|eq)\s*\(/.test(linea) && !linea.includes('|')
}

const citadas = new Map()          // clave → [ficheros]
const anota = (clave, archivo) => {
  if (!citadas.has(clave)) citadas.set(clave, new Set())
  citadas.get(clave).add(archivo)
}

for (const archivo of ficheros(RAIZ)) {
  const src = readFileSync(archivo, 'utf8')
  for (const m of src.matchAll(GUARDA)) {
    for (const clave of literalesDirectos(src, m.index + m[0].length - 1)) anota(clave, archivo)
  }
  for (const m of src.matchAll(CAMPO)) {
    const linea = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index))
    if (!esCampoDeCatalogo(linea)) continue
    for (const l of m[1].matchAll(/'([a-z_]+)'/g)) anota(l[1], archivo)
  }
  // La lista de módulos que ponen artículos en `products`.
  const cat = /MODULOS_CATALOGO[^=]*=\s*\[([^\]]*)\]/.exec(src)
  if (cat) for (const l of cat[1].matchAll(/'([a-z_]+)'/g)) anota(l[1], archivo)
}

// ── Comprobaciones ───────────────────────────────────────────────────────────

const hallazgos = []
const apunta = (que, porque) => hallazgos.push({ que, porque })

const [catalogo, sectores, necesidades, clientes] = await Promise.all([
  pedir('modulos_catalogo?select=clave,nombre,activo,tipo,precio_inicial_usd,precio_empresa_usd,precio_pro_usd,precio_inicial_eur,precio_empresa_eur,precio_pro_eur'),
  pedir('plantillas_sector?select=sector,modulos'),
  pedir('diagnostico_necesidades?select=clave,modulos'),
  pedir('clients?select=client_id,nombre_empresa,modulos_activos'),
])

const existe = new Set(catalogo.map(m => m.clave))
const activo = new Set(catalogo.filter(m => m.activo).map(m => m.clave))

// 1. Código → catálogo.
for (const [clave, archivos] of citadas) {
  if (existe.has(clave) || ALLOWLIST[clave]) continue
  const donde = [...archivos].slice(0, 3).join(', ')
  apunta(`el código cita el módulo '${clave}', que no está en modulos_catalogo (${donde}${archivos.size > 3 ? `, +${archivos.size - 3}` : ''})`,
         '`tieneModulo` devolverá false para siempre: la funcionalidad no se rompe, se apaga — y apagada parece «no contratada».')
}

// 1-bis. Código → módulo INACTIVO que ya no tiene NINGÚN cliente.
//
// Un módulo retirado de la venta se le sigue sirviendo a quien lo contrató, así
// que citarlo es correcto mientras alguien lo tenga. Cuando no lo tiene nadie, la
// cita es código muerto que APAGA algo en silencio: `tieneModulo` devuelve false
// para todos y la funcionalidad desaparece sin que nadie vea un fallo. Es lo que
// pasó con el selector de empresa del dossier al retirar Multiempresa.
const conClientes = new Set(
  clientes.flatMap(c => (Array.isArray(c.modulos_activos) ? c.modulos_activos : [])),
)
for (const [clave, archivos] of citadas) {
  if (!existe.has(clave) || activo.has(clave)) continue
  if (SIN_VENDER_AUN[clave] || conClientes.has(clave)) continue
  const donde = [...archivos].slice(0, 3).join(', ')
  apunta(`el código cita '${clave}', retirado de la venta y sin ningún cliente que lo tenga (${donde}${archivos.size > 3 ? `, +${archivos.size - 3}` : ''})`,
         'La condición es false para todo el mundo: lo que hubiera detrás está apagado y parece «no contratado». Retira la cita, o justifícala en SIN_VENDER_AUN.')
}

// 2. Datos → catálogo. Sector y necesidad alimentan la recomendación pública: una
//    clave retirada ahí le ofrece al visitante algo que no puede comprar.
for (const s of sectores) {
  for (const clave of (Array.isArray(s.modulos) ? s.modulos : [])) {
    if (!existe.has(clave)) {
      apunta(`la plantilla de sector '${s.sector}' sugiere '${clave}', que no está en el catálogo`,
             'El diagnóstico lo recomienda y el visitante no puede contratarlo.')
    } else if (!activo.has(clave)) {
      apunta(`la plantilla de sector '${s.sector}' sugiere '${clave}', que está INACTIVO`,
             'Se recomienda un módulo retirado de la venta.')
    }
  }
}
for (const n of necesidades) {
  for (const clave of (Array.isArray(n.modulos) ? n.modulos : [])) {
    if (!existe.has(clave)) {
      apunta(`la necesidad '${n.clave}' del diagnóstico apunta a '${clave}', que no está en el catálogo`,
             'El informe promete un módulo que no existe.')
    } else if (!activo.has(clave)) {
      apunta(`la necesidad '${n.clave}' del diagnóstico apunta a '${clave}', que está INACTIVO`,
             'Se recomienda un módulo retirado de la venta.')
    }
  }
}

// 3. Clientes con un módulo que ya no existe. Inactivo NO se marca: un módulo
//    retirado de la venta se le sigue sirviendo a quien lo contrató.
for (const c of clientes) {
  for (const clave of (Array.isArray(c.modulos_activos) ? c.modulos_activos : [])) {
    if (!existe.has(clave)) {
      apunta(`el cliente ${c.client_id} (${c.nombre_empresa}) tiene contratado '${clave}', que no está en el catálogo`,
             'Le sigue apareciendo en la factura y no le da acceso a nada: se le cobra por una clave muerta.')
    }
  }
}

// 4. Las SEIS casillas de precio de cada módulo activo: tres niveles × dos monedas.
//    El euro no es el dólar convertido —es precio propio— así que se comprueba
//    entero, columna a columna, igual que el dólar.
const MONEDAS = [['USD', 'usd', '$'], ['EUR', 'eur', '€']]
const NIVELES = ['inicial', 'empresa', 'pro']
for (const m of catalogo) {
  if (!m.activo) continue
  for (const [moneda, sufijo, simbolo] of MONEDAS) {
    const precios = {}
    for (const nivel of NIVELES) {
      const v = m[`precio_${nivel}_${sufijo}`]
      if (v === null || v === undefined || v === '') {
        apunta(`'${m.clave}' (${m.nombre}) no tiene precio en ${nivel} / ${moneda}`,
               '`precioModulo` hace `?? 0`: el módulo sale GRATIS en esa casilla, y el presupuesto, la factura y la landing lo repiten igual.')
        continue
      }
      precios[nivel] = Number(v)
      if (!Number.isFinite(precios[nivel]) || precios[nivel] <= 0) {
        apunta(`'${m.clave}' (${m.nombre}) vale ${v} en ${nivel} / ${moneda}`,
               'Un módulo activo a cero se está regalando; si es a propósito, desactívalo o ponle su precio.')
      }
    }
    // Un nivel más alto nunca puede costar menos: sería el escalón al revés, y en
    // una rejilla que se teclea a mano es el error más fácil.
    if (precios.inicial > precios.empresa || precios.empresa > precios.pro) {
      apunta(`'${m.clave}' (${m.nombre}) cuesta ${simbolo}${precios.inicial} / ${simbolo}${precios.empresa} / ${simbolo}${precios.pro}`,
             'El precio baja al subir de nivel: subir de nivel le saldría más barato al cliente que quedarse.')
    }
  }
}

// ── Veredicto ────────────────────────────────────────────────────────────────

if (hallazgos.length === 0) {
  console.log(`✓ Catálogo OK: las ${citadas.size} claves citadas en código existen, y los ${activo.size} módulos activos tienen sus seis precios (3 niveles × 2 monedas).`)
  process.exit(0)
}

console.log(`✗ ${hallazgos.length} problema(s) de catálogo:\n`)
for (const h of hallazgos) console.log(`  ${h.que}\n    → ${h.porque}\n`)
console.log('Ninguno da un error en pantalla: o apagan una funcionalidad, o cobran de menos.')
process.exit(1)
