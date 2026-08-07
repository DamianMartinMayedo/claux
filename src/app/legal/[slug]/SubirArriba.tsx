'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'

/** A partir de cuánto scroll aparece. Una pantalla larga: antes estorba sin hacer falta. */
const UMBRAL = 600

/**
 * Botón para volver al principio del texto.
 *
 * Una política de privacidad son dos mil palabras: a media lectura, el principio —donde
 * está «Volver» y el índice visual de la página— queda a diez pantallas de scroll, y en
 * un móvil eso es medio minuto de arrastrar el dedo.
 *
 * Aparece solo cuando hay algo que deshacer y se queda fuera de la columna de lectura,
 * abajo a la derecha. Respeta `prefers-reduced-motion`: con la animación desactivada el
 * salto es instantáneo en vez de un desplazamiento largo, que es justo lo que marea a
 * quien pide esa preferencia.
 */
export default function SubirArriba() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const mirar = () => setVisible(window.scrollY > UMBRAL)
    mirar()
    // `passive`: el oyente no llama a `preventDefault`, y decírselo al navegador le
    // deja seguir haciendo scroll sin esperar a este código.
    window.addEventListener('scroll', mirar, { passive: true })
    return () => window.removeEventListener('scroll', mirar)
  }, [])

  function subir() {
    const nada = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: nada ? 'auto' : 'smooth' })
  }

  return (
    <button
      type="button"
      className={`lg-subir${visible ? ' is-visible' : ''}`}
      onClick={subir}
      aria-label="Volver al principio de la página"
      /* Fuera del tabulador mientras no se ve: un botón invisible que recibe el foco
         deja al teclado en un sitio que nadie puede señalar. */
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
    >
      <ArrowUp size={18} strokeWidth={2.5} />
    </button>
  )
}
