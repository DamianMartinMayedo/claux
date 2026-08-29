'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CAPAS, COOKIE_CAPA, type Capa, type ClaveCapa } from '@/lib/academia/capas'

/**
 * El selector de capa: con qué ojos se está leyendo el manual.
 *
 * Cambia una cookie y pide al servidor que vuelva a pintar. El filtrado ocurre
 * ENTERO en el servidor —texto, índice lateral, sumarios y buscador—, así que la
 * vista «como vendedor» no trae escondido lo que no debería enseñar.
 *
 * Es una previsualización, no un permiso: sirve para ver con qué se va a
 * encontrar quien lo lea antes de dárselo. Por eso la barra dice siempre en qué
 * capa se está y qué queda fuera, en vez de filtrar en silencio.
 */

/** Un año: es una preferencia de lectura, no una sesión. */
const UN_ANO = 60 * 60 * 24 * 365

/** La cookie que lee el servidor. Fuera del componente: escribir en `document`
 *  desde el cuerpo de uno es tocar algo que no le pertenece. */
function recordarCapa(clave: ClaveCapa) {
  document.cookie = `${COOKIE_CAPA}=${clave}; path=/; max-age=${UN_ANO}; samesite=lax`
}

export default function AcademiaCapa({ capa, apartados, total }: {
  capa: Capa
  /** Apartados que deja ver la capa actual. */
  apartados: number
  /** Los que tiene el manual entero. */
  total: number
}) {
  const router = useRouter()
  const [pendiente, arrancar] = useTransition()
  // La pastilla se marca al instante: en Cuba la vuelta del servidor puede
  // tardar, y sin esto el clic parece no haber hecho nada.
  const [elegida, setElegida] = useState<ClaveCapa>(capa.clave)

  function cambiar(clave: ClaveCapa) {
    if (clave === elegida) return
    setElegida(clave)
    recordarCapa(clave)
    arrancar(() => router.refresh())
  }

  return (
    <div className={`acad-vercomo${capa.clave === 'interna' ? '' : ' es-filtrada'}`}>
      <div className="acad-vercomo-in">
        <div className="acad-vercomo-sel" role="group" aria-label="Ver el manual como">
          <span className="acad-vercomo-k">Ver como</span>
          {CAPAS.map(c => (
            <button type="button" key={c.clave}
                    className={`acad-capa-pill${c.clave === elegida ? ' is-active' : ''}`}
                    onClick={() => cambiar(c.clave)}
                    aria-pressed={c.clave === elegida}
                    title={c.quien}>
              {c.nombre}
            </button>
          ))}
        </div>
        <p className="acad-vercomo-nota">
          {pendiente
            ? 'Aplicando la capa…'
            : capa.clave === 'interna'
              ? <>El manual completo: los {total} apartados, incluido lo interno y lo confidencial.</>
              : <><strong>{apartados} de {total} apartados.</strong> {capa.fuera}</>}
        </p>
      </div>
    </div>
  )
}
