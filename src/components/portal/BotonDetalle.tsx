'use client'

import { ChevronDown } from 'lucide-react'

/**
 * El botón que despliega el DETALLE de una fila, bajo ella (Tesorería, Gastos y cobros,
 * CxC/CxP, Movimientos de inventario).
 *
 * Es un componente y no seis copias del mismo `<button>` por las dos cosas que se olvidan al
 * copiar la tabla de al lado:
 *
 *  · **El clic no puede subir a la fila.** La fila entera despliega también (§3 de la skill de
 *    UI), así que sin `stopPropagation` el clic en el chevron alternaba DOS veces —el botón y
 *    la fila— y el detalle no se abría.
 *  · **Es la vía de teclado.** La fila clicable no es focalizable; el botón sí, y lleva el
 *    `aria-expanded` que anuncia el estado.
 *
 * Va donde van las acciones de la fila, dentro del `.table-actions`, y está disponible también
 * en solo-lectura: desplegar no escribe nada.
 */
export default function BotonDetalle({ abierto, rotulo, onAlternar }: {
  abierto: boolean
  /** Qué fila es, para el lector de pantalla: «Ver detalle de A-000123». */
  rotulo: string
  onAlternar: () => void
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      title="Ver detalle"
      aria-label={`Ver detalle de ${rotulo}`}
      aria-expanded={abierto}
      onClick={e => { e.stopPropagation(); onAlternar() }}
    >
      <ChevronDown size={15} strokeWidth={2}
        className={abierto ? 'fila-detalle-abierta' : undefined} />
    </button>
  )
}
