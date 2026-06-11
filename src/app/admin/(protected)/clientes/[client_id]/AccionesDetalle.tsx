'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { cambiarEstadoCliente, aplicarGracia } from '@/app/actions/clientes'
import { registrarPago, obtenerDatosPagoDefecto } from '@/app/actions/pagos'

const MOTIVOS_GRACIA = [
  { value: 'descuento',  label: 'Descuento comercial' },
  { value: 'promocion',  label: 'Promoción' },
  { value: 'oferta',     label: 'Oferta especial' },
  { value: 'cortesia',   label: 'Cortesía' },
  { value: 'liquidez',   label: 'Problema de liquidez' },
  { value: 'otro',       label: 'Otro' },
]

const METODO_LABEL: Record<string, string> = {
  tropipay: 'TropiPay', transferencia: 'Transferencia', efectivo: 'Efectivo',
}

type Plan = { plan_id: string; nombre: string; precio_usd: number; duracion_dias: number }

type UltimoPago = { monto_usd: number; fecha_inicio: string; fecha_fin: string }

type Props = {
  cliente: {
    client_id: string
    nombre_empresa: string
    estado: string
    plan_id: string
    fecha_expiracion: string | null
  }
  planes: Plan[]
}

type ModalType = 'gracia' | 'estado' | 'pago' | null

