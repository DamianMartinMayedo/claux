'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import type { DossierData } from '@/app/actions/portal/dossier'
import Tabs from '@/components/Tabs'
import { ConfirmDialog } from '@/components/portal/Dialog'
import DossierWizard from './DossierWizard'
import DossierSecciones from './DossierSecciones'
import PestanaEstado from './PestanaEstado'
import PestanaPresentacion from './PestanaPresentacion'

// Las tres pestañas: el mismo snapshot mirado de tres maneras — se edita, se
// presenta (enlace web) y se descarga (PDF). Nunca se desincronizan porque no hay
// dos flujos: los tres leen la misma serie congelada.
type Tab = 'dossier' | 'presentacion' | 'estado'

// `volver`: solo lo pasa la ruta /portal/dossier/[dossierId] del addon; sin él la
// página ES el módulo entero y no hay ninguna lista a la que volver.
export default function DossierEditor({ data, volver }: { data: DossierData; volver?: string }) {
  const router = useRouter()
  const refrescar = () => router.refresh()
  const [tab, setTab] = useState<Tab>('dossier')
  // Estado sucio de «Mi dossier» (lo teclea DossierSecciones). Vive aquí para poder
  // guardar TAMBIÉN el salto de pestaña, no solo el de sección.
  const [dirty, setDirty] = useState(false)
  const [tabPend, setTabPend] = useState<Tab | null>(null)

  function intentarTab(next: string) {
    const t = next as Tab
    if (t === tab) return
    // Solo «Mi dossier» tiene edición a mano sin guardar; las otras dos se guardan
    // solas o confirman aparte.
    if (dirty && tab === 'dossier') { setTabPend(t); return }
    setTab(t)
  }

  // Recargar la página (habitual en Cuba con mala conexión) también se lleva lo
  // tecleado: el navegador pregunta antes de descartar.
  useEffect(() => {
    if (!dirty) return
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [dirty])

  // Wizard mientras el dossier no produce todavía ningún documento (sin números
  // no hay nada que enseñar). Se decide UNA vez al montar, a propósito: si fuera
  // reactivo, guardar los números dentro del wizard te expulsaría de él a mitad
  // de flujo. Al volver más tarde, la serie ya existe → pestañas, y todo lo que
  // faltara se edita ahí suelto: nada de lo escrito se pierde por abandonar.
  const [modo, setModo] = useState<'wizard' | 'tabs'>(
    () => (!data.dossier || data.serie.length === 0) ? 'wizard' : 'tabs',
  )

  if (modo === 'wizard') {
    return <DossierWizard data={data} onRefrescar={refrescar} onTerminar={() => setModo('tabs')} />
  }

  const dossier = data.dossier
  if (!dossier) return null   // inalcanzable: sin dossier el modo es 'wizard'

  const simbolo = data.monedas.find(m => m.codigo === dossier.moneda_presentacion)?.simbolo ?? dossier.moneda_presentacion
  // «Todas las empresas» solo cuando de verdad son VARIAS: con una sola, el
  // consolidado ES esa empresa, y rotularlo «todas» delante de un inversor (o en
  // el nombre del PDF que le llega) suena a plantilla sin rellenar.
  const empresaNombre = dossier.empresa_id
    ? (data.empresas.find(e => e.empresa_id === dossier.empresa_id)?.nombre ?? 'Mi empresa')
    : data.empresas.length === 1
      ? data.empresas[0].nombre
      : 'Todas las empresas'

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          {volver && (
            <Link className="volver-link" href={volver}>
              <ArrowLeft size={14} strokeWidth={2.5} /> Mis dossiers
            </Link>
          )}
          <h1 className="page-title">{dossier.titulo}</h1>
          <p className="page-subtitle">
            Período {dossier.periodo_desde} – {dossier.periodo_hasta} · moneda {dossier.moneda_presentacion}
          </p>
        </div>
      </div>

      <Tabs
        ariaLabel="Secciones del dossier"
        active={tab}
        onChange={intentarTab}
        tabs={[
          { id: 'dossier', label: 'Mi dossier' },
          { id: 'presentacion', label: 'Presentación' },
          { id: 'estado', label: 'Estado de resultados' },
        ]}
      />

      {/* «Mi dossier»: los MISMOS componentes del wizard, con navegación libre
          entre secciones (no un scroll largo). Editar sin pasar por el wizard. */}
      {tab === 'dossier' && (
        <DossierSecciones
          data={data} dossier={dossier} simbolo={simbolo} onRefrescar={refrescar}
          dirty={dirty} setDirty={setDirty}
        />
      )}

      {tab === 'presentacion' && (
        <PestanaPresentacion
          dossier={dossier} tieneBase={data.tieneBase}
          aperturas={data.aperturas} ultimaApertura={data.ultimaApertura}
          tieneEn={data.tieneEn} enDesactualizado={data.enDesactualizado}
          onCambio={refrescar}
        />
      )}

      {tab === 'estado' && (
        <PestanaEstado
          dossier={dossier}
          serie={data.serie}
          lineas={data.lineas}
          empresaNombre={empresaNombre}
          simbolo={simbolo}
          tieneBase={data.tieneBase}
          hayInventario={data.hayInventario}
          onRefrescar={refrescar}
        />
      )}

      {tabPend && (
        <ConfirmDialog
          title="Tienes cambios sin guardar"
          body="Si cambias de pestaña ahora, se perderá lo que escribiste en «Mi dossier» y no has guardado."
          confirmLabel="Descartar y salir"
          cancelLabel="Seguir aquí"
          danger
          onConfirm={() => { setTab(tabPend); setDirty(false); setTabPend(null) }}
          onCancel={() => setTabPend(null)}
        />
      )}
    </div>
  )
}
