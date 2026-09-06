'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Download, Eye, Pencil, Trash2, X } from 'lucide-react'
import { RowActions } from '@/components/portal/RowActions'
import PresupuestoPdfMenu from '@/components/admin/PresupuestoPdfMenu'
import { ConfirmDialog } from '@/components/portal/Dialog'
import ModalShell from '@/components/portal/ModalShell'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
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
import { normalizarNivel, precioModulo, type Nivel, type ModuloPrecios } from '@/lib/niveles'
import { claveOrdenImporte, importeClaux, normalizarMonedaClaux } from '@/lib/moneda-claux'
import { numeroPresupuesto } from '@/lib/presupuesto/config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detalle = Record<string, any>
type DesgloseFase = { fase: string; horas: number; subtotal: number }
type Revision = { linea: string; motivo: string }
export type ModuloCatalogo = ModuloPrecios & { nombre: string }

// La moneda la trae CADA presupuesto, no el cliente: uno de hace medio año en
// dólares se lee en dólares aunque hoy se le facture en euros. Ese es justo el
// punto de guardarla en la fila (mig. 225).
const imp = (n: number, moneda: unknown) => importeClaux(n, moneda)

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

function EstadoBadge({ estado }: { estado: string }) {
  if (estado === 'aprobado')  return <span className="badge badge-success">Aprobado</span>
  if (estado === 'instalado') return <span className="badge badge-purple">Instalado</span>
  return <span className="badge badge-info">Guardado</span>
}

/** Guardado → aprobado → instalado: el orden del ciclo, no el alfabético. */
const ESTADO_PRIORIDAD: Record<string, number> = { guardado: 0, aprobado: 1, instalado: 2 }

const COLUMNAS: ColumnasOrden<PresupuestoRow> = {
  fecha:       { label: 'Fecha',       valor: p => p.created_at },
  estado:      { label: 'Estado',      valor: p => ESTADO_PRIORIDAD[p.estado] ?? 9 },
  horas:       { label: 'Horas',       valor: p => p.horas_total },
  reales:      { label: 'Reales',      valor: p => p.horas_reales },
  instalacion: { label: 'Instalación', valor: p => claveOrdenImporte(p.total_final ?? p.coste_instalacion, p.moneda) },
}

