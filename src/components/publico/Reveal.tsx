'use client'

// Revelado al hacer scroll, ultraligero (IntersectionObserver, sin librerías).
// La transición vive en CSS (.reveal / .reveal-stagger en 08-landing.css) y bajo
// prefers-reduced-motion solo hace fade, sin desplazamiento. El componente solo
// añade la clase `is-visible` cuando el bloque entra en pantalla.
//
// - tag: etiqueta a renderizar (div por defecto; útil para envolver una sección).
// - stagger: si los hijos directos deben aparecer en cascada (tarjetas de un grid).
import { createElement, useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  className?: string
  tag?: ElementType
  stagger?: boolean
  /** Identificador opcional para anclas (#como-funciona, etc.). */
  id?: string
}

export function Reveal({ children, className = '', tag = 'div', stagger = false, id }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const base = stagger ? 'reveal-stagger' : 'reveal'
  const cls = [base, visible ? 'is-visible' : '', className].filter(Boolean).join(' ')

  return createElement(tag, { ref, id, className: cls }, children)
}
