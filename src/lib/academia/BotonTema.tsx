'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Interruptor claro/oscuro del manual, en sus dos superficies.
 *
 * Escribe el mismo `claux-theme` que el resto de la app: quien lee una guía en
 * oscuro y luego entra al portal se lo encuentra en oscuro.
 *
 * El tema no es estado de React: lo pinta el atributo `data-theme` del <html>
 * antes de hidratar, y puede cambiarlo otra parte de la app. Se lee como sistema
 * externo (así el botón nunca contradice a la página, y no hay setState en un
 * efecto encadenando renders).
 */

function suscribirTema(avisar: () => void) {
  const obs = new MutationObserver(avisar)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => obs.disconnect()
}
const leerTema = () =>
  document.documentElement.getAttribute('data-theme') === 'dark' ? 'oscuro' : 'claro'
/** En el servidor no hay atributo que leer: se pinta claro y se corrige al hidratar. */
const temaEnServidor = () => 'claro' as const

export default function BotonTema() {
  const tema = useSyncExternalStore(suscribirTema, leerTema, temaEnServidor)

  const alternarTema = useCallback(() => {
    const valor = tema === 'claro' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', valor)
    try { localStorage.setItem('claux-theme', valor) } catch {}
  }, [tema])

  return (
    <button type="button" className="acad-tema" onClick={alternarTema}
            aria-label={tema === 'claro' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}>
      {tema === 'claro' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      )}
      <span>{tema === 'claro' ? 'Oscuro' : 'Claro'}</span>
    </button>
  )
}
