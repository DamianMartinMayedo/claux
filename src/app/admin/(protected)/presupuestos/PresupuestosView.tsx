'use client'

import { Eye, FileText, Plus, X } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RowActions } from '@/components/portal/RowActions'
import { useToast } from '@/app/contexts/ToastContext'
import {
  obtenerPresupuesto,
  actualizarHorasReales,
  type PresupuestoRow,
} from '@/app/actions/presupuestos'

type DesgloseFase = { fase: string; horas: number; subtotalUsd: number; detalle?: string }
type Revision = { linea: string; motivo: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detalle = Record<string, any>

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}
const usd = (n: number) => `$${Number(n ?? 0).toFixed(2)}`

export default function PresupuestosView({ presupuestos }: { presupuestos: PresupuestoRow[] }) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [cargando, setCargando] = useState(false)
  const [horasReales, setHorasReales] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function abrir(id: number) {
    setCargando(true)
    const d = await obtenerPresupuesto(id)
    setCargando(false)
    if (!d) { toastError('No se pudo cargar el presupuesto'); return }
    setDetalle(d)
    setHorasReales(d.horas_reales != null ? String(d.horas_reales) : '')
  }

  async function guardarHoras() {
    if (!detalle) return
    setGuardando(true)
    const val = horasReales.trim() === '' ? null : parseFloat(horasReales)
    const r = await actualizarHorasReales(detalle.id, val)
    setGuardando(false)
    if (!r.ok) { toastError(r.error ?? 'Error al guardar'); return }
    toastSuccess('Horas reales guardadas')
    setDetalle({ ...detalle, horas_reales: val, estado: val != null ? 'instalado' : 'guardado' })
    router.refresh()
  }

  const desglose: DesgloseFase[] = Array.isArray(detalle?.desglose) ? detalle!.desglose : []
  const revisiones: Revision[] = Array.isArray(detalle?.revisiones) ? detalle!.revisiones : []

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Presupuestos de instalación</h1>
          <p className="page-subtitle">{presupuestos.length} guardado{presupuestos.length !== 1 ? 's' : ''}.</p>
        </div>
        <Link href="/admin/presupuestos/nuevo" className="btn btn-primary">
          <Plus size={16} /> Nuevo presupuesto
        </Link>
      </div>

      {presupuestos.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <FileText size={40} strokeWidth={1.5} />
            <h3 className="table-empty-title">Sin presupuestos</h3>
            <p>Calcula el primero con el botón de arriba.</p>
          </div>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Negocio</th>
                  <th>Comercial</th>
                  <th className="col-center">Horas est.</th>
                  <th className="col-num">Instalación</th>
                  <th className="col-num">Cuota/mes</th>
                  <th className="col-center">Reales</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {presupuestos.map(p => (
                  <tr key={p.id} className="table-row-clickable" onClick={() => abrir(p.id)}>
                    <td data-label="Fecha" className="table-muted">{fmtFecha(p.created_at)}</td>
                    <td data-label="Negocio">{p.nombre_negocio}</td>
                    <td data-label="Comercial" className="table-muted">{p.comercial_nombre ?? '—'}</td>
                    <td data-label="Horas est." className="col-center">{p.horas_total}</td>
                    <td data-label="Instalación" className="col-num">{usd(p.coste_instalacion_usd)}</td>
                    <td data-label="Cuota/mes" className="col-num">{usd(p.cuota_mensual_usd)}</td>
                    <td data-label="Reales" className="col-center">{p.horas_reales ?? '—'}</td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => abrir(p.id)}>
                          <Eye size={15} strokeWidth={2} /> Ver detalles
                        </button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(detalle || cargando) && (
        <div className="modal-backdrop" onClick={() => !guardando && setDetalle(null)}>
          <div className="modal modal-560" onClick={e => e.stopPropagation()}>
            {cargando || !detalle ? (
              <div className="modal-body"><p className="text-sm-muted"><span className="spinner" /> Cargando…</p></div>
            ) : (
              <>
                <div className="modal-header">
                  <h2 className="modal-title">{detalle.nombre_negocio}</h2>
                  <button onClick={() => setDetalle(null)} className="modal-close" aria-label="Cerrar">
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-body">
                  <div className="sol-detalle">
                    <div className="sol-row"><span className="sol-label">Comercial</span><span className="sol-value">{detalle.comercial_nombre ?? '—'}</span></div>
                    <div className="sol-row"><span className="sol-label">Responsable</span><span className="sol-value">{detalle.nombre_responsable ?? '—'}</span></div>
                    <div className="sol-row"><span className="sol-label">Contacto</span><span className="sol-value">{detalle.contacto ?? '—'}</span></div>
                    <div className="sol-row"><span className="sol-label">Tarifa</span><span className="sol-value">{detalle.tarifa === 'fundador' ? 'Fundador' : 'Estándar'}</span></div>
                    <div className="sol-row"><span className="sol-label">Módulos</span><span className="sol-value">{(detalle.modulos ?? []).join(', ') || '—'}</span></div>
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
                    <div><span className="pres-total-label">Horas totales</span><span className="pres-total-valor">{detalle.horas_total}h</span></div>
                    <div><span className="pres-total-label">Coste instalación</span><span className="pres-total-valor">{usd(detalle.coste_instalacion_usd)}</span></div>
                    <div><span className="pres-total-label">Cuota mensual</span><span className="pres-total-valor">{usd(detalle.cuota_mensual_usd)}</span></div>
                  </div>

                  <div className="input-group">
                    <label htmlFor="horas-reales">Horas reales de la instalación</label>
                    <input id="horas-reales" type="number" min="0" step="0.5" className="input"
                      value={horasReales} onChange={e => setHorasReales(e.target.value)}
                      placeholder="Completar al cerrar la instalación" />
                    <span className="input-hint">Permite comparar estimado vs. real para afinar tarifas/límites.</span>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
                  <button className="btn btn-primary" disabled={guardando} onClick={guardarHoras}>
                    {guardando ? <><span className="spinner" /> Guardando...</> : 'Guardar horas reales'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
