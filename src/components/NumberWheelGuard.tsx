'use client'

import { useEffect } from 'react'

// Evita que la rueda del ratón cambie el valor de un <input type="number"> enfocado
// (comportamiento por defecto de Chrome/Firefox, fácil de disparar sin querer). Al
// hacer scroll sobre un number enfocado, le quitamos el foco: así la rueda hace
// scroll de la página en vez de sumar/restar. Las flechas del propio input SIGUEN
// funcionando. Guard global: se monta una vez en el layout raíz.
export default function NumberWheelGuard() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = e.target
      if (el instanceof HTMLInputElement && el.type === 'number' && el === document.activeElement) {
        el.blur()
      }
    }
    document.addEventListener('wheel', onWheel, { passive: true })
    return () => document.removeEventListener('wheel', onWheel)
  }, [])
  return null
}
