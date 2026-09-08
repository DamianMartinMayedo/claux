#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Centinela del registro de los textos visibles (skills/ui/SKILL.md § 5.1).
//
// POR QUÉ EXISTE. El 2026-09-08 se cambió la voz de toda la plataforma: de tuteo
// a impersonal. Un barrido no basta. La norma anterior ya prohibía exclamaciones
// y emoticonos desde hacía meses y había 17 y 73 repartidos por el código: una
// regla escrita que nadie comprueba se deshace en tres sesiones. Esto la comprueba.
//
// QUÉ MIRA. Solo el texto que un humano LEE: literales de cadena y texto JSX.
// Los comentarios del código quedan fuera a propósito —ahí se escribe como se
// quiera— y por eso el fichero se recorre con un escáner que sabe distinguir una
// cadena de un comentario, en vez de con una expresión regular por línea.
//
//   1. TUTEO            pronombres, posesivos, presentes e imperativos de tú
//   2. PRIMERA PERSONA  CLAUX hablando de sí mismo («no pudimos», «te cargamos»)
//   3. COLOQUIALISMOS   «ojo», «a mano», «de golpe», «si quieres», «no hace falta»
//   4. EUFORIA          exclamaciones y emoticonos
//   5. PLANTILLA        la forma prohibida de una situación con forma única
//                       («Error al…», «Aún no hay…», «Inténtalo de nuevo»)
//   6. REGISTRO IA      solo en `src/lib/ia/`: que ningún prompt vuelva a pedir
//                       respuestas «de tú», «cercanas» o «cálidas»
//
// FUERA DE ALCANCE. `/academia` y la landing (registro propio, decisión del
// propietario) y las migraciones ya aplicadas (son historia; el texto vivo de la
// BD se corrige con una migración nueva o desde el admin, no reescribiendo el
// pasado).
//
// Uso:  node scripts/audit-textos.mjs [--lista] [--ruta src/app/portal]
//         --lista  vuelca cada hallazgo con su texto completo (para barrer)
//         --ruta   limita el recorrido a una carpeta
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'src'

// Carpetas con registro propio o que no son texto de producto.
const EXCLUIDAS = [
  'src/app/(academia)',
  'src/app/(landing)',
  'src/lib/academia',
  'src/app/api',
  // La home es la landing, aunque su metadata y su imagen social vivan sueltas
  // en `src/app/` en vez de dentro de `(landing)`.
  'src/app/layout.tsx',
  'src/app/opengraph-image.tsx',
]

// ── Excepciones justificadas ────────────────────────────────────────────────
// Cada entrada dice POR QUÉ. Sin motivo no entra: la lista es la puerta por la
// que vuelve el tuteo si se usa como alfombra.
const PERMITIDO = [
  // La firma de un correo es la única primera persona del equipo que la norma acepta.
  { texto: 'El equipo de CLAUX',        motivo: 'firma de correo (§5.1)' },
  // Documentos legales: «las Partes» hablan en primera persona del plural por
  // convención jurídica, no por cercanía.
  { ruta: 'src/lib/documentos/plantillas/', motivo: 'texto legal: registro jurídico propio' },
  { ruta: 'src/lib/pdf/documento',      motivo: 'texto legal: registro jurídico propio' },
  // La propuesta comercial la firma la empresa: «la puesta en marcha la hacemos
  // nosotros» no es cercanía impostada, es quién se compromete a qué. Solo se le
  // perdona la primera persona; el tuteo y la euforia se le exigen igual.
  { ruta: 'src/lib/propuesta/', reglas: ['primera'], motivo: 'documento comercial firmado por la empresa' },
  { ruta: 'src/app/(public)/p/', reglas: ['primera'], motivo: 'la propuesta, ya en pantalla: la firma la empresa' },
  // Los avisos al comensal los firma EL NEGOCIO, no CLAUX: «le confirmamos su
  // reserva» es quién se compromete. El tuteo y la euforia se les exigen igual.
  { ruta: 'src/lib/reservas/', reglas: ['primera'], motivo: 'mensaje que el negocio firma ante su cliente final' },
  // El diagnóstico público es el embudo comercial: «le contactamos» es CLAUX
  // comprometiéndose con quien deja sus datos, no cercanía de interfaz.
  { ruta: 'src/app/diagnostico/', reglas: ['primera'], motivo: 'embudo comercial: la empresa se compromete' },
]

// ── Reglas ───────────────────────────────────────────────────────────────────

const TUTEO_PRONOMBRES = /\b(tú|ti|contigo|tuyo|tuya|tuyos|tuyas|tus)\b|\btu\s+[a-záéíóúñ]/i

