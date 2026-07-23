'use client'

import { useState, useMemo, useEffect, useTransition } from 'react'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import { ConfirmDialog } from '@/components/portal/Dialog'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import EmpresaPills      from '@/components/portal/EmpresaPills'
import { useEmpresas }   from '@/components/portal/EmpresaColorContext'
import { usePagination, TablePagination } from '@/components/TablePagination'
import Tabs from '@/components/Tabs'
import { Plus, Search, Pencil, Pause, Play, RotateCcw, XCircle, X, Repeat, Receipt, Info, AlertTriangle, ChevronDown, ExternalLink } from 'lucide-react'
import {
  guardarSuscripcion,
  cambiarEstadoSuscripcion,
  renovarSuscripcion,
  obtenerCalendarioFacturacion,
  facturarPeriodo,
} from '@/app/actions/portal/suscripciones'
import { calcularCobroAcuerdo, sumarPeriodo } from '@/lib/suscripciones'
import type {
  SuscripcionesPageData, SuscripcionRow, EstadoEfectivo, PeriodicidadSub,
  DescuentoModo, ServicioSuscribible,
  CalendarioFacturacion, MesCalendario, EstadoCobro,
} from '@/lib/suscripciones'
import { ESTADO_FACTURA_LABEL, ESTADO_FACTURA_BADGE, type EstadoFactura } from '../ventas/_ventas-helpers'

