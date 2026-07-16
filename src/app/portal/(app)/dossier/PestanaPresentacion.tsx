'use client'

import { useState, useTransition } from 'react'
import { ExternalLink, Copy, Check, Loader2, Globe, EyeOff, RefreshCw, AlertTriangle } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import {
  publicarDossier, despublicarDossier, revocarEnlace,
  type DossierBasico,
} from '@/app/actions/portal/dossier'
import DossierDesfase from './DossierDesfase'

// Panel de control del enlace público. El deck vive en /d/<token>: una capability
// URL (quien la tiene, la ve). No hay login que ponerle delante —el inversor no es
// usuario de CLAUX—, así que la protección real es poder revocarla.

export default function PestanaPresentacion({
  dossier, tieneBase, onCambio,
}: {
  dossier: DossierBasico
  tieneBase: boolean
  onCambio?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [copiado, setCopiado] = useState(false)
  const [confirmarRevocar, setConfirmarRevocar] = useState(false)

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
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      const res = await publicarDossier(fd)
      if (res.ok) { toastSuccess('Dossier publicado'); onCambio?.() }
      else toastError(res.error || 'No se pudo publicar')
    })
  }

  function despublicar() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      const res = await despublicarDossier(fd)
      if (res.ok) { toastSuccess('Dossier despublicado'); onCambio?.() }
      else toastError(res.error || 'No se pudo despublicar')
    })
  }

  function revocar() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      const res = await revocarEnlace(fd)
      if (res.ok) { toastSuccess('Enlace nuevo generado; el anterior ya no funciona'); setConfirmarRevocar(false); onCambio?.() }
      else toastError(res.error || 'No se pudo revocar')
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

        {sinNumeros ? (
          <p className="dos-vacio">Carga tus números en «Mi dossier» y podrás publicar tu presentación.</p>
        ) : !publicado ? (
          <>
            <p className="dos-section-hint">
              Todavía no está publicada: nadie puede verla. Al publicar obtendrás un enlace privado que
              solo funciona para quien se lo des.
            </p>
            <div className="dos-acciones">
              <button className="btn btn-primary" onClick={publicar} disabled={pending || desfasado}>
                {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Globe size={14} strokeWidth={2.5} />}
                Publicar presentación
              </button>
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
            </div>

            <div className="dos-enlace-acciones">
              <button className="btn btn-ghost btn-sm" onClick={despublicar} disabled={pending}>
                <EyeOff size={13} strokeWidth={2.5} /> Despublicar
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmarRevocar(true)} disabled={pending}>
                <RefreshCw size={13} strokeWidth={2.5} /> Cambiar el enlace
              </button>
            </div>

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
      </div>
    </section>
  )
}
