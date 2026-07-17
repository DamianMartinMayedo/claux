'use client'

/**
 * Pestañas internas canónicas del design system.
 * Presentacional y controlado: el estado (pestaña activa) lo maneja el padre,
 * para servir a los patrones state-driven ya usados en el portal/admin.
 * CSS: .tabs / .tab / .tab-count en 03-components.css.
 */

export type TabItem<Id extends string = string> = {
  id: Id
  label: string
  /** Conteo opcional mostrado como pill a la derecha de la etiqueta. */
  count?: number
  /** Color del pill de conteo. 'warning' para conteos de alerta (p. ej. sin leer). */
  countTone?: 'neutral' | 'warning'
}

type Props<Id extends string> = {
  tabs: TabItem<Id>[]
  active: Id
  onChange: (id: Id) => void
  /** Etiqueta accesible del grupo de pestañas. */
  ariaLabel?: string
}

export default function Tabs<Id extends string>({ tabs, active, onChange, ariaLabel }: Props<Id>) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          className={`tab${t.id === active ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {typeof t.count === 'number' && (
            <span className={`tab-count${t.countTone === 'warning' ? ' tab-count-warning' : ''}`}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}
