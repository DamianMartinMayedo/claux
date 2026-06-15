'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { registrarPago, obtenerDatosPagoDefecto } from '@/app/actions/pagos'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { useToast } from '@/app/contexts/ToastContext'

type Cliente = {
  client_id: string
  nombre_empresa: string
  precio_mensual_usd: number | null
  ciclo_facturacion: string | null
}
type UltimoPago = { monto_usd: number; fecha_inicio: string; fecha_fin: string }

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

function calcProrata(
  fechaInicio: string,
  fechaExpActual: string | null,
  ultimoPago: UltimoPago | null,
  precioPeriodo: number,
): { overlapDays: number; dailyRate: number; credit: number; precioPeriodo: number; suggestedNet: number } | null {
  if (!ultimoPago || !fechaInicio || !fechaExpActual) return null
  if (fechaInicio >= fechaExpActual) return null
  const periodDays = daysBetween(ultimoPago.fecha_inicio, ultimoPago.fecha_fin)
  if (periodDays <= 0) return null
  const overlapDays = daysBetween(fechaInicio, fechaExpActual)
  if (overlapDays <= 0) return null
  const dailyRate    = ultimoPago.monto_usd / periodDays
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
  const { success: toastSuccess, error: toastError, loading: toastLoading } = useToast()
  const [open, setOpen]               = useState(false)
  const [loading, setLoading]         = useState(false)
  const [loadingDefecto, setLoadingDefecto] = useState(false)
  const [advertencia, setAdvertencia] = useState('')
  const mounted = useMounted()

  const [clienteId, setClienteId]         = useState(preselectedClientId ?? '')
  const [montoSugerido, setMontoSugerido] = useState('')
  const [montoBase, setMontoBase]         = useState(0)
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
    setMontoSugerido(String(res.monto_sugerido))
    setMontoBase(Number(res.monto_sugerido))
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
    await cargarDefecto(id)
  }

  function onInicioChange(val: string) {
    setFechaInicio(val)
    if (val && duracionDias) setFechaFin(addDays(val, duracionDias))
    const pr = calcProrata(val, fechaExpActual, ultimoPago, montoBase)
    setMontoSugerido(pr ? String(pr.suggestedNet.toFixed(2)) : String(montoBase.toFixed(2)))
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
  )

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-560">
        <div className="modal-header">
          <h2 className="modal-title">Registrar pago</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
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

            {/* Ciclo (informativo) + Método */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Ciclo</label>
                <div className="input input-display">
                  {ciclo === 'anual' ? `Anual (−${descuentoAnualPct}%)` : 'Mensual'} · {duracionDias} días
                </div>
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
              <label>Monto USD a cobrar</label>
              <div className="input input-display">${(parseFloat(montoSugerido) || 0).toFixed(2)}</div>
              <input type="hidden" name="monto_usd" value={montoSugerido} />
              <span className="input-hint">
                Precio configurado del cliente ({ciclo === 'anual' ? 'anual' : 'mensual'}).
                {prorata && ` Ajustado por prorrateo: crédito $${prorata.credit.toFixed(2)} sobre $${prorata.precioPeriodo.toFixed(2)}.`}
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
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-px">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span className="text-xs">{alertaInicioTemprano}</span>
              </div>
            )}

            {/* Desglose pro-rata */}
            {prorata && (
              <div className="info-banner mt-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div className="pro-rata-details">
                  <strong>Desglose pro-rata ({prorata.overlapDays} días solapados)</strong>
                  <span>Tarifa diaria período anterior: ${prorata.dailyRate.toFixed(4)}/día</span>
                  <span>Crédito por días ya pagados: −${prorata.credit.toFixed(2)}</span>
                  <strong>Monto sugerido primer período: ${prorata.suggestedNet.toFixed(2)}</strong>
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
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-px">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Registrar pago
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
