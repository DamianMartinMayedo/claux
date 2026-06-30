'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

export interface EmpresaLite {
  empresa_id: string
  nombre:     string
  color?:     string | null
}

interface Ctx {
  empresas: EmpresaLite[]
  colorOf:  (id: string) => string | undefined
  nombreOf: (id: string) => string | undefined
}

const EmpresaColorContext = createContext<Ctx>({
  empresas: [],
  colorOf:  () => undefined,
  nombreOf: () => undefined,
})

// Provee las empresas de la cuenta (con su color) a todas las vistas del portal,
// sin tener que añadir el color a cada action de datos. Lo monta el layout, que
// ya carga las empresas para el header.
export function EmpresaColorProvider({
  empresas,
  children,
}: {
  empresas: EmpresaLite[]
  children: ReactNode
}) {
  const value = useMemo<Ctx>(() => {
    const map = new Map(empresas.map(e => [e.empresa_id, e]))
    return {
      empresas,
      colorOf:  id => map.get(id)?.color ?? undefined,
      nombreOf: id => map.get(id)?.nombre,
    }
  }, [empresas])

  return <EmpresaColorContext.Provider value={value}>{children}</EmpresaColorContext.Provider>
}

export function useEmpresas() {
  return useContext(EmpresaColorContext)
}
