'use client'

import { useState } from 'react'
import Tabs from '@/components/Tabs'

type TabId = 'cuenta' | 'facturacion' | 'legales'

/**
 * Envoltorio cliente de la página de Configuración: gestiona la pestaña activa
 * y muestra el panel correspondiente. Los contenidos (forms) se resuelven en el
 * Server Component (page.tsx) y llegan como props ReactNode.
 */
export default function ConfiguracionTabs({
  cuenta,
  facturacion,
  legales,
}: {
  cuenta: React.ReactNode
  facturacion: React.ReactNode
  legales: React.ReactNode
}) {
  const [tab, setTab] = useState<TabId>('cuenta')

  return (
    <>
      <Tabs
        ariaLabel="Secciones de configuración"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'cuenta', label: 'Cuenta' },
          { id: 'facturacion', label: 'Facturación' },
          { id: 'legales', label: 'Textos legales' },
        ]}
      />
      <div className="config-panel">
        {tab === 'cuenta' && cuenta}
        {tab === 'facturacion' && facturacion}
        {tab === 'legales' && legales}
      </div>
    </>
  )
}