export default function PresupuestosClienteTabla({
  presupuestos,
  catalogo,
  nombresNivel,
  descuentoAnualPct,
}: {
  presupuestos: PresupuestoRow[]
  catalogo: ModuloCatalogo[]
  nombresNivel: Record<Nivel, string>
  descuentoAnualPct: number
}) {
  const { error: toastError, success: toastSuccess } = useToast()
  const router = useRouter()
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  // Lleva la FILA, no un booleano: el modal abre al instante y ya con el nombre del
  // negocio en la cabecera, en vez de un recuadro anónimo mientras llega el detalle.
  const [cargando, setCargando] = useState<PresupuestoRow | null>(null)
  const [aprobando, setAprobando] = useState(false)
  const [horasReales, setHorasReales] = useState('')
  const [horasRealesOriginales, setHorasRealesOriginales] = useState('')
  const [guardando, setGuardando] = useState(false)
  // El borrador que se está confirmando para borrar: el estado vive en el padre,
  // no en la fila ni en el menú (que se desmonta al pulsar y se lo llevaría).
  const [borrar, setBorrar]     = useState<PresupuestoRow | null>(null)
  const [borrando, setBorrando] = useState(false)

  // Cuál de las peticiones en vuelo es la que vale. Con la conexión de Cuba da tiempo
  // a cerrar el modal o a pulsar otra fila antes de que conteste el servidor, y sin
  // esto la respuesta atrasada volvía a abrir el modal —o pisaba el presupuesto que
  // se acababa de pedir con el que se había pedido antes.
  const peticion = useRef(0)

  async function abrir(p: PresupuestoRow) {
    const mia = ++peticion.current
    setCargando(p)
    const d = await obtenerPresupuesto(p.id)
    if (peticion.current !== mia) return
    setCargando(null)
    if (!d) { toastError('No se pudo cargar el presupuesto'); return }
    setHorasReales(d.horas_reales != null ? String(d.horas_reales) : '')
    setHorasRealesOriginales(d.horas_reales != null ? String(d.horas_reales) : '')
    setDetalle(d)
  }

  function cerrarDetalle() {
    peticion.current++
    setDetalle(null)
    setCargando(null)
  }

  async function descargarPdf(incluir: 'todo' | 'instalacion' | 'suscripcion') {
    if (!detalle) return
    const claves: string[] = Array.isArray(detalle.modulos) ? detalle.modulos : []
    const moneda = normalizarMonedaClaux(detalle.moneda)
    const mods = catalogo
      .filter(m => claves.includes(m.clave))
      .map(m => ({ nombre: m.nombre, precio: precioModulo(m, detalle.nivel, moneda) }))
    const mensual = Number(detalle.cuota_mensual ?? 0)
    try {
      await descargarPresupuesto({
        numero: numeroPresupuesto(detalle.id),
        fecha: fmtFecha(detalle.created_at),
        negocio: detalle.nombre_negocio ?? '',
        responsable: detalle.nombre_responsable,
        contacto: detalle.contacto,
        desglose,
        horasTotal: Number(detalle.horas_total ?? 0),
        tarifaHora: Number(detalle.tarifa_hora ?? 0),
        costeInstalacion: Number(detalle.coste_instalacion ?? 0),
        descuentoPct: Number(detalle.descuento_pct ?? 0),
        totalInstalacion: Number(detalle.total_final ?? detalle.coste_instalacion ?? 0),
        modulos: mods,
        cuotaMensual: mensual,
        cuotaAnual: importeCiclo(mensual, 'anual', descuentoAnualPct),
        descuentoAnualPct,
        moneda,
        incluir,
      }, `${numeroPresupuesto(detalle.id)}${incluir === 'todo' ? '' : `-${incluir}`}.pdf`)
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
    cerrarDetalle()
    router.refresh()
  }

  const monedaDet = normalizarMonedaClaux(detalle?.moneda)
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

  // El de siempre primero, que es el que se mira: el más reciente arriba.
  const orden = useOrden(presupuestos, COLUMNAS, { clave: 'fecha', dir: 'desc' })

  return (
    <>
      <div className="table-wrapper table-wrapper-flush">
        <table className="table">
          <thead>
            <tr>
              <ThOrden clave="fecha" orden={orden} />
              <ThOrden clave="estado" orden={orden} />
              <ThOrden clave="horas" orden={orden} className="col-num" />
              <ThOrden clave="reales" orden={orden} className="col-num" />
              <ThOrden clave="instalacion" orden={orden} className="col-num" />
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {orden.filas.map(p => {
              const reales = p.horas_reales
              const seExcedio = reales != null && reales > p.horas_total
              const moneda = normalizarMonedaClaux(p.moneda)
              return (
                <tr
                  key={p.id}
                  className="table-row-clickable"
                  onClick={() => abrir(p)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(p) } }}
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
                    {imp(p.total_final ?? p.coste_instalacion, moneda)}
                    {Number(p.descuento_pct) > 0 && (
                      <span className="text-xs-muted"> · −{Number(p.descuento_pct)}%</span>
                    )}
                  </td>
                  {/* La fila entera abre el detalle; el menú, no: sin esto cada opción
                      disparaba además el clic de la fila. */}
                  <td className="col-actions" onClick={e => e.stopPropagation()}>
                      <RowActions>
                        <button className="row-actions-item" onClick={() => abrir(p)}>
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
            Se borra el presupuesto de{' '}
            <strong>{imp(borrar.total_final ?? borrar.coste_instalacion, borrar.moneda)}</strong>{' '}
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
        <ModalShell
          title={detalle?.nombre_negocio ?? cargando?.nombre_negocio ?? ''}
          subtitle={`${numeroPresupuesto(detalle?.id ?? cargando!.id)} · ${fmtFecha(detalle?.created_at ?? cargando!.created_at)}`}
          size="modal-640 modal-fixed-actions"
          onClose={cerrarDetalle}
        >
          {!detalle ? (
            <div className="modal-body">
              <p className="text-sm-muted"><span className="spinner" /> Cargando…</p>
            </div>
          ) : (
            <>
              <div className="modal-body">
                <div className="sol-detalle">
                  <div className="sol-row"><span className="sol-label">Estado</span><span className="sol-value"><EstadoBadge estado={detalle.estado} /></span></div>
                  <div className="sol-row"><span className="sol-label">Comercial</span><span className="sol-value">{detalle.comercial_nombre ?? '—'}</span></div>
                  <div className="sol-row"><span className="sol-label">Responsable</span><span className="sol-value">{detalle.nombre_responsable ?? '—'}</span></div>
                  <div className="sol-row"><span className="sol-label">Contacto</span><span className="sol-value">{detalle.contacto ?? '—'}</span></div>
                  <div className="sol-row"><span className="sol-label">Nivel</span><span className="sol-value">{nombresNivel[normalizarNivel(detalle.nivel)]}</span></div>
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
                      <span className="pres-fase-sub">{imp(d.subtotal, monedaDet)}</span>
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
                  {Number(detalle.tarifa_hora) > 0 && (
                    <div><span className="pres-total-label">Tarifa aplicada</span><span className="pres-total-valor">{imp(detalle.tarifa_hora, monedaDet)}/h</span></div>
                  )}
                  <div><span className="pres-total-label">Coste instalación</span><span className="pres-total-valor">{imp(detalle.coste_instalacion, monedaDet)}</span></div>
                  {Number(detalle.descuento_pct) > 0 && (
                    <div className="pres-total-dto">
                      <span className="pres-total-label">
                        Descuento ({Number(detalle.descuento_pct)}%)
                        {detalle.descuento_motivo && <em className="pres-dto-motivo"> · {detalle.descuento_motivo}</em>}
                      </span>
                      <span className="pres-total-valor">
                        −{imp(Number(detalle.coste_instalacion) - Number(detalle.total_final), monedaDet)}
                      </span>
                    </div>
                  )}
                  <div className="pres-total-final">
                    <span className="pres-total-label">Total a pagar una vez</span>
                    <span className="pres-total-valor">{imp(detalle.total_final ?? detalle.coste_instalacion, monedaDet)}</span>
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
        </ModalShell>
      )}
    </>
  )
}