const TUTEO_PRESENTE = new RegExp(
  '\\b(' + [
    'puedes', 'podrás', 'podrías', 'tienes', 'tendrás', 'debes', 'deberás',
    'quieres', 'querrás', 'necesitas', 'necesitarás', 'verás', 'sabes', 'sabrás',
    'estás', 'eres', 'harás', 'haces', 'dices', 'eliges', 'pones', 'entras',
    'vuelves', 'sigues', 'llevas', 'usas', 'escribes', 'registras', 'cobras',
    'vendes', 'pagas', 'añades', 'subes', 'guardas', 'envías', 'recibes',
    'aplicas', 'confirmas', 'cancelas', 'borras', 'eliminas', 'archivas',
    'importas', 'exportas', 'ajustas', 'corriges', 'revisas', 'compruebas',
    'gestionas', 'clasificaste', 'cambiaste', 'habías', 'hiciste', 'pediste',
  ].join('|') + ')\\b', 'i')

// Imperativos de tú. Solo los que NO son también un sustantivo corriente
// («Consulta», «Marca», «Copia», «Prueba», «Firma», «Cuenta» quedan fuera:
// darían falsos positivos en etiquetas de columna).
const TUTEO_IMPERATIVO = new RegExp(
  '(^|[.·:—]\\s+)(' + [
    'Crea', 'Escribe', 'Elige', 'Pulsa', 'Haz', 'Introduce', 'Selecciona',
    'Comprueba', 'Añade', 'Descarga', 'Comparte', 'Envía', 'Guarda', 'Sube',
    'Revisa', 'Vuelve', 'Entra', 'Usa', 'Abre', 'Dime', 'Empieza', 'Continúa',
    'Apunta', 'Rellena', 'Completa', 'Arrastra', 'Contacta', 'Ponte', 'Pon',
  ].join('|') + ')\\s+[a-záéíóúñ]')

// Imperativos con pronombre pegado: inconfundibles, se listan uno a uno porque
// la forma genérica («acento + lo/la/nos») confunde «artículos» con «márcalos».
const TUTEO_ENCLITICO = new RegExp(
  '\\b(' + [
    'revísalo', 'revísala', 'revísalos', 'revísalas', 'cópialo', 'cópiala',
    'márcalo', 'márcala', 'archívalo', 'archívala', 'cámbialo', 'cámbiala',
    'hazlo', 'hazla', 'inténtalo', 'dilo', 'míralo', 'súbelo', 'bájalo',
    'envíalo', 'guárdalo', 'ábrelo', 'ciérralo', 'déjalo', 'ponlo', 'quítalo',
    'añádelo', 'créalo', 'elígelo', 'úsalo', 'léelo', 'compártelo',
    'descárgalo', 'actualízalo', 'corrígelo', 'ajústalo', 'complétalo',
    'rellénalo', 'bórralo', 'elimínalo', 'confírmalo', 'cancélalo', 'apúntalo',
    'avísanos', 'escríbenos', 'respóndenos', 'cuéntanos', 'dinos', 'pídelo',
    'dásela', 'dáselo', 'sincronízalo', 'edítala', 'edítalo', 'retómalo',
  ].join('|') + ')\\b', 'i')

const PRIMERA_PERSONA = new RegExp(
  '\\b(' + [
    'pudimos', 'podemos', 'hemos', 'hicimos', 'tenemos', 'queremos',
    'necesitamos', 'recibimos', 'confirmamos', 'encontramos', 'cargamos',
    'ampliamos', 'seguimos', 'pagamos', 'ofrecemos', 'sentimos', 'avisamos',
    'contactamos', 'nosotros', 'nuestro', 'nuestra', 'nuestros', 'nuestras',
    'no pude', 'no puedo', 'perdona', 'perdón',
  ].join('|') + ')\\b', 'i')

const COLOQUIAL = new RegExp(
  '(' + [
    '\\bojo\\b', 'a ojo\\b', '\\ba mano\\b', 'de golpe', 'de un tirón',
    'sin líos', 'casi listo', 'no pasa nada', 'si quieres', 'cuando quieras',
    'no hace falta', 'hace falta', 'haga falta', '\\btoca\\s+(decidir|hacer|elegir|revisar)',
    'un pelín', 'échale', 'lo vemos', '\\bte paso\\b', 'en un momento', 'ya verás',
  ].join('|') + ')', 'i')

// Las flechas (→ ↑ ⋮) son señalización de interfaz, no euforia: fuera del rango.
const EUFORIA = /[¡!]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u

