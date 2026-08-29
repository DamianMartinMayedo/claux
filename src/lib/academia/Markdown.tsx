import type { ReactNode } from 'react'
import Diagrama, { type TipoDiagrama } from './Diagramas'
import Limites from './Limites'
import { slugify, anclaEncabezado } from './slug'

/**
 * Renderizador de Markdown propio, sin dependencias.
 *
 * Cubre justo lo que usa el contenido de la Academia: encabezados (#..####),
 * párrafos, listas (con y sin número), tablas GFM, reglas (---), citas `>` —con
 * el caso especial `> etiquetas:` que se pinta como chips— y en línea **negrita**,
 * *cursiva*, `código` y [enlaces](url). Nada más, a propósito.
 *
 * Además intercepta un bloque cercado especial para insertar algo que NO es
 * texto del manual sino dato del sistema:
 *
 *  · ```claux:flujo```, ```claux:conexiones```, ```claux:capas``` → un diagrama
 *    del grafo. Por defecto dibuja el de la ficha en la que está, de ahí el
 *    `slug`; con una clave —```claux:flujo:recorrido-venta```— apunta a una
 *    entrada concreta, que es lo que necesita la Parte I: varios recorridos
 *    distintos conviviendo en la misma página.
 *  · ```claux:limites:productos,almacenes``` → la tabla de topes por nivel,
 *    leída de `nivel_limites`. Sin claves salen las diez dimensiones.
 *
 * En los dos casos la línea de dentro del bloque, si la hay, es el pie.
 *
 * Y pliega los apartados que `filtro.ts` marcó como `avanzado` (ver
 * `plegarAvanzados`), que es el segundo eje de la etiqueta: no quién puede
 * leerlo, sino cuánto baja.
 */

const DIAGRAMAS: readonly TipoDiagrama[] = ['flujo', 'conexiones', 'capas']

// ── En línea ─────────────────────────────────────────────────────────────────
const INLINE = /(\*\*([^*]+?)\*\*|`([^`]+?)`|\*([^*\s][^*]*?)\*|\[([^\]]+?)\]\(([^)]+?)\))/g

function inline(texto: string, keyBase: string): ReactNode[] {
  const nodos: ReactNode[] = []
  let ultimo = 0
  let m: RegExpExecArray | null
  let n = 0
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(texto)) !== null) {
    if (m.index > ultimo) nodos.push(texto.slice(ultimo, m.index))
    const k = `${keyBase}-${n++}`
    if (m[2] !== undefined) nodos.push(<strong key={k}>{m[2]}</strong>)
    else if (m[3] !== undefined) nodos.push(<code key={k} className="acad-code">{m[3]}</code>)
    else if (m[4] !== undefined) nodos.push(<em key={k}>{m[4]}</em>)
    else if (m[5] !== undefined) nodos.push(<a key={k} className="acad-link" href={m[6]} target="_blank" rel="noopener noreferrer">{m[5]}</a>)
    ultimo = m.index + m[0].length
  }
  if (ultimo < texto.length) nodos.push(texto.slice(ultimo))
  return nodos
}

/** Botón «copiar enlace a este apartado» que acompaña a cada encabezado. */
function AnclaCopiar({ id }: { id: string }) {
  return (
    <button type="button" className="acad-ancla" data-acad-copy={id}
            aria-label="Copiar el enlace a este apartado">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </svg>
      <span className="acad-ancla-ok" aria-hidden="true">Copiado</span>
    </button>
  )
}

// ── Utilidades de bloque ─────────────────────────────────────────────────────

const esListaItem = (l: string) => /^\s*([-*]|\d+\.)\s+/.test(l)
const esEncabezado = (l: string) => /^#{1,6}\s+/.test(l)
const esRegla = (l: string) => /^(---+|\*\*\*+)\s*$/.test(l)
const esCita = (l: string) => /^>\s?/.test(l)
const esTabla = (l: string, sig: string | undefined) =>
  l.trim().startsWith('|') && !!sig && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(sig)

// ── Profundidad ──────────────────────────────────────────────────────────────

/** Dónde empieza cada encabezado dentro de los bloques ya pintados. */
type Hito = { pos: number; nivel: number; texto: string }

/**
 * Los apartados marcados `avanzado` se pliegan donde están.
 *
 * No es un filtro —no se quita nada, y lo plegado sigue en el HTML— sino el
 * segundo plano de lectura: la etiqueta dice para quién es un apartado *y*
 * cuánto baja, y lo segundo no es una frontera. Se usa `<details>` nativo: sin
 * JS se abre igual, se navega con el teclado y no cuesta un viaje al servidor.
 *
 * Abierto o cerrado lo decide la CAPA, no el apartado. Para el equipo esto es el
 * manual entero —plegárselo sería esconderle la Parte V, que es justo lo que
 * viene a leer—; para quien vende o lee de fuera, la primera lectura de una
 * ficha es qué es y cómo se vende, y el cableado con los demás módulos estorba
 * hasta el día que se busca.
 */
function plegarAvanzados(
  bloques: ReactNode[],
  hitos: Hito[],
  avanzados: readonly string[],
  abiertos: boolean,
): ReactNode[] {
  const marcados = new Set(avanzados)
  const salida: ReactNode[] = []
  let i = 0
  let h = 0

  while (i < bloques.length) {
    const hito = hitos[h]
    // Solo apartados: un `#` marcado `avanzado` es la pieza entera (la Parte V
    // lo está), y plegar una página dentro de sí misma no dice nada.
    if (hito?.pos === i && hito.nivel >= 2 && marcados.has(hito.texto)) {
      // El apartado entero: hasta el siguiente encabezado de su nivel o mayor.
      const sig = hitos.slice(h + 1).find(x => x.nivel <= hito.nivel)
      const fin = sig ? sig.pos : bloques.length
      salida.push(
        <details key={`av${hito.pos}`} className="acad-avanzado" open={abiertos}>
          <summary className="acad-avanzado-sum">
            {bloques[i]}
            <span className="acad-avanzado-pista">Detalle</span>
          </summary>
          {bloques.slice(i + 1, fin)}
        </details>
      )
      while (h < hitos.length && hitos[h].pos < fin) h++
      i = fin
      continue
    }
    if (hito?.pos === i) h++
    salida.push(bloques[i])
    i++
  }
  return salida
}

