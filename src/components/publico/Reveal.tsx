// Marca un bloque para el revelado al hacer scroll. Solo pone la clase: no hay
// estado ni efecto, así que la landing sigue siendo un Server Component puro.
// Quien anima es LandingAnim (un único observer para toda la página), y solo si
// el JS arranca: el estado base de este bloque es VISIBLE. La transición vive en
// CSS (.ld-anim .reveal / .reveal-stagger en 08-landing.css).
//
// - tag: etiqueta a renderizar (div por defecto; útil para envolver una sección).
// - stagger: si los hijos directos deben aparecer en cascada (tarjetas de un grid).
import { createElement, type ElementType, type ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  className?: string
  tag?: ElementType
  stagger?: boolean
  /** Identificador opcional para anclas (#como-funciona, etc.). */
  id?: string
}

export function Reveal({ children, className = '', tag = 'div', stagger = false, id }: RevealProps) {
  const cls = [stagger ? 'reveal-stagger' : 'reveal', className].filter(Boolean).join(' ')

  return createElement(tag, { id, className: cls }, children)
}
