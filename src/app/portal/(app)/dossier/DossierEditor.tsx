'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import type { DossierData } from '@/app/actions/portal/dossier'
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
  const empresaNombre = dossier.empresa_id
    ? (data.empresas.find(e => e.empresa_id === dossier.empresa_id)?.nombre ?? 'Mi empresa')
    : 'Todas las empresas'

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          {volver && (
            <Link className="dos-volver" href={volver}>
              <ArrowLeft size={14} strokeWidth={2.5} /> Mis dossiers
            </Link>
          )}
          <h1 className="page-title">{dossier.titulo}</h1>
          <p className="page-subtitle">
            Período {dossier.periodo_desde} – {dossier.periodo_hasta} · moneda {dossier.moneda_presentacion}
          </p>
        </div>
      </div>

      <div className="res-tabs">
        <button className={`res-tab ${tab === 'dossier' ? 'active' : ''}`} onClick={() => setTab('dossier')}>Mi dossier</button>
        <button className={`res-tab ${tab === 'presentacion' ? 'active' : ''}`} onClick={() => setTab('presentacion')}>Presentación</button>
        <button className={`res-tab ${tab === 'estado' ? 'active' : ''}`} onClick={() => setTab('estado')}>Estado de resultados</button>
      </div>

      {/* «Mi dossier»: los MISMOS componentes del wizard, con navegación libre
          entre secciones (no un scroll largo). Editar sin pasar por el wizard. */}
      {tab === 'dossier' && (
        <DossierSecciones data={data} dossier={dossier} simbolo={simbolo} onRefrescar={refrescar} />
      )}

      {tab === 'presentacion' && (
        <PestanaPresentacion dossier={dossier} tieneBase={data.tieneBase} onCambio={refrescar} />
      )}

      {tab === 'estado' && (
        <PestanaEstado
          dossier={dossier}
          serie={data.serie}
          lineas={data.lineas}
          empresaNombre={empresaNombre}
          simbolo={simbolo}
          tieneBase={data.tieneBase}
          onRefrescar={refrescar}
        />
      )}
    </div>
  )
}
