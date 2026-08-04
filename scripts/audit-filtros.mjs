#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Centinela de filtros: ¿miente algún listado sobre lo que está enseñando?
//
// POR QUÉ EXISTE. Los fallos de filtro de este repo no se ven. Ninguno da un
// error: todos devuelven un resultado creíble que resulta ser falso.
//
//   · Un `.limit(N)` sin `count: 'exact'` recorta el listado y NADIE puede saber
//     cuántas filas faltan — ni el aviso del techo, ni el contador «N de M», que
//     acaba diciendo «500 de 500» sobre el conjunto ya recortado. Es el fallo que
//     apareció en el cliente DEUS: una tabla que no traía nada de años anteriores.
//   · Una vista con rango y descarga que no le pasa el rango al fichero: el
//     desplegable dice «Todo el listado» y te bajas la historia entera mientras la
//     pantalla enseña tres meses.
//   · Un `resumen` con una variable de estado en crudo: el desplegable de «lo que
//     vas a descargar» imprime «PENDIENTE», «INGRESO» o directamente un UUID.
//   · Una entrada de exportación de una tabla CON `empresa_id` que no acota por
//     empresa: un usuario de una sola empresa se descarga las de todas.
//   · `new Date().toISOString()` usado como «hoy»: eso es UTC, y La Habana va a
//     UTC−4/−5. A partir de las 20:00 «hoy» ya es mañana, así que el último día
//     del mes «Este mes» devolvía un listado vacío con la píldora encendida.
//
// ALCANCE DELIBERADAMENTE ESTRECHO, como el centinela de columnas: solo grita
// cuando está seguro, mirando cadenas literales del código. No entiende el
// programa; reconoce las cinco formas de arriba.
//
// Uso:  node scripts/audit-filtros.mjs   ·   npm run audit:filtros
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'src'

// ── Excepciones justificadas ─────────────────────────────────────────────────
// Cada una dice POR QUÉ. Una lista de excepciones sin motivo es una lista de
// fallos escondidos.

/** `.limit()` que NO necesita `count`: no está recortando un listado del dueño. */
const LIMITE_OK = [
  // Un único registro (`.limit(1)`) no es un listado truncado.
  /\.limit\(\s*1\s*\)/,
  // Los avisos/campana y los cálculos internos no se pintan como tabla paginada.
  /\.limit\(\s*\d+\s*\)\s*$/m,
]

/** Ficheros donde `new Date().toISOString()` como fecha es legítimo. */
const TZ_OK = new Set([
  // La única fuente de «hoy» del negocio: aquí es donde se hace bien.
  'src/lib/fecha-tz.ts',
])

/** Vistas con rango y descarga que a propósito NO pasan el rango al fichero. */
const RANGO_EXPORT_OK = new Set([
  // Catálogos y maestros: su descarga no tiene dimensión temporal.
])

// ── Recorrido ────────────────────────────────────────────────────────────────

function ficheros(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) { ficheros(p, out); continue }
    if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}

function lineaDe(src, idx) {
  return src.slice(0, idx).split('\n').length
}

const hallazgos = []
function grito(archivo, linea, que, porque) {
  hallazgos.push({ archivo, linea, que, porque })
}

// ── 1. `.limit()` de un listado sin `count: 'exact'` ─────────────────────────
//
// Se mira POR CONSULTA, no por fichero: una acción puede tener una consulta con
// techo y aviso y otra sin él (era el caso de `caja.ts`, con los tickets bien y
// los cierres mudos). La consulta se delimita entre el `.from(` y el `.limit(`.

function revisarLimites(archivo, src) {
  // Solo las acciones del portal montan listados del dueño.
  if (!archivo.includes('actions/portal/')) return
  const re = /\.from\(\s*'([^']+)'\s*\)([\s\S]{0,1200}?)\.limit\(\s*([^)]*)\)/g
  let m
  while ((m = re.exec(src)) !== null) {
    const [todo, tabla, cuerpo, arg] = m
    if (arg.trim() === '1') continue                    // un solo registro
    if (/count:\s*'exact'/.test(todo)) continue         // lo hace bien
    if (LIMITE_OK.some(rx => rx.test(todo))) continue
    // Un `.limit(<literal>)` sin count: si el número está escrito a mano es un
    // techo fijo, y esos son justo los que mentían.
    if (!/^\d+$/.test(arg.trim())) continue
    grito(archivo, lineaDe(src, m.index),
      `.from('${tabla}') … .limit(${arg.trim()}) sin count: 'exact'`,
      'el listado se recorta y nadie puede decir cuántas filas faltan')
    void cuerpo
  }
}