const PLANTILLA = new RegExp(
  '(' + [
    '^Error al\\b', '^Error:', '^Error\\b', 'No pudimos', 'No pude\\b',
    'Inténtalo de nuevo', 'Vuelve a intentarlo', 'Prueba de nuevo',
    '^Aún no hay', '^Aún no tienes', '^Todavía no', 'correctamente',
    'No tienes permiso', 'No puedes\\b',
  ].join('|') + ')', 'i')

// ── Zona de prompts ─────────────────────────────────────────────────────────
// `src/lib/ia/` no es texto visible: son instrucciones AL MODELO, y ahí se le
// habla de tú porque no lo lee ningún cliente. Lo que sí se vigila es que nadie
// vuelva a pedirle que RESPONDA con la voz antigua: la salida de la IA la lee el
// dueño del negocio y va en el mismo registro que el resto (§5.1).
const ZONA_PROMPTS = 'src/lib/ia/'

const REGISTRO_IA = new RegExp(
  '(' + [
    // «Sin tutear» es la instrucción CORRECTA: se busca la que pide la voz vieja.
    'de t[úu]\\b', 'tuteo\\b', 'segunda persona',
    'cercan[oa]', 'c[áa]lid[oa]', 'calidez', 'con simpat[íi]a', 'amable',
  ].join('|') + ')', 'i')

const REGLAS = [
  { id: 'tuteo',     etiqueta: 'TUTEO',           re: TUTEO_PRONOMBRES },
  { id: 'tuteo',     etiqueta: 'TUTEO',           re: TUTEO_PRESENTE },
  { id: 'tuteo',     etiqueta: 'TUTEO',           re: TUTEO_IMPERATIVO },
  { id: 'tuteo',     etiqueta: 'TUTEO',           re: TUTEO_ENCLITICO },
  { id: 'primera',   etiqueta: 'PRIMERA PERSONA', re: PRIMERA_PERSONA },
  { id: 'coloquial', etiqueta: 'COLOQUIALISMO',   re: COLOQUIAL },
  { id: 'euforia',   etiqueta: 'EUFORIA',         re: EUFORIA },
  { id: 'plantilla', etiqueta: 'PLANTILLA',       re: PLANTILLA },
]

// ── Escáner: separa cadenas y texto JSX de los comentarios ──────────────────
//
// Recorre el fichero carácter a carácter llevando la cuenta de dónde está. No es
// un parser de TypeScript: es lo justo para no confundir un `//` dentro de una
// URL con el principio de un comentario.

function extraer(src) {
  const salida = []          // { texto, linea }
  let i = 0, linea = 1
  const n = src.length

  const empujar = (texto, ln) => { if (texto.trim()) salida.push({ texto: texto.trim(), linea: ln }) }

  while (i < n) {
    const c = src[i]

    if (c === '\n') { linea++; i++; continue }

    // Comentario de línea
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    // Comentario de bloque
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') linea++; i++ }
      i += 2
      continue
    }
    // Cadena
    if (c === "'" || c === '"' || c === '`') {
      const cierre = c, inicio = linea
      let buf = ''
      i++
      while (i < n && src[i] !== cierre) {
        if (src[i] === '\\') { buf += src[i + 1] === 'n' ? ' ' : ''; i += 2; continue }
        // Interpolación de plantilla: el hueco no es texto, pero lo de alrededor sí
        if (cierre === '`' && src[i] === '$' && src[i + 1] === '{') {
          let prof = 1; i += 2
          while (i < n && prof > 0) {
            if (src[i] === '{') prof++
            else if (src[i] === '}') prof--
            else if (src[i] === '\n') linea++
            i++
          }
          buf += ' … '
          continue
        }
        if (src[i] === '\n') linea++
        buf += src[i]; i++
      }
      i++
      empujar(buf, inicio)
      continue
    }
    // Texto JSX: entre `>` y `<`, sin llaves ni etiquetas por medio. El `>` de una
    // flecha (`=>`) o de una comparación no abre nada.
    if (c === '>' && !'=-<>!'.includes(src[i - 1]) && src[i + 1] !== '=') {
      // Se cuentan los saltos en local: si el tramo se descarta, la cuenta de
      // líneas no puede quedar adelantada —era el fallo que descolocaba el informe.
      let j = i + 1, buf = '', ln = linea, saltos = 0, ok = true
      while (j < n && src[j] !== '<') {
        if (src[j] === '{' || src[j] === '}' || src[j] === '>') { ok = false; break }
        if (src[j] === '\n') saltos++
        buf += src[j]; j++
      }
      // Una comparación (`a > 0`) abre un tramo que parece texto y arrastra código:
      // ninguna frase de la interfaz lleva una palabra reservada de JavaScript.
      const codigo = /\b(?:return|const|let|var|if|else|function|await|async|typeof|null|undefined|true|false)\b/
      if (ok && j < n && !/\/\/|\/\*|=>|;|&&|\|\|/.test(buf) && !codigo.test(buf)) {
        empujar(buf, ln); linea += saltos; i = j; continue
      }
      i++
      continue
    }
    i++
  }
  return salida
}

