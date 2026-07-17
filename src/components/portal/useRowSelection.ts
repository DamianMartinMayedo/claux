'use client'

import { useCallback, useMemo, useState } from 'react'

// ── Selección de filas por id (patrón reutilizable de acciones en lote) ────────
//
// El estado es un Set de ids. Los helpers `allSelected`/`someSelected` se calculan
// contra la lista visible (filtrada) que le pases, para que el checkbox de
// «seleccionar todo» refleje solo lo que se ve. La selección persiste aunque
// cambie la paginación; límpiala tú al cambiar de pestaña o de filtros.

export function useRowSelection(visibleIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  const toggleAll = useCallback(() => {
    setSelected(prev => {
      const allIn = visibleIds.length > 0 && visibleIds.every(id => prev.has(id))
      if (allIn) {
        const next = new Set(prev)
        for (const id of visibleIds) next.delete(id)
        return next
      }
      const next = new Set(prev)
      for (const id of visibleIds) next.add(id)
      return next
    })
  }, [visibleIds])

  // Solo los seleccionados que siguen visibles (las acciones operan sobre estos).
  const selectedVisible = useMemo(
    () => visibleIds.filter(id => selected.has(id)),
    [visibleIds, selected],
  )

  const allSelected  = visibleIds.length > 0 && selectedVisible.length === visibleIds.length
  const someSelected = selectedVisible.length > 0 && !allSelected

  const isSelected = useCallback((id: string) => selected.has(id), [selected])

  return {
    selectedIds: selectedVisible,
    count:       selectedVisible.length,
    isSelected,
    toggle,
    toggleAll,
    clear,
    allSelected,
    someSelected,
  }
}
