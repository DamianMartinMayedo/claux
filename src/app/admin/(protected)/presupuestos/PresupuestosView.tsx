'use client'

import { Check, Eye, FileText, Pencil, Plus, Trash2, UserPlus, X, Download } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RowActions } from '@/components/portal/RowActions'
import PresupuestoPdfMenu from '@/components/admin/PresupuestoPdfMenu'
import { ConfirmDialog } from '@/components/portal/Dialog'
import FormHelp from '@/components/portal/FormHelp'
import { usePagination, TablePagination } from '@/components/TablePagination'
import VentasTabs from '@/components/admin/VentasTabs'
import { useToast, toastTono } from '@/app/contexts/ToastContext'
import ClienteFormModal, {
  type ModuloCatalogo,
  type PlantillaSector,
  type InitialCliente,
} from '../clientes/ClienteFormModal'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import { descargarPresupuesto } from '@/lib/pdf/presupuesto'
import { importeCiclo } from '@/lib/billing'
import {
  obtenerPresupuesto,
  actualizarHorasReales,
  aprobarPresupuesto,
  eliminarPresupuesto,
  type PresupuestoRow,
} from '@/app/actions/presupuestos'

type DesgloseFase = { fase: string; horas: number; subtotalUsd: number; detalle?: string }
type Revision = { linea: string; motivo: string }
type Filtro = 'todos' | 'guardado' | 'aprobado' | 'instalado'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detalle = Record<string, any>

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}
const usd = (n: number) => `$${Number(n ?? 0).toFixed(2)}`

function EstadoBadge({ estado }: { estado: string }) {
  if (estado === 'aprobado')  return <span className="badge badge-success">Aprobado</span>
  if (estado === 'instalado') return <span className="badge badge-purple">Instalado</span>
  return <span className="badge badge-info">Guardado</span>
}

// Precarga del alta de cliente a partir del presupuesto. El correo (contacto
// principal) y el sector vienen del diagnóstico de origen; si no hay diagnóstico
// (presupuesto manual) se cae al `contacto` cuando parece un email. Los módulos y
// la tarifa vienen del presupuesto, y el pago de configuración = coste calculado.
function initialDesde(d: Detalle): InitialCliente {
  const diag = d.diagnosticos ?? null
  const contacto = String(d.contacto ?? '').trim()
  const email = String(diag?.email ?? '').trim() || (contacto.includes('@') ? contacto : '')
  return {
    nombre_empresa:  d.nombre_negocio ?? '',
    nombre_contacto: d.nombre_responsable ?? '',
    email_admin:     email,
    sector:          diag?.sector ?? '',
    tarifa:          d.tarifa === 'fundador' ? 'fundador' : 'estandar',
    modulos:         Array.isArray(d.modulos) ? d.modulos : [],
    // Lo que se cobra es el total tras el descuento, no el coste bruto: cobrar el bruto
    // sería no aplicar lo que se le prometió al cliente.
    pago_setup_usd:  Number(d.total_final_usd ?? d.coste_instalacion_usd ?? 0),
  }
}