// ── Renderizado principal ────────────────────────────────────────────────────
export default function Markdown(
  { source, slug, avanzados, abiertos = false }:
  { source: string; slug?: string; avanzados?: readonly string[]; abiertos?: boolean },
) {
  const lineas = source.replace(/\r\n/g, '\n').split('\n')
  const bloques: ReactNode[] = []
  const hitos: Hito[] = []
  let i = 0
  let b = 0

  while (i < lineas.length) {
    const linea = lineas[i]

    // En blanco.
    if (linea.trim() === '') { i++; continue }

    // Bloque cercado (```). Directiva de diagrama o código literal. Admite las
    // dos formas: fence de varias líneas y fence de una sola (```tipo```).
    const cerca = /^(```+)(.*)$/.exec(linea)
    if (cerca) {
      let resto = cerca[2]
      const unaLinea = resto.trimEnd().endsWith('```')
      if (unaLinea) resto = resto.trimEnd().replace(/`+$/, '')
      const info = resto.trim()
      const buffer: string[] = []
      i++
      if (!unaLinea) {
        while (i < lineas.length && !/^```+\s*$/.test(lineas[i])) { buffer.push(lineas[i]); i++ }
        if (i < lineas.length) i++ // línea de cierre
      }
      const cuerpo = buffer.join('\n').trim()
      // La coma en la clave es de `claux:limites`, que admite varias dimensiones.
      const dir = /^claux:(\w+)(?::([\w,-]+))?$/.exec(info)
      const tipo = dir?.[1]
      const clave = dir?.[2] ?? slug
      if (tipo === 'limites') {
        // Sin clave son TODAS las dimensiones, no la de la ficha: aquí el slug
        // de la pieza no nombra nada.
        bloques.push(<Limites key={`b${b++}`} dims={dir?.[2]} caption={cuerpo || undefined} />)
      } else if (clave && tipo && DIAGRAMAS.includes(tipo as TipoDiagrama)) {
        bloques.push(<Diagrama key={`b${b++}`} tipo={tipo as TipoDiagrama} slug={clave} caption={cuerpo || undefined} />)
      } else {
        bloques.push(<pre key={`b${b++}`} className="acad-pre"><code>{cuerpo}</code></pre>)
      }
      continue
    }

    // Regla.
    if (esRegla(linea)) { bloques.push(<hr key={`b${b++}`} className="acad-hr" />); i++; continue }

    // Encabezado.
    const he = /^(#{1,6})\s+(.*)$/.exec(linea)
    if (he) {
      const nivel = he[1].length
      const texto = he[2].trim()
      const id = anclaEncabezado(texto, slug)
      const cls = `acad-h${nivel}`
      const hijos = inline(texto, `b${b}`)
      // El manual es UNA página: sin un enlace por apartado, lo único que se
      // puede compartir es «/academia» y que el otro lo busque. El botón lo
      // pinta el servidor y el clic lo atiende un listener delegado.
      const ancla = nivel === 2 || nivel === 3 ? <AnclaCopiar id={id} /> : null
      hitos.push({ pos: bloques.length, nivel, texto })
      bloques.push(
        nivel === 1 ? <h1 key={`b${b++}`} id={id} className={cls}>{hijos}</h1> :
        nivel === 2 ? <h2 key={`b${b++}`} id={id} className={cls}>{hijos}{ancla}</h2> :
        nivel === 3 ? <h3 key={`b${b++}`} id={id} className={cls}>{hijos}{ancla}</h3> :
                      <h4 key={`b${b++}`} id={id} className={cls}>{hijos}</h4>
      )
      i++; continue
    }

    // Tabla.
    if (esTabla(linea, lineas[i + 1])) {
      const celdas = (fila: string) =>
        fila.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())
      const cab = celdas(linea)
      i += 2 // cabecera + separador
      const filas: string[][] = []
      while (i < lineas.length && lineas[i].trim().startsWith('|')) {
        filas.push(celdas(lineas[i])); i++
      }
      bloques.push(
        <div key={`b${b++}`} className="acad-table-wrap">
          <table className="acad-table">
            <thead>
              <tr>{cab.map((c, j) => <th key={j}>{inline(c, `b${b}t${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {filas.map((f, r) => (
                <tr key={r}>{f.map((c, j) => <td key={j}>{inline(c, `b${b}r${r}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // Cita / etiquetas.
    if (esCita(linea)) {
      const buffer: string[] = []
      while (i < lineas.length && esCita(lineas[i])) {
        buffer.push(lineas[i].replace(/^>\s?/, '')); i++
      }
      const contenido = buffer.join('\n').trim()
      const etq = /^etiquetas:\s*(.*)$/i.exec(contenido)
      if (etq) {
        const partes = etq[1].split('·').map(s => s.trim()).filter(Boolean)
        bloques.push(
          <div key={`b${b++}`} className="acad-tags">
            {partes.map((p, j) => (
              <span key={j} className={`acad-tag acad-tag-${slugify(p)}`}>{p}</span>
            ))}
          </div>
        )
      } else {
        bloques.push(
          <blockquote key={`b${b++}`} className="acad-callout">
            {contenido.split('\n\n').map((par, j) => <p key={j}>{inline(par.replace(/\n/g, ' '), `b${b}p${j}`)}</p>)}
          </blockquote>
        )
      }
      continue
    }

    // Lista.
    if (esListaItem(linea)) {
      const ordenada = /^\s*\d+\.\s+/.test(linea)
      const items: string[] = []
      while (i < lineas.length && lineas[i].trim() !== '') {
        if (esListaItem(lineas[i])) {
          items.push(lineas[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))
        } else if (/^\s+/.test(lineas[i]) && items.length > 0) {
          items[items.length - 1] += ' ' + lineas[i].trim()
        } else break
        i++
      }
      const hijos = items.map((it, j) => <li key={j}>{inline(it, `b${b}i${j}`)}</li>)
      bloques.push(ordenada
        ? <ol key={`b${b++}`} className="acad-ol">{hijos}</ol>
        : <ul key={`b${b++}`} className="acad-ul">{hijos}</ul>)
      continue
    }

    // Párrafo.
    const par: string[] = []
    while (
      i < lineas.length && lineas[i].trim() !== '' &&
      !esEncabezado(lineas[i]) && !esRegla(lineas[i]) && !esCita(lineas[i]) &&
      !esListaItem(lineas[i]) && !esTabla(lineas[i], lineas[i + 1])
    ) {
      par.push(lineas[i]); i++
    }
    bloques.push(<p key={`b${b++}`} className="acad-p">{inline(par.join(' '), `b${b}`)}</p>)
  }

  return <>{avanzados?.length ? plegarAvanzados(bloques, hitos, avanzados, abiertos) : bloques}</>
}
