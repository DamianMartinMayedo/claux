'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import type { DossierData, DossierBasico } from '@/app/actions/portal/dossier'
import { pasosEditables, LABEL_PASO, type PasoEditable } from '@/lib/dossier/pasos'
import PasoBasicos from './PasoBasicos'
import PasoCostoVentas from './PasoCostoVentas'
import PasoNumeros from './PasoNumeros'
import PasoCrecimiento from './PasoCrecimiento'
import PasoRelato from './PasoRelato'
import PasoMarca from './PasoMarca'

// «Mi dossier»: los MISMOS componentes del wizard, pero con NAVEGACIÓN LIBRE en
// lugar de un scroll largo. Se ve un paso a la vez, se salta a cualquiera, y cada
// uno se muestra igual que en la configuración inicial pero con los datos ya
// cargados (los componentes se inicializan de sus props). La tira marca qué pasos
// tienen contenido, para que nada parezca perdido tras un proceso de una vez.

export default function DossierSecciones({
  data, dossier, simbolo, onRefrescar,
}: {
  data: DossierData
  dossier: DossierBasico
  simbolo: string
  onRefrescar: () => void
}) {
  const pasos = pasosEditables(data.tieneBase)
  const [activo, setActivo] = useState<PasoEditable>('basicos')

  // Completado = tiene contenido guardado. Heurística suave, solo para el indicador:
  // 'basicos' y 'numeros' existen siempre aquí (se entra a las pestañas con serie).
  const completado: Record<PasoEditable, boolean> = {
    basicos:     true,
    costos:      data.categoriasCosto.some(c => c.es_costo_ventas),
    numeros:     data.serie.length > 0,
    crecimiento: (dossier.crecimiento_mensual_pct ?? 0) !== 0,
    relato:      data.secciones.some(s => (s.cuerpo ?? '').trim().length > 0),
    marca:       !!dossier.logo_url || dossier.color_principal.toUpperCase() !== '#00AFAA',
  }

  return (
    <div className="dos-secc">
      <nav className="dos-secc-nav" aria-label="Secciones del dossier">
        {pasos.map((p, i) => (
          <button
            key={p}
            type="button"
            className={`dos-secc-item${activo === p ? ' active' : ''}${completado[p] ? ' done' : ''}`}
            onClick={() => setActivo(p)}
            aria-current={activo === p ? 'true' : undefined}
          >
            <span className="dos-secc-num">
              {completado[p] ? <Check size={13} strokeWidth={3} /> : i + 1}
            </span>
            {LABEL_PASO[p]}
          </button>
        ))}
      </nav>

      {/* key={activo} → fade suave al cambiar de sección (respeta reduced-motion) */}
      <div className="dos-secc-panel" key={activo}>
        {activo === 'basicos' && (
          <PasoBasicos data={data} dossier={dossier} onListo={onRefrescar} />
        )}
        {activo === 'costos' && data.tieneBase && (
          <PasoCostoVentas categorias={data.categoriasCosto} onGuardado={onRefrescar} />
        )}
        {activo === 'numeros' && (
          <PasoNumeros
            key={dossier.snapshot_at ?? 'nuevo'}
            dossier={dossier} serie={data.serie} tieneBase={data.tieneBase}
            simbolo={simbolo} onCambio={onRefrescar}
          />
        )}
        {activo === 'crecimiento' && (
          <PasoCrecimiento dossier={dossier} serie={data.serie} simbolo={simbolo} onGuardado={onRefrescar} />
        )}
        {activo === 'relato' && (
          <PasoRelato dossier={dossier} secciones={data.secciones} tieneRrhh={data.tieneRrhh} onGuardado={onRefrescar} />
        )}
        {activo === 'marca' && (
          <PasoMarca dossier={dossier} empresaLogoUrl={data.empresaLogoUrl} onGuardado={onRefrescar} />
        )}
      </div>
    </div>
  )
}