const PERIODICIDAD_LABEL: Record<PeriodicidadSub, string> = {
  MENSUAL: 'Mensual', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual',
}
const ESTADO_LABEL: Record<EstadoEfectivo, string> = {
  ACTIVA: 'Activa', PAUSADA: 'Pausada', VENCIDA: 'Vencida', CANCELADA: 'Cancelada',
}
const ESTADO_BADGE: Record<EstadoEfectivo, string> = {
  ACTIVA: 'badge-success', PAUSADA: 'badge-info', VENCIDA: 'badge-warning', CANCELADA: 'badge-neutral',
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtMoneda(n: number, moneda: string) {
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${moneda}`
}
/** 'YYYY-MM' → «julio de 2026». Un período no se le enseña a nadie como «2026-07». */
function fmtPeriodo(periodo: string) {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}

// ── Modal de alta / edición ─────────────────────────────────────────────────────

/** Un importe con su moneda: de dónde convertir cuando falta la tarifa. */
interface ImporteEn { moneda: string; precio: number }

/** Una línea del acuerdo mientras se edita: el precio es texto para poder dejarlo vacío. */
interface LineaForm {
  producto_id: string
  precio:      string
  /** El descuento es de CADA servicio (mig. 125). */
  dtoModo:     DescuentoModo
  dtoValor:    string
  /** Lo que tenía antes de cambiar la moneda, para poder ofrecer la conversión. */
  origen?:     ImporteEn
}

/**
 * La tarifa del servicio en CUALQUIER otra moneda. Es la referencia para ofrecer la
 * conversión cuando el servicio no está tarifado en la moneda elegida: un servicio a
 * 10.000 CUP que se contrata en USD no tiene por qué dejar el campo huérfano.
 */
function tarifaEnOtraMoneda(s: ServicioSuscribible | undefined, moneda: string): ImporteEn | null {
  const otra = Object.entries(s?.precios ?? {}).find(([m, v]) => m !== moneda && Number(v) > 0)
  return otra ? { moneda: otra[0], precio: Number(otra[1]) } : null
}

function SuscripcionModal({ sub, data, onClose, onSaved }: {
  sub: SuscripcionRow | null; data: SuscripcionesPageData; onClose: () => void; onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const hoy = new Date().toISOString().split('T')[0]

  const [clienteId,    setClienteId]    = useState(sub?.cliente_id ?? '')
  // Los servicios del acuerdo. Cada uno con SU precio mensual; el resto (moneda,
  // periodicidad, descuento, fechas) se pacta una vez para todo el acuerdo.
  const [lineas,       setLineas]       = useState<LineaForm[]>(() =>
    sub ? sub.lineas.map(l => ({
            producto_id: l.producto_id, precio: String(l.precio_mensual),
            dtoModo: l.descuento_modo, dtoValor: l.descuento_valor > 0 ? String(l.descuento_valor) : '',
          }))
        : [{ producto_id: '', precio: '', dtoModo: 'PORCENTAJE', dtoValor: '' }])
  const [empresaId,    setEmpresaId]    = useState(sub?.empresa_id ?? (data.empresas[0]?.empresa_id ?? ''))
  const [moneda,       setMoneda]       = useState(sub?.moneda ?? (data.monedas[0] ?? ''))
  const [periodicidad, setPeriodicidad] = useState<PeriodicidadSub>(sub?.periodicidad ?? 'MENSUAL')
  const [fechaInicio,  setFechaInicio]  = useState(sub?.fecha_inicio ?? hoy)
  const [proximoCobro, setProximoCobro] = useState(sub?.fecha_proximo_cobro ?? sub?.fecha_inicio ?? hoy)
  const [fechaFin,     setFechaFin]     = useState(sub?.fecha_fin ?? '')
  const [renovacion,   setRenovacion]   = useState(sub?.renovacion_automatica ?? true)
  const [notas,        setNotas]        = useState(sub?.notas ?? '')

  const isEdit = !!sub

  // El importe del cobro NO se teclea: se calcula y se enseña. Cada servicio con su precio
  // y SU descuento (mig. 125); el ciclo hace el resto y el acuerdo suma línea a línea.
  const lineasCobro = lineas.filter(l => l.producto_id).map(l => ({
    precio_mensual:  parseFloat(l.precio) || 0,
    descuento_modo:  l.dtoModo,
    descuento_valor: parseFloat(l.dtoValor) || 0,
  }))
  const mensual = lineasCobro.reduce((t, l) => t + l.precio_mensual, 0)
  const cobro   = calcularCobroAcuerdo(lineasCobro, periodicidad)

  // Los clientes son POR EMPRESA: el mismo negocio puede tener ficha en varias, y
  // mezclarlas es lo que hacía salir «CLAUDIA» tres veces en la lista.
  const clientesDeEmpresa = data.clientes.filter(c => c.empresa_id === empresaId)

  /** Cambiar de empresa cambia el juego de fichas: la elegida deja de valer. */
  function onEmpresaChange(id: string) {
    setEmpresaId(id)
    if (clienteId && !data.clientes.some(c => c.tercero_id === clienteId && c.empresa_id === id)) {
      setClienteId('')
    }
  }

  function setLinea(i: number, cambio: Partial<LineaForm>) {
    setLineas(prev => prev.map((l, idx) => idx === i ? { ...l, ...cambio } : l))
  }
  function addLinea()          { setLineas(prev => [...prev, { producto_id: '', precio: '', dtoModo: 'PORCENTAJE', dtoValor: '' }]) }
  function quitarLinea(i: number) { setLineas(prev => prev.filter((_, idx) => idx !== i)) }

  /** Precio del catálogo en la moneda del acuerdo, o null si ahí no está tarifado. */
  function tarifaDe(producto_id: string, m: string): number | null {
    const p = data.servicios.find(x => x.producto_id === producto_id)?.precios[m]
    return p == null ? null : Number(p)
  }

  function onServicioChange(i: number, id: string) {
    const s = data.servicios.find(x => x.producto_id === id)
    // La periodicidad por defecto del servicio solo manda al elegir el PRIMERO: es del
    // acuerdo entero, y que el tercer servicio te cambie el ciclo ya pactado sería peor
    // que no precargarla.
    if (s?.periodicidad_defecto && i === 0 && !isEdit) setPeriodicidad(s.periodicidad_defecto)
    // Sin tarifa en esta moneda el precio se deja vacío: arrastrar el anterior es
    // exactamente el error de cobrar 10.000 USD donde eran 10.000 CUP.
    const tarifa = tarifaDe(id, moneda)
    setLinea(i, { producto_id: id, precio: tarifa == null ? '' : String(tarifa) })
  }

  /**
   * Cambiar de moneda no arrastra los importes: 10.000 CUP no son 10.000 USD. Cada
   * servicio se re-tarifa en la nueva si el catálogo lo tiene; el que no, se queda vacío
   * y la tasa se ofrece como atajo (mismo criterio que el salario en Personal: la
   * conversión se ofrece, no se impone — el precio en otra moneda se decide).
   */
  function onMonedaChange(m: string) {
    if (m === moneda) return
    const anterior = moneda
    setMoneda(m)
    setLineas(prev => prev.map(l => {
      const tarifa = tarifaDe(l.producto_id, m)
      if (tarifa != null) return { ...l, precio: String(tarifa), origen: undefined }
      const previo = parseFloat(l.precio) || 0
      // Volver a la moneda de la que se venía restaura el importe TAL CUAL: en un acuerdo
      // cerrado el precio pactado no es el de la lista, y deshacer un cambio de moneda no
      // puede re-tarifar por la espalda.
      if (l.origen && l.origen.moneda === m) return { ...l, precio: String(l.origen.precio), origen: undefined }
      return { ...l, precio: '', origen: previo > 0 ? { moneda: anterior, precio: previo } : undefined }
    }))
  }

  /** De dónde convertir el precio de una línea vacía: lo que había, o su tarifa en otra moneda. */
  function referenciaDe(l: LineaForm): ImporteEn | null {
    if (l.precio !== '' || !l.producto_id) return null
    if (l.origen && l.origen.moneda !== moneda) return l.origen
    return tarifaEnOtraMoneda(data.servicios.find(x => x.producto_id === l.producto_id), moneda)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData()
    if (sub) fd.set('suscripcion_id', sub.suscripcion_id)
    fd.set('cliente_id', clienteId)
    fd.set('empresa_id', empresaId)
    fd.set('moneda', moneda)
    fd.set('lineas', JSON.stringify(
      lineas.filter(l => l.producto_id).map(l => ({
        producto_id:     l.producto_id,
        precio_mensual:  parseFloat(l.precio) || 0,
        descuento_modo:  l.dtoModo,
        descuento_valor: parseFloat(l.dtoValor) || 0,
      })),
    ))
    fd.set('periodicidad', periodicidad)
    fd.set('fecha_inicio', fechaInicio)
    fd.set('fecha_proximo_cobro', proximoCobro)
    fd.set('fecha_fin', fechaFin)
    fd.set('renovacion_automatica', renovacion ? '1' : '')
    fd.set('notas', notas)
    const ld = toastLoading(isEdit ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const res = await guardarSuscripcion(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(
        isEdit          ? 'Suscripción actualizada.'
        // Sin número: el borrador no lo tiene hasta que se emite.
        : res.factura   ? 'Suscripción creada. Su factura borrador ya está en Ventas.'
        :                 'Suscripción creada.',
      )
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-xl" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar suscripción' : 'Nueva suscripción'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="ter-form-section">
              <span className="ter-form-section-title">Acuerdo</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-3">
                  <label>Cliente <span className="required">*</span></label>
                  <select className="input" value={clienteId} onChange={e => setClienteId(e.target.value)} required>
                    <option value="">— Elige un cliente —</option>
                    {clientesDeEmpresa.map(c => <option key={c.tercero_id} value={c.tercero_id}>{c.nombre}</option>)}
                  </select>
                  {clientesDeEmpresa.length === 0 && (
                    <span className="input-hint">Esta empresa aún no tiene clientes dados de alta.</span>
                  )}
                </div>
                {data.empresas.length > 1 && (
                  <div className="input-group ter-col-span-3">
                    <label>Empresa <span className="required">*</span></label>
                    <select className="input" value={empresaId} onChange={e => onEmpresaChange(e.target.value)} required>
                      {data.empresas.map(em => <option key={em.empresa_id} value={em.empresa_id}>{em.nombre}</option>)}
                    </select>
                    <span className="input-hint">Cada empresa tiene sus propios clientes y su facturación.</span>
                  </div>
                )}
              </div>
            </div>

            <div className="ter-form-section">
              <span className="ter-form-section-title">Servicios contratados</span>
              {/* Un acuerdo, varios servicios: un cliente que contrata tres no son tres
                  acuerdos. La moneda, el ciclo y el descuento son del acuerdo entero; el
                  precio, de cada servicio. La factura sale con una línea por cada uno. */}
              <div className="sus-lineas-form">
                {lineas.map((l, i) => {
                  const ref    = referenciaDe(l)
                  const factor = ref ? data.tasas[`${ref.moneda}__${moneda}`] : undefined
                  return (
                    <div key={i} className="sus-linea-form">
                      <div className="sus-linea-form-campos">
                        <div className="input-group">
                          <label htmlFor={`sus-srv-${i}`}>Servicio <span className="required">*</span></label>
                          <select className="input" id={`sus-srv-${i}`} value={l.producto_id}
                            onChange={e => onServicioChange(i, e.target.value)} required>
                            <option value="">— Elige un servicio —</option>
                            {data.servicios.map(sv => (
                              <option key={sv.producto_id} value={sv.producto_id}>{sv.nombre}</option>
                            ))}
                          </select>
                        </div>
                        <div className="input-group sus-linea-form-precio">
                          <label htmlFor={`sus-precio-${i}`}>Precio al mes <span className="required">*</span></label>
                          <input className="input" id={`sus-precio-${i}`} type="number" step="0.01" min="0"
                            value={l.precio} onChange={e => setLinea(i, { precio: e.target.value })}
                            placeholder="0.00" required />
                        </div>
                        <div className="input-group sus-linea-form-dto">
                          <label htmlFor={`sus-dto-${i}`}>Descuento</label>
                          <div className="sus-dto-row">
                            <input className="input" id={`sus-dto-${i}`} type="number" step="0.01" min="0"
                              value={l.dtoValor} onChange={e => setLinea(i, { dtoValor: e.target.value })} placeholder="0" />
                            <select className="input" value={l.dtoModo} aria-label="Tipo de descuento"
                              onChange={e => setLinea(i, { dtoModo: e.target.value as DescuentoModo })}>
                              <option value="PORCENTAJE">%</option>
                              <option value="MONTO_FIJO">{moneda || 'fijo'}</option>
                            </select>
                          </div>
                        </div>
                        {lineas.length > 1 && (
                          <button type="button" className="prd-editor-del-btn" onClick={() => quitarLinea(i)}
                            title="Quitar servicio" aria-label="Quitar servicio">×</button>
                        )}
                      </div>
                      {ref && (
                        <div className="moneda-cambio-nota">
                          <Info size={14} strokeWidth={2} />
                          <span>
                            Sin precio en {moneda}; cuesta {fmtMoneda(ref.precio, ref.moneda)}. Escríbelo en {moneda}
                            {factor
                              ? <> o <button type="button" className="aplicar-tasa-btn"
                                  onClick={() => setLinea(i, { precio: (ref.precio * factor).toFixed(2) })}>
                                  usa la tasa ({fmtMoneda(ref.precio * factor, moneda)})</button></>
                              : <> (no hay tasa {ref.moneda} → {moneda} para convertirlo)</>}.
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
                <button type="button" className="btn-ghost-xs sus-add-servicio" onClick={addLinea}>
                  + Añadir otro servicio
                </button>
              </div>
            </div>

            <div className="ter-form-section">
              <span className="ter-form-section-title">Cobro</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-2">
                  <label htmlFor="sus-moneda">Moneda <span className="required">*</span></label>
                  <select className="input" id="sus-moneda" value={moneda}
                    onChange={e => onMonedaChange(e.target.value)} required>
                    {data.monedas.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <span className="input-hint">Una sola para todo el acuerdo.</span>
                </div>
                <div className="input-group ter-col-span-2">
                  <label htmlFor="sus-periodicidad">Cada cuánto se cobra <span className="required">*</span></label>
                  <select className="input" id="sus-periodicidad" value={periodicidad}
                    onChange={e => setPeriodicidad(e.target.value as PeriodicidadSub)} required>
                    {(Object.keys(PERIODICIDAD_LABEL) as PeriodicidadSub[]).map(p => (
                      <option key={p} value={p}>{PERIODICIDAD_LABEL[p]}</option>
                    ))}
                  </select>
                </div>

                <div className="sus-cobro-resumen ter-col-full">
                  <span className="sus-cobro-label">Se le cobrará</span>
                  <strong className="sus-cobro-total">{fmtMoneda(cobro.total, moneda)}</strong>
                  <span className="sus-cobro-detalle">
                    {lineas.filter(l => l.producto_id).length > 1 && <>{lineas.filter(l => l.producto_id).length} servicios · </>}
                    {cobro.meses > 1
                      ? <>{cobro.meses} meses × {fmtMoneda(mensual, moneda)}</>
                      : <>cada mes</>}
                    {cobro.descuento > 0 && <> − {fmtMoneda(cobro.descuento, moneda)} de descuento</>}
                    {cobro.meses > 1 && <> · sale a {fmtMoneda(cobro.equivalenteMensual, moneda)}/mes</>}
                  </span>
                </div>
              </div>
            </div>

            <div className="ter-form-section">
              <span className="ter-form-section-title">Vigencia</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-2">
                  <label htmlFor="sus-inicio">Inicio <span className="required">*</span></label>
                  <input className="input" id="sus-inicio" type="date" value={fechaInicio}
                    onChange={e => setFechaInicio(e.target.value)} required />
                  <span className="input-hint">Desde cuándo tiene contratado el servicio.</span>
                </div>
                <div className="input-group ter-col-span-2">
                  <label htmlFor="sus-proximo">Próximo cobro</label>
                  <input className="input" id="sus-proximo" type="date" value={proximoCobro}
                    onChange={e => setProximoCobro(e.target.value)} />
                  {/* La periodicidad no se ve en ningún sitio hasta que se dice CUÁNDO cae el
                      siguiente: con «Anual» esta sección se veía idéntica a la mensual. */}
                  <span className="input-hint">
                    {proximoCobro
                      ? <>Se cobra el {fmtDate(proximoCobro)} y el siguiente caería el {fmtDate(sumarPeriodo(proximoCobro, periodicidad))}.</>
                      : <>Cuándo toca el primer cobro.</>}
                  </span>
                </div>
                <div className="input-group ter-col-span-2">
                  <label htmlFor="sus-fin">Fin (opcional)</label>
                  <input className="input" id="sus-fin" type="date" value={fechaFin}
                    onChange={e => setFechaFin(e.target.value)} />
                  <span className="input-hint">Vacío = indefinida: se cobra hasta que la canceles.</span>
                </div>
                {/* La casilla solo pinta algo si HAY fin: sin fecha de fin no hay nada que
                    renovar, y ahí la casilla marcada era ruido que no significaba nada. */}
                {fechaFin && (
                  <div className="input-group ter-col-full">
                    <label className="checkbox-group">
                      <input type="checkbox" checked={renovacion} onChange={e => setRenovacion(e.target.checked)} />
                      <span className="checkbox-label">
                        Al llegar el {fmtDate(fechaFin)}, seguir cobrando (renovación automática)
                      </span>
                    </label>
                    <span className="input-hint">
                      {renovacion
                        ? 'Se renueva sola; el fin es solo la fecha del acuerdo.'
                        : 'Sin renovar: ese día deja de cobrarse y la suscripción pasa a «Vencida».'}
                    </span>
                  </div>
                )}
                {/* Se avisa ANTES de guardar: la factura aparece sola y nadie debería
                    descubrir un documento que no recuerda haber creado. */}
                {!isEdit && proximoCobro && proximoCobro <= hoy && (
                  <div className="ter-col-full">
                    <div className="alert alert-info">
                      <span>
                        Como ya toca cobrar, al guardar se creará la <strong>factura borrador</strong> en
                        Ventas. No se emite ni se envía: la revisas y la emites tú.
                      </span>
                    </div>
                  </div>
                )}
                <div className="input-group ter-col-full">
                  <label>Notas</label>
                  <textarea className="input input-textarea" rows={2} value={notas}
                    onChange={e => setNotas(e.target.value)} placeholder="Notas internas (opcional)…" />
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear suscripción'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Panel: Calendario de cobros ───────────────────────────────────────────────
//
// Sustituye al selector de mes. Aquel obligaba a ir mes a mes para enterarse de algo y,
// peor, ESCONDÍA los atrasos: lo vencido hacía meses se colaba en el mes que estuvieras
// mirando como si fuera de ese mes. Aquí cada ciclo aparece en SU mes, con su estado.
//
// El futuro es informativo y sin acciones: no existe hasta que se genera su borrador.

const ESTADO_COBRO_LABEL: Record<EstadoCobro, string> = {
  PENDIENTE: 'Toca cobrar', FACTURADO: 'Facturado', PROYECTADO: 'Próximamente',
}
const ESTADO_COBRO_BADGE: Record<EstadoCobro, string> = {
  PENDIENTE: 'badge-warning', FACTURADO: 'badge-success', PROYECTADO: 'badge-neutral',
}

function MesCard({ mes, atrasado, tieneBase, excluidos, onToggle, onGenerar, isPending }: {
  mes:       MesCalendario
  /** Su mes ya pasó y sigue sin factura: se marca, que es justo lo que antes no se veía. */
  atrasado:  boolean
  tieneBase: boolean
  excluidos: Set<string>
  onToggle:  (key: string) => void
  onGenerar: (periodo: string) => void
  isPending: boolean
}) {
  const accionable = mes.estado === 'PENDIENTE' && mes.grupos.length > 0
  const incluidos  = mes.grupos.filter(g => !excluidos.has(`${mes.periodo}#${g.cliente_id}#${g.moneda}`))

  return (
    <div className="card card-table sus-mes">
      <div className="mon-card-header sus-mes-header">
        <div className="sus-mes-titulo">
          <h2 className="sus-mes-nombre">{fmtPeriodo(mes.periodo)}</h2>
          <span className={`badge ${ESTADO_COBRO_BADGE[mes.estado]}`}>
            {atrasado ? 'Atrasado' : ESTADO_COBRO_LABEL[mes.estado]}
          </span>
          <span className="sus-mes-totales">
            {mes.totales.map(t => (
              <span key={t.moneda} className="sus-mes-total">{fmtMoneda(t.total, t.moneda)}</span>
            ))}
          </span>
        </div>
        {accionable && tieneBase && (
          <button className="btn btn-primary btn-sm" onClick={() => onGenerar(mes.periodo)}
            disabled={isPending || incluidos.length === 0}>
            {isPending
              ? <><span className="spinner spinner-sm" /> Generando…</>
              : `Generar ${incluidos.length} factura(s)`}
          </button>
        )}
        {mes.facturas.length > 0 && !accionable && (
          <Link href="/portal/ventas" className="btn btn-secondary btn-sm">Ver en Facturas</Link>
        )}
      </div>

      {atrasado && (
        <div className="sus-mes-aviso">
          <AlertTriangle size={14} strokeWidth={2} />
          <span>Este cobro venció y sigue sin factura. Genérala aquí para que quede en su mes.</span>
        </div>
      )}

      {mes.clientesMultimoneda.length > 0 && (
        <div className="sus-mes-aviso">
          <Info size={14} strokeWidth={2} />
          <span>Con varias monedas ({mes.clientesMultimoneda.join(', ')}): una factura por moneda.</span>
        </div>
      )}

      {/* Lo ya facturado del mes */}
      {mes.facturas.length > 0 && (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Cliente</th>
                <th className="col-center">Suscripciones</th>
                <th className="col-num">Total</th>
                <th>Estado</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {mes.facturas.map(f => (
                <tr key={f.factura_id}>
                  <td data-label="Nº"><strong className="text-sm-bold">{f.numero}</strong></td>
                  <td data-label="Cliente" className="text-sm-muted">{f.cliente_nombre}</td>
                  <td data-label="Suscripciones" className="col-center text-sm-muted">{f.suscripciones}</td>
                  <td data-label="Total" className="col-num">{fmtMoneda(f.total, f.moneda)}</td>
                  <td data-label="Estado">
                    <span className={`badge ${ESTADO_FACTURA_BADGE[f.estado as EstadoFactura] ?? 'badge-neutral'}`}>
                      {ESTADO_FACTURA_LABEL[f.estado as EstadoFactura] ?? f.estado}
                    </span>
                  </td>
                  <td className="col-actions">
                    <Link href={`/portal/ventas/facturas/${f.factura_id}`} className="ter-action-btn"
                      title={`Ver la factura ${f.numero}`} aria-label={`Ver la factura ${f.numero}`}>
                      <ExternalLink size={15} strokeWidth={2} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lo que toca cobrar: se marca qué entra y se genera */}
      {accionable && (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th className="col-center">Incluir</th>
                <th>Cliente</th>
                <th>Qué se le factura</th>
                <th className="col-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {mes.grupos.map(g => {
                const key = `${mes.periodo}#${g.cliente_id}#${g.moneda}`
                const incluido = !excluidos.has(key)
                return (
                  <tr key={key} className={incluido ? undefined : 'sus-fila-excluida'}>
                    <td data-label="Incluir" className="col-center">
                      <input type="checkbox" checked={incluido} onChange={() => onToggle(key)}
                        aria-label={`Incluir a ${g.cliente_nombre} en ${g.moneda}`} />
                    </td>
                    <td data-label="Cliente"><strong className="text-sm-bold">{g.cliente_nombre}</strong></td>
                    <td data-label="Qué se le factura">
                      <ul className="sus-lineas">
                        {g.lineas.map(l => (
                          <li key={l.suscripcion_id}>
                            <span className="sus-linea-nombre">{l.servicio_nombre}</span>
                            <span className="sus-linea-detalle">
                              {/* La periodicidad primero: un cobro anual de $X no puede
                                  confundirse con uno mensual del mismo importe. */}
                              {PERIODICIDAD_LABEL[l.periodicidad]}
                              {l.meses > 1 && <> · {l.meses} meses</>} · {' '}
                              {l.descuento > 0 && <>dto. {fmtMoneda(l.descuento, g.moneda)} · </>}
                              {fmtMoneda(l.precio, g.moneda)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td data-label="Total" className="col-num">{fmtMoneda(g.total, g.moneda)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Futuro: se mira, no se toca. Lista compacta, sin casillas y sin botón. */}
      {mes.estado === 'PROYECTADO' && mes.grupos.length > 0 && (
        <ul className="sus-proyeccion">
          {mes.grupos.map(g => (
            <li key={`${g.cliente_id}#${g.moneda}`} className="sus-proyeccion-item">
              <span className="sus-proyeccion-cliente">{g.cliente_nombre}</span>
              <span className="sus-proyeccion-detalle">
                {/* Con la periodicidad al lado: aquí un cobro anual se veía idéntico a
                    uno mensual del mismo importe. */}
                {g.lineas.map(l => `${l.servicio_nombre} (${PERIODICIDAD_LABEL[l.periodicidad]})`).join(', ')}
              </span>
              <span className="sus-proyeccion-monto">{fmtMoneda(g.total, g.moneda)}</span>
            </li>
          ))}
        </ul>
      )}

      {accionable && !tieneBase && (
        <p className="sus-mes-nota">Con Contabilidad se generarían {mes.grupos.length} factura(s) borrador.</p>
      )}
    </div>
  )
}

function FacturacionPanel({ data }: { data: SuscripcionesPageData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [empresaId,  setEmpresaId]  = useState(data.empresas[0]?.empresa_id ?? '')
  const [calendario, setCalendario] = useState<CalendarioFacturacion | null>(null)
  const [excluidos,  setExcluidos]  = useState<Set<string>>(new Set())
  const [verFuturo,  setVerFuturo]  = useState(false)
  const [recarga,    setRecarga]    = useState(0)

  const { colorOf } = useEmpresas()
  const empresasPills = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))

  const empresaSel = data.empresas.find(e => e.empresa_id === empresaId)
  const sinLetra   = !!empresaSel && !empresaSel.letra_facturacion

  // Cargando = lo que hay en pantalla no es de lo que se está preguntando. El calendario
  // lleva su empresa dentro, así que no hace falta un estado aparte.
  const cargando = isPending && calendario?.empresa_id !== empresaId

  const mesActual = calendario?.mesActual ?? ''
  const meses     = calendario?.meses ?? []
  // Hasta el mes en curso es lo que toca (o ya está hecho); a partir de ahí, estimación.
  const ahora     = meses.filter(m => m.periodo <= mesActual)
  const futuro    = meses.filter(m => m.periodo >  mesActual)

  useEffect(() => {
    if (!empresaId) return
    let cancelado = false
    startTransition(async () => {
      const res = await obtenerCalendarioFacturacion(empresaId)
      if (cancelado) return
      if (!res.ok) { toastError(res.error ?? 'Error'); setCalendario(null); return }
      setCalendario(res.calendario ?? null)
      setExcluidos(new Set())
    })
    return () => { cancelado = true }
  }, [empresaId, recarga])

  function toggleExcluir(key: string) {
    setExcluidos(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  function generar(periodo: string) {
    // Las exclusiones viajan por período: la clave lleva el mes delante para que
    // desmarcar a alguien en mayo no lo desmarque también en junio.
    const pref = `${periodo}#`
    const excluirDelMes = [...excluidos]
      .filter(k => k.startsWith(pref))
      .map(k => k.slice(pref.length))
    const ld = toastLoading('Generando…')
    startTransition(async () => {
      const res = await facturarPeriodo(empresaId, periodo, excluirDelMes)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      if (res.fallidas) toastError(`${res.fallidas} sin crear${res.error ? `: ${res.error}` : '.'}`)
      toastSuccess(`${res.generadas ?? 0} factura(s) borrador creada(s).`)
      setRecarga(n => n + 1)   // relee: lo facturado ya no debe ofrecerse
      router.refresh()
    })
  }

  return (
    <>
      {!data.tieneBase && (
        <div className="alert alert-warning alert-cta">
          <span className="alert-cta-texto">
            Esto es una <strong>vista previa</strong>: puedes ver qué se cobraría cada mes. Para
            <strong> emitir las facturas de verdad</strong> y cobrarlas necesitas el módulo <strong>Contabilidad</strong>.
          </span>
          <Link href="/portal/soporte" className="btn btn-aviso btn-sm">Contactar para contratarlo</Link>
        </div>
      )}

      {/* Sin selector de mes: el calendario los enseña todos. Solo se elige empresa,
          porque cada factura pertenece a UNA. */}
      <div className="ter-toolbar">
        <EmpresaPills empresas={empresasPills} value={empresaId} onChange={setEmpresaId} sinTodas />
      </div>

      {data.tieneBase && sinLetra && (
        <div className="alert alert-warning mb-4">
          Esta empresa no tiene <strong>letra de facturación</strong>. Asígnala en Empresas para poder facturar.
        </div>
      )}

      {cargando && (
        <div className="card mon-empty">
          <span className="spinner" />
          <p>Calculando el calendario de cobros…</p>
        </div>
      )}

      {!cargando && calendario && meses.length === 0 && (
        <div className="card mon-empty">
          <Receipt size={36} strokeWidth={1} opacity={0.25} />
          <p>No hay cobros que programar. Las suscripciones activas aparecerán aquí con su mes.</p>
        </div>
      )}

      {!cargando && ahora.map(m => (
        <MesCard key={m.periodo} mes={m}
          atrasado={m.estado === 'PENDIENTE' && m.periodo < mesActual}
          tieneBase={data.tieneBase} excluidos={excluidos}
          onToggle={toggleExcluir} onGenerar={generar} isPending={isPending} />
      ))}

      {/* Lo que viene, plegado: es una estimación y no se hace nada con ella, así que no
          puede robarle la pantalla a lo que sí toca. */}
      {!cargando && futuro.length > 0 && (
        <div className="sus-futuro">
          <button type="button" className="sus-futuro-toggle" onClick={() => setVerFuturo(v => !v)}
            aria-expanded={verFuturo}>
            <ChevronDown size={16} strokeWidth={2.5}
              className={`sus-futuro-chevron${verFuturo ? ' sus-futuro-chevron-open' : ''}`} />
            Próximos cobros ({futuro.length} {futuro.length === 1 ? 'mes' : 'meses'})
          </button>
          <span className="sus-futuro-nota">
            Estimación de lo que toca si nada cambia. No se puede facturar por adelantado:
            cada mes se genera cuando llega.
          </span>
          {verFuturo && futuro.map(m => (
            <MesCard key={m.periodo} mes={m} atrasado={false}
              tieneBase={data.tieneBase} excluidos={excluidos}
              onToggle={toggleExcluir} onGenerar={generar} isPending={isPending} />
          ))}
        </div>
      )}
    </>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function SuscripcionesView({ data }: { data: SuscripcionesPageData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [modal,     setModal]     = useState(false)
  const [editSub,   setEditSub]   = useState<SuscripcionRow | null>(null)
  const [cancelSub, setCancelSub] = useState<SuscripcionRow | null>(null)
  const [search,    setSearch]    = useState('')
  const [filtro,    setFiltro]    = useState<'TODAS' | EstadoEfectivo>('TODAS')
  const [vista,     setVista]     = useState<'acuerdos' | 'facturacion'>('acuerdos')

  const faltaSetup = data.empresas.length === 0 || data.monedas.length === 0
  const sinClientes = data.clientes.length === 0
  const sinServicios = data.servicios.length === 0
  const puedeCrear = !faltaSetup && !sinClientes && !sinServicios

  const filtradas = useMemo(() => {
    const q = search.toLowerCase().trim()
    return data.suscripciones.filter(s => {
      if (filtro !== 'TODAS' && s.estado_efectivo !== filtro) return false
      const texto = `${s.cliente_nombre} ${s.lineas.map(l => l.servicio_nombre).join(' ')}`
      if (q && !texto.toLowerCase().includes(q)) return false
      return true
    })
  }, [data.suscripciones, search, filtro])

  const { pageItems, ...pag } = usePagination(filtradas)

  function openCreate()             { setEditSub(null); setModal(true) }
  function openEdit(s: SuscripcionRow) { setEditSub(s); setModal(true) }
  function onSaved()                { setModal(false); setEditSub(null); router.refresh() }

  function accionEstado(id: string, estado: 'ACTIVA' | 'PAUSADA' | 'CANCELADA', msg: string) {
    const ld = toastLoading(estado === 'PAUSADA' ? 'Pausando…' : estado === 'ACTIVA' ? 'Reanudando…' : 'Cancelando…')
    startTransition(async () => {
      const res = await cambiarEstadoSuscripcion(id, estado)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      toastSuccess(msg); setCancelSub(null); router.refresh()
    })
  }
  function accionRenovar(id: string) {
    const ld = toastLoading('Renovando…')
    startTransition(async () => {
      const res = await renovarSuscripcion(id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      toastSuccess('Suscripción renovada.'); router.refresh()
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Suscripciones</h1>
            <IaTouchpoint tipo="suscripciones" descripcion="un análisis de tus suscripciones" />
          </div>
          <p className="page-subtitle">Los servicios que tus clientes tienen contratados, con su precio y renovación.</p>
        </div>
        {vista === 'acuerdos' && (
          <button className="btn btn-primary" onClick={openCreate} disabled={!puedeCrear}>
            <Plus size={14} strokeWidth={2.5} /> Nueva suscripción
          </button>
        )}
      </div>

      {faltaSetup && (
        <PrerequisitoAviso acciones={data.empresas.length === 0
          ? [{ label: 'Crear empresa', href: '/portal/empresas' }]
          : [{ label: 'Crear moneda', href: '/portal/monedas' }]}>
          {data.empresas.length === 0
            ? <>Para gestionar suscripciones necesitas <strong>una empresa</strong>.</>
            : <>Para gestionar suscripciones necesitas <strong>al menos una moneda</strong> configurada.</>}
        </PrerequisitoAviso>
      )}
      {!faltaSetup && sinServicios && (
        <PrerequisitoAviso acciones={[{ label: 'Ir a Servicios', href: '/portal/servicios' }]}>
          No hay servicios <strong>suscribibles</strong>. Marca un servicio como «suscripción» en su ficha para poder contratarlo.
        </PrerequisitoAviso>
      )}
      {!faltaSetup && !sinServicios && sinClientes && (
        <PrerequisitoAviso acciones={[{ label: 'Crear cliente', href: '/portal/terceros' }]}>
          No hay clientes. Da de alta un <strong>cliente</strong> para asociarle una suscripción.
        </PrerequisitoAviso>
      )}

      <Tabs
        ariaLabel="Vista de suscripciones"
        active={vista}
        onChange={setVista}
        tabs={[
          { id: 'acuerdos',    label: 'Acuerdos', count: data.suscripciones.length },
          { id: 'facturacion', label: 'Facturación del período' },
        ]}
      />

      {vista === 'acuerdos' && (
      <>
      <div className="ter-toolbar">
        <div className="ter-search-wrap">
          <Search size={16} strokeWidth={2} />
          <input type="search" className="ter-search" placeholder="Buscar por cliente o servicio…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input ter-filter-select" aria-label="Estado" value={filtro}
          onChange={e => setFiltro(e.target.value as typeof filtro)}>
          <option value="TODAS">Todos los estados</option>
          <option value="ACTIVA">Activas</option>
          <option value="PAUSADA">Pausadas</option>
          <option value="VENCIDA">Vencidas</option>
          <option value="CANCELADA">Canceladas</option>
        </select>
      </div>

      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">Acuerdos</h2>
          <span className="card-count">{filtradas.length} de {data.suscripciones.length}</span>
        </div>

        {filtradas.length === 0 ? (
          <div className="mon-empty">
            <Repeat size={36} strokeWidth={1} opacity={0.25} />
            <p>{data.suscripciones.length === 0
              ? 'Aún no hay suscripciones. Crea la primera.'
              : 'No hay resultados para el filtro seleccionado.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Servicios</th>
                  <th className="col-num">Cada cobro</th>
                  <th>Periodicidad</th>
                  <th>Próximo cobro</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(s => (
                  <tr key={s.suscripcion_id}>
                    <td data-label="Cliente"><strong className="text-sm-bold">{s.cliente_nombre}</strong></td>
                    {/* Un acuerdo puede prestar varios servicios: se listan, que es lo
                        que el cliente verá en su factura. */}
                    <td data-label="Servicios" className="text-sm-muted">
                      {s.lineas.map(l => l.servicio_nombre).join(', ') || '—'}
                    </td>
                    <td data-label="Cada cobro" className="col-num">
                      {fmtMoneda(calcularCobroAcuerdo(s.lineas, s.periodicidad).total, s.moneda)}
                    </td>
                    <td data-label="Periodicidad" className="text-sm-muted">{PERIODICIDAD_LABEL[s.periodicidad]}</td>
                    <td data-label="Próximo cobro" className="text-sm-muted">{fmtDate(s.fecha_proximo_cobro)}</td>
                    <td data-label="Estado">
                      <span className={`badge ${ESTADO_BADGE[s.estado_efectivo]}`}>{ESTADO_LABEL[s.estado_efectivo]}</span>
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        {s.estado !== 'CANCELADA' && (
                          <button className="row-actions-item" onClick={() => openEdit(s)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                        )}
                        {s.estado === 'ACTIVA' && (
                          <button className="row-actions-item" onClick={() => accionEstado(s.suscripcion_id, 'PAUSADA', 'Suscripción pausada.')} disabled={isPending}>
                            <Pause size={15} strokeWidth={2} /> Pausar
                          </button>
                        )}
                        {s.estado === 'PAUSADA' && (
                          <button className="row-actions-item" onClick={() => accionEstado(s.suscripcion_id, 'ACTIVA', 'Suscripción reanudada.')} disabled={isPending}>
                            <Play size={15} strokeWidth={2} /> Reanudar
                          </button>
                        )}
                        {(s.estado_efectivo === 'VENCIDA' || s.estado === 'CANCELADA') && (
                          <button className="row-actions-item" onClick={() => accionRenovar(s.suscripcion_id)} disabled={isPending}>
                            <RotateCcw size={15} strokeWidth={2} /> Renovar
                          </button>
                        )}
                        {s.estado !== 'CANCELADA' && (
                          <button className="row-actions-item row-actions-item-danger" onClick={() => setCancelSub(s)} disabled={isPending}>
                            <XCircle size={15} strokeWidth={2} /> Cancelar
                          </button>
                        )}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="suscripción" />
      </div>
      </>
      )}

      {vista === 'facturacion' && <FacturacionPanel data={data} />}

      {modal && (
        <SuscripcionModal sub={editSub} data={data} onClose={() => { setModal(false); setEditSub(null) }} onSaved={onSaved} />
      )}
      {cancelSub && (
        <ConfirmDialog
          title="Cancelar suscripción"
          body={`¿Cancelar la suscripción de ${cancelSub.cliente_nombre} (${cancelSub.lineas.map(l => l.servicio_nombre).join(', ') || 'sin servicios'})? Deja de cobrarse; el histórico se conserva.`}
          confirmLabel="Cancelar suscripción" danger
          onCancel={() => setCancelSub(null)}
          onConfirm={() => accionEstado(cancelSub.suscripcion_id, 'CANCELADA', 'Suscripción cancelada.')}
        />
      )}
    </div>
  )
}
