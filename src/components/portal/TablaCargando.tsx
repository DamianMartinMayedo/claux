'use client'

import type { ReactNode } from 'react'

/**
 * Estado de «cargando» de una tabla mientras el servidor recarga por un cambio de
 * filtro o de búsqueda. En lugar de atenuar las filas, VACÍA la tabla y muestra un
 * spinner con la palabra «Cargando…» centrado —igual que el calendario de Turnos por
 * trabajadores—: en Cuba la recarga tarda y el texto deja claro que algo está pasando
 * (loading innegociable), sin que el spinner quede perdido en mitad de una lista larga.
 *
 * Uso: envolver la tarjeta de la tabla y pasarle `activo`, que sale del `onCargando`
 * de `<Filtros>`. Mientras carga, se sustituye por la tarjeta de «Cargando…».
 */
export default function TablaCargando({
  activo, children,
}: {
  activo:   boolean
  children: ReactNode
}) {
  if (activo) {
    return (
      <div className="card card-table">
        <div className="mon-empty" role="status" aria-live="polite">
          <span className="spinner spinner-sm" />
          <p>Cargando…</p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
