'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Download, Eye, Pencil, Trash2, X } from 'lucide-react'
import { RowActions } from '@/components/portal/RowActions'
import PresupuestoPdfMenu from '@/components/admin/PresupuestoPdfMenu'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { useToast, toastTono } from '@/app/contexts/ToastContext'
import {
  obtenerPresupuesto,
  aprobarPresupuesto,
  eliminarPresupuesto,
  actualizarHorasReales,
  type PresupuestoRow,
} from '@/app/actions/presupuestos'
import { descargarPresupuesto } from '@/lib/pdf/presupuesto'
import { importeCiclo } from '@/lib/billing'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detalle = Record<string, any>
type DesgloseFase = { fase: string; horas: number; subtotalUsd: number }
type Revision = { linea: string; motivo: string }
type ModuloCatalogo = { clave: string; nombre: string; precio_fundador_usd: number; precio_estandar_usd: number }

const usd = (n: number) => `$${Number(n ?? 0).toFixed(2)}`

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

function EstadoBadge({ estado }: { estado: string }) {
  if (estado === 'aprobado')  return <span className="badge badge-success">Aprobado</span>
  if (estado === 'instalado') return <span className="badge badge-purple">Instalado</span>
  return <span className="badge badge-info">Guardado</span>
}

export default function PresupuestosClienteTabla({
  presupuestos,
  catalogo,
  descuentoAnualPct,
}: {
  presupuestos: PresupuestoRow[]
  catalogo: ModuloCatalogo[]
  descuentoAnualPct: number
}) {
  const { error: toastError, success: toastSuccess } = useToast()
  const router = useRouter()
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [cargando, setCargando] = useState(false)
  const [aprobando, setAprobando] = useState(false)
  const [horasReales, setHorasReales] = useState('')
  const [horasRealesOriginales, setHorasRealesOriginales] = useState('')
  const [guardando, setGuardando] = useState(false)
  // El borrador que se está confirmando para borrar: el estado vive en el padre,
  // no en la fila ni en el menú (que se desmonta al pulsar y se lo llevaría).
  const [borrar, setBorrar]     = useState<PresupuestoRow | null>(null)
  const [borrando, setBorrando] = useState(false)

  async function abrir(id: number) {
    setCargando(true)
    const d = await obtenerPresupuesto(id)
    setCargando(false)
    if (!d) { toastError('No se pudo cargar el presupuesto'); return }
    setHorasReales(d.horas_reales != null ? String(d.horas_reales) : '')
    setHorasRealesOriginales(d.horas_reales != null ? String(d.horas_reales) : '')
    setDetalle(d)
  }

  async function descargarPdf(incluir: 'todo' | 'instalacion' | 'suscripcion') {
    if (!detalle) return
    const claves: string[] = Array.isArray(detalle.modulos) ? detalle.modulos : []
    const campo = detalle.tarifa === 'fundador' ? 'precio_fundador_usd' : 'precio_estandar_usd'
    const mods = catalogo
      .filter(m => claves.includes(m.clave))
      .map(m => ({ nombre: m.nombre, precio: Number(m[campo]) || 0 }))
    const mensual = Number(detalle.cuota_mensual_usd ?? 0)
    try {
      await descargarPresupuesto({
        numero: `PRE-${String(detalle.id).padStart(4, '0')}`,
        fecha: fmtFecha(detalle.created_at),
        negocio: detalle.nombre_negocio ?? '',
        responsable: detalle.nombre_responsable,
        contacto: detalle.contacto,
        desglose,
        horasTotal: Number(detalle.horas_total ?? 0),
        tarifaHora: Number(detalle.tarifa_hora_usd ?? 0),
        costeInstalacion: Number(detalle.coste_instalacion_usd ?? 0),
        descuentoPct: Number(detalle.descuento_pct ?? 0),
        totalInstalacion: Number(detalle.total_final_usd ?? detalle.coste_instalacion_usd ?? 0),
        modulos: mods,
        cuotaMensual: mensual,
        cuotaAnual: importeCiclo(mensual, 'anual', descuentoAnualPct),
        descuentoAnualPct,
        incluir,
      }, `PRE-${String(detalle.id).padStart(4, '0')}${incluir === 'todo' ? '' : `-${incluir}`}.pdf`)
    } catch {
      toastError('No se pudo generar el PDF.')
    }
  }

  async function aprobar(id: number, aprobado: boolean) {
    if (aprobando) return
    setAprobando(true)
    const r = await aprobarPresupuesto(id, aprobado)
    setAprobando(false)
    if (!r.ok) { toastError(r.error ?? 'No se pudo guardar'); return }
    toastSuccess(aprobado ? 'Presupuesto aprobado' : 'Aprobación retirada')
    // Aprobar mueve el cobro de configuración de este cliente: se dice aquí mismo,
    // que es donde se está mirando su historial de pagos.
    if (r.aviso) toastTono(r.avisoTono ?? 'info', r.aviso)
    router.refresh()
  }

  async function borrarPresupuesto() {
    if (!borrar) return
    setBorrando(true)
    const r = await eliminarPresupuesto(borrar.id)
    setBorrando(false)
    if (!r.ok) { toastError(r.error ?? 'No se pudo eliminar'); return }
    toastSuccess(r.yaEliminado ? 'El presupuesto ya no existía; lista actualizada' : 'Borrador eliminado')
    setBorrar(null)
    router.refresh()
  }

  async function guardarHoras() {
    if (!detalle) return
    setGuardando(true)
    const val = horasReales.trim() === '' ? null : parseFloat(horasReales.replace(',', '.'))
    const r = await actualizarHorasReales(detalle.id, val)
    setGuardando(false)
    if (!r.ok) { toastError(r.error ?? 'No se pudo guardar'); return }
    toastSuccess('Horas reales guardadas')
    setDetalle(null)
    router.refresh()
  }

  const desglose: DesgloseFase[] = Array.isArray(detalle?.desglose) ? detalle!.desglose : []
  const revisiones: Revision[] = Array.isArray(detalle?.revisiones) ? detalle!.revisiones : []
  const horasHanCambiado = horasReales !== horasRealesOriginales
  // La acción principal la fija el ESTADO. «Guardar» va aparte y SIEMPRE en primary
  // (conviven), pero sí empuja al PDF a secundario. Aquí ya estamos DENTRO del
  // cliente, así que aprobado no ofrece «crear cliente».
  const accionPrincipal =
    detalle?.estado === 'guardado' ? 'aprobar'
    : horasHanCambiado             ? 'horas'
    : 'pdf'

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
              <th className="col-actions" />
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
                  <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => abrir(p.id)}>
                          <Eye size={15} strokeWidth={2} /> Ver detalles
                        </button>
                        {/* Editar y eliminar solo en borrador: aprobado es la prueba de
                            lo pactado e instalado ya tiene horas reales detrás. */}
                        {p.estado === 'guardado' && (
                          <Link href={`/admin/presupuestos/${p.id}/editar`} className="row-actions-item">
                            <Pencil size={15} strokeWidth={2} /> Editar
                          </Link>
                        )}
                        {p.estado !== 'instalado' && (
                          p.estado === 'aprobado'
                            ? <button className="row-actions-item" onClick={() => aprobar(p.id, false)}>
                                <X size={15} strokeWidth={2} /> Quitar aprobación
                              </button>
                            : <button className="row-actions-item" onClick={() => aprobar(p.id, true)}>
                                <Check size={15} strokeWidth={2} /> Aprobar
                              </button>
                        )}
                        {p.estado === 'guardado' && (
                          <button
                            className="row-actions-item row-actions-item-danger"
                            onClick={() => setBorrar(p)}
                          >
                            <Trash2 size={14} strokeWidth={2} /> Eliminar
                          </button>
                        )}
                    </RowActions>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {borrar && (
        <ConfirmDialog
          title={`¿Eliminar el borrador de ${borrar.nombre_negocio}?`}
          body={<>
            Se borra el presupuesto de <strong>{usd(borrar.total_final_usd ?? borrar.coste_instalacion_usd)}</strong>{' '}
            de instalación ({borrar.horas_total}h) guardado el {fmtFecha(borrar.created_at)}. No se puede deshacer.
          </>}
          confirmLabel="Eliminar"
          pendingLabel="Eliminando…"
          danger
          pending={borrando}
          onConfirm={borrarPresupuesto}
          onCancel={() => setBorrar(null)}
        />
      )}

      {(detalle || cargando) && (
        <div className="modal-backdrop">
          <div className="modal modal-640 modal-fixed-actions" onClick={e => e.stopPropagation()}>
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
                  <div className="input-group pres-horas-reales">
                    <label htmlFor="cliente-horas-reales">Horas reales de la instalación</label>
                    <input id="cliente-horas-reales" type="number" min="0" step="0.5" className="input" value={horasReales} onChange={e => setHorasReales(e.target.value)} placeholder="Completar al cerrar la instalación" />
                  </div>
                </div>
                {/* Orden por importancia: lo secundario a la izquierda, la acción principal
                    la última (a la derecha en escritorio; arriba en móvil, que invierte la
                    columna). Sin «Cerrar»: para eso está la ✕ de la cabecera. */}
                <div className="modal-footer">
                  <PresupuestoPdfMenu
                    nombre={detalle.nombre_negocio}
                    destacado={accionPrincipal === 'pdf'}
                    onDownload={descargarPdf}
                  >
                    <Download size={16} strokeWidth={2} /> Descargar PDF
                  </PresupuestoPdfMenu>
                  {detalle.estado === 'aprobado' && (
                    <button type="button" className="btn btn-secondary" disabled={aprobando} onClick={() => aprobar(detalle.id, false)}>
                      <X size={16} strokeWidth={2} /> Quitar aprobación
                    </button>
                  )}
                  {detalle.estado === 'guardado' && (
                    <>
                      <Link href={`/admin/presupuestos/${detalle.id}/editar`} className="btn btn-secondary">
                        <Pencil size={16} strokeWidth={2} /> Editar
                      </Link>
                      <button
                        type="button"
                        className={accionPrincipal === 'aprobar' ? 'btn btn-primary' : 'btn btn-secondary'}
                        disabled={aprobando}
                        onClick={() => aprobar(detalle.id, true)}
                      >
                        <Check size={16} strokeWidth={2} /> Aprobar
                      </button>
                    </>
                  )}
                  {horasHanCambiado && (
                    <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardarHoras}>
                      {guardando ? <><span className="spinner" /> Guardando...</> : 'Guardar'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
