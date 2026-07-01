'use client'

import { createContext, useContext } from 'react'

// Estado del addon de IA disponible en todo el portal: si está contratado y el
// nombre del agente. Lo provee el layout (que ya lo calcula) para que cualquier
// IaTouchpoint lo lea sin pasar props por cada página.
interface IaCtx { tieneIa: boolean; nombreAgente: string }

const Ctx = createContext<IaCtx>({ tieneIa: false, nombreAgente: 'Claux' })

export function IaProvider({ value, children }: { value: IaCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useIa(): IaCtx {
  return useContext(Ctx)
}
