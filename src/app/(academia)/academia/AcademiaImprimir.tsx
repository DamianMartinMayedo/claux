'use client'

/**
 * Imprimir «el manual entero» — que en la práctica es guardarlo en PDF.
 *
 * No se genera el PDF en el servidor a propósito: el navegador ya sabe hacerlo,
 * el archivo sale con el texto seleccionable y los enlaces vivos, y no hay que
 * mantener una segunda plantilla que acabaría diciendo otra cosa que la web.
 * Lo que se imprime es lo que deja ver la capa activa, así que «Ver como
 * vendedor» + este botón da el PDF que se le puede entregar a quien vende.
 */
export default function AcademiaImprimir() {
  return (
    <button type="button" className="acad-imprimir" onClick={() => window.print()}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <path d="M6 14h12v8H6z" />
      </svg>
      Imprimir o guardar en PDF
    </button>
  )
}
