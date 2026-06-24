'use client'

import { useSyncExternalStore } from 'react'

// Detecta si ya hidratamos en cliente, sin setState-en-effect ni mismatch de
// hidratación. Los gráficos (recharts) solo se montan tras hidratar, así el SSR
// pinta un esqueleto y el cliente ya mide el contenedor correctamente.
const subscribe = () => () => {}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false)
}