// ── Filtro: ¿esto lo lee un humano? ─────────────────────────────────────────

const PALABRAS_ES = /[a-záéíóúñü]{3,}\s+[a-záéíóúñü]{2,}|[¿«]/i

function esTextoVisible(t) {
  if (t.length < 6 || t.length > 600) return false
  if (!PALABRAS_ES.test(t)) return false
  if (/^[a-z0-9_\-./@]+$/.test(t)) return false            // rutas, claves, imports
  if (/^(https?:|\/|\.\/|@\/|use |#[0-9a-f])/i.test(t)) return false
  if (/[<>]{1}[a-z]/.test(t)) return false                  // fragmento de etiqueta
  if (/^[a-z-]+(\s+[a-z-]+)*$/.test(t) && !/[áéíóúñ¿«]/i.test(t)) return false  // clases CSS
  if (/\b(SELECT|INSERT|UPDATE|FROM|WHERE|const|function|import|export)\b/.test(t)) return false
  return true
}

// ── Recorrido ────────────────────────────────────────────────────────────────

function ficheros(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (EXCLUIDAS.some(x => p.startsWith(x))) continue
    const st = statSync(p)
    if (st.isDirectory()) ficheros(p, acc)
    else if (/\.(ts|tsx)$/.test(e) && !/\.d\.ts$/.test(e)) acc.push(p)
  }
  return acc
}

function permitido(ruta, texto, regla) {
  return PERMITIDO.some(p => {
    // Sin `reglas`, la excepción vale para todas; con ellas, solo para las suyas.
    if (p.reglas && !p.reglas.includes(regla)) return false
    return (p.ruta && ruta.startsWith(p.ruta)) || (p.texto && texto.includes(p.texto))
  })
}

const args = process.argv.slice(2)
const LISTA = args.includes('--lista')
const iRuta = args.indexOf('--ruta')
const BASE = iRuta >= 0 ? args[iRuta + 1] : RAIZ

const hallazgos = []
// `--ruta` acepta un fichero suelto además de una carpeta: al corregir se mira uno.
const objetivo = statSync(BASE).isDirectory() ? ficheros(BASE) : [BASE]
for (const f of objetivo) {
  for (const { texto, linea } of extraer(readFileSync(f, 'utf8'))) {
    if (!esTextoVisible(texto)) continue
    const aplicables = f.startsWith(ZONA_PROMPTS)
      ? [{ id: 'ia', etiqueta: 'REGISTRO IA', re: REGISTRO_IA }]
      : REGLAS
    const rotas = [...new Set(aplicables
      .filter(r => r.re.test(texto) && !permitido(f, texto, r.id))
      .map(r => r.etiqueta))]
    if (rotas.length) hallazgos.push({ f, linea, texto, rotas })
  }
}

// ── Informe ──────────────────────────────────────────────────────────────────

if (!hallazgos.length) {
  console.log(`✓ Textos: registro correcto en ${BASE} (§5.1).`)
  process.exit(0)
}

const porRegla = {}
for (const h of hallazgos) for (const r of h.rotas) porRegla[r] = (porRegla[r] ?? 0) + 1

const porFichero = {}
for (const h of hallazgos) (porFichero[h.f] ??= []).push(h)

console.log(`\n✗ ${hallazgos.length} textos fuera del registro de §5.1 en ${Object.keys(porFichero).length} ficheros.\n`)
for (const [r, n] of Object.entries(porRegla).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(4)}  ${r}`)
}
console.log('')

const orden = Object.entries(porFichero).sort((a, b) => b[1].length - a[1].length)
for (const [f, hs] of (LISTA ? orden : orden.slice(0, 25))) {
  console.log(`${f}  (${hs.length})`)
  for (const h of (LISTA ? hs : hs.slice(0, 3))) {
    const t = LISTA ? h.texto : h.texto.slice(0, 110)
    console.log(`   ${String(h.linea).padStart(5)}  [${h.rotas.join(' ')}]  ${t}`)
  }
  if (!LISTA && hs.length > 3) console.log(`         … y ${hs.length - 3} más`)
}
if (!LISTA && orden.length > 25) console.log(`\n… y ${orden.length - 25} ficheros más. Con --lista salen todos.`)
console.log(`\nRegistro: skills/ui/SKILL.md § 5.1\n`)
process.exit(1)