// ── Utilidades de fecha ─────────────────────────────────────────────
function parseYMD(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toYMD(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(dateStr: string, days: number): string {
  const d = parseYMD(dateStr)
  d.setDate(d.getDate() + days)
  return toYMD(d)
}

function daysBetween(fromStr: string, toStr: string): number {
  return Math.round((parseYMD(toStr).getTime() - parseYMD(fromStr).getTime()) / 86_400_000)
}

// Calcula el pro-rata dado los valores necesarios (función pura, sin estado)
function calcProrata(
  fechaInicio: string,
  fechaExpActual: string | null,
  ultimoPago: UltimoPago | null,
  planPrice: number,
): { overlapDays: number; dailyRate: number; credit: number; planPrice: number; suggestedNet: number } | null {
  if (!ultimoPago || !fechaInicio || !fechaExpActual) return null
  if (fechaInicio >= fechaExpActual) return null
  const periodDays = daysBetween(ultimoPago.fecha_inicio, ultimoPago.fecha_fin)
  if (periodDays <= 0) return null
  const overlapDays = daysBetween(fechaInicio, fechaExpActual)
  if (overlapDays <= 0) return null
  const dailyRate    = ultimoPago.monto_usd / periodDays
  const credit       = dailyRate * overlapDays
  const suggestedNet = Math.max(0, planPrice - credit)
  return { overlapDays, dailyRate, credit, planPrice, suggestedNet }
}

// Formatea YYYY-MM-DD → "04 de mayo de 2026" (sin depender del timezone del browser)
function formatDateES(dateStr: string): string {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

// Calcula fecha N días desde hoy en formato europeo (para el campo "Acceso hasta" de gracia)
function addDaysES(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default function AccionesDetalle({ cliente, planes }: Props) {
  const [modal, setModal]         = useState<ModalType>(null)
  const [loading, setLoading]     = useState(false)
  const [loadingPago, setLoadingPago] = useState(false)
  const [error, setError]         = useState('')
  const [success, setSuccess]     = useState('')
  const [advertencia, setAdvertencia] = useState('')
  const [mounted, setMounted]     = useState(false)

  // Gracia
  const [diasGracia, setDiasGracia]         = useState('')
  const [fechaCalculada, setFechaCalculada] = useState('—')

  // Pago — estado controlado
  const [montoSugerido, setMontoSugerido]     = useState('')
  const [fechaInicio, setFechaInicio]         = useState('')
  const [fechaFin, setFechaFin]               = useState('')
  const [planPago, setPlanPago]               = useState(cliente.plan_id)
  const [planDuracionDias, setPlanDuracionDias] = useState(30)
  const [fechaExpActual, setFechaExpActual]   = useState<string | null>(cliente.fecha_expiracion)
  const [ultimoPago, setUltimoPago]           = useState<UltimoPago | null>(null)

  const formGraciaRef = useRef<HTMLFormElement>(null)
  const formPagoRef   = useRef<HTMLFormElement>(null)
  const router        = useRouter()

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!modal) return
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey) }
  }, [modal])

  function handleClose() {
    setModal(null); setError(''); setSuccess(''); setAdvertencia('')
    setDiasGracia(''); setFechaCalculada('—')
    setFechaInicio(''); setFechaFin(''); setMontoSugerido('')
    setPlanPago(cliente.plan_id); setPlanDuracionDias(30); setUltimoPago(null)
  }

  function onDiasChange(val: string) {
    setDiasGracia(val)
    const n = parseInt(val)
    setFechaCalculada((!isNaN(n) && n >= 1 && n <= 180) ? addDaysES(n) : '—')
  }

  // ── Abre el modal de pago y carga los datos por defecto ──────────────
  async function openPago() {
    setModal('pago')
    setLoadingPago(true)
    const res = await obtenerDatosPagoDefecto(cliente.client_id)
    setLoadingPago(false)
    if (res.ok) {
      setMontoSugerido(String(res.monto_sugerido))
      setFechaInicio(res.fecha_inicio)
      setFechaFin(res.fecha_fin)
      setPlanPago(res.plan_id)
      setPlanDuracionDias(res.duracion_dias)
      setFechaExpActual(res.fecha_expiracion_actual)
      setUltimoPago(res.ultimo_pago)
    }
  }

  // ── Cambio de plan: actualiza monto (con pro-rata si aplica), duración y fecha fin ──
  function onPlanChange(planId: string) {
    setPlanPago(planId)
    const plan = planes.find(p => p.plan_id === planId)
    if (plan) {
      setPlanDuracionDias(plan.duracion_dias)
      if (fechaInicio) setFechaFin(addDays(fechaInicio, plan.duracion_dias))
      // Auto-aplicar pro-rata si hay solapamiento, si no usar precio del plan
      const pr = calcProrata(fechaInicio, fechaExpActual, ultimoPago, plan.precio_usd)
      setMontoSugerido(pr ? String(pr.suggestedNet.toFixed(2)) : String(plan.precio_usd))
    }
  }

  // ── Cambio de fecha inicio: recalcula fecha fin y pro-rata ───────────
  function onInicioChange(val: string) {
    setFechaInicio(val)
    if (val && planDuracionDias) setFechaFin(addDays(val, planDuracionDias))
    // Recalcular monto con nuevo inicio
    const planActual = planes.find(p => p.plan_id === planPago)
    const planPrice  = planActual?.precio_usd ?? parseFloat(montoSugerido) ?? 0
    const pr = calcProrata(val, fechaExpActual, ultimoPago, planPrice)
    if (pr) {
      setMontoSugerido(String(pr.suggestedNet.toFixed(2)))
    } else if (planActual) {
      setMontoSugerido(String(planActual.precio_usd))
    }
  }

  // ── Suspender / Reactivar ────────────────────────────────────────────
  async function handleEstado(nuevoEstado: 'ACTIVO' | 'SUSPENDIDO') {
    setError(''); setAdvertencia('')
    setLoading(true)
    const fd = new FormData()
    fd.append('client_id', cliente.client_id)
    fd.append('estado', nuevoEstado)
    const res = await cambiarEstadoCliente(fd)
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error desconocido'); return }
    if (res.advertencia) {
      setAdvertencia(res.advertencia)
      setSuccess(nuevoEstado === 'ACTIVO' ? 'Cliente reactivado' : 'Cliente suspendido')
      return
    }
    setSuccess(nuevoEstado === 'ACTIVO' ? 'Cliente reactivado' : 'Cliente suspendido')
    setTimeout(() => { handleClose(); router.refresh() }, 1200)
  }

  // ── Gracia submit ────────────────────────────────────────────────────
  async function handleGracia(e: { preventDefault(): void }) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await aplicarGracia(new FormData(formGraciaRef.current!))
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error desconocido'); return }
    setSuccess(`Período especial aplicado hasta ${formatDateES(res.hasta ?? '')}`)
    setTimeout(() => { handleClose(); router.refresh() }, 1400)
  }

  // ── Pago submit ──────────────────────────────────────────────────────
  async function handlePago(e: { preventDefault(): void }) {
    e.preventDefault()
    setError(''); setAdvertencia('')
    setLoading(true)
    const res = await registrarPago(new FormData(formPagoRef.current!))
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error desconocido'); return }
    if (res.advertencia_gap) setAdvertencia(res.advertencia_gap)
    setSuccess(`Pago ${res.pago_id} registrado. Suscripción renovada hasta ${formatDateES(res.nueva_expiracion ?? '')}`)
    setTimeout(() => { handleClose(); router.refresh() }, res.advertencia_gap ? 2500 : 1500)
  }

  // ── Alertas calculadas del modal de pago ────────────────────────────
  const alertaInicioTemprano = (fechaInicio && fechaExpActual && fechaInicio < fechaExpActual)
    ? `Se recomienda que el inicio del nuevo período (${formatDateES(fechaInicio)}) sea igual o posterior a la expiración actual (${formatDateES(fechaExpActual)}). Puedes continuar si el cambio de plan lo requiere.`
    : null

  // Pro-rata para mostrar el desglose en la UI (monto ya se auto-aplicó en los handlers)
  const selectedPlan = planes.find(p => p.plan_id === planPago)
  const prorata = calcProrata(
    fechaInicio,
    fechaExpActual,
    ultimoPago,
    selectedPlan?.precio_usd ?? parseFloat(montoSugerido) ?? 0,
  )

  const esActivo    = cliente.estado === 'ACTIVO' || cliente.estado === 'TRIAL'
  const puedeGracia = ['VENCIDO', 'SUSPENDIDO', 'GRACIA'].includes(cliente.estado)

  // ── Info del cliente (reutilizado en modales) ────────────────────────
  const clienteInfo = (
    <div style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
      <strong style={{ display: 'block', fontWeight: 700, marginBottom: 2 }}>{cliente.nombre_empresa}</strong>
      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
        {cliente.client_id} · Estado: <strong>{cliente.estado}</strong>
        {cliente.fecha_expiracion && (
          <> · Expira: <strong>{formatDateES(cliente.fecha_expiracion)}</strong></>
        )}
      </span>
    </div>
  )

  // ── Modal: Período especial ──────────────────────────────────────────
  const modalGracia = (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 className="modal-title">Aplicar período especial</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form ref={formGraciaRef} onSubmit={handleGracia}>
          <input type="hidden" name="client_id" value={cliente.client_id} />
          <div className="modal-body">
            {clienteInfo}

            <div className="grid-cols-2">
              <div className="input-group">
                <label>Días de acceso especial <span className="required">*</span></label>
                <input
                  name="dias"
                  type="number"
                  className="input"
                  min="1"
                  max="180"
                  required
                  placeholder="ej. 15"
                  value={diasGracia}
                  onChange={(e) => onDiasChange(e.target.value)}
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Entre 1 y 180 días</span>
              </div>
              <div className="input-group">
                <label>Acceso hasta</label>
                <div className="input" style={{ background: 'var(--color-surface-2)', color: fechaCalculada === '—' ? 'var(--color-text-muted)' : 'var(--color-text)', cursor: 'default', display: 'flex', alignItems: 'center' }}>
                  {fechaCalculada}
                </div>
              </div>
            </div>

            <div className="input-group">
              <label>Motivo <span className="required">*</span></label>
              <select name="motivo" className="input" required defaultValue="">
                <option value="" disabled>Selecciona un motivo</option>
                {MOTIVOS_GRACIA.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="input-group">
              <label>Notas internas</label>
              <textarea name="notas" className="input" rows={2} placeholder="Ej: cliente solicitó extensión hasta cobro de factura pendiente" />
            </div>

            <div className="info-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p>El cliente tendrá acceso durante este período <strong>sin registrar pago</strong>. Al vencer pasará a VENCIDO automáticamente.</p>
            </div>

            {error   && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Aplicando...</> : 'Aplicar período'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  // ── Modal: Confirmar Suspender / Reactivar ───────────────────────────
  const nuevoEstado = esActivo ? 'SUSPENDIDO' : 'ACTIVO'
  const modalEstado = (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2 className="modal-title">{esActivo ? 'Suspender cliente' : 'Reactivar cliente'}</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {clienteInfo}
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            {esActivo
              ? 'El cliente no podrá iniciar sesión mientras esté suspendido.'
              : 'El estado pasará a ACTIVO. Si la fecha de expiración ya venció, registra un pago para renovarla.'
            }
          </p>
          {advertencia && (
            <div className="alert alert-error" style={{ marginTop: 'var(--space-3)' }}>
              ⚠ {advertencia}
            </div>
          )}
          {error   && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
        </div>
        <div className="modal-footer">
          {!success ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
              <button
                className={`btn ${esActivo ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => handleEstado(nuevoEstado as 'ACTIVO' | 'SUSPENDIDO')}
                disabled={loading}
              >
                {loading
                  ? <><span className="spinner" /> {esActivo ? 'Suspendiendo...' : 'Reactivando...'}</>
                  : esActivo ? 'Suspender' : 'Reactivar'
                }
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => { handleClose(); router.refresh() }}>
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  )

  // ── Modal: Registrar pago ────────────────────────────────────────────
  const modalPago = (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="modal" style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <h2 className="modal-title">Registrar pago</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form ref={formPagoRef} onSubmit={handlePago}>
          <input type="hidden" name="client_id" value={cliente.client_id} />
          <div className="modal-body">
            {clienteInfo}

            {loadingPago && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
                <span className="spinner" style={{ width: 14, height: 14 }} /> Cargando datos del plan…
              </div>
            )}

            {/* Plan + Método */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Plan</label>
                <select
                  name="plan_id"
                  className="input"
                  value={planPago}
                  onChange={(e) => onPlanChange(e.target.value)}
                >
                  {planes.map(p => (
                    <option key={p.plan_id} value={p.plan_id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label>Método <span className="required">*</span></label>
                <select name="metodo" className="input" required defaultValue="transferencia">
                  {Object.entries(METODO_LABEL).map(([val, lbl]) => (
                    <option key={val} value={val}>{lbl}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Monto */}
            <div className="input-group">
              <label>Monto USD <span className="required">*</span></label>
              <input
                name="monto_usd"
                type="number"
                step="0.01"
                min="0.01"
                className="input"
                required
                value={montoSugerido}
                onChange={(e) => setMontoSugerido(e.target.value)}
                placeholder="0.00"
              />
              {prorata && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Sugerido: ${prorata.suggestedNet.toFixed(2)} (precio plan ${prorata.planPrice.toFixed(2)} − crédito ${prorata.credit.toFixed(2)})
                </span>
              )}
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
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
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
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {formatDateES(fechaFin)}
                  </span>
                )}
              </div>
            </div>

            {/* Alerta inicio temprano */}
            {alertaInicioTemprano && (
              <div className="alert alert-warning" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', marginTop: 'calc(var(--space-1) * -1)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>{alertaInicioTemprano}</span>
              </div>
            )}

            {/* Desglose pro-rata */}
            {prorata && (
              <div className="info-banner" style={{ marginTop: 'var(--space-2)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div style={{ fontSize: 'var(--text-xs)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <strong>Desglose pro-rata ({prorata.overlapDays} días solapados)</strong>
                  <span>Tarifa diaria período anterior: ${prorata.dailyRate.toFixed(4)}/día</span>
                  <span>Crédito por días ya pagados: −${prorata.credit.toFixed(2)}</span>
                  <span>
                    <strong>Monto sugerido primer mes nuevo plan: ${prorata.suggestedNet.toFixed(2)}</strong>
                    {' '}(ajustado arriba en el campo Monto)
                  </span>
                </div>
              </div>
            )}

            <div className="input-group">
              <label>Notas</label>
              <textarea name="notas" className="input" rows={2} placeholder="Referencia de pago, observaciones…" />
            </div>

            {advertencia && (
              <div className="alert alert-warning" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>{advertencia}</span>
              </div>
            )}
            {error   && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading || loadingPago || !!success}>
              {loading ? <><span className="spinner" /> Registrando...</> : 'Registrar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  const activeModal = modal === 'gracia' ? modalGracia
    : modal === 'estado' ? modalEstado
    : modal === 'pago'   ? modalPago
    : null

  return (
    <>
      <div className="client-actions-bar">
        {puedeGracia && (
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => setModal('gracia')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Período especial
            </button>
            <div className="client-actions-divider" />
          </>
        )}

        {esActivo ? (
          <button className="btn btn-danger btn-sm" onClick={() => setModal('estado')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            Suspender
          </button>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={() => setModal('estado')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Reactivar
          </button>
        )}

        <div className="client-actions-divider" />

        <button className="btn btn-primary btn-sm" onClick={openPago}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          Registrar pago
        </button>
      </div>

      {mounted && activeModal && createPortal(activeModal, document.body)}
    </>
  )
}
