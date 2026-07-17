'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { guardarCierre, eliminarCierre, type Cierre } from '@/app/actions/portal/reservas'
import { Plus, Trash2 } from 'lucide-react'

function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function fmt(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CierresSection({ cierres, iaActiva }: { cierres: Cierre[]; iaActiva?: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [mostrarForm, setMostrarForm] = useState(false)
  const [confirmarBorrado, setConfirmarBorrado] = useState<Cierre | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await guardarCierre(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Cierre guardado.'); setMostrarForm(false); router.refresh()
    })
  }
  // Confirmación in-app (ConfirmDialog, patrón de la plataforma) antes de un
  // borrado que no se puede deshacer: reabre las reservas de esas fechas.
  function doEliminar(c: Cierre) {
    setConfirmarBorrado(null)
    startTransition(async () => {
      const res = await eliminarCierre(c.cierre_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Cierre eliminado.'); router.refresh()
    })
  }

  return (
    <div className="card res-section">
      <div className="card-header">
        <h2 className="card-title">Cierres y festivos</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setMostrarForm(v => !v)}>
          <Plus size={14} strokeWidth={2.5} /> Añadir
        </button>
      </div>

      {iaActiva && (
        <div className="info-box">
          <span className="text-xs-muted">La IA no ofrecerá reservas en estas fechas.</span>
        </div>
      )}

      {mostrarForm && (
        <form onSubmit={handleSubmit}>
          <div className="ter-form-grid res-conf-pad-top">
            <div className="input-group ter-col-span-2">
              <label>Desde <span className="required">*</span></label>
              <input className="input" name="fecha_desde" type="date" required min={hoyISO()} defaultValue={hoyISO()} />
            </div>
            <div className="input-group ter-col-span-2">
              <label>Hasta</label>
              <input className="input" name="fecha_hasta" type="date" min={hoyISO()} />
              <span className="input-hint">Déjalo vacío si es un solo día.</span>
            </div>
            <div className="input-group ter-col-span-2">
              <label>Motivo</label>
              <input className="input" name="motivo" placeholder="Festivo, vacaciones…" />
            </div>
          </div>
          <div className="res-form-submit res-actions-row">
            <button type="button" className="btn btn-secondary" onClick={() => setMostrarForm(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar'}
            </button>
          </div>
        </form>
      )}

      {cierres.length === 0 ? (
        <div className="ter-form-grid res-conf-pad-top">
          <span className="input-hint">No hay días de cierre. Añade festivos, vacaciones o cierres puntuales para bloquear reservas y citas esos días.</span>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead><tr><th>Fechas</th><th>Motivo</th><th className="col-actions"></th></tr></thead>
            <tbody>
              {cierres.map(c => (
                <tr key={c.cierre_id}>
                  <td data-label="Fechas"><strong>{c.fecha_desde === c.fecha_hasta ? fmt(c.fecha_desde) : `${fmt(c.fecha_desde)} – ${fmt(c.fecha_hasta)}`}</strong></td>
                  <td data-label="Motivo" className="text-sm-muted cell-truncate">{c.motivo ?? '—'}</td>
                  <td className="col-actions">
                    <div className="ter-actions">
                      <button className="ter-action-btn ter-action-danger" title="Eliminar"
                        onClick={() => setConfirmarBorrado(c)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmarBorrado && (
        <ConfirmDialog
          title="¿Eliminar este cierre?"
          body={`${confirmarBorrado.fecha_desde === confirmarBorrado.fecha_hasta
            ? fmt(confirmarBorrado.fecha_desde)
            : `${fmt(confirmarBorrado.fecha_desde)} – ${fmt(confirmarBorrado.fecha_hasta)}`}. Volverán a admitirse reservas y citas esos días.`}
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmarBorrado(null)}
          onConfirm={() => doEliminar(confirmarBorrado)}
        />
      )}
    </div>
  )
}
