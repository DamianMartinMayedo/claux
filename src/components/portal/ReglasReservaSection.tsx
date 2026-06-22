'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarReglas, type ReglasReserva } from '@/app/actions/portal/reservas'

export default function ReglasReservaSection({
  reglas, mostrarMaxPersonas,
}: {
  reglas: ReglasReserva
  mostrarMaxPersonas?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await guardarReglas(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Reglas guardadas.'); router.refresh()
    })
  }

  return (
    <div className="card res-section">
      <div className="card-header"><h2 className="card-title">Reglas de reserva</h2></div>
      <form onSubmit={handleSubmit}>
        <div className="ter-form-grid res-conf-pad-top">
          <div className="input-group ter-col-span-2">
            <label>Antelación mínima (horas)</label>
            <input className="input" name="antelacion_min_horas" type="number" min="0" defaultValue={reglas.antelacion_min_horas} />
            <span className="input-hint">0 = sin mínimo.</span>
          </div>
          <div className="input-group ter-col-span-2">
            <label>Ventana máxima (días)</label>
            <input className="input" name="ventana_max_dias" type="number" min="0" defaultValue={reglas.ventana_max_dias} />
            <span className="input-hint">0 = sin límite.</span>
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
