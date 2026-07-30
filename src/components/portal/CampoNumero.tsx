'use client'

import { useState } from 'react'
import { parseNumeroEs, textoNumeroEs } from '@/lib/numeros'

/**
 * Campo numérico que acepta **coma decimal** sin comerse lo que se escribe.
 *
 * El `type="number"` devuelve cadena vacía con «0,5» en un navegador con locale es
 * (la coma es inválida para el control), así que medio kilo se guardaba como 0 en
 * silencio. Y un `type="text"` controlado ingenuo es igual de malo: al teclear «0,»
 * el número vale 0 y el input se repinta como «0», borrando la coma.
 *
 * Lo que hace: guarda el TEXTO tal cual y lo enseña **mientras siga significando el
 * número que tiene el documento**. Si el valor cambia desde fuera —el selector de
 * moneda reexpresa los importes, o se recalcula una línea— el texto deja de cuadrar
 * y se pinta el número nuevo. Derivado en el render, sin `useEffect`: un efecto aquí
 * robaría el foco al repintar.
 *
 * Nació en Ventas (`_DocumentoLineasEditor`) y se comparte desde la Fase 1 del plan
 * de Inventario, que necesitaba lo mismo en cinco formularios más.
 */
export function CampoNumero({
  valor, onValor, etiqueta, className = 'input', id, placeholder, onKeyDown, disabled, autoFocus,
}: {
  valor: number
  onValor: (n: number) => void
  etiqueta: string
  className?: string
  id?: string
  placeholder?: string
  onKeyDown?: (e: React.KeyboardEvent) => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  const [texto, setTexto] = useState<string | null>(null)
  const mostrado = texto !== null && parseNumeroEs(texto) === valor ? texto : textoNumeroEs(valor)
  return (
    <input
      className={className}
      type="text" inputMode="decimal"
      id={id}
      aria-label={etiqueta}
      value={mostrado}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={e => { setTexto(e.target.value); onValor(parseNumeroEs(e.target.value)) }}
      onFocus={e => e.target.select()}
      onKeyDown={onKeyDown}
    />
  )
}
