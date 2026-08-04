'use client'

import { useState } from 'react'
import Tabs from '@/components/Tabs'

type TabId = 'cuenta' | 'facturacion' | 'presupuesto' | 'legales'

/**
 * Envoltorio cliente de la página de Configuración: gestiona la pestaña activa
 * y muestra el panel correspondiente. Los contenidos (forms) se resuelven en el
 * Server Component (page.tsx) y llegan como props ReactNode.
 */
export default function ConfiguracionTabs({
  cuenta,
  facturacion,
  presupuesto,
  legales,
}: {
  cuenta: React.ReactNode
  /** Lo recurrente: descuento anual y días de prueba. */
  facturacion: React.ReactNode
  /** Pestaña propia: los precios de la instalación son una tabla larga y no tienen nada que
   *  ver con la facturación recurrente —pago único cotizado por horas—. Juntos, la pestaña
   *  se hacía interminable y había que bajar mucho para llegar a lo que se venía a tocar. */
  presupuesto: React.ReactNode
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
          { id: 'presupuesto', label: 'Presupuesto' },
          { id: 'legales', label: 'Textos legales' },
        ]}
      />
      <div className="config-panel">
        {tab === 'cuenta' && cuenta}
        {tab === 'facturacion' && facturacion}
        {tab === 'presupuesto' && presupuesto}
        {tab === 'legales' && legales}
      </div>
    </>
  )
}