// ── 2. «Hoy» en UTC ──────────────────────────────────────────────────────────

function revisarHoy(archivo, src) {
  if (TZ_OK.has(archivo)) return
  const re = /new Date\(\)\.toISOString\(\)\s*(?:\.split\(\s*'T'\s*\)\s*\[\s*0\s*\]|\.slice\(\s*0\s*,\s*10\s*\))/g
  let m
  while ((m = re.exec(src)) !== null) {
    grito(archivo, lineaDe(src, m.index),
      'new Date().toISOString() usado como fecha de HOY',
      'eso es UTC; La Habana va a UTC−4/−5, así que a partir de las 20:00 es mañana. Usa hoyEnTz() de lib/fecha-tz.ts')
  }
}

// ── 3. Vista con rango y descarga que no le pasa el rango al fichero ─────────

function revisarRangoEnDescarga(archivo, src) {
  if (!/\.tsx$/.test(archivo)) return
  if (RANGO_EXPORT_OK.has(archivo)) return
  // La vista tiene rango si pinta la barra con `rango=` o el control directo.
  const tieneRango = /<RangoBusqueda/.test(src) || /<Filtros[\s\S]{0,400}?rango=/.test(src)
  if (!tieneRango) return
  if (!/<ExportarMenu/.test(src)) return
  // Con el contrato único basta `filtroExport(...)`, que ya arrastra el rango que
  // se le pasa de base; sin él, hay que ver `desde` explícito.
  const pasaRango = /filtroExport\(/.test(src) || /desde:\s*data\.rango\.desde/.test(src)
  if (pasaRango) return
  grito(archivo, 1,
    'la vista filtra por rango y la descarga no lo recibe',
    'el desplegable dirá «Todo el listado» y el fichero traerá la historia entera')
}

// ── 4. `resumen` con un valor en crudo ───────────────────────────────────────
//
// El resumen es lo que el desplegable promete descargar, y va en las palabras del
// dueño. Una variable de estado suelta imprime el código interno.

function revisarResumen(archivo, src) {
  if (!/\.tsx$/.test(archivo)) return
  const re = /resumen=\{\[([\s\S]{0,600}?)\]\}/g
  let m
  while ((m = re.exec(src)) !== null) {
    const cuerpo = m[1]
    // `resumenDe(...)` ya resuelve la etiqueta desde la declaración.
    const lineas = cuerpo.split('\n')
    for (const [i, l] of lineas.entries()) {
      const t = l.trim().replace(/,$/, '')
      // Una entrada que es SOLO una variable (`filtroTipo`, `estado`) no puede
      // estar en palabras del dueño.
      if (/^(filtro[A-Za-z]*|estado|tipo|tab|modo)$/.test(t)) {
        grito(archivo, lineaDe(src, m.index) + i,
          `resumen con «${t}» en crudo`,
          'el desplegable imprimirá el código interno («PENDIENTE», «INGRESO», un UUID). Usa resumenDe(declaracion)')
      }
    }
  }
}

// ── 5. Entrada de exportación de una tabla con empresa que no acota ──────────
//
// `leer()` aplica el alcance por sí solo cuando la tabla está en
// `TABLAS_CON_EMPRESA`. El centinela comprueba que esa lista sigue viva: si
// desaparece, la fuga vuelve en silencio.

function revisarAlcanceExport(archivo, src) {
  if (!archivo.endsWith('src/lib/exportar/tablas.ts')) return
  if (!/TABLAS_CON_EMPRESA/.test(src)) {
    grito(archivo, 1,
      'no existe TABLAS_CON_EMPRESA',
      'sin ella `leer()` no acota por empresa y un usuario de una empresa se descarga las de todas')
    return
  }
  if (!/query\s*=\s*query\.in\(\s*'empresa_id'/.test(src)) {
    grito(archivo, 1,
      'TABLAS_CON_EMPRESA existe pero `leer()` no la aplica',
      'la lista sin el `.in(empresa_id)` es documentación, no control de acceso')
  }
}

// ── 6. Sentinela propio en un VALOR DE FILTRO ────────────────────────────────
//
// Hubo dos centinelas distintos para lo mismo y el de Productos se traducía a
// cadena vacía al mandarlo: pedir «Sin categoría» descargaba TODO el catálogo.
//
// Solo se mira donde el valor VIAJA —una opción de un desplegable, una clave del
// contrato de filtro—, no una clave interna de un `Map` de agrupación: `'__sin__'`
// como clave del grupo «Otros» del catálogo público, o del acumulador del P&L, no
// sale de su función y no puede desincronizarse de nada.

function revisarCentinelas(archivo, src) {
  if (archivo.endsWith('src/lib/listados.ts')) return
  const formas = [
    // <option value="__sin_algo__">
    /value=(?:'|"|\{')__sin_[a-z_]*__?(?:'|"|'\})/g,
    // categoria: '__sin__' · tercero: '__sin_x__' · valor: '__sin__'
    /\b(?:categoria|tercero|valor|estado|tipo)\s*:\s*'__sin_[a-z_]*__?'/g,
  ]
  for (const re of formas) {
    let m
    while ((m = re.exec(src)) !== null) {
      grito(archivo, lineaDe(src, m.index),
        `centinela propio en un valor de filtro: ${m[0]}`,
        'usa SIN_CATEGORIA / SIN_TERCERO de lib/listados.ts: dos centinelas para lo mismo es cómo «Sin categoría» acabó descargando el catálogo entero')
    }
  }
}

// ── 7. Filtro por tercero montado a mano ─────────────────────────────────────
//
// Un tercero es POR EMPRESA: el mismo proveedor real tiene una ficha por cada empresa que
// le compra. Un desplegable plano lista «CLAUDIA» tres veces, idénticas; y agrupar por
// NOMBRE es peor, porque fusiona tres fichas y filtrar enseña las deudas de las tres.
// La única forma correcta es `opcionesTercero()`, que pone el id como valor y la empresa
// como grupo. Aquí se caza el que se escriba a mano.

function revisarOpcionesTercero(archivo, src) {
  if (!/\.tsx$/.test(archivo)) return
  // Una declaración con `clave: 'tercero'` cuyas opciones no salen del helper. La ventana
  // llega HOLGADAMENTE más allá del `opciones:` porque el array suele ir en varias líneas
  // (con la opción «Sin cliente» delante) y el helper aparece en la siguiente.
  const re = /clave:\s*'tercero'[\s\S]{0,600}?opciones:[\s\S]{0,400}/g
  let m
  while ((m = re.exec(src)) !== null) {
    if (/opcionesTercero\(/.test(m[0])) continue
    grito(archivo, lineaDe(src, m.index),
      'filtro por tercero con las opciones montadas a mano',
      'usa opcionesTercero() de lib/filtros.ts: un tercero tiene una ficha POR EMPRESA, y sin el grupo salen tres «CLAUDIA» idénticas (o, si agrupas por nombre, una que enseña las deudas de las tres)')
  }
}

// ── Ejecución ────────────────────────────────────────────────────────────────

for (const archivo of ficheros(RAIZ)) {
  const src = readFileSync(archivo, 'utf8')
  revisarLimites(archivo, src)
  revisarHoy(archivo, src)
  revisarRangoEnDescarga(archivo, src)
  revisarResumen(archivo, src)
  revisarAlcanceExport(archivo, src)
  revisarCentinelas(archivo, src)
  revisarOpcionesTercero(archivo, src)
}

if (hallazgos.length === 0) {
  console.log('✓ Filtros OK: ningún listado recorta en silencio, ninguna descarga promete lo que no lleva.')
  process.exit(0)
}

console.log(`✗ ${hallazgos.length} hallazgo(s):\n`)
for (const h of hallazgos) {
  console.log(`  ${h.archivo}:${h.linea}`)
  console.log(`    ${h.que}`)
  console.log(`    → ${h.porque}\n`)
}
console.log('Ninguno de estos da un error: todos devuelven un resultado creíble que es falso.')
process.exit(1)
