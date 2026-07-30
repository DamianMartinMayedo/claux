'use client'

// ── Descripción de una línea, con AUTOCOMPLETADO del catálogo ──
//
// Nació en el editor de líneas de Ventas y ahora lo comparten Ventas y Compras: es el
// mismo problema (elegir un artículo del catálogo sin dejar de poder escribir a mano) y
// tenerlo dos veces habría dado dos comportamientos distintos en dos pantallas gemelas.
//
// EL VÍNCULO SE CREA AL ELEGIR UNA SUGERENCIA, NUNCA POR COINCIDENCIA DE TEXTO. El
// `datalist` que había antes ataba la línea solo si el input decía exactamente
// «CÓDIGO — Nombre», así que matizar la descripción rompía el enlace en silencio: en
// Ventas se perdía el coste congelado y el descuento de existencias; en Compras, la
// línea dejaba de mover stock al confirmar. Por eso el chip del código INFORMA y no se
// puede quitar desde aquí: para una línea suelta se borra y se escribe a mano.
//
// El CSS es la familia `.ac-*` de `03-components.css`: el patrón de autocompletado del
// portal, compartido con `AutocompletarTexto`. Este componente es su variante CON VÍNCULO
// (chip del código dentro del input); la otra es la de texto libre.

import { useMemo, useState } from 'react'

export interface ArticuloSugerible {
  producto_id: string
  codigo:      string
  nombre:      string
}

export function DescripcionCatalogo<T extends ArticuloSugerible>({
  valor, articulos, linkCodigo, placeholder, inputRef,
  importeTexto, onTexto, onElegir, onEnter,
}: {
  valor:      string
  articulos:  T[]
  /** Código del artículo enlazado, o null. Se pinta DENTRO del input, a la derecha. */
  linkCodigo: string | null
  placeholder: string
  inputRef?:  (el: HTMLInputElement | null) => void
  /** El importe que se enseña en cada sugerencia (precio en Ventas, coste en Compras). */
  importeTexto?: (a: T) => string | null
  onTexto:    (v: string) => void
  onElegir:   (a: T) => void
  /** `Enter` sin sugerencias abiertas. Nunca envía el formulario. */
  onEnter?:   () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo]   = useState(0)

  const sugerencias = useMemo(() => {
    const t = valor.trim().toLowerCase()
    if (t.length < 2) return []
    return articulos
      .filter(a => a.codigo.toLowerCase().includes(t) || a.nombre.toLowerCase().includes(t))
      .slice(0, 6)
  }, [valor, articulos])

  // Se ofrecen sugerencias solo si la línea NO está ya enlazada: con vínculo, seguir
  // sugiriendo invita a cambiarlo por accidente mientras se matiza el texto.
  const visible = abierto && !linkCodigo && sugerencias.length > 0

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible) {
      // Enter en la descripción NUNCA envía el documento: en un formulario largo eso es
      // casi siempre un accidente. Aquí significa «he terminado esta línea».
      if (e.key === 'Enter') { e.preventDefault(); onEnter?.() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(i => (i + 1) % sugerencias.length); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActivo(i => (i - 1 + sugerencias.length) % sugerencias.length); return }
    if (e.key === 'Escape')    { setAbierto(false); return }
    if (e.key === 'Enter') {
      // Con la lista abierta, Enter ELIGE la sugerencia marcada.
      e.preventDefault()
      onElegir(sugerencias[activo])
      setAbierto(false)
    }
  }

  return (
    <div className="ac-wrap">
      <input
        ref={inputRef}
        className={`input input-sm${linkCodigo ? ' ac-enlazada' : ''}`}
        type="text"
        aria-label="Descripción de la línea"
        placeholder={placeholder}
        value={valor}
        onChange={e => { onTexto(e.target.value); setAbierto(true); setActivo(0) }}
        onFocus={() => setAbierto(true)}
        // `blur` con retardo: sin él, el clic en una sugerencia cierra la lista antes de
        // que el `mousedown` llegue a registrarse y no se elige nada.
        onBlur={() => setTimeout(() => setAbierto(false), 120)}
        onKeyDown={teclas}
      />
      {linkCodigo && (
        <span className="ac-chip" title={`Enlazada al artículo ${linkCodigo} del catálogo`}>
          {linkCodigo}
        </span>
      )}
      {visible && (
        <ul className="ac-lista" role="listbox">
          {sugerencias.map((a, i) => {
            const importe = importeTexto?.(a) ?? null
            return (
              <li key={a.producto_id}>
                <button
                  type="button"
                  className={`ac-item${i === activo ? ' active' : ''}`}
                  onMouseDown={e => { e.preventDefault(); onElegir(a); setAbierto(false) }}
                  onMouseEnter={() => setActivo(i)}
                >
                  <span className="ac-cod">{a.codigo}</span>
                  <span className="ac-nom">{a.nombre}</span>
                  {importe && <span className="ac-extra">{importe}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
