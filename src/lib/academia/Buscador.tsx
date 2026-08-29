'use client'

// `KeyboardEvent` de React se importa con alias: sin él tapa al del DOM y el
// listener global de «/» deja de compilar.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as TeclaReact, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { normalizar, type EntradaIndice } from './indice'
import { desplazarAAncla } from './desplazar'

/**
 * Buscador de contenido de TODO el manual, aunque cada pieza sea una página.
 *
 * Lo montan las dos superficies —el manual interno (`/academia`) y el centro de
 * ayuda público (`/ayuda`)—, y cada una **se queda en su contexto**: le pasa su
 * `urlIndice` y su `base`, así que buscar desde la ayuda encuentra guías de la
 * ayuda y lleva a `/ayuda/…`. Nunca asoma por aquí contenido de la otra: quien
 * decide qué entra en el índice es el endpoint que lo sirve.
 *
 * El índice se pide UNA vez nada más cargar y se queda en memoria: a partir de
 * ahí filtra al teclear sin tocar la red, que es lo que hace utilizable buscar
 * con conexión mala. Se trae aparte y no dentro del HTML porque pesa más que
 * cualquier pieza: incrustado, abrir una ficha por un enlace costaba cuatro
 * veces lo que ocupa la ficha.
 *
 * Si el resultado está en la página abierta, salta; si está en otra, navega a
 * ella con su ancla.
 *
 * Dentro del manual el índice depende además de la capa —buscar como vendedor no
 * puede encontrar lo que como vendedor no se ve—: por eso la capa viaja en la
 * `urlIndice` (cada una con su entrada en la caché del navegador) y al cambiarla
 * se vuelve a pedir sola, porque cambia la URL.
 *
 * Teclado: «/» o ⌘/Ctrl+K enfocan desde cualquier sitio, ↑/↓ recorren, Enter
 * salta, Escape cierra. El campo entero es un `<label>`, así que basta con
 * pinchar en cualquier punto de la píldora —el icono o la tecla «/» incluidos—.
 */

const MAX_RESULTADOS = 8
/** Por debajo de esto una palabra no acota nada: «de», «la», «el». */
const MIN_TERMINO = 2

type Resultado = EntradaIndice & { extracto: string }

/** Extrae el trozo de texto alrededor de la primera coincidencia. */
function extracto(texto: string, terminos: string[]): string {
  const plano = normalizar(texto)
  let pos = -1
  let largo = 0
  for (const t of terminos) {
    const p = plano.indexOf(t)
    if (p >= 0 && (pos < 0 || p < pos)) { pos = p; largo = t.length }
  }
  if (pos < 0) return texto.slice(0, 120)
  const desde = Math.max(0, pos - 40)
  const hasta = Math.min(texto.length, pos + largo + 80)
  return `${desde > 0 ? '…' : ''}${texto.slice(desde, hasta).trim()}${hasta < texto.length ? '…' : ''}`
}

/** Parte el texto en trozos para resaltar las coincidencias sin usar HTML crudo. */
function resaltar(texto: string, terminos: string[]) {
  if (terminos.length === 0) return texto
  const plano = normalizar(texto)
  const trozos: ReactNode[] = []
  let i = 0
  let n = 0
  while (i < texto.length) {
    // De todos los términos, el que aparezca antes a partir de aquí.
    let pos = -1
    let largo = 0
    for (const t of terminos) {
      const p = plano.indexOf(t, i)
      if (p >= 0 && (pos < 0 || p < pos)) { pos = p; largo = t.length }
    }
    if (pos < 0) { trozos.push(texto.slice(i)); break }
    if (pos > i) trozos.push(texto.slice(i, pos))
    trozos.push(<mark key={n++} className="acad-bus-mark">{texto.slice(pos, pos + largo)}</mark>)
    i = pos + largo
  }
  return trozos
}

