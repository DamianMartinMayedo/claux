'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { cambiarEstadoCliente, aplicarGracia, editarCliente } from '@/app/actions/clientes'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { useToast } from '@/app/contexts/ToastContext'
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

type UltimoPago = { monto_usd: number; fecha_inicio: string; fecha_fin: string }

type Props = {
  cliente: {
    client_id: string
    nombre_empresa: string
    estado: string
    fecha_expiracion: string | null
    nombre_contacto?: string | null
    email_admin?: string
    notas?: string | null
  }
}

type ModalType = 'gracia' | 'estado' | 'pago' | 'editar' | null

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

function formatDateES(dateStr: string): string {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

function addDaysES(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default function AccionesHeader({ cliente }: Props) {
  const [modal, setModal]         = useState<ModalType>(null)
  const [loading, setLoading]     = useState(false)
  const [loadingPago, setLoadingPago] = useState(false)
  const [advertencia, setAdvertencia] = useState('')
  const [menuMovilOpen, setMenuMovilOpen] = useState(false)
  const { success: toastSuccess, error: toastError, loading: toastLoading } = useToast()
  const mounted = useMounted()

  // Gracia
  const [diasGracia, setDiasGracia]         = useState('')
  const [fechaCalculada, setFechaCalculada] = useState('—')

  // Pago — estado controlado
  const [montoSugerido, setMontoSugerido]     = useState('')
  const [montoBase, setMontoBase]             = useState(0)
  const [fechaInicio, setFechaInicio]         = useState('')
  const [fechaFin, setFechaFin]               = useState('')
  const [duracionDias, setDuracionDias]       = useState(30)
  const [ciclo, setCiclo]                     = useState('mensual')
  const [fechaExpActual, setFechaExpActual]   = useState<string | null>(cliente.fecha_expiracion)
  const [ultimoPago, setUltimoPago]           = useState<UltimoPago | null>(null)

  const formGraciaRef = useRef<HTMLFormElement>(null)
  const formPagoRef   = useRef<HTMLFormElement>(null)
  const formEditarRef = useRef<HTMLFormElement>(null)
  const menuMovilRef  = useRef<HTMLDivElement>(null)
  const router        = useRouter()

  const [editLoading, setEditLoading] = useState(false)

  const handleClose = useCallback(() => {
    setModal(null); setAdvertencia('')
    setDiasGracia(''); setFechaCalculada('—')
    setFechaInicio(''); setFechaFin(''); setMontoSugerido(''); setMontoBase(0)
    setDuracionDias(30); setCiclo('mensual'); setUltimoPago(null)
  }, [])

  useModalKeyboard(!!modal, handleClose)

  // Cerrar menú móvil al hacer clic fuera
  const handleClickOutsideMenu = useCallback((e: MouseEvent) => {
    if (menuMovilRef.current && !menuMovilRef.current.contains(e.target as Node)) {
      setMenuMovilOpen(false)
    }
  }, [])

  useState(() => {
    if (typeof window !== 'undefined') {
      document.addEventListener('mousedown', handleClickOutsideMenu)
      return () => document.removeEventListener('mousedown', handleClickOutsideMenu)
    }
  })

  function onDiasChange(val: string) {
    setDiasGracia(val)
    const n = parseInt(val)
    setFechaCalculada((!isNaN(n) && n >= 1 && n <= 180) ? addDaysES(n) : '—')
  }

  async function openPago() {
    setMenuMovilOpen(false)
    setModal('pago')
    setLoadingPago(true)
    const res = await obtenerDatosPagoDefecto(cliente.client_id)
    setLoadingPago(false)
    if (res.ok) {
      setMontoSugerido(String(res.monto_sugerido))
      setMontoBase(Number(res.monto_sugerido))
      setFechaInicio(res.fecha_inicio)
      setFechaFin(res.fecha_fin)
      setDuracionDias(res.duracion_dias)
      setCiclo(res.ciclo)
      setFechaExpActual(res.fecha_expiracion_actual)
      setUltimoPago(res.ultimo_pago)
    }
  }

  function openEstado() {
    setMenuMovilOpen(false)
    setModal('estado')
  }

  function openGracia() {
    setMenuMovilOpen(false)
    setModal('gracia')
  }

  function openEditar() {
    setMenuMovilOpen(false)
    setModal('editar')
  }

  async function handleEditar(e: { preventDefault(): void }) {
    e.preventDefault()
    setEditLoading(true)
    const res = await editarCliente(new FormData(formEditarRef.current!))
    setEditLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al guardar'); return }
    toastSuccess('Cliente actualizado')
    handleClose()
    router.refresh()
  }

  function onInicioChange(val: string) {
    setFechaInicio(val)
    if (val && duracionDias) setFechaFin(addDays(val, duracionDias))
    const pr = calcProrata(val, fechaExpActual, ultimoPago, montoBase)
    setMontoSugerido(pr ? String(pr.suggestedNet.toFixed(2)) : String(montoBase.toFixed(2)))
  }

  async function handleSuspender() {
    setAdvertencia('')
    setLoading(true)
    const fd = new FormData()
    fd.append('client_id', cliente.client_id)
    fd.append('estado', 'DESACTIVADO')
    const res = await cambiarEstadoCliente(fd)
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al suspender'); return }
    toastSuccess('Cliente desactivado')
    setTimeout(() => { handleClose(); router.refresh() }, 1200)
  }

  async function handleGracia(e: { preventDefault(): void }) {
    e.preventDefault()
    setLoading(true)
    const res = await aplicarGracia(new FormData(formGraciaRef.current!))
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al aplicar período'); return }
    toastSuccess(`Período especial aplicado hasta ${formatDateES(res.hasta ?? '')}`)
    setTimeout(() => { handleClose(); router.refresh() }, 1400)
  }

  async function handlePago(e: { preventDefault(): void }) {
    e.preventDefault()
    setAdvertencia('')
    setLoading(true)
    const res = await registrarPago(new FormData(formPagoRef.current!))
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al registrar pago'); return }
    if (res.advertencia_gap) setAdvertencia(res.advertencia_gap)
    toastSuccess(`Pago ${res.pago_id} registrado`)
    setTimeout(() => { handleClose(); router.refresh() }, res.advertencia_gap ? 2500 : 1500)
  }

  const alertaInicioTemprano = (fechaInicio && fechaExpActual && fechaInicio < fechaExpActual)
    ? `Se recomienda que el inicio del nuevo período (${formatDateES(fechaInicio)}) sea igual o posterior a la expiración actual (${formatDateES(fechaExpActual)}).`
    : null

  const prorata = calcProrata(
    fechaInicio,
    fechaExpActual,
    ultimoPago,
    montoBase || parseFloat(montoSugerido) || 0,
  )

  const esActivo    = cliente.estado === 'ACTIVO' || cliente.estado === 'TRIAL'
  const hoyYMD = toYMD(new Date())
  const vencidoPorFecha = !!cliente.fecha_expiracion && cliente.fecha_expiracion.split('T')[0] <= hoyYMD
  const puedeGracia = vencidoPorFecha || ['VENCIDO', 'DESACTIVADO', 'GRACIA'].includes(cliente.estado)

  const clienteInfo = (
    <div className="info-box">
      <strong className="info-box-title">{cliente.nombre_empresa}</strong>
      <span className="text-xs-muted">
        {cliente.client_id} · Estado: <strong>{cliente.estado}</strong>
        {cliente.fecha_expiracion && (
          <> · Expira: <strong>{formatDateES(cliente.fecha_expiracion)}</strong></>
        )}
      </span>
    </div>
  )

  // ── Modales (sin cambios respecto a la versión anterior) ──
  const modalGracia = (
    <div className="modal-backdrop">
      <div className="modal modal-md">
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
                <span className="input-hint">Entre 1 y 180 días</span>
              </div>
              <div className="input-group">
                <label>Acceso hasta</label>
                <div className="input input-display" style={{ color: fechaCalculada === '—' ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
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

  const modalSuspender = (
    <div className="modal-backdrop">
      <div className="modal modal-420">
        <div className="modal-header">
          <h2 className="modal-title">Desactivar cliente</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {clienteInfo}
          <p className="text-sm-muted">
            El cliente no podrá iniciar sesión mientras esté suspendido. Para reactivarlo, registra un pago o concede un período especial.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
          <button
            className="btn btn-danger"
            onClick={handleSuspender}
            disabled={loading}
          >
            {loading ? <><span className="spinner" /> Desactivando...</> : 'Desactivar'}
          </button>
        </div>
      </div>
    </div>
  )

  const modalPago = (
    <div className="modal-backdrop">
      <div className="modal modal-540">
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
              <div className="loading-row">
                <span className="spinner spinner-xs" /> Cargando datos de la suscripción…
              </div>
            )}

            <div className="grid-cols-2">
              <div className="input-group">
                <label>Ciclo</label>
                <div className="input input-display">
                  {ciclo === 'anual' ? 'Anual' : 'Mensual'} · {duracionDias} días
                </div>
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

            <div className="input-group">
              <label>Monto USD a cobrar</label>
              <div className="input input-display">${(parseFloat(montoSugerido) || 0).toFixed(2)}</div>
              <input type="hidden" name="monto_usd" value={montoSugerido} />
              <span className="input-hint">
                Precio configurado del cliente ({ciclo === 'anual' ? 'anual' : 'mensual'}).
                {prorata && ` Ajustado por prorrateo: crédito $${prorata.credit.toFixed(2)} sobre $${prorata.planPrice.toFixed(2)}.`}
              </span>
            </div>

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
                  <span className="input-hint">{formatDateES(fechaInicio)}</span>
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
                  <span className="input-hint">{formatDateES(fechaFin)}</span>
                )}
              </div>
            </div>

            {alertaInicioTemprano && (
              <div className="alert alert-warning alert-flex mt-neg-1">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-px">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>{alertaInicioTemprano}</span>
              </div>
            )}

            {prorata && (
              <div className="info-banner mt-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div className="pro-rata-details">
                  <strong>Desglose pro-rata ({prorata.overlapDays} días solapados)</strong>
                  <span>Tarifa diaria período anterior: ${prorata.dailyRate.toFixed(4)}/día</span>
                  <span>Crédito por días ya pagados: −${prorata.credit.toFixed(2)}</span>
                  <span>
                    <strong>Monto sugerido primer período: ${prorata.suggestedNet.toFixed(2)}</strong>
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
              <div className="alert alert-warning alert-flex">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-px">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>{advertencia}</span>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading || loadingPago}>
              {loading ? <><span className="spinner" /> Registrando...</> : 'Registrar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  // ── Modal: Editar cliente ──
  const modalEditar = (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Editar cliente</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form ref={formEditarRef} onSubmit={handleEditar}>
          <input type="hidden" name="client_id" value={cliente.client_id} />
          <div className="modal-body">
            <div className="input-group">
              <label>Nombre de la empresa <span className="required">*</span></label>
              <input name="nombre_empresa" className="input" required defaultValue={cliente.nombre_empresa} />
            </div>
            <div className="input-group">
              <label>Nombre del contacto</label>
              <input name="nombre_contacto" className="input" defaultValue={cliente.nombre_contacto ?? ''} />
            </div>
            <div className="input-group">
              <label>Email del administrador <span className="required">*</span></label>
              <input name="email_admin" type="email" className="input" required defaultValue={cliente.email_admin} />
            </div>
            <div className="input-group">
              <label>Notas internas</label>
              <textarea name="notas" className="input" rows={3} defaultValue={cliente.notas ?? ''} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={editLoading}>
              {editLoading ? <><span className="spinner" /> Guardando…</> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  const activeModal = modal === 'gracia' ? modalGracia
    : modal === 'estado' ? modalSuspender
    : modal === 'pago'   ? modalPago
    : modal === 'editar' ? modalEditar
    : null

  // ── Botones sueltos (orden acordado: Editar, Suspender, Período especial, Registrar pago) ──
  const btnEditar = (
    <button
      className="btn btn-secondary btn-sm header-action"
      onClick={openEditar}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      Editar
    </button>
  )

  const btnSuspender = esActivo ? (
    <button
      className="btn btn-danger btn-sm header-action"
      onClick={openEstado}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
      </svg>
      Suspender
    </button>
  ) : null

  const btnGracia = puedeGracia ? (
    <button
      className="btn btn-secondary btn-sm header-action"
      onClick={openGracia}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      Período especial
    </button>
  ) : null

  const btnPago = (
    <button
      className="btn btn-primary btn-sm header-action"
      onClick={openPago}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
      Registrar pago
    </button>
  )

  return (
    <>
      {/* Desktop: botones sueltos en fila horizontal. Móvil: dropdown con los 3 puntos */}
      <div className="detail-header-actions">
        {btnEditar}
        {btnSuspender}
        {btnGracia}
        {btnPago}

        {/* Dropdown móvil */}
        <div className="detail-header-actions-mobile" ref={menuMovilRef}>
          <button
            className="btn-icon"
            onClick={() => setMenuMovilOpen(v => !v)}
            aria-label="Más opciones"
            title="Más opciones"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="1.5"/>
              <circle cx="12" cy="12" r="1.5"/>
              <circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
          {menuMovilOpen && (
            <div className="detail-header-actions-dropdown">
              <button className="dropdown-item" onClick={openEditar}>
                Editar
              </button>
              {esActivo && (
                <button className="dropdown-item" onClick={openEstado}>
                  Suspender
                </button>
              )}
              {puedeGracia && (
                <button className="dropdown-item" onClick={openGracia}>
                  Período especial
                </button>
              )}
              <button className="dropdown-item" onClick={openPago}>
                Registrar pago
              </button>
            </div>
          )}
        </div>
      </div>

      {mounted && activeModal && createPortal(activeModal, document.body)}
    </>
  )
}
