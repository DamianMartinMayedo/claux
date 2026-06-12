import { useEffect, useRef } from 'react'

/**
 * Comportamiento estándar de modal: bloquea el scroll del body mientras está
 * abierto y cierra con la tecla Escape. Centraliza un patrón que estaba duplicado
 * en ~10 modales.
 *
 * Usa un ref para `onClose` de modo que el efecto solo dependa de `active`: así no
 * se arrastra setState dentro del efecto (evita el aviso set-state-in-effect del
 * React Compiler) y el listener siempre llama a la última versión de onClose.
 */
export function useModalKeyboard(active: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!active) return
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [active])
}
