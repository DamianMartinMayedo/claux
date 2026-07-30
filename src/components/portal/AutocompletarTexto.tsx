'use client'

// ── Campo de texto libre CON SUGERENCIAS ──
//
// El autocompletado del portal para un campo que sigue siendo texto libre: quién contó el
// almacén, un concepto, un nombre que puede existir o no en ninguna tabla. Se sugiere, no
// se impone: lo que se guarda es lo que hay escrito, tal cual, y elegir una sugerencia es
// solo una forma rápida de escribirlo.
//
// **NUNCA `<datalist>`.** Es la razón de que este componente exista y no es cosmética:
//
//  · No se puede estilar. En cada navegador es otro control y en Android abre un
//    desplegable del sistema, así que el mismo campo se ve distinto en cada sitio.
//  · Empareja por COINCIDENCIA DE TEXTO. Donde eso crea un vínculo (el catálogo en Ventas
//    y Compras), matizar una palabra rompía el enlace en silencio — se perdía el coste
//    congelado y el descuento de existencias sin decir nada. Aquí lo único que pasa al
//    elegir es que se escribe ese texto.
//
// Comparte el CSS (`.ac-*` de `03-components.css`) con `DescripcionCatalogo`, que es la
// variante CON vínculo. Este no lleva código ni chip a propósito: en un campo de texto
// libre no hay ninguna referencia que enseñar, y meter una inventada es ruido.
//
// La lista flota (`position:absolute`): si empujara, abrir sugerencias movería el
// formulario entero bajo el dedo.

import { useMemo, useState } from 'react'

/** minúsculas y sin acentos: «Ramón» tiene que encontrarse escribiendo «ramon». */
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

export default function AutocompletarTexto({
  id, valor, opciones, placeholder, maxLength, disabled, ariaLabel, onCambio, onBlur,
}: {
  id?:        string
  valor:      string
  /** Lo que se ofrece. Vacío = el campo se comporta como un `input` normal. */
  opciones:   string[]
  placeholder?: string
  maxLength?: number
  disabled?:  boolean
  ariaLabel?: string
  onCambio:   (v: string) => void
  /** Al salir del campo: el sitio donde el resto del portal guarda lo escrito. */
  onBlur?:    () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo]   = useState(0)

  // Con el campo vacío se ofrecen TODAS (hasta 8): la lista de quien puede haber contado
  // es corta, y obligar a teclear dos letras para ver lo que hay convierte una ayuda en
  // un acertijo. En cuanto se escribe, filtra.
  const sugerencias = useMemo(() => {
    const t = norm(valor)
    return opciones
      .filter(o => o && (t === '' || norm(o).includes(t)) && norm(o) !== t)
      .slice(0, 8)
  }, [valor, opciones])

  const visible = abierto && !disabled && sugerencias.length > 0

  function elegir(v: string) {
    onCambio(v)
    setAbierto(false)
    onBlur?.()
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(i => (i + 1) % sugerencias.length); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActivo(i => (i - 1 + sugerencias.length) % sugerencias.length); return }
    if (e.key === 'Escape')    { setAbierto(false); return }
    // Enter con la lista abierta ELIGE, y no envía el formulario: en un formulario largo
    // eso es casi siempre un accidente.
    if (e.key === 'Enter')     { e.preventDefault(); elegir(sugerencias[activo]) }
  }

  return (
    <div className="ac-wrap">
      <input
        id={id}
        className="input"
        type="text"
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        value={valor}
        onChange={e => { onCambio(e.target.value); setAbierto(true); setActivo(0) }}
        onFocus={() => setAbierto(true)}
        // `blur` con retardo: sin él, el clic en una sugerencia cierra la lista antes de
        // que el `mousedown` llegue a registrarse y no se elige nada.
        onBlur={() => { setTimeout(() => setAbierto(false), 120); onBlur?.() }}
        onKeyDown={teclas}
      />
      {visible && (
        <ul className="ac-lista" role="listbox">
          {sugerencias.map((o, i) => (
            <li key={o}>
              <button
                type="button"
                className={`ac-item${i === activo ? ' active' : ''}`}
                onMouseDown={e => { e.preventDefault(); elegir(o) }}
                onMouseEnter={() => setActivo(i)}
              >
                <span className="ac-nom">{o}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