export default function PresupuestosView({
  presupuestos,
  rol,
  permisos,
  catalogo,
  plantillas,
  descuentoAnualPct,
}: {
  presupuestos: PresupuestoRow[]
  rol: RolAdmin
  permisos: SeccionKey[]
  catalogo: ModuloCatalogo[]
  plantillas: PlantillaSector[]
  descuentoAnualPct: number
}) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  const [filtro, setFiltro] = useState<Filtro>('todos')

  /**
   * El presupuesto en PDF, con la misma plantilla de marca que la factura.
   *
   * Se arma desde el SNAPSHOT guardado (`desglose`, `tarifa_hora_usd`, `descuento_*`), no
   * recalculando: un presupuesto enseñado al cliente hace tres meses tiene que imprimirse tal
   * como se le enseñó, aunque la tarifa base haya subido desde entonces.
   */
  async function descargarPdf(d: Detalle, incluir: 'todo' | 'instalacion' | 'suscripcion') {
    const claves: string[] = Array.isArray(d.modulos) ? d.modulos : []
    const campo = d.tarifa === 'fundador' ? 'precio_fundador_usd' : 'precio_estandar_usd'
    const mods = catalogo
      .filter(m => claves.includes(m.clave))
      .map(m => ({ nombre: m.nombre, precio: Number((m as unknown as Record<string, unknown>)[campo] ?? 0) }))
    const mensual = Number(d.cuota_mensual_usd ?? 0)
    try {
      await descargarPresupuesto({
        numero:  `PRE-${String(d.id).padStart(4, '0')}`,
        fecha:   fmtFecha(d.created_at),
        negocio: d.nombre_negocio ?? '',
        responsable: d.nombre_responsable,
        contacto:    d.contacto,
        desglose:    Array.isArray(d.desglose) ? d.desglose : [],
        horasTotal:  Number(d.horas_total ?? 0),
        tarifaHora:  Number(d.tarifa_hora_usd ?? 0),
        costeInstalacion: Number(d.coste_instalacion_usd ?? 0),
        descuentoPct:     Number(d.descuento_pct ?? 0),
        totalInstalacion: Number(d.total_final_usd ?? d.coste_instalacion_usd ?? 0),
        modulos:      mods,
        cuotaMensual: mensual,
        cuotaAnual:   importeCiclo(mensual, 'anual', descuentoAnualPct),
        descuentoAnualPct,
        incluir,
      }, `PRE-${String(d.id).padStart(4, '0')}${incluir === 'todo' ? '' : `-${incluir}`}.pdf`)
    } catch {
      toastError('No se pudo generar el PDF.')
    }
  }
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [cargando, setCargando] = useState(false)
  const [horasReales, setHorasReales] = useState('')
  const [horasRealesOriginales, setHorasRealesOriginales] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [aprobando, setAprobando] = useState(false)
  // El borrador que se está confirmando para borrar: el estado vive aquí, no en la
  // fila ni en el menú (que se desmonta al pulsar y se llevaría el diálogo con él).
  const [borrar, setBorrar]   = useState<PresupuestoRow | null>(null)
  const [borrando, setBorrando] = useState(false)

  // Alta de cliente desde un presupuesto aprobado (modal compartido).
  const [clienteOpen, setClienteOpen] = useState(false)
  const [clienteInitial, setClienteInitial] = useState<InitialCliente | undefined>(undefined)
  const [clientePresupuestoId, setClientePresupuestoId] = useState<number | undefined>(undefined)

  const visibles = presupuestos.filter(p => filtro === 'todos' || p.estado === filtro)
  const nAprobados = presupuestos.filter(p => p.estado === 'aprobado').length
  const { pageItems, ...pag } = usePagination(visibles)

  const FILTROS: { k: Filtro; label: string }[] = [
    { k: 'todos',     label: 'Todos' },
    { k: 'guardado',  label: 'Guardados' },
    { k: 'aprobado',  label: 'Aprobados' },
    { k: 'instalado', label: 'Instalados' },
  ]

  async function abrir(id: number) {
    setCargando(true)
    const d = await obtenerPresupuesto(id)
    setCargando(false)
    if (!d) { toastError('No se pudo cargar el presupuesto'); return }
    setDetalle(d)
    setHorasReales(d.horas_reales != null ? String(d.horas_reales) : '')
    setHorasRealesOriginales(d.horas_reales != null ? String(d.horas_reales) : '')
  }

  async function guardarHoras() {
    if (!detalle) return
    setGuardando(true)
    const val = horasReales.trim() === '' ? null : parseFloat(horasReales)
    const r = await actualizarHorasReales(detalle.id, val)
    setGuardando(false)
    if (!r.ok) { toastError(r.error ?? 'Error al guardar'); return }
    toastSuccess('Horas reales guardadas')
    setDetalle(null)
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

  async function aprobar(id: number, aprobado: boolean) {
    setAprobando(true)
    const r = await aprobarPresupuesto(id, aprobado)
    setAprobando(false)
    if (!r.ok) { toastError(r.error ?? 'Error al guardar'); return }
    toastSuccess(aprobado ? 'Presupuesto aprobado' : 'Aprobación retirada')
    // Aprobar mueve el cobro de configuración (crearlo, ajustarlo o retirarlo).
    // Si ya estaba confirmado no se toca y el aviso llega en tono de advertencia.
    if (r.aviso) toastTono(r.avisoTono ?? 'info', r.aviso)
    if (detalle?.id === id) setDetalle({ ...detalle, estado: aprobado ? 'aprobado' : 'guardado' })
    router.refresh()
  }

  function abrirClienteConDetalle(d: Detalle) {
    setClienteInitial(initialDesde(d))
    setClientePresupuestoId(d.id)
    setDetalle(null)
    setClienteOpen(true)
  }

  async function abrirCrearClienteRow(id: number) {
    const d = await obtenerPresupuesto(id)
    if (!d) { toastError('No se pudo cargar el presupuesto'); return }
    abrirClienteConDetalle(d)
  }

  const desglose: DesgloseFase[] = Array.isArray(detalle?.desglose) ? detalle!.desglose : []
  const revisiones: Revision[] = Array.isArray(detalle?.revisiones) ? detalle!.revisiones : []
  const horasHanCambiado = horasReales !== horasRealesOriginales

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Presupuestos de instalación</h1>
          <p className="page-subtitle">
            {presupuestos.length} guardado{presupuestos.length !== 1 ? 's' : ''} · {nAprobados} aprobado{nAprobados !== 1 ? 's' : ''}.
          </p>
        </div>
        <Link href="/admin/presupuestos/nuevo" className="btn btn-primary">
          <Plus size={16} /> Nuevo presupuesto
        </Link>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />

      <div className="ter-toolbar">
        {FILTROS.map(f => (
          <button
            key={f.k}
            className={`btn btn-sm ${filtro === f.k ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFiltro(f.k)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <FileText size={40} strokeWidth={1.5} />
            <h3 className="table-empty-title">Sin presupuestos</h3>
            <p>{filtro === 'todos' ? 'Calcula el primero con el botón de arriba.' : 'No hay presupuestos en este estado.'}</p>
          </div>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Estado</th>
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
                {pageItems.map(p => (
                  <tr key={p.id} className="table-row-clickable" onClick={() => abrir(p.id)}>
                    <td data-label="Estado"><EstadoBadge estado={p.estado} /></td>
                    <td data-label="Fecha" className="table-muted">{fmtFecha(p.created_at)}</td>
                    <td data-label="Negocio">{p.nombre_negocio}</td>
                    <td data-label="Comercial" className="table-muted">{p.comercial_nombre ?? '—'}</td>
                    <td data-label="Horas est." className="col-center">{p.horas_total}</td>
                    <td data-label="Instalación" className="col-num">{usd(p.total_final_usd ?? p.coste_instalacion_usd)}</td>
                    <td data-label="Cuota/mes" className="col-num">{usd(p.cuota_mensual_usd)}</td>
                    <td data-label="Reales" className="col-center">{p.horas_reales ?? '—'}</td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => abrir(p.id)}>
                          <Eye size={15} strokeWidth={2} /> Ver detalles
                        </button>
                        {/* Editar solo en borrador: aprobado/instalado son foto congelada. */}
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
                        {p.estado === 'aprobado' && !p.client_id && (
                          <button className="row-actions-item" onClick={() => abrirCrearClienteRow(p.id)}>
                            <UserPlus size={15} strokeWidth={2} /> Crear cliente
                          </button>
                        )}
                        {p.client_id && (
                          <Link href={`/admin/clientes/${p.client_id}`} className="row-actions-item">
                            <UserPlus size={15} strokeWidth={2} /> Ver cliente {p.client_id}
                          </Link>
                        )}
                        {/* Eliminar solo el borrador: un presupuesto que se hizo por
                            error no debería quedarse compitiendo por ser «el» del cliente. */}
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
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} label="presupuesto" />
        </div>
      )}

      {(detalle || cargando) && (
        <div className="modal-backdrop">
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

                  {/* Dos precios, dos bloques: el pago único y lo recurrente no se suman. */}
                  <div className="pres-totales">
                    <p className="pres-bloque-titulo">Pago único · Instalación</p>
                    <div><span className="pres-total-label">Horas totales</span><span className="pres-total-valor">{detalle.horas_total}h</span></div>
                    {/* La tarifa que se aplicó, no la vigente: un presupuesto de hace tres
                        meses tiene que seguir explicando su propio número. */}
                    {Number(detalle.tarifa_hora_usd) > 0 && (
                      <div><span className="pres-total-label">Tarifa aplicada</span><span className="pres-total-valor">{usd(detalle.tarifa_hora_usd)}/h</span></div>
                    )}
                    <div><span className="pres-total-label">Coste instalación</span><span className="pres-total-valor">{usd(detalle.coste_instalacion_usd)}</span></div>
                    {Number(detalle.descuento_pct) > 0 && (
                      <>
                        <div className="pres-total-dto">
                          <span className="pres-total-label">
                            Descuento ({Number(detalle.descuento_pct)}%)
                            {detalle.descuento_motivo && <em className="pres-dto-motivo"> · {detalle.descuento_motivo}</em>}
                          </span>
                          <span className="pres-total-valor">
                            −{usd(Number(detalle.coste_instalacion_usd) - Number(detalle.total_final_usd))}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="pres-total-final">
                      <span className="pres-total-label">Total a pagar una vez</span>
                      <span className="pres-total-valor">{usd(detalle.total_final_usd ?? detalle.coste_instalacion_usd)}</span>
                    </div>
                  </div>

                  <div className="pres-totales">
                    <p className="pres-bloque-titulo">Suscripción</p>
                    <div className="pres-total-final">
                      <span className="pres-total-label">Cada mes</span>
                      <span className="pres-total-valor">{usd(detalle.cuota_mensual_usd)}</span>
                    </div>
                    {Number(detalle.cuota_mensual_usd) > 0 && (
                      <div>
                        <span className="pres-total-label">Pagando por año (−{descuentoAnualPct}%)</span>
                        <span className="pres-total-valor">
                          {usd(importeCiclo(Number(detalle.cuota_mensual_usd), 'anual', descuentoAnualPct))}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="input-group">
                    <div className="form-label-with-help">
                      <label htmlFor="horas-reales">Horas reales de la instalación</label>
                      <FormHelp text="Permite comparar estimado vs. real para afinar tarifas/límites." label="Para qué sirven las horas reales" />
                    </div>
                    <input id="horas-reales" type="number" min="0" step="0.5" className="input"
                      value={horasReales} onChange={e => setHorasReales(e.target.value)}
                      placeholder="Completar al cerrar la instalación" />
                  </div>
                  <div className="pres-modal-actions">
                    <PresupuestoPdfMenu nombre={detalle.nombre_negocio} onDownload={tipo => descargarPdf(detalle, tipo)}>
                      <Download size={14} strokeWidth={2} /> Descargar PDF
                    </PresupuestoPdfMenu>
                    {detalle.estado === 'guardado' && (
                      <>
                        <Link href={`/admin/presupuestos/${detalle.id}/editar`} className="btn btn-secondary btn-sm">
                          <Pencil size={15} strokeWidth={2} /> Editar
                        </Link>
                        <button className="btn btn-primary btn-sm" disabled={aprobando} onClick={() => aprobar(detalle.id, true)}>
                          {aprobando ? <><span className="spinner" /> …</> : <><Check size={15} strokeWidth={2} /> Aprobar presupuesto</>}
                        </button>
                      </>
                    )}
                    {detalle.estado === 'aprobado' && (
                      <>
                        {detalle.client_id ? (
                          <Link href={`/admin/clientes/${detalle.client_id}`} className="btn btn-primary btn-sm">
                            <UserPlus size={15} strokeWidth={2} /> Ver cliente {detalle.client_id}
                          </Link>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => abrirClienteConDetalle(detalle)}>
                            <UserPlus size={15} strokeWidth={2} /> Crear cliente
                          </button>
                        )}
                        <button className="btn btn-secondary btn-sm" disabled={aprobando} onClick={() => aprobar(detalle.id, false)}>
                          {aprobando ? <><span className="spinner" /> …</> : <><X size={15} strokeWidth={2} /> Quitar aprobación</>}
                        </button>
                      </>
                    )}
                    {horasHanCambiado && <button className="btn btn-secondary btn-sm" disabled={guardando} onClick={guardarHoras}>
                      {guardando ? <><span className="spinner" /> Guardando...</> : 'Guardar horas reales'}
                    </button>}
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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

      <ClienteFormModal
        open={clienteOpen}
        onClose={() => setClienteOpen(false)}
        catalogo={catalogo}
        plantillas={plantillas}
        descuentoAnualPct={descuentoAnualPct}
        initial={clienteInitial}
        presupuestoId={clientePresupuestoId}
      />
    </div>
  )
}
