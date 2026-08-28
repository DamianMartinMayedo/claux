'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

/**
 * Campo de varios valores cortos: lo escrito se convierte en pastilla y el campo
 * se vacía. Se añade con Enter, coma, punto y coma o al salir del campo; se
 * quita con la × de cada pastilla o con Retroceso cuando no queda texto.
 *
 * El sitio donde se escribe es un `.input` corriente e INDEPENDIENTE, y las
 * pastillas van debajo. Todo dentro del mismo recuadro se probó y se rompe con
 * el caso normal: dos correos largos ocupan una línea cada uno, el hueco de
 * escribir baja a la tercera sin borde ni marcador de posición y deja de verse.
 * Aparte, el campo está siempre en el mismo punto, tenga cero pastillas o seis.
 *
 * Se valida al AÑADIR y no al guardar: el error apunta al valor concreto que no
 * entró, en vez de a una lista de cinco donde hay que buscar cuál falla.
 *
 * Pegar una lista entera funciona —se parte por los mismos separadores—, que es
 * el caso real de quien trae los correos de otro sitio.
 */
export default function ChipsInput({
  id, valores, onChange, placeholder, validar, describedBy, etiquetaQuitar,
}: {
  /** Va en el campo de texto, para que el `<label htmlFor>` lo alcance. */
  id: string
  valores: string[]
  onChange: (siguiente: string[]) => void
  placeholder?: string
  /** Motivo por el que un valor no vale, o null si vale. */
  validar?: (valor: string) => string | null
  describedBy?: string
  /** Cómo se llama lo que hay dentro, para el botón de quitar («Quitar el correo X»). */
  etiquetaQuitar?: (valor: string) => string
}) {
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)

  /** Añade todo lo que traiga el texto. Devuelve false si algo no pasó el filtro. */
  function anadir(bruto: string): boolean {
    const partes = bruto.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean)
    if (partes.length === 0) { setTexto(''); setError(null); return true }

    const nuevos: string[] = []
    for (const v of partes) {
      const motivo = validar?.(v) ?? null
      if (motivo) {
        // Lo válido que venía antes SÍ entra: en una lista pegada, tirar las
        // cinco buenas por una mala obliga a repetirlo todo.
        if (nuevos.length) onChange([...valores, ...nuevos])
        setTexto(v)
        setError(motivo)
        return false
      }
      if (!valores.includes(v) && !nuevos.includes(v)) nuevos.push(v)
    }
    if (nuevos.length) onChange([...valores, ...nuevos])
    setTexto('')
    setError(null)
    return true
  }

  function quitar(valor: string) {
    onChange(valores.filter((v) => v !== valor))
    setError(null)
  }

  return (
    <div>
      <input
        id={id}
        type="text"
        className="input"
        value={texto}
        placeholder={placeholder}
        aria-describedby={[describedBy, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => { setTexto(e.target.value); setError(null) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
            // Enter dentro de un formulario lo envía: aquí cierra la pastilla.
            e.preventDefault()
            anadir(texto)
            return
          }
          // Retroceso con el campo vacío quita la última, como en cualquier
          // campo de destinatarios.
          if (e.key === 'Backspace' && texto === '' && valores.length > 0) {
            e.preventDefault()
            quitar(valores[valores.length - 1])
          }
        }}
        // Al salir del campo se cierra lo escrito. Sin esto, quien teclea un
        // correo y va directo a «Guardar» lo pierde sin enterarse.
        onBlur={() => { if (texto.trim()) anadir(texto) }}
        onPaste={(e) => {
          const pegado = e.clipboardData.getData('text')
          if (!/[,;\s]/.test(pegado)) return   // un solo valor: que siga escribiendo
          e.preventDefault()
          anadir(texto + pegado)
        }}
      />
      {error && <p id={`${id}-error`} className="chips-error">{error}</p>}
      {valores.length > 0 && (
        <ul className="chips-lista">
          {valores.map((v) => (
            <li key={v} className="chips-chip">
              <span className="chips-chip-texto" title={v}>{v}</span>
              <button
                type="button"
                className="chips-quitar"
                aria-label={etiquetaQuitar ? etiquetaQuitar(v) : `Quitar ${v}`}
                onClick={() => quitar(v)}
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
