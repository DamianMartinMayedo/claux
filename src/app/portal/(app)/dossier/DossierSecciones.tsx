'use client'

import { useCallback, useState } from 'react'
import { Check } from 'lucide-react'
import type { DossierData, DossierBasico } from '@/app/actions/portal/dossier'
import { pasosEditables, LABEL_PASO, type PasoEditable } from '@/lib/dossier/pasos'
import { ConfirmDialog } from '@/components/portal/Dialog'
import DossierDesfase from './DossierDesfase'
import PasoBasicos from './PasoBasicos'
import PasoCostoVentas from './PasoCostoVentas'
import PasoNumeros from './PasoNumeros'
import PasoDesglose from './PasoDesglose'
import PasoCrecimiento from './PasoCrecimiento'
import PasoRelato from './PasoRelato'
import PasoMarca from './PasoMarca'

// «Mi dossier»: los MISMOS componentes del wizard, pero con NAVEGACIÓN LIBRE en
// lugar de un scroll largo. Se ve un paso a la vez, se salta a cualquiera, y cada
// uno se muestra igual que en la configuración inicial pero con los datos ya
// cargados (los componentes se inicializan de sus props). La tira marca qué pasos
// tienen contenido, para que nada parezca perdido tras un proceso de una vez.

export default function DossierSecciones({
  data, dossier, simbolo, onRefrescar, dirty, setDirty,
}: {
  data: DossierData
  dossier: DossierBasico
  simbolo: string
  onRefrescar: () => void
  // `dirty`/`setDirty` viven en DossierEditor: el mismo flag guarda el cambio de
  // SECCIÓN (aquí) y el de PESTAÑA (allí). Los Paso* re-inicializan de props al
  // remontar, así que saltar con algo tecleado sin guardar lo perdía en silencio.
  dirty: boolean
  setDirty: (v: boolean) => void
}) {
  const pasos = pasosEditables(data.tieneBase)
  const [activo, setActivo] = useState<PasoEditable>('basicos')
  const [pendiente, setPendiente] = useState<PasoEditable | null>(null)

  // Un guardado limpia el flag: cada Paso llama a su callback SOLO tras guardar bien,
  // así que es el punto exacto en que lo tecleado deja de estar en el aire.
  const marcarGuardado = useCallback(() => { setDirty(false); onRefrescar() }, [setDirty, onRefrescar])

  // Intento de cambiar de sección: si hay algo tecleado sin guardar, se confirma
  // antes de descartarlo; si no, se cambia directo.
  const irA = useCallback((p: PasoEditable) => {
    if (p === activo) return
    if (dirty) { setPendiente(p); return }
    setActivo(p)
  }, [activo, dirty, setPendiente, setActivo])

  // Defecto de la portada: la empresa del dossier, o el nombre de la cuenta si es
  // consolidado (mismo criterio que deriva el deck cuando no hay nombre fijado).
  const nombrePortadaDefault = dossier.empresa_id
    ? (data.empresas.find(e => e.empresa_id === dossier.empresa_id)?.nombre ?? data.nombreNegocio)
    : data.nombreNegocio

  // Snapshot desfasado: cambió la moneda/empresa/período tras congelar y la serie
  // todavía es la anterior. Solo tiene sentido si ya hay números que enseñar.
  const desfasado = dossier.snapshot_stale && data.serie.length > 0

  // Completado = tiene contenido guardado. Heurística suave, solo para el indicador:
  // 'basicos' y 'numeros' existen siempre aquí (se entra a las pestañas con serie).
  const completado: Record<PasoEditable, boolean> = {
    basicos:     true,
    // 🔴 Deducirlo del catálogo NO funciona, y ya falló dos veces: primero con
    // «algo distinto de OPERATIVO» (la semilla planta raíces de fuera del
    // resultado desde la fase 2) y después con los tres roles de gasto, porque la
    // semilla planta también «Compras», que nace `COSTE_VENTAS`. Cualquier
    // heurística sobre el catálogo se cumple sola en cuanto la semilla crece.
    // La prueba de verdad de que el dueño pasó por aquí es que GUARDÓ el paso:
    // `categorias_roles` solo lo escribe `guardarCostoVentas`.
    costos:      Object.keys(dossier.categorias_roles).length > 0,
    numeros:     data.serie.length > 0,
    desglose:    data.lineas.length > 0,
    crecimiento: (dossier.crecimiento_mensual_pct ?? 0) !== 0,
    relato:      data.secciones.some(s => (s.cuerpo ?? '').trim().length > 0),
    marca:       !!dossier.logo_url || dossier.color_principal.toUpperCase() !== '#00AFAA',
  }

  return (
    <div className="dos-secc">
      {desfasado && (
        <DossierDesfase
          dossierId={dossier.dossier_id}
          tieneBase={data.tieneBase}
          onIrANumeros={() => irA('numeros')}
          onActualizado={marcarGuardado}
          mensaje={
            <>
              <strong>Tus números están desfasados.</strong> Cambiaste la moneda, la empresa o el período, pero
              la presentación y el estado de resultados siguen mostrando el snapshot anterior
              {data.tieneBase ? ' (importes en la moneda o empresa de antes)' : ''}. Sincronízalos para que todo cuadre.
            </>
          }
        />
      )}

      <nav className="dos-secc-nav" aria-label="Secciones del dossier">
        {pasos.map((p, i) => (
          <button
            key={p}
            type="button"
            className={`dos-secc-item${activo === p ? ' active' : ''}${completado[p] ? ' done' : ''}`}
            onClick={() => irA(p)}
            aria-current={activo === p ? 'true' : undefined}
          >
            <span className="dos-secc-num">
              {completado[p] ? <Check size={13} strokeWidth={3} /> : i + 1}
            </span>
            {LABEL_PASO[p]}
          </button>
        ))}
      </nav>

      {/* key={activo} → fade suave al cambiar de sección (respeta reduced-motion).
          onChangeCapture marca «sucio» en cuanto se teclea en cualquier campo del
          Paso activo, sin tener que instrumentar cada uno. */}
      <div className="dos-secc-panel" key={activo} onChangeCapture={() => setDirty(true)}>
        {activo === 'basicos' && (
          <PasoBasicos data={data} dossier={dossier} onListo={marcarGuardado} />
        )}
        {activo === 'costos' && data.tieneBase && (
          <PasoCostoVentas
            dossierId={dossier.dossier_id}
            categorias={data.categoriasCosto}
            categoriasExcluidasIniciales={dossier.categorias_excluidas}
            tieneSnapshot={!!dossier.snapshot_at}
            onGuardado={marcarGuardado}
          />
        )}
        {activo === 'numeros' && (
          <PasoNumeros
            key={dossier.snapshot_at ?? 'nuevo'}
            dossier={dossier} serie={data.serie} tieneBase={data.tieneBase}
            simbolo={simbolo} onGuardado={marcarGuardado} onCambio={marcarGuardado}
          />
        )}
        {activo === 'desglose' && (
          <PasoDesglose
            key={dossier.snapshot_at ?? 'nuevo'}
            dossier={dossier} serie={data.serie} lineas={data.lineas}
            conceptos={data.conceptosSector} tieneBase={data.tieneBase}
            simbolo={simbolo} onGuardado={marcarGuardado}
          />
        )}
        {activo === 'crecimiento' && (
          <PasoCrecimiento dossier={dossier} serie={data.serie} simbolo={simbolo} onGuardado={marcarGuardado} />
        )}
        {activo === 'relato' && (
          <PasoRelato dossier={dossier} secciones={data.secciones} tieneRrhh={data.tieneRrhh} onGuardado={marcarGuardado} />
        )}
        {activo === 'marca' && (
          <PasoMarca dossier={dossier} empresaLogoUrl={data.empresaLogoUrl}
            nombrePorDefecto={nombrePortadaDefault} onGuardado={marcarGuardado} onCambio={marcarGuardado} />
        )}
      </div>

      {pendiente && (
        <ConfirmDialog
          title="Tienes cambios sin guardar"
          body="Si cambias de sección ahora, se perderá lo que escribiste aquí y no has guardado."
          confirmLabel="Descartar y salir"
          cancelLabel="Seguir aquí"
          danger
          onConfirm={() => { setActivo(pendiente); setDirty(false); setPendiente(null) }}
          onCancel={() => setPendiente(null)}
        />
      )}
    </div>
  )
}
