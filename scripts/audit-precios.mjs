#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Centinela de precios cableados: ¿hay algún importe escrito en el código?
//
// POR QUÉ EXISTE. El precio de CLAUX no vive en el código: vive en
// `modulos_catalogo` (seis columnas: tres niveles × dos monedas) y en `settings`
// (la hora de instalación, una por moneda), y el dueño los edita desde /admin sin desplegar. Un importe
// tecleado en un `.ts` no da error nunca: **empieza siendo verdad**. Deja de serlo
// el día que el dueño cambia el precio en el admin, y a partir de ahí hay dos
// cifras distintas —la de la pantalla y la del cobro— sin nada que las enfrente.
//
// Ya pasó con las migraciones-semilla, que quedaron desalineadas del catálogo
// vivo. Con seis columnas y dos descuentos, la tentación de cablear crece.
//
// QUÉ MIRA, y solo esto:
//   1. Un número puesto a mano en un campo que ES dinero de CLAUX
//      (`precio_*_usd`, `precio_*_eur`, `cuota_mensual`, `tarifa_hora`, `monto`…).
//   2. Un importe escrito dentro de un texto que el usuario lee («$35/mes»,
//      «€35/mes», «20 USD al mes»): el mismo problema, en la copia.
//
// No mira comentarios (ahí un importe es un ejemplo, no una promesa) ni los
// ficheros del ALLOWLIST, donde el valor por defecto vive JUNTO a su clave de
// `settings` y se lee como lo que es.
//
// Uso:  node scripts/audit-precios.mjs   ·   npm run audit:precios
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'src'

// Sitios donde un número monetario está justificado. Cada uno, con su motivo.
const ALLOWLIST = {
  // La tabla de ajustes del presupuesto: cada valor por defecto va PEGADO a la
  // clave de `settings` que lo sobreescribe y a su etiqueta del admin. Es el
  // respaldo declarado de un valor configurable, no un precio suelto — y tenerlo
  // aquí es lo que permite que el resto del repo no tenga ninguno.
  'src/lib/presupuesto/config.ts': 'tabla AJUSTES_PRESUPUESTO (valor por defecto + clave de settings)',
}

// Campos que SON dinero de CLAUX (no del cliente: `precio_venta` de un producto o
// el `descuento_pct` de una línea de factura son datos del negocio, no nuestros).
// Los campos con moneda EN EL NOMBRE son los del catálogo y las cachés del
// cliente (hay una columna por moneda); los que la perdieron —`cuota_mensual`,
// `total_final`, `monto`…— la llevan ahora en una columna `moneda` al lado, y por
// eso cablear su importe es AÚN peor: el número ya no dice ni en qué moneda está.
const CAMPOS = [
  'precio_inicial_usd', 'precio_empresa_usd', 'precio_pro_usd',
  'precio_inicial_eur', 'precio_empresa_eur', 'precio_pro_eur',
  'precio_mensual_usd', 'precio_mensual_eur',
  'cuota_mensual', 'coste_instalacion', 'tarifa_hora',
  'total_final', 'monto',
]

const CAMPO_CON_NUMERO = new RegExp(String.raw`\b(${CAMPOS.join('|')})\s*[:=]\s*(\d+(?:\.\d+)?)`, 'g')
// «$35», «€35.00/mes». `$0` no: es «no se cobra nada», no un precio.
const IMPORTE_TEXTO    = /[$€]\s?(\d+(?:[.,]\d+)?)/g
// «20 USD», «20 euros al mes».
const IMPORTE_PALABRA  = /\b(\d+(?:[.,]\d+)?)\s*(USD|usd|EUR|eur|dólares|dolares|euros)\b/g

function ficheros(dir) {
  const out = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) { out.push(...ficheros(ruta)); continue }
    if (/\.(ts|tsx|mts)$/.test(nombre)) out.push(ruta)
  }
  return out
}

/** El fuente con los COMENTARIOS en blanco (las cadenas se conservan: ahí se busca). */
function sinComentarios(src) {
  const out = src.split('')
  const blanquear = (a, b) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ' }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { let j = src.indexOf('\n', i); if (j === -1) j = src.length; blanquear(i, j); i = j; continue }
    if (c === '/' && src[i + 1] === '*') { let j = src.indexOf('*/', i); j = j === -1 ? src.length : j + 2; blanquear(i, j); i = j; continue }
    if (c === "'" || c === '"' || c === '`') {          // saltar la cadena entera, intacta
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) { j++; break }
        j++
      }
      i = j; continue
    }
    i++
  }
  return out.join('')
}

const lineaDe = (src, pos) => src.slice(0, pos).split('\n').length
const textoLinea = (src, pos) => {
  const fin = src.indexOf('\n', pos)
  return src.slice(src.lastIndexOf('\n', pos) + 1, fin === -1 ? src.length : fin)
}

const hallazgos = []

for (const archivo of ficheros(RAIZ)) {
  if (ALLOWLIST[archivo]) continue
  const src  = readFileSync(archivo, 'utf8')
  const codigo = sinComentarios(src)

  for (const m of codigo.matchAll(CAMPO_CON_NUMERO)) {
    if (Number(m[2]) === 0) continue                      // cero = «nada», no un precio
    hallazgos.push({
      archivo, linea: lineaDe(src, m.index), que: `${m[1]} = ${m[2]}`,
      porque: 'Ese importe vive en el catálogo o en settings; aquí es una copia que dejará de coincidir sin avisar.',
    })
  }

  for (const [re, clase] of [[IMPORTE_TEXTO, 'texto'], [IMPORTE_PALABRA, 'texto']]) {
    for (const m of codigo.matchAll(re)) {
      if (Number(String(m[1]).replace(',', '.')) === 0) continue
      const linea = textoLinea(codigo, m.index)
      // `'$1'` de una sustitución no es dinero, es un grupo capturado.
      if (/\.replace(All)?\s*\(|RegExp\s*\(/.test(linea)) continue
      hallazgos.push({
        archivo, linea: lineaDe(src, m.index), que: `importe en ${clase}: «${m[0].trim()}»`,
        porque: 'Un precio escrito en la copia se queda viejo el día que el dueño lo cambia en /admin.',
      })
    }
  }
}

if (hallazgos.length === 0) {
  console.log('✓ Precios OK: ningún importe de CLAUX cableado en el código.')
  process.exit(0)
}

console.log(`✗ ${hallazgos.length} importe(s) cableado(s):\n`)
for (const h of hallazgos) console.log(`  ${h.archivo}:${h.linea}  ${h.que}\n    → ${h.porque}\n`)
console.log('Léelo de modulos_catalogo (precioModulo) o de settings (leerSetting), o justifícalo en ALLOWLIST.')
process.exit(1)
