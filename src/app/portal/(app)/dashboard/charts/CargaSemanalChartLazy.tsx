'use client'

import dynamic from 'next/dynamic'

// AgendaWidget es Server Component y `ssr: false` solo se puede declarar en
// cliente: este envoltorio es el que parte el bundle. Recharts pesa ~100 KB gzip
// y no puede bloquear el dashboard, que es la primera pantalla tras entrar
// (presupuesto Cuba, CONTEXTO §3). El esqueleto es el mismo que el gráfico ya
// pintaba antes de hidratar, así que la pantalla no cambia.
export default dynamic(() => import('./CargaSemanalChart'), {
  ssr: false,
  loading: () => <div className="dash-chart dash-chart-skeleton" aria-hidden />,
})
