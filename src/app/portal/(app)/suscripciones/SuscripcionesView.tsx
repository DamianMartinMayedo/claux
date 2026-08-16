'use client'

import { Fragment, useState, useMemo, useEffect, useTransition } from 'react'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { useRouter, useSearchParams } from 'next/navigation'
// «Hoy» en la zona del NEGOCIO (America/Havana). Con `toISOString()` (UTC) a partir de las
// 20:00 ya es la fecha de mañana, así que el defecto de un `type=date` y la previsualización
// de la reanudación se adelantaban un día cada noche.
import { hoyEnTz } from '@/lib/fecha-tz'
import Link from 'next/link'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import FormHelp from '@/components/portal/FormHelp'
import BulkBar from '@/components/portal/BulkBar'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { ConfirmDialog } from '@/components/portal/Dialog'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import EmpresaPills      from '@/components/portal/EmpresaPills'
import { useEmpresas }   from '@/components/portal/EmpresaColorContext'
import { usePagination, TablePagination } from '@/components/TablePagination'
import Filtros from '@/components/portal/Filtros'
import AvisoTope from '@/components/portal/AvisoTope'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'
import { PRESETS_FUTURO } from '@/lib/listados'
import Tabs from '@/components/Tabs'
import { Plus, Pencil, Pause, Play, RotateCcw, XCircle, CalendarX, Copy, Users, TrendingUp, X, Repeat, Receipt, Info, AlertTriangle, ChevronDown, ExternalLink } from 'lucide-react'
import {
  guardarSuscripcion,
  cambiarEstadoSuscripcion,
  cancelarAlFinalDelPeriodo,
  crearSuscripcionesEnLote,
  previsualizarSubidaTarifa,
  aplicarSubidaTarifa,
  type LineaSubida,
  renovarSuscripcion,
  obtenerCalendarioFacturacion,
  facturarPeriodo,
} from '@/app/actions/portal/suscripciones'
import { cambiarEstadoFacturasEnLote } from '@/app/actions/portal/ventas'
import { guardarTarifaSiVacia } from '@/app/actions/portal/productos'
import { calcularCobroAcuerdo, sumarPeriodo, planReanudacion, diaAnterior } from '@/lib/suscripciones'
import { parseNumeroEs, textoNumeroEs } from '@/lib/numeros'
import type {
  SuscripcionesPageData, SuscripcionRow, EstadoEfectivo, PeriodicidadSub,
  DescuentoModo, ServicioSuscribible,
  CalendarioFacturacion, MesCalendario, EstadoCobro,
} from '@/lib/suscripciones'
import { ESTADO_FACTURA_LABEL, ESTADO_FACTURA_BADGE, type EstadoFactura } from '../ventas/_ventas-helpers'
import ExportarMenu from '@/components/portal/ExportarMenu'

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

