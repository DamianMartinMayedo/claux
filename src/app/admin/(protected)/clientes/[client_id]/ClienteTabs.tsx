'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Tabs, { type TabItem } from '@/components/Tabs'

const IDS = ['resumen', 'cuota', 'pagos', 'acceso'] as const
type TabId = (typeof IDS)[number]

function normalizar(t: string | undefined): TabId {
  return IDS.includes(t as TabId) ? (t as TabId) : 'resumen'
}

/**
 * Envoltorio cliente de la ficha del cliente: reparte once tarjetas en cuatro
 * pestañas. Los contenidos se resuelven en el Server Component (page.tsx) y
 * llegan como props ReactNode — el patrón de `ConfiguracionTabs`.
 *
 * Lo que NO entra aquí y sigue fijo arriba: cabecera, badges, botones de acción
 * y los banners de archivado y período especial. Es lo que hay que ver del
 * cliente sin tener que elegir antes una pestaña.
 *
 * Los CONTEOS solo aparecen cuando algo espera (y en ámbar): documentos sin
 * firmar, pagos por confirmar. Un número que a veces es «total» y a veces
 * «pendientes» no se puede leer de un vistazo, así que aquí significa siempre lo
 * mismo — si no hay nada que hacer, no hay número. Es lo que impide que agrupar
 * en pestañas esconda justo lo que había que atender.
 */
export default function ClienteTabs({
  tabInicial,
  pagosPendientes,
  docsPendientes,
  resumen,
  cuota,
  pagos,
  acceso,
}: {
  /** Pestaña de la URL (`?tab=`), leída en el servidor: la primera pintura ya
   *  sale en la correcta, sin parpadeo ni `useSearchParams` en cliente. */
  tabInicial?: string
  pagosPendientes: number
  docsPendientes: number
  resumen: React.ReactNode
  cuota: React.ReactNode
  pagos: React.ReactNode
  acceso: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [tab, setTab] = useState<TabId>(normalizar(tabInicial))

  // La pestaña vive en la URL: volver del detalle de un presupuesto, compartir
  // el enlace o recargar tras un corte tiene que devolver a lo que se estaba
  // mirando. `replace` para no llenar el historial de pasos atrás que solo
  // cambian de pestaña, y `scroll: false` para no saltar al principio.
  function cambiar(id: TabId) {
    setTab(id)
    const q = new URLSearchParams(window.location.search)
    if (id === 'resumen') q.delete('tab')
    else q.set('tab', id)
    const qs = q.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const tabs: TabItem<TabId>[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'cuota',   label: 'Módulos y cuota' },
    pagosPendientes > 0
      ? { id: 'pagos', label: 'Pagos', count: pagosPendientes, countTone: 'warning' }
      : { id: 'pagos', label: 'Pagos' },
    docsPendientes > 0
      ? { id: 'acceso', label: 'Acceso y documentos', count: docsPendientes, countTone: 'warning' }
      : { id: 'acceso', label: 'Acceso y documentos' },
  ]

  return (
    <>
      <Tabs ariaLabel="Secciones de la ficha del cliente" tabs={tabs} active={tab} onChange={cambiar} />
      <div className="cli-panel">
        {tab === 'resumen' && resumen}
        {tab === 'cuota'   && cuota}
        {tab === 'pagos'   && pagos}
        {tab === 'acceso'  && acceso}
      </div>
    </>
  )
}
