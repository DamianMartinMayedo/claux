'use client'

import { useState, useTransition } from 'react'
import { ExternalLink, Copy, Check, Loader2, Globe, EyeOff, RefreshCw, AlertTriangle, Download } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useIa } from '@/components/portal/ia/IaContext'
import IaSparkle from '@/components/portal/ia/IaSparkle'
import {
  publicarDossier, despublicarDossier, revocarEnlace, guardarTraduccionIngles,
  type DossierBasico,
} from '@/app/actions/portal/dossier'
import { revisarDossierIa, traducirDossierIa } from '@/app/actions/portal/ia'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { TZ_NEGOCIO } from '@/lib/fecha-tz'

// "Visto 3 veces · última vez 10 ago 14:32", o "Nadie lo ha abierto todavía". La
// fecha va anclada a la zona del negocio (como el resto del módulo) para que el SSR
// (UTC) y el navegador del dueño (Habana) impriman lo mismo — sin mismatch.
function textoApertura(n: number, ultima: string | null): string {
  if (n <= 0 || !ultima) return 'Nadie ha abierto el enlace todavía.'
  const veces = n === 1 ? 'Visto 1 vez' : `Visto ${n} veces`
  const d = new Date(ultima)
  if (Number.isNaN(d.getTime())) return veces + '.'
  const cuando = new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ_NEGOCIO, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d)
  return `${veces} · última vez ${cuando}.`
}
import DossierDesfase from './DossierDesfase'
import AvisoContabilidad from './AvisoContabilidad'
import GavetaLanzador from '@/components/portal/GavetaLanzador'
import type { ResumenGaveta } from '@/lib/caja/pendientes'

// Panel de control del enlace público. El deck vive en /d/<token>: una capability
// URL (quien la tiene, la ve). No hay login que ponerle delante —el inversor no es
// usuario de CLAUX—, así que la protección real es poder revocarla.

