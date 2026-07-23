'use client'

import { Check, Eye, FileText, Plus, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RowActions } from '@/components/portal/RowActions'
import { usePagination, TablePagination } from '@/components/TablePagination'
import VentasTabs from '@/components/admin/VentasTabs'
import { useToast } from '@/app/contexts/ToastContext'
import ClienteFormModal, {
  type ModuloCatalogo,
  type PlantillaSector,
  type InitialCliente,
} from '../clientes/ClienteFormModal'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import {
  obtenerPresupuesto,
  actualizarHorasReales,
  aprobarPresupuesto,
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
    pago_setup_usd:  Number(d.coste_instalacion_usd ?? 0),
  }
}

export default function PresupuestosView({
  presupuestos,
  rol,
  permisos,
  catalogo,
  plantillas,
  setupDefault,
  descuentoAnualPct,
}: {
  presupuestos: PresupuestoRow[]
  rol: RolAdmin
  permisos: SeccionKey[]
  catalogo: ModuloCatalogo[]
  plantillas: PlantillaSector[]
  setupDefault: number
  descuentoAnualPct: number
}) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [cargando, setCargando] = useState(false)
  const [horasReales, setHorasReales] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [aprobando, setAprobando] = useState(false)

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

  async function aprobar(id: number, aprobado: boolean) {
    setAprobando(true)
    const r = await aprobarPresupuesto(id, aprobado)
    setAprobando(false)
    if (!r.ok) { toastError(r.error ?? 'Error al guardar'); return }
    toastSuccess(aprobado ? 'Presupuesto aprobado' : 'Aprobación retirada')
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
                    <td data-label="Instalación" className="col-num">{usd(p.coste_instalacion_usd)}</td>
                    <td data-label="Cuota/mes" className="col-num">{usd(p.cuota_mensual_usd)}</td>
                    <td data-label="Reales" className="col-center">{p.horas_reales ?? '—'}</td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => abrir(p.id)}>
                          <Eye size={15} strokeWidth={2} /> Ver detalles
                        </button>
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

                  <div className="pres-totales">
                    <div><span className="pres-total-label">Horas totales</span><span className="pres-total-valor">{detalle.horas_total}h</span></div>
                    <div><span className="pres-total-label">Coste instalación</span><span className="pres-total-valor">{usd(detalle.coste_instalacion_usd)}</span></div>
                    <div><span className="pres-total-label">Cuota mensual</span><span className="pres-total-valor">{usd(detalle.cuota_mensual_usd)}</span></div>
                  </div>

                  {/* Acciones de venta: aprobar y convertir en cliente (no aplica si ya está instalado) */}
                  {detalle.estado !== 'instalado' && (
                    <div className="pres-acciones-cierre">
                      {detalle.estado === 'aprobado' ? (
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
                      ) : (
                        <button className="btn btn-success btn-sm" disabled={aprobando} onClick={() => aprobar(detalle.id, true)}>
                          {aprobando ? <><span className="spinner" /> …</> : <><Check size={15} strokeWidth={2} /> Aprobar presupuesto</>}
                        </button>
                      )}
                    </div>
                  )}

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

      <ClienteFormModal
        open={clienteOpen}
        onClose={() => setClienteOpen(false)}
        catalogo={catalogo}
        plantillas={plantillas}
        setupDefault={setupDefault}
        descuentoAnualPct={descuentoAnualPct}
        initial={clienteInitial}
        presupuestoId={clientePresupuestoId}
      />
    </div>
  )
}
