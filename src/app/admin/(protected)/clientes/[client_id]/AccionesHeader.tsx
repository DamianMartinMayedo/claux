'use client'

import { AlertTriangle, Archive, ArchiveRestore, Ban, Clock, DollarSign, Info, MoreVertical, Pencil, Trash2, X } from 'lucide-react'
import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { cambiarEstadoCliente, aplicarGracia, editarCliente, archivarCliente, desarchivarCliente, eliminarCliente } from '@/app/actions/clientes'
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
    archivado_at?: string | null
  }
  tienePagosConfirmados?: boolean
}

type ModalType = 'gracia' | 'estado' | 'pago' | 'editar' | 'archivar' | 'borrar' | null

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

export default function AccionesHeader({ cliente, tienePagosConfirmados = false }: Props) {
  const [modal, setModal]         = useState<ModalType>(null)
  const [loading, setLoading]     = useState(false)
  const [loadingPago, setLoadingPago] = useState(false)
  const [advertencia, setAdvertencia] = useState('')
  const [nombreConfirm, setNombreConfirm] = useState('')
  const archivado = !!cliente.archivado_at
  const [menuMovilOpen, setMenuMovilOpen] = useState(false)
  const { success: toastSuccess, error: toastError } = useToast()
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
    setModal(null); setAdvertencia(''); setNombreConfirm('')
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

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutsideMenu)
    return () => document.removeEventListener('mousedown', handleClickOutsideMenu)
  }, [handleClickOutsideMenu])

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

  function openArchivar() { setMenuMovilOpen(false); setModal('archivar') }
  function openBorrar()   { setMenuMovilOpen(false); setNombreConfirm(''); setModal('borrar') }

  async function handleArchivar() {
    setLoading(true)
    const res = await archivarCliente(cliente.client_id)
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al archivar'); return }
    toastSuccess('Cliente archivado')
    setTimeout(() => { handleClose(); router.refresh() }, 1000)
  }

  async function handleDesarchivar() {
    setMenuMovilOpen(false)
    setLoading(true)
    const res = await desarchivarCliente(cliente.client_id)
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al desarchivar'); return }
    toastSuccess('Cliente desarchivado')
    router.refresh()
  }

  async function handleEliminar() {
    setLoading(true)
    const res = await eliminarCliente(cliente.client_id, nombreConfirm)
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al borrar'); return }
    toastSuccess('Cliente borrado')
    setTimeout(() => { router.push('/admin/clientes') }, 1000)
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
            <X size={18} />
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
            <X size={18} />
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
            <X size={18} />
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
                <AlertTriangle size={15} className="flex-shrink-0 mt-px" />
                <span>{alertaInicioTemprano}</span>
              </div>
            )}

            {prorata && (
              <div className="info-banner mt-2">
                <Info aria-hidden />
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
                <AlertTriangle size={15} className="flex-shrink-0 mt-px" />
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
            <X size={18} />
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

  const modalArchivar = (
    <div className="modal-backdrop">
      <div className="modal modal-420">
        <div className="modal-header">
          <h2 className="modal-title">Archivar cliente</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {clienteInfo}
          <p className="text-sm-muted">
            Se ocultará de las listas activas, pero se conservan <strong>todos</strong> sus datos
            (pagos, facturación e historial). Puedes desarchivarlo cuando quieras.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleArchivar} disabled={loading}>
            {loading ? <><span className="spinner" /> Archivando...</> : 'Archivar'}
          </button>
        </div>
      </div>
    </div>
  )

  const modalBorrar = (
    <div className="modal-backdrop">
      <div className="modal modal-420">
        <div className="modal-header">
          <h2 className="modal-title">Borrar cliente</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {clienteInfo}
          <div className="alert alert-error">
            <strong>Acción irreversible.</strong> Se borrarán permanentemente TODOS los datos del
            cliente: usuarios, ventas, inventario, reservas, caja, catálogo, presupuestos, etc.
            No se puede deshacer.
          </div>
          <div className="input-group">
            <label htmlFor="confirm-nombre">
              Escribe <strong>{cliente.nombre_empresa}</strong> para confirmar
            </label>
            <input
              id="confirm-nombre"
              className="input"
              value={nombreConfirm}
              onChange={(e) => setNombreConfirm(e.target.value)}
              placeholder={cliente.nombre_empresa}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
          <button
            className="btn btn-danger"
            onClick={handleEliminar}
            disabled={loading || nombreConfirm.trim() !== cliente.nombre_empresa.trim()}
          >
            {loading ? <><span className="spinner" /> Borrando...</> : 'Borrar definitivamente'}
          </button>
        </div>
      </div>
    </div>
  )

  const activeModal = modal === 'gracia' ? modalGracia
    : modal === 'estado'   ? modalSuspender
    : modal === 'pago'     ? modalPago
    : modal === 'editar'   ? modalEditar
    : modal === 'archivar' ? modalArchivar
    : modal === 'borrar'   ? modalBorrar
    : null

  // ── Botones sueltos (orden acordado: Editar, Suspender, Período especial, Registrar pago) ──
  const btnEditar = (
    <button
      className="btn btn-secondary btn-sm header-action"
      onClick={openEditar}
    >
      <Pencil size={14} />
      Editar
    </button>
  )

  const btnSuspender = esActivo ? (
    <button
      className="btn btn-danger btn-sm header-action"
      onClick={openEstado}
    >
      <Ban size={14} />
      Suspender
    </button>
  ) : null

  const btnGracia = puedeGracia ? (
    <button
      className="btn btn-secondary btn-sm header-action"
      onClick={openGracia}
    >
      <Clock size={14} />
      Período especial
    </button>
  ) : null

  const btnPago = (
    <button
      className="btn btn-primary btn-sm header-action"
      onClick={openPago}
    >
      <DollarSign size={14} />
      Registrar pago
    </button>
  )

  // Archivar (soft, reversible) / Desarchivar. Siempre disponible.
  const btnArchivar = archivado ? (
    <button className="btn btn-secondary btn-sm header-action" onClick={handleDesarchivar} disabled={loading}>
      <ArchiveRestore size={14} />
      Desarchivar
    </button>
  ) : (
    <button className="btn btn-secondary btn-sm header-action" onClick={openArchivar}>
      <Archive size={14} />
      Archivar
    </button>
  )

  // Borrar (purga total) solo para clientes suspendidos SIN pagos confirmados.
  const puedeBorrar = !archivado && cliente.estado === 'DESACTIVADO' && !tienePagosConfirmados
  const btnBorrar = puedeBorrar ? (
    <button className="btn btn-danger btn-sm header-action" onClick={openBorrar}>
      <Trash2 size={14} />
      Borrar
    </button>
  ) : null

  return (
    <>
      {/* Desktop: botones sueltos en fila horizontal. Móvil: dropdown con los 3 puntos */}
      <div className="detail-header-actions">
        {btnEditar}
        {btnSuspender}
        {btnGracia}
        {btnPago}
        {btnArchivar}
        {btnBorrar}

        {/* Dropdown móvil */}
        <div className="detail-header-actions-mobile" ref={menuMovilRef}>
          <button
            className="btn-icon"
            onClick={() => setMenuMovilOpen(v => !v)}
            aria-label="Más opciones"
            title="Más opciones"
          >
            <MoreVertical size={18} />
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
              {archivado ? (
                <button className="dropdown-item" onClick={handleDesarchivar}>
                  Desarchivar
                </button>
              ) : (
                <button className="dropdown-item" onClick={openArchivar}>
                  Archivar
                </button>
              )}
              {puedeBorrar && (
                <button className="dropdown-item dropdown-item-danger" onClick={openBorrar}>
                  Borrar
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {mounted && activeModal && createPortal(activeModal, document.body)}
    </>
  )
}
