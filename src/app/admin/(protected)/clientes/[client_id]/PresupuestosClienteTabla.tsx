'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { useToast } from '@/app/contexts/ToastContext'
import { obtenerPresupuesto, type PresupuestoRow } from '@/app/actions/presupuestos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detalle = Record<string, any>
type DesgloseFase = { fase: string; horas: number; subtotalUsd: number }
type Revision = { linea: string; motivo: string }

const usd = (n: number) => `$${Number(n ?? 0).toFixed(2)}`

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

function EstadoBadge({ estado }: { estado: string }) {
  if (estado === 'aprobado')  return <span className="badge badge-success">Aprobado</span>
  if (estado === 'instalado') return <span className="badge badge-purple">Instalado</span>
  return <span className="badge badge-info">Guardado</span>
}

export default function PresupuestosClienteTabla({ presupuestos }: { presupuestos: PresupuestoRow[] }) {
  const { error: toastError } = useToast()
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [cargando, setCargando] = useState(false)

  async function abrir(id: number) {
    setCargando(true)
    const d = await obtenerPresupuesto(id)
    setCargando(false)
    if (!d) { toastError('No se pudo cargar el presupuesto'); return }
    setDetalle(d)
  }

  const desglose: DesgloseFase[] = Array.isArray(detalle?.desglose) ? detalle!.desglose : []
  const revisiones: Revision[] = Array.isArray(detalle?.revisiones) ? detalle!.revisiones : []

  return (
    <>
      <div className="table-wrapper table-wrapper-flush">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Estado</th>
              <th className="col-num">Horas</th>
              <th className="col-num">Reales</th>
              <th className="col-num">Instalación</th>
            </tr>
          </thead>
          <tbody>
            {presupuestos.map(p => {
              const reales = p.horas_reales
              const seExcedio = reales != null && reales > p.horas_total
              return (
                <tr
                  key={p.id}
                  className="table-row-clickable"
                  onClick={() => abrir(p.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(p.id) } }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Abrir presupuesto del ${fmtFecha(p.created_at)}`}
                >
                  <td data-label="Fecha" className="table-muted">{fmtFecha(p.created_at)}</td>
                  <td data-label="Estado"><EstadoBadge estado={p.estado} /></td>
                  <td data-label="Horas" className="col-num">{p.horas_total}h</td>
                  <td data-label="Reales" className="col-num">
                    {reales == null
                      ? <span className="text-xs-muted">—</span>
                      : <span className={seExcedio ? 'pres-horas-exceso' : undefined}>{reales}h</span>}
                  </td>
                  <td data-label="Instalación" className="col-num table-price">
                    {usd(p.total_final_usd ?? p.coste_instalacion_usd)}
                    {Number(p.descuento_pct) > 0 && (
                      <span className="text-xs-muted"> · −{Number(p.descuento_pct)}%</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {(detalle || cargando) && (
        <div className="modal-backdrop">
          <div className="modal modal-560" onClick={e => e.stopPropagation()}>
            {cargando || !detalle ? (
              <div className="modal-body">
                <p className="text-sm-muted"><span className="spinner" /> Cargando…</p>
              </div>
            ) : (
              <>
                <div className="modal-header">
                  <h2 className="modal-title">{detalle.nombre_negocio}</h2>
                  <button type="button" onClick={() => setDetalle(null)} className="modal-close" aria-label="Cerrar">
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-body">
                  <div className="sol-detalle">
                    <div className="sol-row"><span className="sol-label">Estado</span><span className="sol-value"><EstadoBadge estado={detalle.estado} /></span></div>
                    <div className="sol-row"><span className="sol-label">Comercial</span><span className="sol-value">{detalle.comercial_nombre ?? '—'}</span></div>
                    <div className="sol-row"><span className="sol-label">Responsable</span><span className="sol-value">{detalle.nombre_responsable ?? '—'}</span></div>
                    <div className="sol-row"><span className="sol-label">Contacto</span><span className="sol-value">{detalle.contacto ?? '—'}</span></div>
                    <div className="sol-row"><span className="sol-label">Tarifa</span><span className="sol-value">{detalle.tarifa === 'fundador' ? 'Fundador' : 'Estándar'}</span></div>
                    <div className="sol-row"><span className="sol-label">Módulos</span><span className="sol-value">{(detalle.modulos ?? []).join(', ') || '—'}</span></div>
                    {detalle.client_id && (
                      <div className="sol-row"><span className="sol-label">Cliente</span><span className="sol-value">{detalle.client_id}</span></div>
                    )}
                  </div>

                  <div className="pres-desglose">
                    <p className="mod-list-label">Desglose por fase</p>
                    {desglose.map((d, i) => (
                      <div key={i} className="pres-fase-row">
                        <span className="pres-fase-nombre">{d.fase}</span>
                        <span className="pres-fase-horas">{d.horas}h</span>
                        <span className="pres-fase-sub col-num">{usd(d.subtotalUsd)}</span>
                      </div>
                    ))}
                  </div>

                  {revisiones.length > 0 && (
                    <div className="alert alert-warning">
                      <strong>Líneas a revisar</strong>
                      <ul className="pres-revisiones">
                        {revisiones.map((r, i) => <li key={i}><strong>{r.linea}:</strong> {r.motivo}</li>)}
                      </ul>
                    </div>
                  )}

                  <div className="pres-totales">
                    <p className="pres-bloque-titulo">Pago único · Instalación</p>
                    <div><span className="pres-total-label">Horas totales</span><span className="pres-total-valor">{detalle.horas_total}h</span></div>
                    {Number(detalle.tarifa_hora_usd) > 0 && (
                      <div><span className="pres-total-label">Tarifa aplicada</span><span className="pres-total-valor">{usd(detalle.tarifa_hora_usd)}/h</span></div>
                    )}
                    <div><span className="pres-total-label">Coste instalación</span><span className="pres-total-valor">{usd(detalle.coste_instalacion_usd)}</span></div>
                    {Number(detalle.descuento_pct) > 0 && (
                      <div className="pres-total-dto">
                        <span className="pres-total-label">
                          Descuento ({Number(detalle.descuento_pct)}%)
                          {detalle.descuento_motivo && <em className="pres-dto-motivo"> · {detalle.descuento_motivo}</em>}
                        </span>
                        <span className="pres-total-valor">
                          −{usd(Number(detalle.coste_instalacion_usd) - Number(detalle.total_final_usd))}
                        </span>
                      </div>
                    )}
                    <div className="pres-total-final">
                      <span className="pres-total-label">Total a pagar una vez</span>
                      <span className="pres-total-valor">{usd(detalle.total_final_usd ?? detalle.coste_instalacion_usd)}</span>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
