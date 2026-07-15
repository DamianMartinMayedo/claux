'use client'

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, PartyPopper } from 'lucide-react'
import type { DossierData } from '@/app/actions/portal/dossier'
import { pasosEditables, LABEL_PASO, type PasoEditable } from '@/lib/dossier/pasos'
import PasoBasicos from './PasoBasicos'
import PasoCostoVentas from './PasoCostoVentas'
import PasoNumeros from './PasoNumeros'
import PasoCrecimiento from './PasoCrecimiento'
import PasoRelato from './PasoRelato'
import PasoMarca from './PasoMarca'

// ── Wizard de creación ────────────────────────────────────────────────────────
//
// Máquina de estados con CLAVES NOMBRADAS, nunca `useState(0)`: la lista de pasos
// es CONDICIONAL (sin `base` no existe el paso de coste de ventas), y con índices
// numéricos `setPaso(2)` significaría un paso u otro según los módulos del cliente.
//
// El wizard es SOLO para crear; después se mantiene todo desde las pestañas, con
// estos mismos componentes abiertos sueltos. Una implementación por pantalla, dos
// formas de recorrerla — si no, editor y wizard divergen a la tercera semana.
//
// Guardado POR PASO: cada componente guarda lo suyo y al hacerlo avanza. Abandonar
// a media pantalla deja un borrador válido, nunca basura.

// Los pasos editables (orden y etiquetas) los define lib/dossier/pasos.ts, que
// comparte con «Mi dossier». El wizard solo añade su paso final propio, 'listo'.
type Paso = PasoEditable | 'listo'

const ETIQUETA: Record<Paso, string> = { ...LABEL_PASO, listo: 'Listo' }

// Los pasos que se pueden saltar sin escribir nada: el dossier sigue siendo válido
// sin relato ni logo (quien solo quiere el PDF no debería recorrer siete pantallas).
const OPCIONALES: Paso[] = ['costos', 'crecimiento', 'relato', 'marca']

function pasosDe(tieneBase: boolean): Paso[] {
  return [...pasosEditables(tieneBase), 'listo']
}

/**
 * Reanudación DERIVADA del estado, sin columna `paso_actual`: un puntero se queda
 * obsoleto en cuanto el dueño edita hacia atrás. ¿Hay dossier? ¿Hay serie?
 */
function pasoInicial(data: DossierData, pasos: Paso[]): Paso {
  if (!data.dossier) return 'basicos'
  if (data.serie.length === 0) return pasos.includes('costos') ? 'costos' : 'numeros'
  return 'crecimiento'
}

export default function DossierWizard({
  data, onRefrescar, onTerminar,
}: {
  data: DossierData
  onRefrescar: () => void
  onTerminar: () => void
}) {
  const pasos = useMemo(() => pasosDe(data.tieneBase), [data.tieneBase])
  const [paso, setPaso] = useState<Paso>(() => pasoInicial(data, pasos))

  const idx = Math.max(0, pasos.indexOf(paso))
  const pct = Math.round((idx / (pasos.length - 1)) * 100)

  const simbolo = data.dossier
    ? (data.monedas.find(m => m.codigo === data.dossier!.moneda_presentacion)?.simbolo ?? data.dossier.moneda_presentacion)
    : ''

  function avanzar() {
    const siguiente = pasos[Math.min(idx + 1, pasos.length - 1)]
    setPaso(siguiente)
    onRefrescar()
  }
  function atras() {
    setPaso(pasos[Math.max(idx - 1, 0)])
  }

  // Al crear, el dossier aún no existe: refrescamos para que el resto de pasos lo reciban.
  function creado() {
    onRefrescar()
    setPaso(pasos[1])
  }

  const dossier = data.dossier

  return (
    <div className="view-container dos-wizard">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dossier del negocio</h1>
          <p className="page-subtitle">
            Prepara la presentación de tus números para un inversor. Se guarda solo a cada paso: puedes salir y volver.
          </p>
        </div>
      </div>

      <div className="dos-progress">
        <div className="dos-progress-bar">
          <div className="dos-progress-fill" style={{ '--dos-progress': `${pct}%` } as CSSProperties} />
        </div>
        <div className="dos-progress-steps">
          {pasos.map((p, i) => (
            <span key={p} className={`dos-progress-step${i === idx ? ' active' : ''}${i < idx ? ' done' : ''}`}>
              {ETIQUETA[p]}
            </span>
          ))}
        </div>
      </div>

      {/* key={paso} remonta el contenido: es lo que dispara el fade en cada cambio */}
      <div className="dos-step-content" key={paso}>
        {paso === 'basicos' && (
          <PasoBasicos data={data} dossier={dossier} onListo={dossier ? avanzar : creado} />
        )}

        {paso === 'costos' && data.tieneBase && (
          <PasoCostoVentas categorias={data.categoriasCosto} onGuardado={avanzar} />
        )}

        {paso === 'numeros' && dossier && (
          <PasoNumeros
            key={dossier.snapshot_at ?? 'nuevo'}
            dossier={dossier} serie={data.serie} tieneBase={data.tieneBase}
            simbolo={simbolo} onCambio={avanzar}
          />
        )}

        {paso === 'crecimiento' && dossier && (
          <PasoCrecimiento dossier={dossier} serie={data.serie} simbolo={simbolo} onGuardado={avanzar} />
        )}

        {paso === 'relato' && dossier && (
          <PasoRelato dossier={dossier} secciones={data.secciones} tieneRrhh={data.tieneRrhh} onGuardado={avanzar} />
        )}

        {paso === 'marca' && dossier && (
          <PasoMarca dossier={dossier} empresaLogoUrl={data.empresaLogoUrl} onGuardado={avanzar} />
        )}

        {paso === 'listo' && (
          <section className="card dos-listo">
            <div className="dos-body">
              <PartyPopper size={40} strokeWidth={1.5} className="dos-listo-icono" />
              <h2 className="dos-section-title">Tu dossier está listo</h2>
              <p className="dos-section-hint">
                Ya puedes ver tu estado de resultados y descargarlo en PDF. Todo lo que has escrito se edita
                cuando quieras desde «Mi dossier», sin repetir este proceso.
              </p>
              <div className="dos-acciones">
                <button className="btn btn-primary" onClick={onTerminar}>Ir a mi dossier</button>
              </div>
            </div>
          </section>
        )}
      </div>

      {paso !== 'listo' && (
        <div className="dos-wizard-nav">
          {idx > 0
            ? <button className="btn btn-ghost" onClick={atras}><ArrowLeft size={14} strokeWidth={2.5} /> Atrás</button>
            : <span />}
          {OPCIONALES.includes(paso) && (
            <button className="btn btn-secondary" onClick={avanzar}>
              Saltar por ahora <ArrowRight size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
