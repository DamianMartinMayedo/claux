'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Cerrar sesión desde el manual.
 *
 * Solo se pinta para quien no tiene otra salida: el equipo cierra sesión en el
 * sidebar de `/admin`, pero quien solo lee el manual no entra ahí, así que sin
 * este botón su única forma de salir sería borrar la cookie a mano. En un
 * ordenador prestado
 * —que es cómo se trabaja en muchos sitios— eso deja el manual abierto al
 * siguiente que se siente.
 *
 * Vuelve a `/partners`, que es la puerta por la que entró, y no al login del
 * panel: salir no puede dejarte delante de una puerta que no puedes abrir.
 */
export default function AcademiaSalir() {
  const router = useRouter()
  const [saliendo, setSaliendo] = useState(false)

  async function salir() {
    // Se bloquea desde el primer clic: la sesión tarda en cerrarse y pulsar dos
    // veces dispararía dos navegaciones.
    setSaliendo(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/partners')
    router.refresh()
  }

  return (
    <button type="button" className="acad-tema" onClick={salir} disabled={saliendo}
            aria-label="Cerrar sesión">
      {saliendo ? (
        <span className="spinner spinner-sm" aria-hidden="true" />
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
      )}
      <span>{saliendo ? 'Saliendo…' : 'Salir'}</span>
    </button>
  )
}