export default function Buscador({
  urlIndice, base, placeholder,
}: {
  /** De dónde se trae el índice. Lleva dentro todo lo que lo distingue (la capa). */
  urlIndice: string
  /** Raíz de las páginas de esta superficie: `/academia` o `/ayuda`. */
  base: string
  placeholder: string
}) {
  const router = useRouter()
  const ruta = usePathname()
  // El índice pertenece a la URL con la que se pidió: se guarda con ella al lado.
  // Así, al cambiar de capa, el que hay deja de valer solo —sin vaciarlo a mano
  // desde el efecto, que dispara un render de más antes de que llegue el nuevo.
  const [traido, setTraido] = useState<{ url: string; datos: EntradaIndice[] } | null>(null)
  const [fallido, setFallido] = useState<string | null>(null)
  const indice = traido?.url === urlIndice ? traido.datos : null
  const fallo = fallido === urlIndice
  const [consulta, setConsulta] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(0)
  const cajaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Se pide al cargar, no al primer clic en el campo: así casi siempre ya está
  // cuando alguien decide buscar. Vive en el layout, que no se vuelve a montar
  // al cambiar de pieza, de modo que la petición se hace una sola vez.
  useEffect(() => {
    const corte = new AbortController()
    fetch(urlIndice, { signal: corte.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((datos: EntradaIndice[]) => setTraido({ url: urlIndice, datos }))
      .catch(e => {
        if (corte.signal.aborted) return
        console.error('[academia] no se pudo traer el índice de búsqueda:', e)
        setFallido(urlIndice)
      })
    return () => corte.abort()
  }, [urlIndice])

  /** El índice normalizado se calcula una vez, no en cada tecla. */
  const preparado = useMemo(
    () => (indice ?? []).map(e => ({
      entrada: e,
      titulo: normalizar(e.titulo),
      seccion: normalizar(e.seccion),
      texto: normalizar(e.texto),
    })),
    [indice],
  )

  /** La consulta se parte en palabras: «guion demo» encuentra lo que las tiene las dos. */
  const terminos = useMemo(
    () => normalizar(consulta.trim()).split(/\s+/).filter(t => t.length >= MIN_TERMINO),
    [consulta],
  )

  /**
   * Todo apartado que contenga TODAS las palabras, ordenado por dónde aparecen:
   * el título pesa más que la sección y la sección más que el cuerpo. Sin esto,
   * los ocho primeros salían en orden de documento y la ficha que se buscaba
   * quedaba fuera por detrás de ocho párrafos que la mencionaban de pasada.
   */
  const { resultados, total } = useMemo(() => {
    if (terminos.length === 0) return { resultados: [] as Resultado[], total: 0 }
    const casan: { entrada: EntradaIndice; punt: number }[] = []
    for (const p of preparado) {
      if (!terminos.every(t => p.titulo.includes(t) || p.seccion.includes(t) || p.texto.includes(t))) continue
      let punt = 0
      for (const t of terminos) {
        if (p.titulo.startsWith(t)) punt += 6
        else if (p.titulo.includes(t)) punt += 4
        if (p.seccion.includes(t)) punt += 2
        if (p.texto.includes(t)) punt += 1
      }
      casan.push({ entrada: p.entrada, punt })
    }
    // `sort` es estable: a igual puntuación mandan el orden del manual.
    casan.sort((a, b) => b.punt - a.punt)
    return {
      resultados: casan.slice(0, MAX_RESULTADOS).map(c => ({
        ...c.entrada,
        extracto: extracto(c.entrada.texto, terminos),
      })),
      total: casan.length,
    }
  }, [terminos, preparado])

  // «/» y ⌘/Ctrl+K enfocan el buscador desde cualquier parte de la página.
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      const destino = e.target as HTMLElement | null
      const escribiendo = destino && /^(INPUT|TEXTAREA)$/.test(destino.tagName)
      const atajo = (e.key === '/' && !escribiendo) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))
      if (atajo) { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select() }
    }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [])

  // Un clic fuera cierra la lista.
  useEffect(() => {
    function alPulsar(e: MouseEvent) {
      if (!cajaRef.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', alPulsar)
    return () => document.removeEventListener('mousedown', alPulsar)
  }, [])

  /**
   * En «…/todo» está el manual entero, así que cualquier resultado cae en esta
   * misma página; en el resto, solo los de la pieza abierta. Lo demás es
   * navegación de verdad: se pide la página y el navegador para en el ancla.
   */
  function irA(r: Resultado) {
    setAbierto(false)
    inputRef.current?.blur()
    const aqui = ruta === `${base}/todo` || !r.pieza || ruta === `${base}/${r.pieza}`
    if (aqui) desplazarAAncla(r.id)
    else router.push(`${base}/${r.pieza}#${r.id}`)
  }

  function alTeclado(e: TeclaReact<HTMLInputElement>) {
    if (e.key === 'Escape') { setAbierto(false); inputRef.current?.blur(); return }
    if (resultados.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(a => (a + 1) % resultados.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo(a => (a - 1 + resultados.length) % resultados.length) }
    else if (e.key === 'Enter') { e.preventDefault(); irA(resultados[Math.min(activo, resultados.length - 1)]) }
  }

  const mostrar = abierto && terminos.length > 0
  const indiceActivo = Math.min(activo, Math.max(0, resultados.length - 1))

  return (
    <div className="acad-bus" ref={cajaRef}>
      {/* El campo entero es la etiqueta del input: pinchar en la lupa o en la
          tecla «/» enfoca, en vez de no hacer nada. */}
      <label className="acad-bus-campo" htmlFor="acad-buscar">
        <svg className="acad-bus-icono" width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          id="acad-buscar"
          type="search"
          className="acad-bus-input"
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={mostrar}
          aria-controls="acad-bus-panel"
          aria-activedescendant={mostrar && resultados.length > 0 ? `acad-bus-op-${indiceActivo}` : undefined}
          value={consulta}
          onChange={e => { setConsulta(e.target.value); setAbierto(true); setActivo(0) }}
          onFocus={() => setAbierto(true)}
          onKeyDown={alTeclado}
        />
        {consulta
          ? (
            <button type="button" className="acad-bus-limpiar" aria-label="Limpiar la búsqueda"
                    onClick={() => { setConsulta(''); inputRef.current?.focus() }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )
          : <kbd className="acad-bus-kbd" aria-hidden="true">/</kbd>}
      </label>

      {mostrar && (
        <div className="acad-bus-panel" id="acad-bus-panel" role="listbox" aria-label="Resultados">
          {indice === null
            ? <p className="acad-bus-vacio">{fallo ? 'No se pudo cargar el índice.' : 'Cargando el índice…'}</p>
            : resultados.length === 0
            ? <p className="acad-bus-vacio">Sin resultados para «{consulta.trim()}».</p>
            : (
              <>
                <p className="acad-bus-cuenta">
                  {total === 1
                    ? '1 apartado'
                    : total > resultados.length
                      ? `${total} apartados · se muestran los ${resultados.length} más afines`
                      : `${total} apartados`}
                </p>
                {resultados.map((r, i) => (
                  <button
                    type="button"
                    key={r.id + i}
                    id={`acad-bus-op-${i}`}
                    role="option"
                    aria-selected={i === indiceActivo}
                    className={`acad-bus-item${i === indiceActivo ? ' is-active' : ''}`}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => irA(r)}
                  >
                    <span className="acad-bus-item-sec">{r.seccion}</span>
                    <span className="acad-bus-item-tit">{resaltar(r.titulo, terminos)}</span>
                    <span className="acad-bus-item-txt">{resaltar(r.extracto, terminos)}</span>
                  </button>
                ))}
              </>
            )}
        </div>
      )}
    </div>
  )
}
