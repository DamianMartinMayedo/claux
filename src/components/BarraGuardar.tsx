'use client'

import { useEffect } from 'react'
import { Save } from 'lucide-react'

/**
 * El pie de un formulario largo: pegado al fondo de la ventana, siempre a la vista.
 *
 * Nace del encargo literal —«los textos de la propuesta se van del entorno de la
 * pestaña donde están»—, y la causa era ésta: el botón de guardar vivía arriba, en
 * la cabecera, así que editando la quinta tarjeta no se veía ni la pestaña ni el
 * botón. Bajarlo no basta —un botón al final del scroll tampoco se ve mientras
 * editas—; tiene que acompañar.
 *
 * Y dice lo que hay pendiente. Un formulario que reparte sus campos en pestañas
 * puede tener cambios sin guardar en una pestaña que no estás mirando: si el pie
 * no los cuenta, se pierden al cerrar sin que nadie avise.
 *
 * `⌘S` / `Ctrl+S` guarda. Es el gesto que el dueño ya hace por costumbre, y sin
 * capturarlo el navegador abre su propio «guardar página», que es peor que nada.
 *
 * CSS: `.barra-guardar` en 03-components.css.
 */
export default function BarraGuardar({
  cambios, guardando, onGuardar, onDescartar, textoGuardar = 'Guardar', children,
}: {
  /**
   * Cuántos campos están sin guardar. 0 = todo guardado, y el botón se apaga.
   * Un `boolean` vale cuando la vista solo sabe que hay cambios y no cuántos
   * —contarlos exigiría diffear diez estados contra lo cargado—: entonces el pie
   * dice «Cambios sin guardar», sin inventarse un número.
   */
  cambios: number | boolean
  guardando: boolean
  onGuardar: () => void
  /** Si se pasa, aparece «Descartar». Solo donde volver atrás tenga sentido. */
  onDescartar?: () => void
  textoGuardar?: string
  /** Lo que haga falta a la izquierda del contador (un aviso, un dato). */
  children?: React.ReactNode
}) {
  const hayCambios = typeof cambios === 'number' ? cambios > 0 : cambios

  useEffect(() => {
    function atajo(e: KeyboardEvent) {
      if (!(e.key === 's' && (e.metaKey || e.ctrlKey))) return
      e.preventDefault()
      if (hayCambios && !guardando) onGuardar()
    }
    window.addEventListener('keydown', atajo)
    return () => window.removeEventListener('keydown', atajo)
  }, [hayCambios, guardando, onGuardar])

  return (
    <div className="barra-guardar">
      <div className="barra-guardar-estado">
        {children}
        {/* `aria-live`: el contador cambia solo, al teclear, sin que nadie pulse nada. */}
        <span className={`barra-guardar-texto${hayCambios ? ' pendiente' : ''}`} aria-live="polite">
          {hayCambios && <span className="barra-guardar-punto" aria-hidden="true" />}
          {!hayCambios       ? 'Todo guardado'
            : cambios === true ? 'Cambios sin guardar'
            : `${cambios} ${cambios === 1 ? 'cambio' : 'cambios'} sin guardar`}
        </span>
      </div>
      <div className="barra-guardar-acciones">
        {onDescartar && (
          <button type="button" className="btn btn-secondary" disabled={!hayCambios || guardando} onClick={onDescartar}>
            Descartar
          </button>
        )}
        <button
          type="button" className="btn btn-primary" title="⌘S"
          disabled={!hayCambios || guardando} onClick={onGuardar}
        >
          {guardando
            ? <><span className="spinner" /> Guardando…</>
            : <><Save size={16} strokeWidth={2} /> {textoGuardar}</>}
        </button>
      </div>
    </div>
  )
}
