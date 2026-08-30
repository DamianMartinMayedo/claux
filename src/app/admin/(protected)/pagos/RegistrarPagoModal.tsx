'use client'

import { AlertTriangle, Info, Plus, X } from 'lucide-react'
import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { registrarPago, obtenerDatosPagoDefecto } from '@/app/actions/pagos'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { MONEDAS_CLAUX, importeClaux, type MonedaClaux } from '@/lib/moneda-claux'

type Cliente = {
  client_id: string
  nombre_empresa: string
  ciclo_facturacion: string | null
}
type UltimoPago = {
  monto: number
  /** La del cobro anterior. Puede NO ser la de hoy: el prorrateo depende de eso. */
  moneda: MonedaClaux
  fecha_inicio: string
  fecha_fin: string
}

// ── Utilidades de fecha ──────────────────────────────────────────────
function parseYMD(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toYMD(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function addDays(dateStr: string, days: number): string {
  const d = parseYMD(dateStr)
  d.setDate(d.getDate() + days)
  return toYMD(d)
}

function daysBetween(fromStr: string, toStr: string): number {
  return Math.round((parseYMD(toStr).getTime() - parseYMD(fromStr).getTime()) / 86_400_000)
}

/**
 * Crédito por los días ya pagados del período anterior.
 *
 * Solo si el cobro anterior fue en la misma moneda que este: restarle euros a un
 * importe en dólares da un número que no es dinero de ninguna de las dos, y el
 * cliente puede pagar un mes en una y el siguiente en la otra (mig. 225).
 */
function calcProrata(
  fechaInicio: string,
  fechaExpActual: string | null,
  ultimoPago: UltimoPago | null,
  precioPeriodo: number,
  moneda: MonedaClaux,
): { overlapDays: number; dailyRate: number; credit: number; precioPeriodo: number; suggestedNet: number } | null {
  if (!ultimoPago || !fechaInicio || !fechaExpActual) return null
  if (ultimoPago.moneda !== moneda) return null
  if (fechaInicio >= fechaExpActual) return null
  const periodDays = daysBetween(ultimoPago.fecha_inicio, ultimoPago.fecha_fin)
  if (periodDays <= 0) return null
  const overlapDays = daysBetween(fechaInicio, fechaExpActual)
  if (overlapDays <= 0) return null
  const dailyRate    = ultimoPago.monto / periodDays
  const credit       = dailyRate * overlapDays
  const suggestedNet = Math.max(0, precioPeriodo - credit)
  return { overlapDays, dailyRate, credit, precioPeriodo, suggestedNet }
}

function formatDateES(dateStr: string): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

export default function RegistrarPagoModal({
  clientes,
  descuentoAnualPct,
  preselectedClientId,
}: {
  clientes: Cliente[]
  descuentoAnualPct: number
  preselectedClientId?: string
}) {
  const [open, setOpen]               = useState(false)
  const [loading, setLoading]         = useState(false)
  const [loadingDefecto, setLoadingDefecto] = useState(false)
  const [advertencia, setAdvertencia] = useState('')
  const mounted = useMounted()

  const [clienteId, setClienteId]         = useState(preselectedClientId ?? '')
  const [montoSugerido, setMontoSugerido] = useState('')
  const [montoBase, setMontoBase]         = useState(0)
  const [moneda, setMoneda]               = useState<MonedaClaux>('USD')
  // El precio del ciclo en LAS DOS monedas: cambiar de moneda no convierte nada,
  // coge el otro precio (que es propio, no una conversión del primero).
  const [montos, setMontos]               = useState<Record<MonedaClaux, number>>({ USD: 0, EUR: 0 })
  const [fechaInicio, setFechaInicio]     = useState('')
  const [fechaFin, setFechaFin]           = useState('')
  const [duracionDias, setDuracionDias]   = useState(30)
  const [ciclo, setCiclo]                 = useState('mensual')
  const [fechaExpActual, setFechaExpActual]     = useState<string | null>(null)
  const [ultimoPago, setUltimoPago]             = useState<UltimoPago | null>(null)

  const formRef = useRef<HTMLFormElement>(null)
  const router  = useRouter()

  async function cargarDefecto(id: string) {
    if (!id) return
    setLoadingDefecto(true)
    const res = await obtenerDatosPagoDefecto(id)
    setLoadingDefecto(false)
    if (!res.ok) return
    setMontos(res.monto_sugerido)
    setMoneda(res.moneda)
    setMontoSugerido(res.monto_sugerido[res.moneda].toFixed(2))
    setMontoBase(res.monto_sugerido[res.moneda])
    setFechaInicio(res.fecha_inicio)
    setFechaFin(res.fecha_fin)
    setDuracionDias(res.duracion_dias)
    setCiclo(res.ciclo)
    setFechaExpActual(res.fecha_expiracion_actual)
    setUltimoPago(res.ultimo_pago)
  }

  async function onClienteChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    setClienteId(id)
    setMontoSugerido(''); setMontoBase(0); setFechaInicio(''); setFechaFin('')
    setCiclo('mensual'); setFechaExpActual(null); setUltimoPago(null)
    setMoneda('USD'); setMontos({ USD: 0, EUR: 0 })
    await cargarDefecto(id)
  }

  // El importe sale del precio del ciclo en la moneda elegida, menos el crédito del
  // período anterior si lo hay. Misma cuenta al mover la fecha y al cambiar de moneda.
  function recalcularMonto(m: MonedaClaux, inicio: string) {
    const base = montos[m] ?? 0
    const pr = calcProrata(inicio, fechaExpActual, ultimoPago, base, m)
    setMontoBase(base)
    setMontoSugerido((pr ? pr.suggestedNet : base).toFixed(2))
  }

  function onInicioChange(val: string) {
    setFechaInicio(val)
    if (val && duracionDias) setFechaFin(addDays(val, duracionDias))
    recalcularMonto(moneda, val)
  }

  function onMonedaChange(m: MonedaClaux) {
    setMoneda(m)
    recalcularMonto(m, fechaInicio)
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setAdvertencia('')
    setLoading(true)
    const res = await registrarPago(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error desconocido'); return }
    if (res.advertencia_gap) setAdvertencia(res.advertencia_gap)
    toastSuccess(`Pago ${res.pago_id} registrado`)
    setTimeout(() => { handleClose(); router.refresh() }, res.advertencia_gap ? 3000 : 1400)
  }

  function handleOpen() {
    setOpen(true)
    if (preselectedClientId) cargarDefecto(preselectedClientId)
  }

  const handleClose = useCallback(() => {
    setOpen(false); setAdvertencia('')
    setMontoSugerido(''); setMontoBase(0); setFechaInicio(''); setFechaFin('')
    setCiclo('mensual'); setFechaExpActual(null); setUltimoPago(null)
    setMoneda('USD'); setMontos({ USD: 0, EUR: 0 })
    setClienteId(preselectedClientId ?? '')
  }, [preselectedClientId])

  useModalKeyboard(open, handleClose)

  // ── Alertas calculadas ───────────────────────────────────────────────
  const alertaInicioTemprano = (fechaInicio && fechaExpActual && fechaInicio < fechaExpActual)
    ? `Se recomienda que el inicio (${formatDateES(fechaInicio)}) sea igual o posterior a la expiración actual (${formatDateES(fechaExpActual)}).`
    : null

  const prorata = calcProrata(
    fechaInicio,
    fechaExpActual,
    ultimoPago,
    montoBase || parseFloat(montoSugerido) || 0,
    moneda,
  )
  // Había solape, pero el cobro anterior fue en la otra moneda: se explica en vez de
  // dejar que el importe entero parezca un olvido.
  const solapeOtraMoneda = !prorata && !!ultimoPago && ultimoPago.moneda !== moneda
    && !!fechaInicio && !!fechaExpActual && fechaInicio < fechaExpActual

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-560">
        <div className="modal-header">
          <h2 className="modal-title">Registrar pago</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">

            {/* Cliente */}
            <div className="input-group">
              <label>Cliente <span className="required">*</span></label>
              <select
                name="client_id"
                className="input"
                required
                value={clienteId}
                onChange={onClienteChange}
              >
                <option value="" disabled>Selecciona un cliente</option>
                {clientes.map(c => (
                  <option key={c.client_id} value={c.client_id}>
                    {c.client_id} — {c.nombre_empresa}
                  </option>
                ))}
              </select>
              {loadingDefecto && (
                <span className="text-xs-muted">
                  Cargando datos de la suscripción...
                </span>
              )}
            </div>

            {/* Ciclo (informativo) + Moneda + Método */}
            <div className="grid-cols-3">
              <div className="input-group">
                <label>Ciclo</label>
                <div className="input input-display">
                  {ciclo === 'anual' ? `Anual (−${descuentoAnualPct}%)` : 'Mensual'} · {duracionDias} días
                </div>
              </div>
              <div className="input-group">
                <label>Moneda <span className="required">*</span></label>
                <select name="moneda" className="input" required value={moneda}
                  onChange={e => onMonedaChange(e.target.value as MonedaClaux)}>
                  {MONEDAS_CLAUX.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label>Método de pago <span className="required">*</span></label>
                <select name="metodo" className="input" required defaultValue="transferencia">
                  <option value="tropipay">TropiPay</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                </select>
              </div>
            </div>

            {/* Monto (fijado por la configuración del cliente, no editable) */}
            <div className="input-group">
              <label>Monto a cobrar</label>
              <div className="input input-display">{importeClaux(parseFloat(montoSugerido) || 0, moneda)}</div>
              <input type="hidden" name="monto" value={montoSugerido} />
              <span className="input-hint">
                Precio configurado del cliente ({ciclo === 'anual' ? 'anual' : 'mensual'}).
                {prorata && ` Ajustado por prorrateo: crédito ${importeClaux(prorata.credit, moneda)} sobre ${importeClaux(prorata.precioPeriodo, moneda)}.`}
                {solapeOtraMoneda && ` El período anterior se cobró en ${ultimoPago!.moneda}: no se prorratea entre monedas.`}
              </span>
            </div>

            {/* Período */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Inicio período <span className="required">*</span></label>
                <input
                  name="fecha_inicio_periodo"
                  type="date"
                  lang="es-ES"
                  className="input"
                  required
                  value={fechaInicio}
                  onChange={(e) => onInicioChange(e.target.value)}
                />
                {fechaInicio && (
                  <span className="text-xs-muted">
                    {formatDateES(fechaInicio)}
                  </span>
                )}
              </div>
              <div className="input-group">
                <label>Fin período <span className="required">*</span></label>
                <input
                  name="fecha_fin_periodo"
                  type="date"
                  lang="es-ES"
                  className="input"
                  required
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                />
                {fechaFin && (
                  <span className="text-xs-muted">
                    {formatDateES(fechaFin)}
                  </span>
                )}
              </div>
            </div>

            {/* Alerta inicio temprano */}
            {alertaInicioTemprano && (
              <div className="alert alert-warning alert-flex mt-neg-1">
                <AlertTriangle size={15} className="flex-shrink-0 mt-px" />
                <span className="text-xs">{alertaInicioTemprano}</span>
              </div>
            )}

            {/* Desglose pro-rata */}
            {prorata && (
              <div className="info-banner mt-2">
                <Info aria-hidden />
                <div className="pro-rata-details">
                  <strong>Desglose pro-rata ({prorata.overlapDays} días solapados)</strong>
                  <span>Tarifa diaria período anterior: {importeClaux(prorata.dailyRate, moneda)}/día</span>
                  <span>Crédito por días ya pagados: −{importeClaux(prorata.credit, moneda)}</span>
                  <strong>Monto sugerido primer período: {importeClaux(prorata.suggestedNet, moneda)}</strong>
                </div>
              </div>
            )}

            {/* Notas */}
            <div className="input-group">
              <label>Notas</label>
              <textarea name="notas" className="input" rows={2} placeholder="Referencia de pago, observaciones..." />
            </div>

            {advertencia && (
              <div className="alert alert-warning alert-flex">
                <AlertTriangle size={15} className="flex-shrink-0 mt-px" />
                <span className="text-xs">{advertencia}</span>
              </div>
            )}

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading || loadingDefecto}>
              {loading ? <><span className="spinner" /> Registrando...</> : 'Registrar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button className="btn btn-primary" onClick={handleOpen}>
        <Plus size={16} />
        Registrar pago
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
