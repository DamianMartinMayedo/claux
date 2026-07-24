'use client'

import { createContext, useContext, type ReactNode } from 'react'

// ¿La sesión actual es de CONFIGURACIÓN? (impersonación: el equipo CLAUX entra al
// portal del cliente para configurarlo, `session.imp`). Se resuelve en el servidor
// y se expone aquí a los componentes cliente. Los configuradores pueden FORZAR
// acciones vetadas a un usuario normal — p. ej. eliminar documentos que solo se
// archivan — para limpiar datos de prueba. El candado real vive en las server
// actions (comprueban `session.imp`); esto solo decide si se muestra la opción.
const Ctx = createContext(false)

export function ConfiguradorProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useConfigurador(): boolean {
  return useContext(Ctx)
}