function SuscripcionModal({ sub, plantilla, lote: loteInicial, data, onClose, onSaved }: {
  sub: SuscripcionRow | null
  /**
   * Acuerdo del que copiar condiciones (Duplicar). Rellena el formulario pero NO es una
   * edición: el cliente entra en blanco y no se escribe nada hasta guardar. Ojo con la
   * trampa de PK del repo: las líneas se regeneran con `generarLineaId()` en el
   * servidor, aquí nunca se copia un `linea_id`.
   */
  plantilla?: SuscripcionRow | null
  /** Arranca en modo «varios clientes» (lo pide la acción de fila del acuerdo). */
  lote?: boolean
  data: SuscripcionesPageData; onClose: () => void; onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const hoy = hoyEnTz()

  // Editar parte del acuerdo; duplicar y «varios clientes» parten de la plantilla, que
  // trae las condiciones pero nunca el cliente ni el id.
  const base = sub ?? plantilla ?? null

  const [clienteId,    setClienteId]    = useState(sub?.cliente_id ?? '')
  /** Modo lote: a quiénes se les da de alta el mismo acuerdo. */
  const [clientesLote, setClientesLote] = useState<Set<string>>(new Set())
  // Los servicios del acuerdo. Cada uno con SU precio mensual; el resto (moneda,
  // periodicidad, descuento, fechas) se pacta una vez para todo el acuerdo.
  const [lineas,       setLineas]       = useState<LineaForm[]>(() =>
    base ? base.lineas.map(l => ({
            producto_id: l.producto_id, precio: textoNumeroEs(l.precio_mensual),
            dtoModo: l.descuento_modo, dtoValor: l.descuento_valor > 0 ? textoNumeroEs(l.descuento_valor) : '',
          }))
        : [{ producto_id: '', precio: '', dtoModo: 'PORCENTAJE', dtoValor: '' }])
  const [empresaId,    setEmpresaId]    = useState(base?.empresa_id ?? (data.empresas[0]?.empresa_id ?? ''))
  const [moneda,       setMoneda]       = useState(base?.moneda ?? (data.monedas[0] ?? ''))
  const [periodicidad, setPeriodicidad] = useState<PeriodicidadSub>(base?.periodicidad ?? 'MENSUAL')
  const [fechaInicio,  setFechaInicio]  = useState(sub?.fecha_inicio ?? hoy)
  const [proximoCobro, setProximoCobro] = useState(sub?.fecha_proximo_cobro ?? sub?.fecha_inicio ?? hoy)
  const [fechaFin,     setFechaFin]     = useState(base?.fecha_fin ?? '')
  const [renovacion,   setRenovacion]   = useState(base?.renovacion_automatica ?? true)
  const [notas,        setNotas]        = useState(base?.notas ?? '')
  const [prorratear,   setProrratear]   = useState(base?.prorratear ?? false)
  /** «Ya lo tengo cobrado hasta» (YYYY-MM): mueve el próximo cobro, no se guarda. */
  const [cobradoHasta, setCobradoHasta] = useState('')
  // Al EDITAR se abre desplegado: quien edita viene justo a cambiar una de esas fechas.
  const [masOpciones,  setMasOpciones]  = useState(!!sub)
  /**
   * «Varios clientes» era un botón aparte en la cabecera, y eso lo convertía en otra
   * pantalla que hay que descubrir. Es la MISMA alta con una casilla: se decide dentro,
   * con el formulario ya delante.
   */
  const [lote, setLote] = useState(!!loteInicial)
  /**
   * Generar ya las facturas del primer cobro. Marcada, que es el comportamiento de
   * siempre. **Es un «ahora o mañana», no un «sí o no»**: la facturación automática es
   * permanente, así que el cron las genera igual en su mes.
   */
  const [conBorrador, setConBorrador] = useState(true)
  /** Previsualización del lote: se enseña ANTES de escribir nada. */
  const [confirmLote,  setConfirmLote]  = useState<FormData | null>(null)
  /** Índices de línea cuyo precio se guardará también como tarifa del catálogo. */
  const [guardarTarifa, setGuardarTarifa] = useState<Set<number>>(new Set())

  const isEdit = !!sub

  // El importe del cobro NO se teclea: se calcula y se enseña. Cada servicio con su precio
  // y SU descuento (mig. 125); el ciclo hace el resto y el acuerdo suma línea a línea.
  const lineasCobro = lineas.filter(l => l.producto_id).map(l => ({
    precio_mensual:  parseNumeroEs(l.precio),
    descuento_modo:  l.dtoModo,
    descuento_valor: parseNumeroEs(l.dtoValor),
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
    setLinea(i, { producto_id: id, precio: tarifa == null ? '' : textoNumeroEs(tarifa) })
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
      if (tarifa != null) return { ...l, precio: textoNumeroEs(tarifa), origen: undefined }
      const previo = parseNumeroEs(l.precio)
      // Volver a la moneda de la que se venía restaura el importe TAL CUAL: en un acuerdo
      // cerrado el precio pactado no es el de la lista, y deshacer un cambio de moneda no
      // puede re-tarifar por la espalda.
      if (l.origen && l.origen.moneda === m) return { ...l, precio: textoNumeroEs(l.origen.precio), origen: undefined }
      return { ...l, precio: '', origen: previo > 0 ? { moneda: anterior, precio: previo } : undefined }
    }))
  }

  /** El servicio no tiene tarifa en la moneda del acuerdo y el dueño ha escrito un precio. */
  function sinTarifa(l: LineaForm): boolean {
    return !!l.producto_id && parseNumeroEs(l.precio) > 0 && tarifaDe(l.producto_id, moneda) == null
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
        precio_mensual:  l.precio,
        descuento_modo:  l.dtoModo,
        descuento_valor: l.dtoValor,
      })),
    ))
    fd.set('periodicidad', periodicidad)
    fd.set('fecha_inicio', fechaInicio)
    fd.set('fecha_proximo_cobro', proximoCobro)
    fd.set('fecha_fin', fechaFin)
    fd.set('renovacion_automatica', renovacion ? '1' : '')
    fd.set('notas', notas)
    fd.set('prorratear', prorratear ? '1' : '')
    if (!conBorrador) fd.set('sin_borrador', '1')
    // En lote NO se escribe al enviar: primero la previsualización. `borradorDelPrimerCobro`
    // corre por acuerdo, así que un clic sin aviso puede dejar 30 facturas borrador.
    if (lote) { setConfirmLote(fd); return }

    const ld = toastLoading(isEdit ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const res = await guardarSuscripcion(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      // Las tarifas van DESPUÉS y aparte: el acuerdo ya está guardado y nada de esto
      // puede tumbarlo. Cada una escribe solo si esa moneda está vacía.
      let tarifas = 0
      for (const i of guardarTarifa) {
        const l = lineas[i]
        if (!l?.producto_id) continue
        const r = await guardarTarifaSiVacia(l.producto_id, moneda, parseNumeroEs(l.precio))
        if (r.ok && r.escrito) tarifas++
      }
      toastSuccess(
        isEdit          ? 'Suscripción actualizada.'
        // Sin número: el borrador no lo tiene hasta que se emite.
        : res.factura   ? 'Suscripción creada. Su factura borrador ya está en Ventas.'
        :                 'Suscripción creada.',
      )
      if (tarifas) toastSuccess(`${tarifas} ${tarifas === 1 ? 'tarifa guardada' : 'tarifas guardadas'} en el catálogo.`)
      onSaved()
    })
  }

  function crearLote() {
    const fd = confirmLote
    if (!fd) return
    setConfirmLote(null)
    const ld = toastLoading('Creando acuerdos…')
    startTransition(async () => {
      const res = await crearSuscripcionesEnLote(fd, [...clientesLote])
      await ld.dismiss()
      if (res.error) { toastError(res.error); return }
      const partes = [`${res.hechas} ${res.hechas === 1 ? 'acuerdo creado' : 'acuerdos creados'}`]
      if (res.facturas)        partes.push(`${res.facturas} ${res.facturas === 1 ? 'factura borrador' : 'facturas borrador'}`)
      if (res.omitidas.length) partes.push(`${res.omitidas.length} omitido${res.omitidas.length === 1 ? '' : 's'}`)
      if (res.hechas > 0) toastSuccess(partes.join(' · '))
      else                toastError(res.omitidas[0]?.motivo ?? 'No se creó ninguno.')
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-xl" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">
            {isEdit ? 'Editar suscripción' : lote ? 'Añadir a varios clientes' : 'Nueva suscripción'}
          </h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="ter-form-section">
              <span className="ter-form-section-title">Acuerdo</span>
              {/* La casilla va FUERA de la rejilla, en su propia línea: dentro ocupaba una
                  celda de seis y, con su nota debajo, descuadraba la fila de campos. Es el
                  mismo sitio que la casilla de «Suscripción» en la ficha del servicio. */}
              {!isEdit && (
                <label className="checkbox-group sus-lote-toggle">
                  <input type="checkbox" checked={lote}
                    onChange={e => { setLote(e.target.checked); setClientesLote(new Set()) }} />
                  <span className="checkbox-label">
                    Dar de alta a varios clientes a la vez
                    <em className="sus-lote-nota">mismos servicios y condiciones, un acuerdo para cada uno</em>
                  </span>
                </label>
              )}
              <div className="ter-form-grid">
                {/* La EMPRESA va primero porque el cliente depende de ella: los terceros
                    son por-empresa (`third_parties.empresa_id`), así que la lista de abajo
                    es la de la empresa elegida. Al contrario, se elige un cliente y
                    cambiar de empresa lo borra — se rellena un campo para deshacerlo. */}
                {data.empresas.length > 1 && (
                  <div className="input-group ter-col-span-3">
                    <div className="form-label-with-help">
                      <label>Empresa <span className="required">*</span></label>
                      <FormHelp text="Los clientes y las facturas son de esta empresa." label="A qué empresa pertenece" />
                    </div>
                    <select className="input" value={empresaId} onChange={e => onEmpresaChange(e.target.value)} required>
                      {data.empresas.map(em => <option key={em.empresa_id} value={em.empresa_id}>{em.nombre}</option>)}
                    </select>
                  </div>
                )}
                {/* Con la lista de clientes marcables, media fila no da: la caja alta al
                    lado de un `select` bajo es justo lo que se veía torcido. */}
                <div className={`input-group ${lote ? 'ter-col-full' : 'ter-col-span-3'}`}>
                  <label>{lote ? 'Clientes' : 'Cliente'} <span className="required">*</span></label>
                  {lote ? (
                    <>
                      {/* Un acuerdo POR CLIENTE con las mismas condiciones, no un acuerdo
                          compartido: cada uno se factura a su ficha. */}
                      <div className="sus-lote-clientes">
                        {clientesDeEmpresa.map(c => (
                          <label key={c.tercero_id} className="checkbox-group">
                            <input type="checkbox" checked={clientesLote.has(c.tercero_id)}
                              onChange={() => setClientesLote(prev => {
                                const n = new Set(prev)
                                if (n.has(c.tercero_id)) n.delete(c.tercero_id); else n.add(c.tercero_id)
                                return n
                              })} />
                            <span className="checkbox-label">{c.nombre}</span>
                          </label>
                        ))}
                      </div>
                      <span className="input-hint">
                        {clientesLote.size === 0
                          ? 'Marca los clientes que contratan estos servicios.'
                          : `${clientesLote.size} seleccionado${clientesLote.size === 1 ? '' : 's'}: se creará un acuerdo para cada uno.`}
                      </span>
                    </>
                  ) : (
                    <select className="input" value={clienteId} onChange={e => setClienteId(e.target.value)} required>
                      <option value="">— Elige un cliente —</option>
                      {clientesDeEmpresa.map(c => <option key={c.tercero_id} value={c.tercero_id}>{c.nombre}</option>)}
                    </select>
                  )}
                  {clientesDeEmpresa.length === 0 && (
                    <span className="input-hint">Esta empresa aún no tiene clientes dados de alta.</span>
                  )}
                </div>
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
                            {/* Lo archivado (o desmarcado como suscribible) solo se ofrece en
                                la línea que YA lo tiene: sin esto el select caía en «Elige un
                                servicio» sobre una línea que sí lo tenía, y guardar lo
                                borraba. Mismo criterio que `opcionesCon`. */}
                            {data.servicios
                              .filter(sv => !sv.archivado || sv.producto_id === l.producto_id)
                              .map(sv => (
                                <option key={sv.producto_id} value={sv.producto_id}>
                                  {sv.archivado ? `${sv.nombre} (archivado)` : sv.nombre}
                                </option>
                              ))}
                          </select>
                        </div>
                        <div className="input-group sus-linea-form-precio">
                          <label htmlFor={`sus-precio-${i}`}>Precio al mes <span className="required">*</span></label>
                          {/* `type="text" inputMode="decimal"`, como los cinco formularios de
                              Inventario: con `type="number"` en un navegador con locale es,
                              «0,5» llega vacío y «1.500,50» se corta a 1,5. El campo se queda
                              en TEXTO (y no pasa a `CampoNumero`) porque aquí el vacío
                              significa «sin tarifa en esta moneda», que un número no expresa. */}
                          <input className="input" id={`sus-precio-${i}`} type="text" inputMode="decimal"
                            value={l.precio} onChange={e => setLinea(i, { precio: e.target.value })}
                            placeholder="0,00" required />
                        </div>
                        <div className="input-group sus-linea-form-dto">
                          <label htmlFor={`sus-dto-${i}`}>Descuento</label>
                          <div className="sus-dto-row">
                            <input className="input" id={`sus-dto-${i}`} type="text" inputMode="decimal"
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
                      {/* El aviso solo si HAY algo que ofrecer: tarifa en otra moneda Y
                          tasa para convertirla. Antes imprimía «(no hay tasa CUP → USD)»
                          en 55 de 63 líneas — ruido sobre un problema que el dueño no ha
                          creado y que aquí no puede resolver. */}
                      {ref && factor && (
                        <div className="moneda-cambio-nota">
                          <Info size={14} strokeWidth={2} />
                          <span>
                            Sin precio en {moneda}; cuesta {fmtMoneda(ref.precio, ref.moneda)}. Escríbelo en {moneda}
                            {' '}o <button type="button" className="aplicar-tasa-btn"
                              onClick={() => setLinea(i, { precio: textoNumeroEs(Math.round(ref.precio * factor * 100) / 100) })}>
                              usa la tasa ({fmtMoneda(ref.precio * factor, moneda)})</button>.
                          </span>
                        </div>
                      )}
                      {/* El catálogo se rellena SOLO con el uso real: el precio se decide
                          al pactar, no en la lista. Desmarcada, y escribe únicamente si
                          esa moneda está vacía — nunca pisa una tarifa. */}
                      {!isEdit && sinTarifa(l) && (
                        <label className="checkbox-group sus-linea-tarifa">
                          <input type="checkbox" checked={guardarTarifa.has(i)}
                            onChange={() => setGuardarTarifa(prev => {
                              const n = new Set(prev)
                              if (n.has(i)) n.delete(i); else n.add(i)
                              return n
                            })} />
                          <span className="checkbox-label">
                            Guardar también como tarifa de{' '}
                            {data.servicios.find(x => x.producto_id === l.producto_id)?.nombre ?? 'este servicio'}
                            {' '}en {moneda}
                          </span>
                        </label>
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
                  <div className="form-label-with-help">
                    <label htmlFor="sus-moneda">Moneda <span className="required">*</span></label>
                    <FormHelp text="Una sola para todo el acuerdo." label="Información sobre la moneda" />
                  </div>
                  <select className="input" id="sus-moneda" value={moneda}
                    onChange={e => onMonedaChange(e.target.value)} required>
                    {data.monedas.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
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

            {/* ── Lo de abajo es lo que casi nunca se toca ──
                El caso normal es un cliente, un servicio, mensual y desde hoy; el modal
                pedía diez campos para eso, en móvil y en 3G. Se pliega lo secundario y
                **el resumen “Se le cobrará” se queda SIEMPRE visible**: es lo único que
                hay que comprobar antes de guardar. */}
            <button type="button" className="sus-mas-opciones"
              onClick={() => setMasOpciones(v => !v)} aria-expanded={masOpciones}>
              <ChevronDown size={16} strokeWidth={2.5}
                className={`sus-futuro-chevron${masOpciones ? ' sus-futuro-chevron-open' : ''}`} />
              {masOpciones ? 'Menos opciones' : 'Más opciones'}
              {!masOpciones && (
                <span className="sus-mas-opciones-nota">fechas, fin, renovación y notas</span>
              )}
            </button>

            <div className={`ter-form-section${masOpciones ? '' : ' sus-oculto'}`}>
              <span className="ter-form-section-title">Vigencia</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-2">
                  <div className="form-label-with-help">
                    <label htmlFor="sus-inicio">Inicio <span className="required">*</span></label>
                    <FormHelp text="Desde cuándo tiene contratado el servicio." label="Información sobre el inicio" />
                  </div>
                  <input className="input" id="sus-inicio" type="date" value={fechaInicio}
                    onChange={e => setFechaInicio(e.target.value)} required />
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
                  {/* Migrar un acuerdo que YA está cobrado hasta agosto obligaba a
                      entender la fecha y moverla a mano, o se facturaba un mes ya
                      cobrado. Aquí se dice en las palabras del dueño. */}
                  {!isEdit && (
                    <div className="sus-cobrado-hasta">
                      <label htmlFor="sus-cobrado">Ya lo tengo cobrado hasta</label>
                      <input className="input input-sm" id="sus-cobrado" type="month"
                        value={cobradoHasta}
                        onChange={e => {
                          setCobradoHasta(e.target.value)
                          if (!e.target.value) return
                          // El siguiente cobro es el día 1 del mes que sigue al cubierto.
                          const [y, m] = e.target.value.split('-').map(Number)
                          setProximoCobro(new Date(Date.UTC(y, m, 1)).toISOString().split('T')[0])
                        }} />
                    </div>
                  )}
                </div>
                <div className="input-group ter-col-span-2">
                  <div className="form-label-with-help">
                    <label htmlFor="sus-fin">Fin (opcional)</label>
                    <FormHelp text="Vacío = indefinida: se cobra hasta que la canceles." label="Información sobre el fin" />
                  </div>
                  <input className="input" id="sus-fin" type="date" value={fechaFin}
                    onChange={e => setFechaFin(e.target.value)} />
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
                {/* Con la fecha en el PASADO no es información: es una factura atrasada que
                    va a nacer, y ahí sí hace falta un aviso —la casilla de arriba solo dice
                    qué se va a generar, no que llega tarde. */}
                {!isEdit && conBorrador && proximoCobro && proximoCobro < hoy && (
                  <div className="ter-col-full">
                    <div className="alert alert-warning">
                      <span>
                        El primer cobro es del <strong>{fmtDate(proximoCobro)}</strong>, que ya
                        pasó: {lote ? 'las facturas nacerán atrasadas' : 'la factura nacerá atrasada'}.
                        Si ya lo tienes cobrado, dilo arriba en «Ya lo tengo cobrado hasta».
                      </span>
                    </div>
                  </div>
                )}
                {/* **UNA FACTURA POR CLIENTE, y eso no se elige**: una factura pertenece a un
                    cliente, así que con diez clientes son diez facturas —agrupar dos
                    clientes en un documento sería facturarle a uno el servicio de otro—.
                    Lo que SÍ se elige es cuándo nacen. */}
                {!isEdit && proximoCobro && proximoCobro <= hoy && (
                  <div className="input-group ter-col-full">
                    <label className="checkbox-group">
                      <input type="checkbox" checked={conBorrador}
                        onChange={e => setConBorrador(e.target.checked)} />
                      <span className="checkbox-label">
                        Generar ya {lote ? 'sus facturas borrador' : 'su factura borrador'}
                        {lote && clientesLote.size > 0 && ` (${clientesLote.size})`}
                      </span>
                    </label>
                    <span className="input-hint">
                      {conBorrador
                        ? lote
                          ? 'Una por cliente: una factura pertenece a un cliente, así que no se pueden juntar.'
                          : 'Queda en Ventas como borrador; emitirla sigue siendo cosa tuya.'
                        : 'Sin generarlas ahora. No se pierde nada: la facturación automática las deja hechas en su mes.'}
                    </span>
                  </div>
                )}
                {/* Prorrateo: solo tiene sentido si el acuerdo empieza DESPUÉS de abrirse
                    su primer ciclo — si no, la primera factura ya cubre el ciclo entero. */}
                {!isEdit && fechaInicio && proximoCobro && fechaInicio > proximoCobro && (
                  <div className="input-group ter-col-full">
                    <label className="checkbox-group">
                      <input type="checkbox" checked={prorratear}
                        onChange={e => setProrratear(e.target.checked)} />
                      <span className="checkbox-label">
                        Cobrar solo los días usados en el primer cobro
                      </span>
                    </label>
                    <span className="input-hint">
                      Empieza el {fmtDate(fechaInicio)} y el ciclo abrió el {fmtDate(proximoCobro)}:
                      la primera factura cobraría la parte proporcional y lo dirá en su línea.
                    </span>
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
            <button type="submit" className="btn btn-primary"
              disabled={isPending || (lote && clientesLote.size === 0)}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios'
                : lote   ? `Revisar y crear ${clientesLote.size || ''}`.trim()
                :          'Crear suscripción'}
            </button>
          </div>
        </form>
      </div>

      {/* Previsualización OBLIGATORIA del lote: dice exactamente qué se va a escribir
          —acuerdos y facturas borrador— antes de escribir nada. */}
      {confirmLote && (
        <ConfirmDialog
          title="Revisa antes de crear"
          body={
            <>
              <p>
                Se crearán <strong>{clientesLote.size}</strong>{' '}
                {clientesLote.size === 1 ? 'acuerdo' : 'acuerdos'} de{' '}
                <strong>{fmtMoneda(cobro.total, moneda)}</strong> por cobro
                ({PERIODICIDAD_LABEL[periodicidad].toLowerCase()}), uno por cliente.
              </p>
              {proximoCobro <= hoy && (
                <p className="mt-2">
                  {conBorrador
                    ? <>El primer cobro es del {fmtDate(proximoCobro)}, así que además se generarán{' '}
                        <strong>{clientesLote.size} {clientesLote.size === 1 ? 'factura borrador' : 'facturas borrador'}</strong>{' '}
                        —una por cliente— en Ventas. Ninguna se emite: revisarlas y emitirlas
                        sigue siendo cosa tuya.</>
                    : <>No se generará ninguna factura ahora. La facturación automática las
                        dejará hechas en su mes.</>}
                </p>
              )}
              <p className="mt-2 text-sm-muted">
                {[...clientesLote].map(id => data.clientes.find(c => c.tercero_id === id)?.nombre ?? id).join(', ')}
              </p>
            </>
          }
          confirmLabel={`Crear ${clientesLote.size}`}
          onCancel={() => setConfirmLote(null)}
          onConfirm={crearLote}
        />
      )}
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

// El verde solo para lo que TERMINÓ. Con la facturación automática siempre puesta, el mes
// se ponía verde el día que corría el cron: 55 borradores sin emitir y la pantalla
// diciendo que estaba hecho.
const ESTADO_COBRO_LABEL: Record<EstadoCobro, string> = {
  PENDIENTE:  'Pendiente de facturar',
  BORRADOR:   'Pendiente de emitir',
  EMITIDO:    'Pendiente de cobro',
  COBRADO:    'Cobrado',
  PROYECTADO: 'Previsto',
}
// El color dice LO MISMO que en Ventas y en CxC, porque es el mismo hecho visto desde
// otra pantalla: emitida y esperando al cliente = `info`; cobrada = `success`; vencida =
// `error`. Lo que queda en el tejado del dueño va en ámbar, y da igual si el paso que le
// falta es facturar o emitir: eso lo dice la etiqueta, no el color.
//
// Y el morado NO se usa aquí. Los tonos `purple/indigo/rose` son para etiquetas
// CATEGÓRICAS (lo que algo ES: «Suscribible · Mensual»), no para estados: pintar «Pendiente
// de cobro» del mismo morado que «Suscribible» hace creer que tienen algo que ver.
const ESTADO_COBRO_BADGE: Record<EstadoCobro, string> = {
  PENDIENTE:  'badge-warning',
  BORRADOR:   'badge-warning',
  EMITIDO:    'badge-info',
  COBRADO:    'badge-success',
  PROYECTADO: 'badge-neutral',
}

function MesCard({ mes, atrasado, primario, tieneBase, excluidos, onToggle, onGenerar, onEmitir, isPending, puedeEditar }: {
  mes:       MesCalendario
  /** Su mes ya pasó y sigue sin factura: se marca, que es justo lo que antes no se veía. */
  atrasado:  boolean
  /** El mes pendiente MÁS ANTIGUO: el único con botón primario (C8). */
  primario:  boolean
  tieneBase: boolean
  excluidos: Set<string>
  onToggle:  (key: string) => void
  onGenerar: (periodo: string) => void
  onEmitir:  (ids: string[], onDone: () => void) => void
  isPending: boolean
  puedeEditar: boolean
}) {
  const accionable = mes.estado === 'PENDIENTE' && mes.grupos.length > 0
  const incluidos  = mes.grupos.filter(g => !excluidos.has(`${mes.periodo}#${g.cliente_id}#${g.moneda}`))

  // Emitir en lote: la diferencia entre 55 clics y uno. Solo los BORRADOR — es el único
  // origen válido de la transición, y la acción de servidor omite el resto con su motivo.
  const borradores = mes.facturas.filter(f => f.estado === 'BORRADOR')
  const sel = useRowSelection(borradores.map(f => f.factura_id))

  // El importe de lo que se va a generar, por moneda: el botón que mueve dinero dice
  // cuánto mueve. Nunca sumando monedas distintas.
  const porGenerar = new Map<string, number>()
  for (const g of incluidos) porGenerar.set(g.moneda, (porGenerar.get(g.moneda) ?? 0) + g.total)
  const textoGenerar = `Generar ${incluidos.length} ${incluidos.length === 1 ? 'factura' : 'facturas'}`
    + (porGenerar.size ? ` · ${[...porGenerar.entries()].map(([m, t]) => fmtMoneda(t, m)).join(' + ')}` : '')

  return (
    <div className="card card-table sus-mes">
      <div className="mon-card-header sus-mes-header">
        <div className="sus-mes-titulo">
          <h2 className="sus-mes-nombre">{fmtPeriodo(mes.periodo)}</h2>
          <span className={`badge ${atrasado ? 'badge-error' : ESTADO_COBRO_BADGE[mes.estado]}`}>
            {atrasado ? 'Vencido sin facturar' : ESTADO_COBRO_LABEL[mes.estado]}
          </span>
          <span className="sus-mes-totales">
            {mes.totales.map(t => (
              <span key={t.moneda} className="sus-mes-total">
                {fmtMoneda(t.total, t.moneda)}
                {/* El total solo no distingue «facturado» de «cobrado», que es justo lo
                    que hay que saber para trabajar el mes. */}
                {(t.facturado > 0 || t.pendiente > 0) && (
                  <span className="sus-mes-desglose">
                    {[
                      t.cobrado   > 0 ? `${fmtMoneda(t.cobrado, t.moneda)} cobrado` : null,
                      t.facturado - t.cobrado > 0.005 ? `${fmtMoneda(t.facturado - t.cobrado, t.moneda)} por cobrar` : null,
                      t.pendiente > 0 ? `${fmtMoneda(t.pendiente, t.moneda)} sin facturar` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
            ))}
          </span>
        </div>
        {puedeEditar && accionable && tieneBase && (
          <button className={`btn btn-sm ${primario ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onGenerar(mes.periodo)}
            disabled={isPending || incluidos.length === 0}>
            {isPending
              ? <><span className="spinner spinner-sm" /> Generando…</>
              : textoGenerar}
          </button>
        )}
        {mes.facturas.length > 0 && !accionable && (
          <Link href="/portal/ventas" className="btn btn-secondary btn-sm">Ver en Facturas</Link>
        )}
      </div>

      {atrasado && (
        <div className="sus-mes-aviso">
          <AlertTriangle size={14} strokeWidth={2} />
          <span>Este cobro está vencido y sin facturar. Genera la factura aquí para que quede fechada en su mes.</span>
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
                {puedeEditar && borradores.length > 0 && (
                  <th className="col-center">
                    <input type="checkbox" checked={sel.allSelected}
                      ref={el => { if (el) el.indeterminate = sel.someSelected }}
                      onChange={sel.toggleAll} aria-label="Seleccionar todos los borradores" />
                  </th>
                )}
                <th>Nº</th>
                <th>Cliente</th>
                <th className="col-center">Suscripciones</th>
                <th className="col-num">Total</th>
                <th className="col-num">Debe</th>
                <th>Estado</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {mes.facturas.map(f => (
                <tr key={f.factura_id}>
                  {puedeEditar && borradores.length > 0 && (
                    <td data-label="Seleccionar" className="col-center">
                      {f.estado === 'BORRADOR' && (
                        <input type="checkbox" checked={sel.isSelected(f.factura_id)}
                          onChange={() => sel.toggle(f.factura_id)}
                          aria-label={`Seleccionar la factura ${f.numero}`} />
                      )}
                    </td>
                  )}
                  <td data-label="Nº"><strong className="text-sm-bold">{f.numero}</strong></td>
                  <td data-label="Cliente" className="text-sm-muted"><span className="cell-clamp">{f.cliente_nombre}</span></td>
                  <td data-label="Suscripciones" className="col-center text-sm-muted">{f.suscripciones}</td>
                  <td data-label="Total" className="col-num">{fmtMoneda(f.total, f.moneda)}</td>
                  {/* Vacío ≠ 0: un borrador no debe nada TODAVÍA, y escribir «0» diría
                      que ya está cobrado, que es la conclusión contraria. */}
                  <td data-label="Debe" className="col-num">
                    {f.estado === 'BORRADOR' ? '' : f.saldo > 0.005 ? fmtMoneda(f.saldo, f.moneda) : '—'}
                  </td>
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

      {/* Lo pendiente de facturar: se marca qué entra y se genera */}
      {accionable && (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                {puedeEditar && <th className="col-center">Incluir</th>}
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
                    {puedeEditar && (
                      <td data-label="Incluir" className="col-center">
                        <input type="checkbox" checked={incluido} onChange={() => onToggle(key)}
                          aria-label={`Incluir a ${g.cliente_nombre} en ${g.moneda}`} />
                      </td>
                    )}
                    <td data-label="Cliente"><strong className="text-sm-bold cell-clamp">{g.cliente_nombre}</strong></td>
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

      {/* Emitir es lo que RESERVA el correlativo fiscal, así que se avisa. Si alguna
          falla, el lote no se aborta: la acción reporta las omitidas con su motivo. */}
      {puedeEditar && (
        <BulkBar count={sel.count} onClear={sel.clear}>
          <button className="btn btn-primary btn-sm" disabled={isPending}
            onClick={() => onEmitir(sel.selectedIds, sel.clear)}>
            <Receipt size={14} strokeWidth={2} /> Emitir
          </button>
        </BulkBar>
      )}
    </div>
  )
}

function FacturacionPanel({ data, empresaInicial, puedeEditar }: {
  data: SuscripcionesPageData
  /** La última empresa que se miró (cookie), resuelta en el servidor. */
  empresaInicial: string
  puedeEditar: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Con varias empresas, volver siempre a la primera obliga a reelegir en cada visita.
  // Mismo patrón que `rep_ver` en Reportes: cookie, resuelta en servidor para que el
  // primer pintado ya sea el bueno.
  const [empresaId,  setEmpresaId]  = useState(empresaInicial || data.empresas[0]?.empresa_id || '')
  const [calendario, setCalendario] = useState<CalendarioFacturacion | null>(null)
  const [excluidos,  setExcluidos]  = useState<Set<string>>(new Set())
  const [verFuturo,  setVerFuturo]  = useState(false)
  const [recarga,    setRecarga]    = useState(0)
  const [confirmEmitir, setConfirmEmitir] = useState<{ ids: string[]; onDone: () => void } | null>(null)

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
  // Con varios meses atrasados había varios botones primarios compitiendo. Solo lo lleva
  // el más antiguo pendiente: es el que hay que cerrar primero.
  const primerPendiente = ahora.find(m => m.estado === 'PENDIENTE' && m.grupos.length > 0)?.periodo ?? ''

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

  function elegirEmpresa(id: string) {
    document.cookie = `sus_empresa=${id}; path=/; max-age=31536000`
    setEmpresaId(id)
  }

  /**
   * Emitir en lote los borradores marcados de un mes. `cambiarEstadoFacturasEnLote` ya
   * valida las transiciones y reporta las omitidas con su motivo, así que aquí solo se
   * confirma (emitir GASTA serie fiscal) y se cuenta lo que pasó.
   */
  function emitir(ids: string[], onDone: () => void) {
    setConfirmEmitir({ ids, onDone })
  }
  function emitirConfirmado() {
    const pend = confirmEmitir
    if (!pend) return
    setConfirmEmitir(null)
    const ld = toastLoading('Emitiendo…')
    startTransition(async () => {
      const r = await cambiarEstadoFacturasEnLote(pend.ids, 'EMITIDA')
      await ld.dismiss()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas)          partes.push(`${r.hechas} emitida${r.hechas === 1 ? '' : 's'}`)
      if (r.omitidas.length) partes.push(`${r.omitidas.length} omitida${r.omitidas.length === 1 ? '' : 's'}`)
      if (r.errores.length)  partes.push(`${r.errores.length} con error`)
      const msg = partes.join(' · ') || 'Nada que hacer'
      if (r.hechas > 0 && r.errores.length === 0) toastSuccess(msg)
      else                                        toastError(msg)
      pend.onDone()
      setRecarga(n => n + 1)
      router.refresh()
    })
  }

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
        <EmpresaPills empresas={empresasPills} value={empresaId} onChange={elegirEmpresa} sinTodas />
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
          primario={m.periodo === primerPendiente}
          tieneBase={data.tieneBase} excluidos={excluidos}
          onToggle={toggleExcluir} onGenerar={generar} onEmitir={emitir} isPending={isPending}
          puedeEditar={puedeEditar} />
      ))}

      {confirmEmitir && (
        <ConfirmDialog
          title={`Emitir ${confirmEmitir.ids.length} ${confirmEmitir.ids.length === 1 ? 'factura' : 'facturas'}`}
          body={
            <>
              <p>
                Se emitirán <strong>{confirmEmitir.ids.length}</strong>{' '}
                {confirmEmitir.ids.length === 1 ? 'factura' : 'facturas'} borrador.
              </p>
              <p className="mt-2">
                Al emitir se <strong>asigna el número fiscal</strong> de la serie, y ese
                número no se devuelve: una emitida se anula, no se borra.
              </p>
            </>
          }
          confirmLabel="Emitir"
          onCancel={() => setConfirmEmitir(null)}
          onConfirm={emitirConfirmado}
        />
      )}

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
            Previsión con las condiciones actuales. No se puede facturar por adelantado:
            cada mes se genera cuando llega.
          </span>
          {verFuturo && futuro.map(m => (
            <MesCard key={m.periodo} mes={m} atrasado={false} primario={false}
              tieneBase={data.tieneBase} excluidos={excluidos}
              onToggle={toggleExcluir} onGenerar={generar} onEmitir={emitir} isPending={isPending}
              puedeEditar={puedeEditar} />
          ))}
        </div>
      )}
    </>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function SuscripcionesView({ data, empresaInicial = '', etiqueta = 'Suscripciones', puedeEditar, children }: {
  data: SuscripcionesPageData
  /** Última empresa mirada en «Facturación del período» (cookie `sus_empresa`). */
  empresaInicial?: string
  /** Cómo llama el negocio a esto: «Membresías», «Bonos»… (mig. 164). */
  etiqueta?: string
  /** Permiso de escritura del módulo `servicios` (cubre solo_lectura y falta de módulo). */
  puedeEditar: boolean
  children?: React.ReactNode
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [modal,     setModal]     = useState<null | 'nueva' | 'editar' | 'duplicar' | 'lote'>(null)
  const [editSub,   setEditSub]   = useState<SuscripcionRow | null>(null)
  const [cancelSub, setCancelSub] = useState<SuscripcionRow | null>(null)
  // Cancelar tiene DOS bajas distintas y cada una dice otra cosa sobre el cobro en curso,
  // así que son dos entradas del menú con su propio diálogo: «al final del período» (lo
  // normal en un contrato: el mes ya cobrado se respeta) y «ahora» (corte inmediato).
  const [finPeriodoSub, setFinPeriodoSub] = useState<SuscripcionRow | null>(null)
  const [pausarSub, setPausarSub] = useState<SuscripcionRow | null>(null)
  const [pausarHasta, setPausarHasta] = useState('')
  const [reanudarSub, setReanudarSub] = useState<SuscripcionRow | null>(null)
  const [cobrarPausados, setCobrarPausados] = useState(false)
  // Los filtros viven en la URL, como el rango: refrescar ya no los tira.
  // La empresa existía en Facturación y NO en Acuerdos, con la misma tabla mezclando
  // acuerdos de dos empresas sin decirlo. '' = todas.
  const params = useSearchParams()
  const search     = params.get('q')       ?? ''
  const filtro     = (params.get('estado') ?? '') as '' | EstadoEfectivo
  const empresaFil = params.get('empresa') ?? ''
  // El único filtro que un gestor de cuotas abre a diario.
  const soloDeuda  = params.get('deuda') === '1'
  /** Fila desplegada: su histórico de facturas. Sin página de detalle por acuerdo. */
  const [abierta, setAbierta] = useState<string | null>(null)
  // Subida de tarifa en lote: el caso comercial del modelo (30 socios = 30 ediciones).
  const [subidaAbierta, setSubidaAbierta] = useState(false)
  const [subidaModo,  setSubidaModo]  = useState<'PORCENTAJE' | 'IMPORTE'>('PORCENTAJE')
  const [subidaValor, setSubidaValor] = useState('')
  const [subidaPrev,  setSubidaPrev]  = useState<LineaSubida[] | null>(null)
  const [vista,     setVista]     = useState<'acuerdos' | 'facturacion'>('acuerdos')

  // Solo para PREVISUALIZAR la reanudación en el diálogo. Quien decide es el servidor,
  // que recalcula con su propio «hoy» y devuelve lo que de verdad aplicó.
  const hoy = hoyEnTz()

  // El conteo va en la etiqueta, como «Solo bajo mínimo» de Inventario: un filtro que no
  // dice cuántos hay obliga a marcarlo para averiguarlo.
  const conDeudaCount = data.suscripciones.filter(s => s.debe.length > 0).length

  const { colorOf: colorEmpresa } = useEmpresas()
  const empresasListado = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorEmpresa(e.empresa_id),
  }))

  const faltaSetup = data.empresas.length === 0 || data.monedas.length === 0
  const sinClientes = data.clientes.length === 0
  // Solo cuentan los OFRECIBLES: los archivados viajan para no perderlos al editar, pero
  // un negocio cuyos servicios están todos archivados no puede crear un acuerdo nuevo.
  const sinServicios = data.servicios.every(s => s.archivado)
  const puedeCrear = !faltaSetup && !sinClientes && !sinServicios

  /**
   * LA DECLARACIÓN. De aquí salen la barra, el filtro de la descarga y su resumen.
   *
   * Todos en `cliente`: el estado efectivo (Vencida) se DERIVA (mig. 125) y la deuda se
   * calcula sobre las facturas, así que ninguno es una columna que la consulta pueda filtrar.
   * Cuando el listado está recortado lo dice el aviso del techo.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      clave: 'empresa_id', param: 'empresa', label: 'Todas',
      rotulo: 'Empresa',
      valor: empresaFil, widget: 'pastillas', donde: 'cliente',
      ocultarSi: data.empresas.length <= 1,
      opciones: empresasListado.map(e => ({ valor: e.empresa_id, label: e.nombre, color: e.color })),
    },
    {
      clave: 'estado', label: 'Todos los estados', valor: filtro,
      rotulo: 'Estado',
      widget: 'select', donde: 'cliente',
      opciones: [
        { valor: 'ACTIVA',    label: 'Activas' },
        { valor: 'PAUSADA',   label: 'Pausadas' },
        { valor: 'VENCIDA',   label: 'Vencidas' },
        { valor: 'CANCELADA', label: 'Canceladas' },
      ],
    },
    {
      // El conteo va en la etiqueta: un filtro que no dice cuántos hay obliga a marcarlo
      // para averiguarlo. Y `sinExportar` porque la deuda no es columna: el fichero no
      // puede reproducirla, así que se dice en vez de prometerlo.
      clave: 'con_saldo', param: 'deuda',
      label: conDeudaCount > 0 ? `Con deuda (${conDeudaCount})` : 'Con deuda',
      valor: soloDeuda ? '1' : '', widget: 'toggle', donde: 'cliente', sinExportar: true,
    },
  ], [empresaFil, filtro, soloDeuda, conDeudaCount, data.empresas.length, empresasListado])

  const filtradas = useMemo(() => {
    const q = search.toLowerCase().trim()
    return data.suscripciones.filter(s => {
      if (empresaFil && s.empresa_id !== empresaFil) return false
      if (soloDeuda && s.debe.length === 0) return false
      if (filtro && s.estado_efectivo !== filtro) return false
      const texto = `${s.cliente_nombre} ${s.lineas.map(l => l.servicio_nombre).join(' ')}`
      if (q && !texto.toLowerCase().includes(q)) return false
      return true
    })
  }, [data.suscripciones, search, filtro, empresaFil, soloDeuda])

  const { pageItems, ...pag } = usePagination(filtradas)
  const sel = useRowSelection(pageItems.map(s => s.suscripcion_id))

  /** Previsualiza la subida: el antes → después, acuerdo a acuerdo, antes de escribir. */
  function previsualizarSubida() {
    const ld = toastLoading('Calculando…')
    startTransition(async () => {
      const r = await previsualizarSubidaTarifa(sel.selectedIds, subidaModo, parseNumeroEs(subidaValor))
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error'); return }
      setSubidaPrev(r.lineas ?? [])
    })
  }
  function aplicarSubida() {
    const ld = toastLoading('Aplicando…')
    startTransition(async () => {
      const r = await aplicarSubidaTarifa(sel.selectedIds, subidaModo, parseNumeroEs(subidaValor))
      await ld.dismiss()
      if (r.error) { toastError(r.error); return }
      toastSuccess(`${r.hechas} ${r.hechas === 1 ? 'acuerdo actualizado' : 'acuerdos actualizados'}`
        + (r.omitidas.length ? ` · ${r.omitidas.length} omitido${r.omitidas.length === 1 ? '' : 's'}` : ''))
      setSubidaPrev(null); setSubidaAbierta(false); setSubidaValor('')
      sel.clear(); router.refresh()
    })
  }

  function openCreate()                { setEditSub(null); setModal('nueva') }
  function openEdit(s: SuscripcionRow)    { setEditSub(s); setModal('editar') }
  /** Duplicar: mismas condiciones, cliente en blanco. No escribe nada hasta guardar. */
  function openDuplicar(s: SuscripcionRow) { setEditSub(s); setModal('duplicar') }
  /** El mismo acuerdo para varios clientes (así crece un negocio de cuotas). */
  function openLote(s?: SuscripcionRow)    { setEditSub(s ?? null); setModal('lote') }
  function cerrarModal()               { setModal(null); setEditSub(null) }
  function onSaved()                   { cerrarModal(); router.refresh() }

  function accionEstado(
    id: string, estado: 'ACTIVA' | 'PAUSADA' | 'CANCELADA', msg: string,
    opciones?: { pausada_hasta?: string | null; cobrarPausados?: boolean },
  ) {
    // El toast de carga se crea ANTES de la transición: creado dentro, no llega a pintarse.
    const ld = toastLoading(estado === 'PAUSADA' ? 'Pausando…' : estado === 'ACTIVA' ? 'Reanudando…' : 'Cancelando…')
    startTransition(async () => {
      const res = await cambiarEstadoSuscripcion(id, estado, opciones)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      // Lo que se dice es lo que el SERVIDOR aplicó, no lo que el diálogo prometió.
      toastSuccess(res.ciclosSaltados
        ? `Reanudada. Los ${res.ciclosSaltados} cobro${res.ciclosSaltados === 1 ? '' : 's'} de la pausa no se cobran; el próximo es el ${fmtDate(res.proximoCobro!)}.`
        : msg)
      cerrarDialogos(); router.refresh()
    })
  }
  function cerrarDialogos() {
    setCancelSub(null); setFinPeriodoSub(null)
    setPausarSub(null); setPausarHasta('')
    setReanudarSub(null); setCobrarPausados(false)
  }
  function accionFinPeriodo(s: SuscripcionRow) {
    const ld = toastLoading('Programando la baja…')
    startTransition(async () => {
      const res = await cancelarAlFinalDelPeriodo(s.suscripcion_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      toastSuccess(`Deja de cobrarse el ${fmtDate(res.fecha_fin!)}.`)
      cerrarDialogos(); router.refresh()
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
            <h1 className="page-title">{etiqueta}</h1>
            <IaTouchpoint tipo="suscripciones" descripcion="un análisis de tus suscripciones" />
          </div>
          <p className="page-subtitle">Lo que tus clientes tienen contratado, con su precio y su renovación.</p>
        </div>
        {vista === 'acuerdos' && (
          <div className="tes-header-actions">
            <ExportarMenu
              clave="suscripciones"
              filtro={filtroExport(declaracion, {
                q: search,
                desde: data.rango.desde || undefined, hasta: data.rango.hasta || undefined,
              })}
              resumen={[...resumenDe(declaracion), ...(search ? [`«${search}»`] : [])]}
            />
            {/* Una sola entrada al alta: «varios clientes» es una casilla DENTRO del
                modal, no otra pantalla que haya que descubrir en la cabecera.
                `puedeCrear` es READINESS de datos (hay empresa/clientes/servicios); el
                permiso es aparte: sin él, el botón no existe. */}
            {puedeEditar && (
              <button className="btn btn-primary" onClick={openCreate} disabled={!puedeCrear}>
                <Plus size={14} strokeWidth={2.5} /> Nueva suscripción
              </button>
            )}
          </div>
        )}
      </div>
      {children}

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
      {/* Una sola fila. Presets de FUTURO: el rango se aplica a `fecha_proximo_cobro`, o sea
          a lo que viene. Ofrecía los de un listado histórico («Mes pasado», «Últimos 3
          meses»), que sobre cobros futuros no significan nada. */}
      <Filtros
        filtros={declaracion}
        rango={data.rango}
        q={search}
        placeholder="Buscar por cliente o servicio…"
        presets={PRESETS_FUTURO}
        hayMas={data.hay_mas}
      />

      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">Acuerdos</h2>
          <span className="card-count">{filtradas.length} de {data.suscripciones.length}</span>
        </div>

        {/* El techo recorta por fecha de cobro: decir cuántos faltan y poder traerlos, no
            «acota el rango» —que obligaba a adivinar unas fechas a mano—. */}
        {data.hay_mas && (
          <AvisoTope mostrados={data.suscripciones.length} total={data.total}
            limite={data.limite} sustantivo="acuerdos" />
        )}

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
                  <th className="col-check">
                    <input type="checkbox" checked={sel.allSelected}
                      ref={el => { if (el) el.indeterminate = sel.someSelected }}
                      onChange={sel.toggleAll} aria-label="Seleccionar todos" />
                  </th>
                  <th>Cliente</th>
                  {data.empresas.length > 1 && <th>Empresa</th>}
                  <th>Servicios</th>
                  <th className="col-num">Cada cobro</th>
                  <th>Periodicidad</th>
                  <th>Próximo cobro</th>
                  <th>Último cobro</th>
                  <th className="col-num">Debe</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(s => (
                  <Fragment key={s.suscripcion_id}>
                  <tr>
                    <td className="col-check">
                      <input type="checkbox" className="row-check" checked={sel.isSelected(s.suscripcion_id)}
                        onChange={() => sel.toggle(s.suscripcion_id)}
                        aria-label={`Seleccionar el acuerdo de ${s.cliente_nombre}`} />
                    </td>
                    <td data-label="Cliente"><strong className="text-sm-bold cell-clamp">{s.cliente_nombre}</strong></td>
                    {data.empresas.length > 1 && (
                      <td data-label="Empresa" className="text-sm-muted">
                        {data.empresas.find(e => e.empresa_id === s.empresa_id)?.nombre ?? '—'}
                      </td>
                    )}
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
                    {/* Último cobro y Debe: vacío ≠ 0. Un acuerdo sin facturar todavía no
                        debe nada, y escribir «0» diría que está al día. */}
                    <td data-label="Último cobro" className="text-sm-muted">
                      {s.historial[0] ? (
                        <>
                          {fmtDate(s.historial[0].fecha_emision)}
                          <div className="table-cell-sub">
                            {ESTADO_FACTURA_LABEL[s.historial[0].estado as EstadoFactura] ?? s.historial[0].estado}
                          </div>
                        </>
                      ) : '—'}
                    </td>
                    <td data-label="Debe" className="col-num">
                      {s.debe.length === 0
                        ? (s.historial.length ? '—' : '')
                        : s.debe.map(d => (
                            <div key={d.moneda} className="sus-debe">{fmtMoneda(d.total, d.moneda)}</div>
                          ))}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge ${ESTADO_BADGE[s.estado_efectivo]}`}>{ESTADO_LABEL[s.estado_efectivo]}</span>
                      {/* «¿Por qué está vencida y no cancelada?» es la pregunta que se
                          hace el dueño delante de esta fila: la respuesta es su fecha de
                          fin. Y una pausa con vuelta programada dice cuándo vuelve, o la
                          fecha que se tecleó al pausar no se ve en ninguna parte. */}
                      {s.estado_efectivo === 'VENCIDA' && s.fecha_fin && (
                        <div className="table-cell-sub">Terminó el {fmtDate(s.fecha_fin)}</div>
                      )}
                      {s.estado === 'PAUSADA' && s.pausada_hasta && (
                        <div className="table-cell-sub">Vuelve el {fmtDate(s.pausada_hasta)}</div>
                      )}
                    </td>
                    <td className="col-actions">
                      {/* «Ver sus facturas» es lectura y se queda para todos; el resto son
                          acciones de escritura y solo salen con permiso. Si no queda
                          ninguna entrada, no se pinta el menú «⋯» vacío. */}
                      {(s.historial.length > 0 || puedeEditar) && (
                      <RowActions>
                        {s.historial.length > 0 && (
                          <button className="row-actions-item"
                            onClick={() => setAbierta(a => a === s.suscripcion_id ? null : s.suscripcion_id)}>
                            <Receipt size={15} strokeWidth={2} />
                            {abierta === s.suscripcion_id ? 'Ocultar sus facturas' : `Ver sus facturas (${s.historial.length})`}
                          </button>
                        )}
                        {puedeEditar && (<>
                        {s.estado !== 'CANCELADA' && (
                          <button className="row-actions-item" onClick={() => openEdit(s)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                        )}
                        <button className="row-actions-item" onClick={() => openDuplicar(s)}>
                          <Copy size={15} strokeWidth={2} /> Duplicar
                        </button>
                        <button className="row-actions-item" onClick={() => openLote(s)}>
                          <Users size={15} strokeWidth={2} /> Añadir a varios clientes
                        </button>
                        {s.estado === 'ACTIVA' && (
                          <button className="row-actions-item" onClick={() => setPausarSub(s)} disabled={isPending}>
                            <Pause size={15} strokeWidth={2} /> Pausar
                          </button>
                        )}
                        {s.estado === 'PAUSADA' && (
                          <button className="row-actions-item" onClick={() => setReanudarSub(s)} disabled={isPending}>
                            <Play size={15} strokeWidth={2} /> Reanudar
                          </button>
                        )}
                        {(s.estado_efectivo === 'VENCIDA' || s.estado === 'CANCELADA') && (
                          <button className="row-actions-item" onClick={() => accionRenovar(s.suscripcion_id)} disabled={isPending}>
                            <RotateCcw size={15} strokeWidth={2} /> Renovar
                          </button>
                        )}
                        {/* Dos bajas, no una: lo normal en un contrato es terminar al
                            final del período ya cobrado, y va primero por eso. «Ahora»
                            corta el mismo día y por eso es la roja. */}
                        {s.estado !== 'CANCELADA' && s.estado_efectivo !== 'VENCIDA' && (
                          <button className="row-actions-item" onClick={() => setFinPeriodoSub(s)} disabled={isPending}>
                            <CalendarX size={15} strokeWidth={2} /> Cancelar al final del período
                          </button>
                        )}
                        {s.estado !== 'CANCELADA' && (
                          <button className="row-actions-item row-actions-item-danger" onClick={() => setCancelSub(s)} disabled={isPending}>
                            <XCircle size={15} strokeWidth={2} /> Cancelar ahora
                          </button>
                        )}
                        </>)}
                      </RowActions>
                      )}
                    </td>
                  </tr>
                  {abierta === s.suscripcion_id && (
                    <tr className="sus-detalle-fila">
                      <td colSpan={data.empresas.length > 1 ? 10 : 9}>
                        <div className="dash-list">
                          {s.historial.map(f => (
                            <div key={f.factura_id} className="dash-list-item">
                              <Link href={`/portal/ventas/facturas/${f.factura_id}`} className="dash-list-main">
                                <span className="dash-list-title">{f.numero}</span>
                                <span className="dash-list-meta">
                                  {fmtDate(f.fecha_emision)}
                                  {/* El saldo NO se reparte entre acuerdos: se dice a
                                      cuántos cubre y se atribuye al conjunto. */}
                                  {f.acuerdos > 1 && ` · cubre ${f.acuerdos} suscripciones`}
                                </span>
                              </Link>
                              <span className="dash-list-aside">
                                <span className="dash-list-amount">{fmtMoneda(f.total, f.moneda)}</span>
                                {f.saldo > 0.005 && (
                                  <span className="dash-list-amount is-neg">
                                    debe {fmtMoneda(f.saldo, f.moneda)}
                                  </span>
                                )}
                                <span className={`badge ${ESTADO_FACTURA_BADGE[f.estado as EstadoFactura] ?? 'badge-neutral'}`}>
                                  {ESTADO_FACTURA_LABEL[f.estado as EstadoFactura] ?? f.estado}
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="suscripción" />
      </div>
      </>
      )}

      {vista === 'facturacion' && <FacturacionPanel data={data} empresaInicial={empresaInicial} puedeEditar={puedeEditar} />}

      {modal && (
        <SuscripcionModal
          sub={modal === 'editar' ? editSub : null}
          plantilla={modal === 'duplicar' || modal === 'lote' ? editSub : null}
          lote={modal === 'lote'}
          data={data} onClose={cerrarModal} onSaved={onSaved} />
      )}
      <BulkBar count={sel.count} onClear={sel.clear}>
        <button className="btn btn-primary btn-sm" disabled={isPending}
          onClick={() => setSubidaAbierta(true)}>
          <TrendingUp size={14} strokeWidth={2} /> Subir tarifa
        </button>
      </BulkBar>

      {/* Paso 1: cuánto sube. Mismo vocabulario que el descuento de línea (% o importe). */}
      {subidaAbierta && !subidaPrev && (
        <ConfirmDialog
          title={`Subir la tarifa de ${sel.count} ${sel.count === 1 ? 'acuerdo' : 'acuerdos'}`}
          body={
            <>
              <div className="input-group">
                <div className="form-label-with-help">
                  <label htmlFor="sus-subida">Cuánto sube</label>
                  <FormHelp text="Se aplica al precio mensual de cada servicio. El descuento pactado se mantiene tal cual." label="Cómo se aplica la subida" />
                </div>
                <div className="sus-dto-row">
                  <input className="input" id="sus-subida" type="text" inputMode="decimal"
                    value={subidaValor} onChange={e => setSubidaValor(e.target.value)} placeholder="0" />
                  <select className="input" value={subidaModo} aria-label="Tipo de subida"
                    onChange={e => setSubidaModo(e.target.value as 'PORCENTAJE' | 'IMPORTE')}>
                    <option value="PORCENTAJE">%</option>
                    <option value="IMPORTE">importe</option>
                  </select>
                </div>
              </div>
              <p className="mt-2 text-sm-muted">
                No toca los borradores ya generados: la subida vale desde el siguiente
                cobro. Y no cambia la tarifa del catálogo.
              </p>
            </>
          }
          confirmLabel="Ver el antes y el después"
          onCancel={() => { setSubidaAbierta(false); setSubidaValor('') }}
          onConfirm={previsualizarSubida}
        />
      )}

      {/* Paso 2: la previsualización, acuerdo a acuerdo. Obligatoria: esto mueve dinero
          recurrente de muchos clientes a la vez. */}
      {subidaPrev && (
        <ConfirmDialog
          title="Revisa la subida"
          body={
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className="col-num">Antes / mes</th>
                    <th className="col-num">Después / mes</th>
                    <th className="col-num">Cada cobro</th>
                  </tr>
                </thead>
                <tbody>
                  {subidaPrev.map(l => (
                    <tr key={l.suscripcion_id}>
                      <td data-label="Cliente"><span className="cell-clamp">{l.cliente_nombre}</span></td>
                      <td data-label="Antes / mes" className="col-num">{fmtMoneda(l.antes, l.moneda)}</td>
                      <td data-label="Después / mes" className="col-num">{fmtMoneda(l.despues, l.moneda)}</td>
                      <td data-label="Cada cobro" className="col-num">{fmtMoneda(l.cobroDespues, l.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
          confirmLabel={`Aplicar a ${subidaPrev.length}`}
          onCancel={() => setSubidaPrev(null)}
          onConfirm={aplicarSubida}
        />
      )}

      {pausarSub && (
        <ConfirmDialog
          title="Pausar suscripción"
          body={
            <>
              <p>
                La suscripción de <strong>{pausarSub.cliente_nombre}</strong> deja de cobrarse
                mientras esté pausada. <strong>Los meses de pausa no se cobran</strong>: al
                reanudarla se salta esos cobros en vez de acumularlos.
              </p>
              <div className="input-group mt-3">
                <label htmlFor="sus-pausa-hasta">¿Hasta cuándo? (opcional)</label>
                <input className="input" id="sus-pausa-hasta" type="date"
                  value={pausarHasta} onChange={e => setPausarHasta(e.target.value)} />
                <span className="input-hint">
                  {pausarHasta
                    ? `Se reanudará sola el ${fmtDate(pausarHasta)}.`
                    : 'En blanco, la pausa es indefinida y la reanudas tú cuando quieras.'}
                </span>
              </div>
            </>
          }
          confirmLabel="Pausar"
          onCancel={cerrarDialogos}
          onConfirm={() => accionEstado(pausarSub.suscripcion_id, 'PAUSADA', 'Suscripción pausada.',
            { pausada_hasta: pausarHasta || null })}
        />
      )}
      {reanudarSub && (() => {
        // La MISMA función que aplica el servidor, para que el diálogo no prometa una
        // fecha y se guarde otra.
        const plan = planReanudacion({
          suscripcion_id:      reanudarSub.suscripcion_id,
          periodicidad:        reanudarSub.periodicidad,
          fecha_proximo_cobro: reanudarSub.fecha_proximo_cobro,
          pausada_desde:       reanudarSub.pausada_desde,
        }, hoy, cobrarPausados)
        return (
          <ConfirmDialog
            title="Reanudar suscripción"
            body={
              <>
                {plan.ciclos > 0 ? (
                  <p>
                    Estuvo pausada desde el <strong>{fmtDate(reanudarSub.pausada_desde!)}</strong>.
                    El próximo cobro pasa del <strong>{fmtDate(reanudarSub.fecha_proximo_cobro)}</strong> al{' '}
                    <strong>{fmtDate(plan.proximoCobro)}</strong> — esos {plan.ciclos}{' '}
                    cobro{plan.ciclos === 1 ? '' : 's'} no se cobran.
                  </p>
                ) : (
                  <p>
                    Vuelve a cobrarse. El próximo cobro es el{' '}
                    <strong>{fmtDate(plan.proximoCobro)}</strong>.
                  </p>
                )}
                {/* Se ofrece, no se impone: desmarcada. */}
                {reanudarSub.pausada_desde && (
                  <label className="checkbox-group mt-3">
                    <input type="checkbox" checked={cobrarPausados}
                      onChange={e => setCobrarPausados(e.target.checked)} />
                    <span className="checkbox-label">Cobrar también los meses pausados</span>
                  </label>
                )}
              </>
            }
            confirmLabel="Reanudar"
            onCancel={cerrarDialogos}
            onConfirm={() => accionEstado(reanudarSub.suscripcion_id, 'ACTIVA', 'Suscripción reanudada.',
              { cobrarPausados })}
          />
        )
      })()}
      {finPeriodoSub && (
        <ConfirmDialog
          title="Cancelar al final del período"
          body={
            <>
              <p>
                La suscripción de <strong>{finPeriodoSub.cliente_nombre}</strong> deja de
                cobrarse el <strong>{fmtDate(diaAnterior(finPeriodoSub.fecha_proximo_cobro))}</strong>,
                el día antes de su siguiente cobro. Lo ya facturado se conserva y no se
                genera ningún cobro más.
              </p>
              <p className="mt-2">Pasará a «Vencida» ese día. Puedes reactivarla con «Renovar».</p>
            </>
          }
          confirmLabel="Programar la baja"
          onCancel={cerrarDialogos}
          onConfirm={() => accionFinPeriodo(finPeriodoSub)}
        />
      )}
      {cancelSub && (
        <ConfirmDialog
          title="Cancelar ahora"
          body={
            <>
              <p>
                ¿Cancelar hoy mismo la suscripción de <strong>{cancelSub.cliente_nombre}</strong>{' '}
                ({cancelSub.lineas.map(l => l.servicio_nombre).join(', ') || 'sin servicios'})?
              </p>
              <p className="mt-2">
                Deja de cobrarse desde ahora: el cobro del{' '}
                {fmtDate(cancelSub.fecha_proximo_cobro)} <strong>no se hará</strong>. Lo ya
                facturado se conserva.
              </p>
            </>
          }
          confirmLabel="Cancelar suscripción" danger
          onCancel={cerrarDialogos}
          onConfirm={() => accionEstado(cancelSub.suscripcion_id, 'CANCELADA', 'Suscripción cancelada.')}
        />
      )}
    </div>
  )
}
