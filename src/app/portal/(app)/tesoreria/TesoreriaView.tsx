'use client'

import { toastError } from '@/app/contexts/ToastContext'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter }                        from 'next/navigation'
import { Archive, ArrowDown, ArrowRightLeft, ArrowUp, List, Pencil, Plus, RotateCcw, Trash2, Wallet, X } from 'lucide-react'
import {
  guardarCuenta,
  archivarCuenta,
  restaurarCuenta,
  registrarMovimiento,
  registrarTransferencia,
  eliminarMovimiento,
  obtenerTasaTransferencia,
  type Cuenta,
  type CuentaConSaldo,
  type Movimiento,
  type TipoCuenta,
  type TipoMovimiento,
  type TesoreriaPageData,
} from '@/app/actions/portal/tesoreria'
import { registrarPagoDoc, type DocumentoPendiente } from '@/app/actions/portal/cobranza'

// Pendientes por saldar (CxC / CxP) que se pueden liquidar desde un movimiento
interface Pendientes {
  cobrar: DocumentoPendiente[]
  pagar:  DocumentoPendiente[]
}

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPOS_CUENTA: TipoCuenta[] = ['CAJA', 'BANCO', 'PASARELA', 'OTRO']

const TIPO_CUENTA_LABEL: Record<TipoCuenta, string> = {
  CAJA: 'Caja', BANCO: 'Banco', PASARELA: 'Pasarela', OTRO: 'Otro',
}
const TIPO_CUENTA_DESC: Record<TipoCuenta, string> = {
  CAJA:     'Efectivo físico en caja',
  BANCO:    'Cuenta bancaria',
  PASARELA: 'TropiPay, Enzona u otra pasarela',
  OTRO:     'Otro medio de fondos',
}
const TIPO_CUENTA_BADGE: Record<TipoCuenta, string> = {
  CAJA: 'badge-info', BANCO: 'badge-purple', PASARELA: 'badge-warning', OTRO: 'badge-neutral',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function hoyISO(): string {
  return new Date().toISOString().split('T')[0]
}
function formatFecha(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
function truncar4(n: number): string {
  return String(Math.trunc(n * 10000) / 10000)
}

// ── Modal: Cuenta ───────────────────────────────────────────────────────────────

function CuentaModal({
  cuenta, empresas, monedas, onClose, onSaved,
}: {
  cuenta:   Cuenta | null
  empresas: { empresa_id: string; nombre: string }[]
  monedas:  string[]
  onClose:  () => void
  onSaved:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [tipo,  setTipo]  = useState<TipoCuenta>(cuenta?.tipo ?? 'CAJA')
  const isEdit = !!cuenta

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('tipo', tipo)
    startTransition(async () => {
      const res = await guardarCuenta(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar cuenta' : 'Nueva cuenta'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {cuenta && <input type="hidden" name="cuenta_id" value={cuenta.cuenta_id} />}
          <div className="modal-body">

            {/* Tipo */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Tipo de cuenta</span>
              <div className="alm-tipo-grid">
                {TIPOS_CUENTA.map(t => (
                  <button key={t} type="button" onClick={() => setTipo(t)}
                    className={`alm-tipo-btn${tipo === t ? ' active' : ''}`}>
                    <span className={`badge ${TIPO_CUENTA_BADGE[t]}`}>{TIPO_CUENTA_LABEL[t]}</span>
                    <span className="text-xs-hint">{TIPO_CUENTA_DESC[t]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Datos */}
            <div className="ter-form-section mb-0">
              <span className="ter-form-section-title">Datos de la cuenta</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-4">
                  <label>Nombre <span className="required">*</span></label>
                  <input className="input" name="nombre" required autoFocus={!isEdit}
                    defaultValue={cuenta?.nombre ?? ''}
                    placeholder="Ej: Caja efectivo, Banco BPA, TropiPay USD…" />
                </div>
                <div className="input-group ter-col-span-2">
                  <label>Empresa <span className="required">*</span></label>
                  {empresas.length === 1 ? (
                    <>
                      <input className="input input-static" readOnly value={empresas[0].nombre} />
                      <input type="hidden" name="empresa_id" value={empresas[0].empresa_id} />
                    </>
                  ) : (
                    <select className="input" name="empresa_id"
                      defaultValue={cuenta?.empresa_id ?? ''} required>
                      <option value="">Selecciona una empresa…</option>
                      {empresas.map(e => (
                        <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Moneda <span className="required">*</span></label>
                  {isEdit ? (
                    <>
                      <input className="input input-static" readOnly value={cuenta!.moneda} />
                      <span className="input-hint">La moneda no se puede cambiar tras crear la cuenta.</span>
                    </>
                  ) : monedas.length === 0 ? (
                    <>
                      <input className="input input-static" readOnly value="Sin monedas activas" />
                      <span className="input-hint">Crea una moneda en Monedas y Tasas primero.</span>
                    </>
                  ) : (
                    <select className="input" name="moneda" defaultValue="" required>
                      <option value="" disabled>Selecciona…</option>
                      {monedas.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Saldo inicial</label>
                  <input className="input" name="saldo_inicial" type="number" step="0.01"
                    defaultValue={cuenta?.saldo_inicial ?? 0} placeholder="0.00" />
                  <span className="input-hint">Saldo del que parte la cuenta hoy.</span>
                </div>
                <div className="input-group ter-col-full">
                  <label>Notas</label>
                  <textarea className="input input-textarea" name="notas" rows={2}
                    defaultValue={cuenta?.notas ?? ''}
                    placeholder="Número de cuenta, titular, observaciones…" />
                </div>
              </div>
            </div>

          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || (!isEdit && monedas.length === 0)}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : isEdit ? 'Guardar cambios' : 'Crear cuenta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: Movimiento (ingreso / egreso) ────────────────────────────────────────

function MovimientoModal({
  cuentas, categorias, pendientes, cuentaInicial, onClose, onSaved,
}: {
  cuentas:       CuentaConSaldo[]
  categorias:    TesoreriaPageData['categorias_gastos']
  pendientes:    Pendientes
  cuentaInicial: string | null
  onClose:       () => void
  onSaved:       () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [tipo,  setTipo]  = useState<TipoMovimiento>('INGRESO')
  const [cuentaId, setCuentaId] = useState(cuentaInicial ?? cuentas[0]?.cuenta_id ?? '')
  const [registrarGasto, setRegistrarGasto] = useState(true)
  const [pendienteId, setPendienteId] = useState('')
  const [impDoc, setImpDoc]             = useState('')   // importe en la moneda del documento
  const [impCaja, setImpCaja]           = useState('')   // lo que se mueve en la caja
  const [editandoCaja, setEditandoCaja] = useState(false)
  const [tasaInput, setTasaInput]       = useState('')
  const [tasaCompleta, setTasaCompleta] = useState(1)
  const [cargandoTasa, setCargandoTasa] = useState(false)

  const cuentaSel = cuentas.find(c => c.cuenta_id === cuentaId)
  const esEgreso  = tipo === 'EGRESO'
  const labelRegistro = esEgreso ? 'gasto' : 'cobro'

  // Pendientes que puede saldar este movimiento: mismo sentido.
  // Se muestran TODOS los pendientes (sin filtro por empresa).
  // Los de la misma moneda aparecen primero; los de otra moneda aplican tasa.
  const listaPendientes = useMemo(() => {
    if (!cuentaSel) return []
    const base = esEgreso ? pendientes.pagar : pendientes.cobrar
    return base
      .sort((a, b) => (a.moneda === cuentaSel.moneda ? 0 : 1) - (b.moneda === cuentaSel.moneda ? 0 : 1))
  }, [esEgreso, pendientes, cuentaSel])

  const pendienteSel = listaPendientes.find(d => d.doc_id === pendienteId) ?? null

  // Si cambian tipo/cuenta y el pendiente elegido ya no está en la lista, se limpia
  useEffect(() => {
    if (pendienteId && !listaPendientes.some(d => d.doc_id === pendienteId)) setPendienteId('')
  }, [pendienteId, listaPendientes])

  // ¿El pendiente está en otra moneda que la caja? → se aplica tasa (como en transferencias)
  const cambiaMoneda = !!(pendienteSel && cuentaSel && pendienteSel.moneda !== cuentaSel.moneda)

  // Al elegir/soltar un pendiente, el importe parte del saldo (en la moneda del documento)
  useEffect(() => {
    setImpDoc(pendienteSel ? pendienteSel.saldo.toFixed(2) : '')
    setImpCaja('')
    setEditandoCaja(false)
  }, [pendienteId])

  // Cargar la tasa vigente cuando la moneda de la caja difiere de la del documento
  useEffect(() => {
    if (!cambiaMoneda || !pendienteSel || !cuentaSel) { setTasaCompleta(1); setTasaInput(''); setCargandoTasa(false); return }
    let vivo = true
    setCargandoTasa(true)
    obtenerTasaTransferencia(pendienteSel.moneda, cuentaSel.moneda)
      .then(r => {
        if (!vivo) return
        if (r.ok && r.tasa) { setTasaCompleta(r.tasa); setTasaInput(truncar4(r.tasa)); setEditandoCaja(false) }
        else                { setTasaCompleta(0); setTasaInput('') }
      })
      .catch(() => { if (vivo) { setTasaCompleta(0); setTasaInput('') } })
      .finally(() => { if (vivo) setCargandoTasa(false) })
    return () => { vivo = false }
  }, [cambiaMoneda, pendienteSel, cuentaSel])

  const impDocNum  = parseFloat(impDoc)  || 0
  const impCajaNum = editandoCaja ? (parseFloat(impCaja) || 0) : Math.round(impDocNum * tasaCompleta * 100) / 100

  // Derivar el importe en la caja desde el importe del documento × tasa (salvo edición manual)
  useEffect(() => {
    if (cambiaMoneda && !editandoCaja && impDocNum > 0 && tasaCompleta > 0) {
      setImpCaja(String(Math.round(impDocNum * tasaCompleta * 100) / 100))
    }
  }, [impDoc, tasaCompleta, cambiaMoneda, editandoCaja, impDocNum])

  function handleTasaChange(v: string) {
    setTasaInput(v)
    setTasaCompleta(parseFloat(v) || 0)
    setEditandoCaja(false)
    setImpCaja('')
  }
  function handleImpCajaChange(v: string) {
    setImpCaja(v)
    setEditandoCaja(true)
    const caja = parseFloat(v) || 0
    if (caja > 0 && impDocNum > 0) {
      const nueva = caja / impDocNum
      setTasaCompleta(nueva)
      setTasaInput(truncar4(nueva))
    }
  }

  const pagoInvalido = !!pendienteSel && (impDocNum <= 0 || impDocNum > pendienteSel.saldo + 0.005 || (cambiaMoneda && tasaCompleta <= 0))

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('cuenta_id', cuentaId)
    startTransition(async () => {
      // Liquidar un pendiente existente → no se crea un registro nuevo (evita duplicados)
      if (pendienteSel) {
        if (pagoInvalido) return
        fd.set('doc_tipo', pendienteSel.doc_tipo)
        fd.set('doc_id', pendienteSel.doc_id)
        fd.set('monto', impDoc)                              // importe en la moneda del documento
        fd.set('tasa_cambio', String(cambiaMoneda ? tasaCompleta : 1))
        const res = await registrarPagoDoc(fd)
        if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
        onSaved()
        return
      }
      // Movimiento libre (crea gasto/cobro nuevo si el toggle está activo)
      fd.set('tipo', tipo)
      fd.set('registrar_gasto', String(registrarGasto))
      const res = await registrarMovimiento(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Registrar movimiento</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">

            {/* Tipo */}
            <div className="tes-tipo-toggle">
              <button type="button" className={`tes-tipo-opt tes-tipo-ingreso${tipo === 'INGRESO' ? ' active' : ''}`}
                onClick={() => setTipo('INGRESO')}>
                <ArrowDown size={14} strokeWidth={2.5} /> Ingreso
              </button>
              <button type="button" className={`tes-tipo-opt tes-tipo-egreso${tipo === 'EGRESO' ? ' active' : ''}`}
                onClick={() => setTipo('EGRESO')}>
                <ArrowUp size={14} strokeWidth={2.5} /> Egreso
              </button>
            </div>

            <div className="ter-form-grid mt-3">
              <div className="input-group ter-col-full">
                <label>Cuenta <span className="required">*</span></label>
                <select className="input" value={cuentaId} onChange={e => setCuentaId(e.target.value)} required>
                  {cuentas.map(c => (
                    <option key={c.cuenta_id} value={c.cuenta_id}>
                      {c.nombre} · {c.moneda} (saldo {formatMonto(c.saldo)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Saldar un pendiente ya existente (evita duplicar el gasto/cobro) */}
              {listaPendientes.length > 0 && (
                <div className="input-group ter-col-full">
                  <label>{esEgreso ? 'Pagar un pendiente' : 'Cobrar un pendiente'}</label>
                  <select className="input" value={pendienteId} onChange={e => setPendienteId(e.target.value)}>
                    <option value="">— Ninguno (registrar {labelRegistro} nuevo) —</option>
                    {listaPendientes.map(d => (
                      <option key={d.doc_id} value={d.doc_id}>
                        {d.numero} · {formatMonto(d.saldo)} {d.moneda}
                        {cuentaSel && d.moneda !== cuentaSel.moneda ? ' (otra moneda)' : ''}
                        {d.tercero_nombre ? ` · ${d.tercero_nombre}` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="input-hint">
                    Los de la misma moneda aparecen primero. Elige uno para evitar duplicados.
                  </span>
                  {cambiaMoneda && pendienteSel && cuentaSel && (
                    <span className="input-hint-warning">
                      Monedas distintas: el documento está en {pendienteSel.moneda} y la caja en {cuentaSel.moneda}. Se aplicará la tasa de cambio.
                    </span>
                  )}
                </div>
              )}

              {/* Importe: en la moneda del documento si liquidas un pendiente; si no, en la de la caja */}
              {pendienteSel ? (
                <div className="input-group ter-col-span-3">
                  <label>Importe ({pendienteSel.moneda}) <span className="required">*</span></label>
                  <input className="input" type="number" min="0" step="0.01" required autoFocus
                    value={impDoc} onChange={e => setImpDoc(e.target.value)} placeholder="0.00" />
                  <span className="input-hint">Saldo pendiente {formatMonto(pendienteSel.saldo)} {pendienteSel.moneda}. Puedes cobrar/pagar menos.</span>
                  {impDocNum > pendienteSel.saldo + 0.005 && (
                    <span className="input-hint-warning">El monto supera el saldo pendiente</span>
                  )}
                </div>
              ) : (
                <div className="input-group ter-col-span-3">
                  <label>Monto {cuentaSel ? `(${cuentaSel.moneda})` : ''} <span className="required">*</span></label>
                  <input className="input" name="monto" type="number" min="0" step="0.01" required
                    autoFocus placeholder="0.00" />
                </div>
              )}
              <div className="input-group ter-col-span-3">
                <label>Fecha <span className="required">*</span></label>
                <input className="input" name="fecha" type="date" defaultValue={hoyISO()} required />
              </div>

              {/* Cambio de moneda: tasa + importe en la caja, editables en ambos sentidos (como en transferencias) */}
              {cambiaMoneda && pendienteSel && cuentaSel && (
                <>
                  <div className="input-group ter-col-span-3">
                    <label>Tasa ({cuentaSel.moneda}/{pendienteSel.moneda}) <span className="required">*</span></label>
                    <input className="input" type="number" min="0" step="0.0001"
                      value={tasaInput} onChange={e => handleTasaChange(e.target.value)}
                      placeholder={cargandoTasa ? 'Cargando…' : '0.0000'} />
                    {tasaCompleta <= 0 && !cargandoTasa && (
                      <span className="input-hint-warning">No hay tasa para {pendienteSel.moneda} → {cuentaSel.moneda}. Escríbela.</span>
                    )}
                  </div>
                  <div className="input-group ter-col-span-3">
                    <label>Se moverá en la caja ({cuentaSel.moneda})</label>
                    <input className="input" type="number" min="0" step="0.01"
                      value={impCaja} onChange={e => handleImpCajaChange(e.target.value)} placeholder="0.00" />
                    <span className="input-hint">
                      {impDocNum > 0 && tasaCompleta > 0
                        ? `Saldas ${formatMonto(impDocNum)} ${pendienteSel.moneda}; en la caja ${esEgreso ? 'salen' : 'entran'} ${formatMonto(impCajaNum)} ${cuentaSel.moneda}.`
                        : 'Ajusta el importe o la tasa.'}
                    </span>
                  </div>
                </>
              )}
              {/* Concepto, gasto/cobro y categoría solo aplican al registrar uno nuevo */}
              {!pendienteSel && (
                <>
                  <div className="input-group ter-col-full">
                    <label>Concepto <span className="required">*</span></label>
                    <input className="input" name="concepto" required
                      placeholder="Ej: Venta del día, pago de proveedor, retiro…" />
                  </div>

                  {/* Toggle registrar como gasto/cobro */}
                  <div className="input-group ter-col-full">
                    <label className="cita-chk-item">
                      <input type="checkbox" name="registrar_gasto" checked={registrarGasto}
                        onChange={e => setRegistrarGasto(e.target.checked)} />
                      Registrar como {labelRegistro}
                    </label>
                    <span className="input-hint">
                      El egreso se registrará también como gasto y el ingreso como cobro,
                      vinculados automáticamente.
                    </span>
                  </div>

                  {registrarGasto && (
                    <div className="input-group ter-col-full">
                      <label>Categoría</label>
                      <select className="input" name="categoria_id" defaultValue="">
                        <option value="">— Sin categoría —</option>
                        {categorias.filter(c => c.estado === 'ACTIVO').map(c => (
                          <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              <div className="input-group ter-col-full">
                <label>Notas</label>
                <textarea className="input input-textarea" name="notas" rows={2}
                  placeholder="Referencia, observaciones…" />
              </div>
            </div>

          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || pagoInvalido}>
              {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: Transferencia ────────────────────────────────────────────────────────

function TransferenciaModal({
  cuentas, onClose, onSaved,
}: {
  cuentas: CuentaConSaldo[]
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [origen, setOrigen]   = useState(cuentas[0]?.cuenta_id ?? '')
  const [destino, setDestino] = useState(cuentas[1]?.cuenta_id ?? '')
  const [monto, setMonto]     = useState('')
  const [montoRecibido, setMontoRecibido] = useState('')
  const [tasaInput, setTasaInput] = useState('')
  const [tasaCompleta, setTasaCompleta] = useState<number>(0)
  const [feeEnvio, setFeeEnvio]   = useState('')
  const [feeRecibo, setFeeRecibo] = useState('')
  const [tasaDisplay, setTasaDisplay] = useState<number | null>(null)
  const [tasaEsInversa, setTasaEsInversa] = useState(false)
  const [cargandoTasa, setCargandoTasa] = useState(false)
  const [editandoMontoRecibido, setEditandoMontoRecibido] = useState(false)

  const cuentaOrigen  = cuentas.find(c => c.cuenta_id === origen)
  const cuentaDestino = cuentas.find(c => c.cuenta_id === destino)
  const monedasDiferentes = !!(cuentaOrigen && cuentaDestino && cuentaOrigen.moneda !== cuentaDestino.moneda)

  useEffect(() => {
    if (!monedasDiferentes || !cuentaOrigen || !cuentaDestino) {
      setTasaCompleta(0)
      setTasaDisplay(null)
      setTasaEsInversa(false)
      setTasaInput('')
      setMontoRecibido('')
      return
    }
    setCargandoTasa(true)
    obtenerTasaTransferencia(cuentaOrigen.moneda, cuentaDestino.moneda)
      .then(r => {
        if (r.ok && r.tasa) {
          setTasaCompleta(r.tasa)
          setTasaInput(truncar4(r.tasa))
          setTasaDisplay(r.tasaDisplay ?? r.tasa)
          setTasaEsInversa(r.esInversa ?? false)
          setMontoRecibido('')
          setEditandoMontoRecibido(false)
        } else {
          setTasaCompleta(0)
          setTasaDisplay(null)
          setTasaEsInversa(false)
          setTasaInput('')
          setMontoRecibido('')
        }
      })
      .catch(() => {
        setTasaCompleta(0)
        setTasaDisplay(null)
        setTasaEsInversa(false)
        setTasaInput('')
        setMontoRecibido('')
      })
      .finally(() => setCargandoTasa(false))
  }, [origen, destino, monedasDiferentes])

  const montoNum     = parseFloat(monto) || 0
  const feeEnvioNum  = parseFloat(feeEnvio) || 0
  const feeReciboNum = parseFloat(feeRecibo) || 0
  const montoRecibidoNum = parseFloat(montoRecibido) || 0
  const montoDestino = monedasDiferentes
    ? (editandoMontoRecibido ? montoRecibidoNum : montoNum * tasaCompleta)
    : montoNum
  const totalOrigen  = montoNum + feeEnvioNum
  const netoDestino  = montoDestino - feeReciboNum

  useEffect(() => {
    if (monedasDiferentes && !editandoMontoRecibido && montoNum > 0 && tasaCompleta > 0) {
      setMontoRecibido(String(montoNum * tasaCompleta))
    }
  }, [monto, tasaCompleta, monedasDiferentes, editandoMontoRecibido, montoNum])

  function handleMontoRecibidoChange(value: string) {
    setMontoRecibido(value)
    setEditandoMontoRecibido(true)
    const mr = parseFloat(value) || 0
    if (mr > 0 && montoNum > 0) {
      const nuevaTasa = mr / montoNum
      setTasaCompleta(nuevaTasa)
      setTasaInput(truncar4(nuevaTasa))
    }
  }

  function handleTasaChange(value: string) {
    setTasaInput(value)
    const num = parseFloat(value) || 0
    setTasaCompleta(num)
    setEditandoMontoRecibido(false)
    setMontoRecibido('')
  }

  function handleMontoChange(value: string) {
    setMonto(value)
    if (editandoMontoRecibido) {
      const mr = parseFloat(montoRecibido) || 0
      const m = parseFloat(value) || 0
      if (mr > 0 && m > 0) {
        const nuevaTasa = mr / m
        setTasaCompleta(nuevaTasa)
        setTasaInput(truncar4(nuevaTasa))
      }
    } else {
      setMontoRecibido('')
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('cuenta_origen', origen)
    fd.set('cuenta_destino', destino)
    fd.set('tasa_cambio', String(tasaCompleta))
    startTransition(async () => {
      const res = await registrarTransferencia(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Transferencia entre cuentas</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="ter-form-grid">
              <div className="input-group ter-col-span-3">
                <label>Desde <span className="required">*</span></label>
                <select className="input" value={origen} onChange={e => setOrigen(e.target.value)} required>
                  {cuentas.map(c => (
                    <option key={c.cuenta_id} value={c.cuenta_id}>{c.nombre} · {c.moneda}</option>
                  ))}
                </select>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Hacia <span className="required">*</span></label>
                <select className="input" value={destino} onChange={e => setDestino(e.target.value)} required>
                  {cuentas.map(c => (
                    <option key={c.cuenta_id} value={c.cuenta_id}>{c.nombre} · {c.moneda}</option>
                  ))}
                </select>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Monto {cuentaOrigen ? `(${cuentaOrigen.moneda})` : ''} <span className="required">*</span></label>
                <input className="input" name="monto" type="number" min="0" step="0.01" required
                  autoFocus placeholder="0.00" value={monto} onChange={e => handleMontoChange(e.target.value)} />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Fecha <span className="required">*</span></label>
                <input className="input" name="fecha" type="date" defaultValue={hoyISO()} required />
              </div>

              {monedasDiferentes && (
                <>
                  <div className="input-group ter-col-span-3">
                    <label>Tasa {cuentaOrigen?.moneda} → {cuentaDestino?.moneda} <span className="required">*</span></label>
                    <input className="input" name="tasa_cambio" type="number" min="0" step="0.0001" required
                      placeholder="0.0000" value={tasaInput} onChange={e => handleTasaChange(e.target.value)} />
                    <span className="input-hint">
                      {cargandoTasa ? 'Buscando tasa…'
                        : tasaDisplay
                          ? (tasaEsInversa
                              ? `Tasa inversa: ${tasaDisplay}`
                              : `Tasa vigente: ${tasaDisplay}`)
                          : 'Sin tasa registrada. Introduce manualmente.'}
                    </span>
                  </div>
                  <div className="input-group ter-col-span-3">
                    <label>Monto recibido ({cuentaDestino?.moneda})</label>
                    <input className="input" type="number" min="0" step="0.01"
                      placeholder="0.00"
                      value={montoRecibido} onChange={e => handleMontoRecibidoChange(e.target.value)} />
                    <span className="input-hint">Editable si la tasa real difiere</span>
                  </div>
                </>
              )}

              <div className="input-group ter-col-span-3">
                <label>Fee de envío {cuentaOrigen ? `(${cuentaOrigen.moneda})` : ''}</label>
                <input className="input" name="fee_envio" type="number" min="0" step="0.01"
                  placeholder="0.00" value={feeEnvio} onChange={e => setFeeEnvio(e.target.value)} />
                <span className="input-hint">Comisión por enviar (opcional)</span>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Fee de recepción {cuentaDestino ? `(${cuentaDestino.moneda})` : ''}</label>
                <input className="input" name="fee_recibo" type="number" min="0" step="0.01"
                  placeholder="0.00" value={feeRecibo} onChange={e => setFeeRecibo(e.target.value)} />
                <span className="input-hint">Comisión por recibir (opcional)</span>
              </div>

              <div className="input-group ter-col-full">
                <label>Concepto</label>
                <input className="input" name="concepto" placeholder="Transferencia entre cuentas" />
              </div>
              <div className="input-group ter-col-full">
                <label>Notas</label>
                <textarea className="input input-textarea" name="notas" rows={2}
                  placeholder="Referencia, observaciones…" />
              </div>
            </div>

            {montoNum > 0 && (
              <div className="tes-transfer-preview">
                <strong>Resumen de la transferencia:</strong>
                <ul>
                  <li className="tes-preview-egreso">
                    −{formatMonto(totalOrigen)} {cuentaOrigen?.moneda} de {cuentaOrigen?.nombre}
                    {feeEnvioNum > 0 && ` (incluye ${formatMonto(feeEnvioNum)} de comisión)`}
                  </li>
                  <li className="tes-preview-ingreso">
                    +{formatMonto(netoDestino)} {cuentaDestino?.moneda} en {cuentaDestino?.nombre}
                    {feeReciboNum > 0 && ` (después de ${formatMonto(feeReciboNum)} de comisión)`}
                  </li>
                  {(feeEnvioNum > 0 || feeReciboNum > 0) && (
                    <li className="tes-preview-gasto">
                      Se registrará{feeEnvioNum > 0 && feeReciboNum > 0 ? 'n' : ''} como gasto{feeEnvioNum > 0 && feeReciboNum > 0 ? 's' : ''}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Transfiriendo…</> : 'Transferir'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Confirmación eliminar movimiento ────────────────────────────────────────────

function ConfirmEliminar({
  movimiento, onConfirm, onClose, isPending,
}: {
  movimiento: Movimiento
  onConfirm:  () => void
  onClose:    () => void
  isPending:  boolean
}) {
  const esTransfer = !!movimiento.transfer_grupo
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Eliminar movimiento</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            ¿Eliminar <strong>{movimiento.concepto}</strong> ({formatMonto(Number(movimiento.monto))} {movimiento.moneda})?
            {esTransfer && ' Se eliminarán ambas patas de la transferencia.'}
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Eliminando…</> : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ─────────────────────────────────────────────────────────────

export default function TesoreriaView({ data, pendientes }: { data: TesoreriaPageData; pendientes: Pendientes }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [cuentaModal,    setCuentaModal]    = useState(false)
  const [editCuenta,     setEditCuenta]     = useState<Cuenta | null>(null)
  const [movModal,       setMovModal]       = useState(false)
  const [movCuentaIni,   setMovCuentaIni]   = useState<string | null>(null)
  const [transferModal,  setTransferModal]  = useState(false)
  const [confirmCuenta,  setConfirmCuenta]  = useState<CuentaConSaldo | null>(null)
  const [confirmMov,     setConfirmMov]     = useState<Movimiento | null>(null)

  const [verArchivadas,  setVerArchivadas]  = useState(false)
  const [filtroCuenta,   setFiltroCuenta]   = useState('')
  const [filtroTipo,     setFiltroTipo]     = useState('')
  const [tab,            setTab]            = useState<'cuentas' | 'movimientos'>('cuentas')

  const cuentasActivas = useMemo(() => data.cuentas.filter(c => c.activa), [data.cuentas])
  const cuentasVista   = useMemo(
    () => data.cuentas.filter(c => c.activa === !verArchivadas),
    [data.cuentas, verArchivadas],
  )
  const archivadas = data.cuentas.filter(c => !c.activa).length

  const cuentaNombre = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of data.cuentas) m[c.cuenta_id] = c.nombre
    return m
  }, [data.cuentas])

  const movimientosFiltrados = useMemo(() => {
    return data.movimientos.filter(m => {
      if (filtroCuenta && m.cuenta_id !== filtroCuenta) return false
      if (filtroTipo   && m.tipo      !== filtroTipo)   return false
      return true
    })
  }, [data.movimientos, filtroCuenta, filtroTipo])

  const { pageItems, ...pag } = usePagination(movimientosFiltrados)

  function onSaved() {
    setCuentaModal(false); setEditCuenta(null)
    setMovModal(false); setMovCuentaIni(null)
    setTransferModal(false)
    router.refresh()
  }
  function openMovimiento(cuentaId: string | null) { setMovCuentaIni(cuentaId); setMovModal(true) }

  function handleRestaurar(c: CuentaConSaldo) {
    startTransition(async () => { await restaurarCuenta(c.cuenta_id); router.refresh() })
  }
  function confirmarArchivar() {
    if (!confirmCuenta) return
    startTransition(async () => {
      await archivarCuenta(confirmCuenta.cuenta_id)
      setConfirmCuenta(null); router.refresh()
    })
  }
  function confirmarEliminarMov() {
    if (!confirmMov) return
    startTransition(async () => {
      await eliminarMovimiento(confirmMov.movimiento_id)
      setConfirmMov(null); router.refresh()
    })
  }

  const hayCuentasActivas = cuentasActivas.length > 0

  return (
    <div className="view-container">

      {/* Cabecera */}
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Tesorería</h1>
            <IaTouchpoint tipo="tesoreria" descripcion="un análisis de tu liquidez" />
          </div>
          <p className="page-subtitle">Cajas, cuentas de banco y movimientos. Saldos en tiempo real por moneda.</p>
        </div>
        <div className="tes-header-actions">
          <button className="btn btn-secondary" onClick={() => { setEditCuenta(null); setCuentaModal(true) }} disabled={data.empresas.length === 0 || data.monedas.length === 0}>
            <Plus size={14} strokeWidth={2.5} /> Nueva cuenta
          </button>
          {cuentasActivas.length >= 2 && (
            <button className="btn btn-secondary" onClick={() => setTransferModal(true)}>
              <ArrowRightLeft size={14} /> Transferencia
            </button>
          )}
          {hayCuentasActivas && (
            <button className="btn btn-primary" onClick={() => openMovimiento(null)}>
              <Plus size={14} strokeWidth={2.5} /> Registrar movimiento
            </button>
          )}
        </div>
      </div>

      {(data.empresas.length === 0 || data.monedas.length === 0) && (
        <PrerequisitoAviso acciones={data.empresas.length === 0
          ? [{ label: 'Crear empresa', href: '/portal/empresas' }]
          : [{ label: 'Crear moneda', href: '/portal/monedas' }]}>
          {data.empresas.length === 0
            ? <>Para crear cajas y cuentas necesitas <strong>una empresa</strong>.</>
            : <>Para crear cajas y cuentas necesitas <strong>al menos una moneda</strong> configurada.</>}
        </PrerequisitoAviso>
      )}

      {/* Saldos por moneda */}
      {data.saldos_por_moneda.length > 0 && (
        <div className="tes-saldos-grid">
          {data.saldos_por_moneda.map(s => (
            <div key={s.moneda} className="tes-saldo-card">
              <div className="tes-saldo-moneda">{s.moneda}</div>
              <div className={`tes-saldo-monto${s.saldo < 0 ? ' tes-saldo-neg' : ''}`}>
                {formatMonto(s.saldo)}
              </div>
              <div className="tes-saldo-label">saldo total</div>
            </div>
          ))}
        </div>
      )}

      {/* Pestañas: Cuentas | Movimientos (evita el scroll infinito de la tabla) */}
      <div className="ven-tabs">
        <button type="button" className={`ven-tab${tab === 'cuentas' ? ' active' : ''}`} onClick={() => setTab('cuentas')}>
          Cuentas <span className="ven-tab-count">{cuentasActivas.length}</span>
        </button>
        <button type="button" className={`ven-tab${tab === 'movimientos' ? ' active' : ''}`} onClick={() => setTab('movimientos')}>
          Movimientos <span className="ven-tab-count">{data.movimientos.length}</span>
        </button>
      </div>

      {tab === 'cuentas' && (<>
      {/* Cuentas */}
      <div className="tes-section-header">
        <h2 className="tes-section-title">{verArchivadas ? 'Cuentas archivadas' : 'Cuentas'}</h2>
        <label className="ter-archivados-toggle">
          <input type="checkbox" checked={verArchivadas} onChange={e => setVerArchivadas(e.target.checked)} />
          <span>Archivadas{archivadas > 0 && ` (${archivadas})`}</span>
        </label>
      </div>

      {cuentasVista.length === 0 ? (
        <div className="card mon-empty">
          <Wallet size={40} strokeWidth={1} opacity={0.2} />
          <p>
            {data.cuentas.length === 0
              ? 'Aún no hay cuentas. Crea tu primera caja o cuenta de banco para empezar a registrar movimientos.'
              : verArchivadas ? 'No hay cuentas archivadas.' : 'No hay cuentas activas.'}
          </p>
        </div>
      ) : (
        <div className="tes-cuentas-grid">
          {cuentasVista.map(c => (
            <div key={c.cuenta_id} className={`tes-cuenta-card${!c.activa ? ' tes-cuenta-archivada' : ''}`}>
              <div className="tes-cuenta-top">
                <div>
                  <div className="tes-cuenta-nombre">{c.nombre}</div>
                  <span className={`badge ${TIPO_CUENTA_BADGE[c.tipo]}`}>{TIPO_CUENTA_LABEL[c.tipo]}</span>
                  {data.empresas.length > 1 && (
                    <span className="tes-cuenta-empresa">{data.empresa_nombres[c.empresa_id]}</span>
                  )}
                </div>
                <div className="ter-actions">
                  {c.activa ? (
                    <>
                      <button className="ter-action-btn" title="Editar"
                        onClick={() => { setEditCuenta(c); setCuentaModal(true) }}><Pencil size={15} /></button>
                      <button className="ter-action-btn ter-action-danger" title="Archivar"
                        onClick={() => setConfirmCuenta(c)} disabled={isPending}><Archive size={15} /></button>
                    </>
                  ) : (
                    <button className="ter-action-btn ter-action-restore" title="Restaurar"
                      onClick={() => handleRestaurar(c)} disabled={isPending}><RotateCcw size={15} /></button>
                  )}
                </div>
              </div>

              <div className={`tes-cuenta-saldo${c.saldo < 0 ? ' tes-saldo-neg' : ''}`}>
                {formatMonto(c.saldo)} <span className="tes-cuenta-saldo-mon">{c.moneda}</span>
              </div>

              <div className="tes-cuenta-meta">
                <span className="tes-meta-in">↓ {formatMonto(c.total_ingresos)}</span>
                <span className="tes-meta-out">↑ {formatMonto(c.total_egresos)}</span>
                <span className="tes-meta-num">{c.num_movimientos} mov.</span>
              </div>

              {c.activa && (
                <button className="btn btn-secondary btn-sm tes-cuenta-mov-btn" onClick={() => openMovimiento(c.cuenta_id)}>
                  <Plus size={14} strokeWidth={2.5} /> Movimiento
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      </>)}

      {tab === 'movimientos' && (<>
      {/* Movimientos */}
      <div className="ter-toolbar">
        <select className="input ter-filter-select" value={filtroCuenta} onChange={e => setFiltroCuenta(e.target.value)}>
          <option value="">Todas las cuentas</option>
          {data.cuentas.map(c => <option key={c.cuenta_id} value={c.cuenta_id}>{c.nombre}</option>)}
        </select>
        <select className="input ter-filter-select" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="">Ingresos y egresos</option>
          <option value="INGRESO">Solo ingresos</option>
          <option value="EGRESO">Solo egresos</option>
        </select>
      </div>

      <div className="card card-table">
        {movimientosFiltrados.length === 0 ? (
          <div className="mon-empty">
            <List size={40} strokeWidth={1} opacity={0.2} />
            <p>{data.movimientos.length === 0 ? 'Sin movimientos todavía.' : 'No hay movimientos para los filtros seleccionados.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th>Cuenta</th>
                  <th className="col-num">Monto</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(m => (
                  <tr key={m.movimiento_id}>
                    <td data-label="Fecha" className="text-sm-muted tes-nowrap">{formatFecha(m.fecha)}</td>
                    <td data-label="Concepto">
                      <strong>{m.concepto}</strong>
                      <div className="tes-mov-sub">
                        {m.categoria && <span className="tes-mov-cat">{m.categoria}</span>}
                        {m.origen !== 'MANUAL' && <span className="badge badge-neutral tes-origen-badge">{m.origen}</span>}
                      </div>
                    </td>
                    <td data-label="Cuenta" className="text-sm-muted">{cuentaNombre[m.cuenta_id] ?? m.cuenta_id}</td>
                    <td data-label="Monto" className={`col-num tes-monto-cell ${m.tipo === 'INGRESO' ? 'tes-monto-in' : 'tes-monto-out'}`}>
                      {m.tipo === 'INGRESO' ? '+' : '−'}{formatMonto(Number(m.monto))} {m.moneda}
                    </td>
                    <td className="col-actions">
                      <div className="ter-actions">
                        <button className="ter-action-btn ter-action-danger" title="Eliminar"
                          onClick={() => setConfirmMov(m)} disabled={isPending}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="movimiento" />
      </div>
      </>)}

      {/* Modales */}
      {cuentaModal && (
        <CuentaModal cuenta={editCuenta} empresas={data.empresas} monedas={data.monedas}
          onClose={() => { setCuentaModal(false); setEditCuenta(null) }} onSaved={onSaved} />
      )}
      {movModal && (
        <MovimientoModal cuentas={cuentasActivas} categorias={data.categorias_gastos} pendientes={pendientes}
          cuentaInicial={movCuentaIni}
          onClose={() => { setMovModal(false); setMovCuentaIni(null) }} onSaved={onSaved} />
      )}
      {transferModal && (
        <TransferenciaModal cuentas={cuentasActivas}
          onClose={() => setTransferModal(false)} onSaved={onSaved} />
      )}
      {confirmCuenta && (
        <ConfirmArchivarCuenta cuenta={confirmCuenta} onConfirm={confirmarArchivar}
          onClose={() => setConfirmCuenta(null)} isPending={isPending} />
      )}
      {confirmMov && (
        <ConfirmEliminar movimiento={confirmMov} onConfirm={confirmarEliminarMov}
          onClose={() => setConfirmMov(null)} isPending={isPending} />
      )}
    </div>
  )
}

// ── Confirmación archivar cuenta ────────────────────────────────────────────────

function ConfirmArchivarCuenta({
  cuenta, onConfirm, onClose, isPending,
}: {
  cuenta:    CuentaConSaldo
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Archivar cuenta</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            ¿Archivar <strong>{cuenta.nombre}</strong>? Su saldo ({formatMonto(cuenta.saldo)} {cuenta.moneda})
            dejará de contar en los totales. Los movimientos se conservan y podrás restaurarla.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Archivando…</> : 'Archivar'}
          </button>
        </div>
      </div>
    </div>
  )
}