export default function PestanaPresentacion({
  dossier, tieneBase, gaveta, aperturas, ultimaApertura, tieneEn, enDesactualizado, onCambio,
}: {
  dossier: DossierBasico
  tieneBase: boolean
  /** Salidas de caja sin clasificar. Avisa al dueño ANTES de publicar; el deck no la menciona. */
  gaveta: ResumenGaveta
  aperturas: number
  ultimaApertura: string | null
  tieneEn: boolean
  enDesactualizado: boolean
  onCambio?: () => void
}) {
  const { tieneIa } = useIa()
  const [pending, startTransition] = useTransition()
  const [copiado, setCopiado] = useState(false)
  const [confirmarRevocar, setConfirmarRevocar] = useState(false)
  const [confirmarDespublicar, setConfirmarDespublicar] = useState(false)
  const [revisando, startRevisar] = useTransition()
  const [observaciones, setObservaciones] = useState<string[] | null>(null)
  const [traduciendo, startTraducir] = useTransition()

  const publicado = dossier.estado === 'PUBLICADO'
  const sinNumeros = !dossier.snapshot_at
  // Snapshot desfasado: cambió moneda/empresa/período tras congelar. Publicar así
  // enseñaría importes viejos al inversor; y si ya está publicado, el enlace en vivo
  // ya los muestra. El servidor bloquea publicar; aquí lo avisamos y lo deshabilitamos.
  const desfasado = dossier.snapshot_stale && !!dossier.snapshot_at
  // En el navegador siempre hay origin; el fallback es solo para el render de servidor.
  const url = dossier.token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/d/${dossier.token}`
    : ''

  function publicar() {
    const ld = toastLoading('Publicando…')
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      const res = await publicarDossier(fd)
      await ld.dismiss()
      if (res.ok) { toastSuccess('Dossier publicado'); onCambio?.() }
      else toastError(res.error || 'No se pudo publicar')
    })
  }

  function despublicar() {
    const ld = toastLoading('Despublicando…')
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      const res = await despublicarDossier(fd)
      await ld.dismiss()
      if (res.ok) { toastSuccess('Dossier despublicado'); setConfirmarDespublicar(false); onCambio?.() }
      else toastError(res.error || 'No se pudo despublicar')
    })
  }

  function revocar() {
    const ld = toastLoading('Generando…')
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      const res = await revocarEnlace(fd)
      await ld.dismiss()
      if (res.ok) { toastSuccess('Enlace nuevo generado; el anterior ya no funciona'); setConfirmarRevocar(false); onCambio?.() }
      else toastError(res.error || 'No se pudo revocar')
    })
  }

  // IA1: segunda lectura de coherencia antes de enseñarlo. La IA comenta, no calcula.
  function revisar() {
    if (revisando) return
    const ld = toastLoading('Revisando…')
    startRevisar(async () => {
      const res = await revisarDossierIa(dossier.dossier_id)
      await ld.dismiss()
      if (res.ok) setObservaciones(res.observaciones)
      else toastError(res.error || 'No se pudo revisar el dossier')
    })
  }

  // Fase 10: genera (o regenera) la versión inglesa. La IA traduce y una acción con
  // candado la guarda; el deck la sirve con el botón ES/EN.
  function generarIngles() {
    if (traduciendo) return
    const ld = toastLoading('Traduciendo…')
    startTraducir(async () => {
      const res = await traducirDossierIa(dossier.dossier_id)
      if (!res.ok) { await ld.dismiss(); toastError(res.error); return }
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      fd.set('resumen_en', res.resumenEn ?? '')
      fd.set('secciones', JSON.stringify(res.secciones))
      fd.set('conceptos', JSON.stringify(res.conceptos))
      const save = await guardarTraduccionIngles(fd)
      await ld.dismiss()
      if (save.ok) { toastSuccess('Versión en inglés lista: el enlace ya trae el botón ES/EN'); onCambio?.() }
      else toastError(save.error || 'No se pudo guardar la traducción')
    })
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toastError('No se pudo copiar. Selecciona el enlace y cópialo a mano.')
    }
  }

  return (
    <section className="card">
      <div className="dos-body">
        <h2 className="dos-section-title">Presentación</h2>
        <p className="dos-section-hint">
          Un enlace web con tus números y tu relato, pensado para enseñárselo a un inversor desde el móvil.
        </p>

        {desfasado && (
          <DossierDesfase
            dossierId={dossier.dossier_id}
            tieneBase={tieneBase}
            onActualizado={onCambio}
            mensaje={
              <>
                <strong>Tus números están desfasados.</strong> Cambiaste la moneda, la empresa o el período.
                {publicado
                  ? ' El enlace en vivo sigue mostrando el snapshot anterior.'
                  : ' No podrás publicar hasta actualizarlos.'}
              </>
            }
          />
        )}

        {/* Publicar es enseñárselo a alguien de fuera. Si faltan gastos por
            clasificar, el resultado que va a leer ese alguien está inflado — y hay
            que decirlo AQUÍ, que es la última pantalla del dueño. No se bloquea
            (el desfase sí; esto es una omisión suya, no un dato viejo) y, sobre
            todo, no se escribe una palabra de esto en el deck. */}
        <GavetaLanzador
          resumen={gaveta}
          nota={publicado
            ? 'Esos gastos no están en el enlace que ya repartiste: quien lo abra ve un resultado mejor que el real.'
            : 'Esos gastos no entran en lo que vas a publicar: quien lo abra verá un resultado mejor que el real.'}
        />

        {sinNumeros ? (
          <p className="dos-vacio">Carga tus números en «Mi dossier» y podrás publicar tu presentación.</p>
        ) : !publicado ? (
          <>
            {/* Tercera ubicación del gancho (M3): publicar es el momento en que se
                lo va a enseñar a alguien, y por tanto en el que más pesa que los
                números estén al día solos. */}
            {!tieneBase && (
              <AvisoContabilidad
                texto="Vas a enseñar estos números a alguien. Con Contabilidad se actualizan solos desde tus ventas y gastos, así que el enlace nunca queda viejo — y lo que escribiste a mano se conserva."
              />
            )}
            <p className="dos-section-hint">
              Todavía no está publicada: nadie puede verla. Al publicar obtendrás un enlace privado que
              solo funciona para quien se lo des.
            </p>
            <div className="dos-acciones">
              <button className="btn btn-primary" onClick={publicar} disabled={pending || desfasado}>
                {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Globe size={14} strokeWidth={2.5} />}
                Publicar presentación
              </button>
              {/* Ver el deck ensamblado ANTES de publicar: mismo render que el enlace
                  público, gated por sesión (nadie más lo ve). Evita publicar a ciegas. */}
              <a className="btn btn-secondary" href={`/d/preview/${dossier.dossier_id}`} target="_blank" rel="noreferrer">
                <ExternalLink size={14} strokeWidth={2.5} /> Ver borrador
              </a>
            </div>
          </>
        ) : (
          <>
            <div className="dos-enlace-estado">
              <span className="badge badge-dot badge-success">Publicado</span>
              <span className="dos-section-hint dos-enlace-nota">Los cambios que hagas se ven al instante en el enlace.</span>
            </div>

            <div className="dos-enlace-row">
              <input className="input dos-enlace-input" value={url} readOnly aria-label="Enlace de tu presentación" onFocus={e => e.target.select()} />
              <button className="btn btn-secondary" onClick={copiar}>
                {copiado ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={2.5} />}
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
              <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} strokeWidth={2.5} /> Ver
              </a>
              {/* El PDF es la propia presentación paginada, así que el diálogo tiene
                  que salir en el deck, no aquí: `?print=1` lo abre y lo dispara solo.
                  Sí, abre una pestaña; pero no hay descarga por red que ahorrar —el
                  archivo se genera en el dispositivo— y es el mismo gesto que «Ver». */}
              <a className="btn btn-secondary dos-pdf-btn" href={`${url}?print=1`} target="_blank" rel="noreferrer">
                <Download size={14} strokeWidth={2.5} /> PDF
              </a>
            </div>

            <div className="dos-enlace-acciones">
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmarDespublicar(true)} disabled={pending}>
                <EyeOff size={13} strokeWidth={2.5} /> Despublicar
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmarRevocar(true)} disabled={pending}>
                <RefreshCw size={13} strokeWidth={2.5} /> Cambiar el enlace
              </button>
            </div>

            {/* Acuse de lectura: lo que más quiere saber quien manda un dossier. */}
            <p className="dos-aperturas">{textoApertura(aperturas, ultimaApertura)}</p>

            {confirmarRevocar && (
              <div className="dos-revocar">
                <p className="dos-preview-aviso dos-preview-aviso-warn">
                  <AlertTriangle size={14} strokeWidth={2} />
                  Se creará un enlace nuevo y <strong>el que ya repartiste dejará de funcionar</strong>. Úsalo si crees que
                  el enlace llegó a quien no debía.
                </p>
                <div className="dos-acciones">
                  <button className="btn btn-secondary" onClick={() => setConfirmarRevocar(false)} disabled={pending}>Cancelar</button>
                  <button className="btn btn-danger" onClick={revocar} disabled={pending}>
                    {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : null}
                    Cambiar el enlace
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Acciones de IA del dossier, juntas y al pie: una segunda lectura de
            coherencia (IA1) y la versión en inglés (Fase 10). Solo con addon de IA
            y cuando ya hay algo que revisar/traducir (números congelados). */}
        {tieneIa && !sinNumeros && (
          <div className="dos-ia">
            <div className="dos-ia-acciones">
              <button className="btn btn-ia btn-sm" onClick={revisar} disabled={revisando}>
                {revisando ? <Loader2 size={13} strokeWidth={2.5} className="dos-spin" /> : <IaSparkle />}
                {revisando ? 'Revisando…' : 'Revisar mi dossier con IA'}
              </button>
              <button className="btn btn-ia btn-sm" onClick={generarIngles} disabled={traduciendo}>
                {traduciendo ? <Loader2 size={13} strokeWidth={2.5} className="dos-spin" /> : <IaSparkle />}
                {traduciendo ? 'Traduciendo…' : tieneEn ? 'Regenerar versión en inglés' : 'Generar versión en inglés'}
              </button>
            </div>
            {observaciones && (
              observaciones.length > 0 ? (
                <ul className="dos-revision-lista">
                  {observaciones.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              ) : (
                <p className="dos-section-hint">Sin observaciones: tu dossier se ve coherente.</p>
              )
            )}
            {tieneEn && !enDesactualizado && (
              <p className="dos-section-hint">Tu enlace lleva el botón <strong>ES / EN</strong>: el inversor cambia de idioma en vivo.</p>
            )}
            {tieneEn && enDesactualizado && (
              <div className="alert alert-warning" role="alert">
                <AlertTriangle size={14} strokeWidth={2} />
                <span>Cambiaste el dossier después de traducirlo: la versión en inglés puede estar desactualizada. Regénérala para ponerla al día.</span>
              </div>
            )}
          </div>
        )}
      </div>

      {confirmarDespublicar && (
        <ConfirmDialog
          title="Despublicar la presentación"
          body={
            <>El enlace dejará de funcionar para quien lo tengas dado, hasta que vuelvas a publicar.
            El relato y los números se conservan; solo se corta el acceso.</>
          }
          confirmLabel="Despublicar"
          cancelLabel="Cancelar"
          onConfirm={despublicar}
          onCancel={() => setConfirmarDespublicar(false)}
        />
      )}
    </section>
  )
}
