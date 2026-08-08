'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarReglas, type ReglasReserva } from '@/app/actions/portal/agenda-comun'

export default function ReglasReservaSection({
  reglas, mostrarMaxPersonas, iaActiva, compartidas,
}: {
  reglas: ReglasReserva
  mostrarMaxPersonas?: boolean
  iaActiva?: boolean
  /**
   * El negocio tiene Reservas Y Citas contratadas, así que estas reglas valen para
   * las dos. Es el ajuste peligroso de la pantalla: cambiar la antelación mínima en
   * Citas se la cambia también a Reservas, y no había una sola palabra que lo dijera.
   * Con una sola funcionalidad no hay nada que advertir y la línea sería ruido.
   */
  compartidas?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarReglas(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      // El aviso también EN EL MOMENTO DE GUARDAR: una línea bajo el título la lee
      // quien mira el título, y quien edita la antelación está mirando el campo.
      toastSuccess(compartidas ? 'Reglas guardadas · valen para Reservas y Citas' : 'Reglas guardadas.')
      router.refresh()
    })
  }

  return (
    <div className="card res-section">
      <div className="card-header"><h2 className="card-title">Reglas de reserva</h2></div>
      {compartidas && (
        <span className="text-xs-muted res-ambito">
          Valen para <strong>Reservas y Citas</strong>: si las cambias aquí, cambian en las dos.
        </span>
      )}
      {iaActiva && (
        <div className="info-box">
          <span className="text-xs-muted">La IA respetará estas reglas al gestionar reservas.</span>
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div className="ter-form-grid res-conf-pad-top">
          <div className="input-group ter-col-span-2">
            <label>Antelación mínima (horas)</label>
            <input className="input" name="antelacion_min_horas" type="number" min="0" defaultValue={reglas.antelacion_min_horas} />
            <span className="input-hint">0 = sin mínimo.{compartidas ? ' Vale para Reservas y Citas.' : ''}</span>
          </div>
          <div className="input-group ter-col-span-2">
            <label>Ventana máxima (días)</label>
            <input className="input" name="ventana_max_dias" type="number" min="0" defaultValue={reglas.ventana_max_dias} />
            <span className="input-hint">0 = sin límite.{compartidas ? ' Vale para Reservas y Citas.' : ''}</span>
          </div>
          {mostrarMaxPersonas ? (
            <div className="input-group ter-col-span-2">
              <label>Máx. personas por reserva</label>
              <input className="input" name="max_personas" type="number" min="0" defaultValue={reglas.max_personas} />
              <span className="input-hint">0 = sin límite.</span>
            </div>
          ) : (
            // Preserva el valor (las citas son de 1 persona; no se edita aquí)
            <input type="hidden" name="max_personas" defaultValue={reglas.max_personas} />
          )}
        </div>
        <div className="res-form-submit">
          <button type="submit" className="btn btn-primary" disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar reglas'}
          </button>
        </div>
      </form>
    </div>
  )
}
