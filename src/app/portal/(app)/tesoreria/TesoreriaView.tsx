'use client'

import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { ConfirmDialog } from '@/components/portal/Dialog'
import BulkBar from '@/components/portal/BulkBar'
import { RowActions } from '@/components/portal/RowActions'
import { useRowSelection } from '@/components/portal/useRowSelection'
import Tabs from '@/components/Tabs'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { useEmpresas } from '@/components/portal/EmpresaColorContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter }                        from 'next/navigation'
import { Archive, ArrowDown, ArrowRightLeft, ArrowUp, List, Pencil, Plus, RotateCcw, Trash2, Wallet, X } from 'lucide-react'
import {
  guardarCuenta,
  archivarCuenta,
  restaurarCuenta,
  archivarCuentasEnLote,
  registrarMovimiento,
  registrarTransferencia,
  editarMovimiento,
  eliminarMovimiento,
  eliminarMovimientosEnLote,
  obtenerTasaTransferencia,
  type Cuenta,
  type CuentaConSaldo,
  type Movimiento,
  type TipoCuenta,
  type TipoMovimiento,
  type TesoreriaPageData,
  type ResultadoLoteCuentas,
} from '@/app/actions/portal/tesoreria'
import type { CategoriaGasto } from '@/app/actions/portal/gastos'
import { registrarPagoDoc, type DocumentoPendiente } from '@/app/actions/portal/cobranza'
import RangoBusqueda from '@/components/portal/RangoBusqueda'
import ExportarMenu  from '@/components/portal/ExportarMenu'
import { LIMITE_LISTADO } from '@/lib/listados'

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
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarCuenta(fd)
      await ld.dismiss()
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
                  <input className="input" name="saldo_inicial" type="number" step="any"
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
  cuentas, categorias, pendientes, cuentaInicial, empresaNombres, onClose, onSaved,
}: {
  cuentas:       CuentaConSaldo[]
  categorias:    TesoreriaPageData['categorias_gastos']
  pendientes:    Pendientes
  cuentaInicial: string | null
  empresaNombres: Record<string, string>
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
  const [montoLibre, setMontoLibre]     = useState('')   // importe de un movimiento sin documento
  const [editandoCaja, setEditandoCaja] = useState(false)
  const [tasaInput, setTasaInput]       = useState('')
  /** Tasa traída del servidor o escrita a mano. Solo cuenta si la moneda cambia. */
  const [tasaCargada, setTasaCargada]   = useState(1)
  /** Par cuya tasa ya llegó: «cargando» se deriva comparándolo con el par actual, en vez
   *  de encender un flag desde el efecto (que puede quedarse encendido si algo falla). */
  const [parResuelto, setParResuelto]   = useState<string | null>(null)

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

  // Si cambian tipo/cuenta y el pendiente elegido ya no está en la lista, se ignora.
  // DERIVADO, no reseteado desde un efecto: el `setPendienteId('')` que había aquí era un
  // `setState` síncrono dentro del efecto, con la cascada de repintados que eso arrastra,
  // y además dejaba un fotograma con un pendiente seleccionado que ya no existía.
  const pendienteSel = listaPendientes.find(d => d.doc_id === pendienteId) ?? null
  const pendienteEfectivo = pendienteSel ? pendienteId : ''

  // ¿El pendiente está en otra moneda que la caja? → se aplica tasa (como en transferencias)
  const cambiaMoneda = !!(pendienteSel && cuentaSel && pendienteSel.moneda !== cuentaSel.moneda)

  // Al elegir/soltar un pendiente, el importe parte del saldo del documento. Es un efecto
  // del CLIC, no del render: va en el handler del selector (`elegirPendiente`), donde
  // React sí puede agrupar los tres `setState` en un solo repintado.

  // Cargar la tasa vigente cuando la moneda de la caja difiere de la del documento.
  // La rama de «misma moneda» ya no escribe estado: `tasaCompleta` se deriva más abajo.
  const parTasa = cambiaMoneda && pendienteSel && cuentaSel
    ? `${pendienteSel.moneda}>${cuentaSel.moneda}` : ''
  const cargandoTasa = !!parTasa && parResuelto !== parTasa

  useEffect(() => {
    if (!parTasa) return
    const [desde, hasta] = parTasa.split('>')
    let vivo = true
    obtenerTasaTransferencia(desde, hasta)
      .then(r => {
        if (!vivo) return
        if (r.ok && r.tasa) { setTasaCargada(r.tasa); setTasaInput(truncar4(r.tasa)); setEditandoCaja(false) }
        else                { setTasaCargada(0); setTasaInput('') }
      })
      .catch(() => { if (vivo) { setTasaCargada(0); setTasaInput('') } })
      .finally(() => { if (vivo) setParResuelto(parTasa) })
    return () => { vivo = false }
  }, [parTasa])

  // Sin cambio de moneda la tasa es 1 por definición: derivada, no guardada.
  const tasaCompleta = cambiaMoneda ? tasaCargada : 1

  const impDocNum  = parseFloat(impDoc)  || 0
  // El importe en la caja es derivado (documento × tasa) salvo edición manual. El efecto
  // que lo copiaba al estado disparaba un repintado extra por cada tecla y mantenía dos
  // copias de la misma cifra; ahora el input lee esta.
  const impCajaCalc  = Math.round(impDocNum * tasaCompleta * 100) / 100
  const impCajaNum   = editandoCaja ? (parseFloat(impCaja) || 0) : impCajaCalc
  const impCajaVista = editandoCaja ? impCaja : (impCajaCalc > 0 ? String(impCajaCalc) : '')

  /** Elegir un pendiente arranca el importe en su saldo y suelta la edición manual. */
  function elegirPendiente(id: string) {
    setPendienteId(id)
    const doc = listaPendientes.find(d => d.doc_id === id) ?? null
    setImpDoc(doc ? doc.saldo.toFixed(2) : '')
    setImpCaja('')
    setEditandoCaja(false)
  }

  function handleTasaChange(v: string) {
    setTasaInput(v)
    setTasaCargada(parseFloat(v) || 0)
    setEditandoCaja(false)
    setImpCaja('')
  }
  function handleImpCajaChange(v: string) {
    setImpCaja(v)
    setEditandoCaja(true)
    const caja = parseFloat(v) || 0
    if (caja > 0 && impDocNum > 0) {
      const nueva = caja / impDocNum
      setTasaCargada(nueva)
      setTasaInput(truncar4(nueva))
    }
  }

  const pagoInvalido = !!pendienteSel && (impDocNum <= 0 || impDocNum > pendienteSel.saldo + 0.005 || (cambiaMoneda && tasaCompleta <= 0))

  // Saldo que quedaría en la caja tras un EGRESO libre. `null` cuando no aplica (ingreso,
  // sin cuenta, sin importe o liquidando un pendiente: ahí el importe es del documento).
  const saldoResultante = (() => {
    if (pendienteSel || tipo !== 'EGRESO' || !cuentaSel) return null
    const n = parseFloat(montoLibre) || 0
    if (n <= 0) return null
    return Math.round((cuentaSel.saldo - n) * 100) / 100
  })()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('cuenta_id', cuentaId)
    const ld = toastLoading('Registrando…')
    startTransition(async () => {
      // Liquidar un pendiente existente → no se crea un registro nuevo (evita duplicados)
      if (pendienteSel) {
        if (pagoInvalido) { await ld.dismiss(); return }
        fd.set('doc_tipo', pendienteSel.doc_tipo)
        fd.set('doc_id', pendienteSel.doc_id)
        fd.set('monto', impDoc)                              // importe en la moneda del documento
        fd.set('tasa_cambio', String(cambiaMoneda ? tasaCompleta : 1))
        const res = await registrarPagoDoc(fd)
        await ld.dismiss()
        if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
        onSaved()
        return
      }
      // Movimiento libre (crea gasto/cobro nuevo si el toggle está activo)
      fd.set('tipo', tipo)
      fd.set('registrar_gasto', String(registrarGasto))
      const res = await registrarMovimiento(fd)
      await ld.dismiss()
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
                  <select className="input" value={pendienteEfectivo} onChange={e => elegirPendiente(e.target.value)}>
                    <option value="">— Ninguno (registrar {labelRegistro} nuevo) —</option>
                    {listaPendientes.map(d => (
                      <option key={d.doc_id} value={d.doc_id}>
                        {d.numero} · {formatMonto(d.saldo)} {d.moneda}
                        {cuentaSel && d.moneda !== cuentaSel.moneda ? ' (otra moneda)' : ''}
                        {cuentaSel && d.empresa_id !== cuentaSel.empresa_id ? ` · ${empresaNombres[d.empresa_id] ?? 'otra empresa'}` : ''}
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
                  {/* Está permitido, pero el movimiento se sella con la empresa de la CAJA:
                      sin decirlo, el ingreso de una empresa acaba en la caja de otra. */}
                  {pendienteSel && cuentaSel && pendienteSel.empresa_id !== cuentaSel.empresa_id && (
                    <span className="input-hint-warning">
                      El documento es de {empresaNombres[pendienteSel.empresa_id] ?? 'otra empresa'} y la caja de{' '}
                      {empresaNombres[cuentaSel.empresa_id] ?? 'otra empresa'}: el dinero se mueve en la otra empresa.
                    </span>
                  )}
                </div>
              )}

              {/* Importe: en la moneda del documento si liquidas un pendiente; si no, en la de la caja */}
              {pendienteSel ? (
                <div className="input-group ter-col-span-3">
                  <label>Importe ({pendienteSel.moneda}) <span className="required">*</span></label>
                  <input className="input" type="number" min="0" step="any" required autoFocus
                    value={impDoc} onChange={e => setImpDoc(e.target.value)} placeholder="0.00" />
                  <span className="input-hint">Saldo pendiente {formatMonto(pendienteSel.saldo)} {pendienteSel.moneda}. Puedes cobrar/pagar menos.</span>
                  {impDocNum > pendienteSel.saldo + 0.005 && (
                    <span className="input-hint-warning">El monto supera el saldo pendiente</span>
                  )}
                </div>
              ) : (
                <div className="input-group ter-col-span-3">
                  <label>Monto {cuentaSel ? `(${cuentaSel.moneda})` : ''} <span className="required">*</span></label>
                  <input className="input" name="monto" type="number" min="0" step="any" required
                    autoFocus placeholder="0.00"
                    value={montoLibre} onChange={e => setMontoLibre(e.target.value)} />
                  {/* Aviso ANTES de dejar la caja en rojo, no bloqueo: en Cuba se paga con
                      lo que hay y el efectivo no siempre está registrado al minuto. Lo que
                      no puede pasar es enterarse después, mirando el saldo. */}
                  {saldoResultante != null && saldoResultante < 0 && (
                    <span className="input-hint-warning">
                      La caja se quedaría en {formatMonto(saldoResultante)} {cuentaSel!.moneda}.
                      Se registra igual.
                    </span>
                  )}
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
                    <input className="input" type="number" min="0" step="any"
                      value={tasaInput} onChange={e => handleTasaChange(e.target.value)}
                      placeholder={cargandoTasa ? 'Cargando…' : '0.0000'} />
                    {tasaCompleta <= 0 && !cargandoTasa && (
                      <span className="input-hint-warning">No hay tasa para {pendienteSel.moneda} → {cuentaSel.moneda}. Escríbela.</span>
                    )}
                  </div>
                  <div className="input-group ter-col-span-3">
                    <label>Se moverá en la caja ({cuentaSel.moneda})</label>
                    <input className="input" type="number" min="0" step="any"
                      value={impCajaVista} onChange={e => handleImpCajaChange(e.target.value)} placeholder="0.00" />
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

// ── Modal: editar un movimiento manual ────────────────────────────────────────
//
// Antes solo se podía borrar y volver a crear: corregir una fecha mal escrita destruía la
// fila y su código. La cuenta y la moneda NO se editan (ver `editarMovimiento`): mover
// dinero de caja son dos saldos a la vez, y para eso está borrar y registrar de nuevo.

function EditarMovimientoModal({
  movimiento, categorias, cuentaNombre, onClose, onSaved,
}: {
  movimiento:   Movimiento
  categorias:   CategoriaGasto[]
  cuentaNombre: string
  onClose:      () => void
  onSaved:      () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('movimiento_id', movimiento.movimiento_id)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await editarMovimiento(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Movimiento actualizado.')
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Editar movimiento</h2>
            <p className="text-xs-muted mt-1">
              {movimiento.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'} en {cuentaNombre} · {movimiento.moneda}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label htmlFor="mov-concepto">Concepto <span className="required">*</span></label>
                <input id="mov-concepto" className="input" name="concepto" required autoFocus
                  defaultValue={movimiento.concepto} />
              </div>
              <div className="input-group ter-col-span-3">
                <label htmlFor="mov-monto">Monto ({movimiento.moneda}) <span className="required">*</span></label>
                <input id="mov-monto" className="input" name="monto" type="number" min="0" step="any" required
                  defaultValue={String(movimiento.monto)} />
              </div>
              <div className="input-group ter-col-span-3">
                <label htmlFor="mov-fecha">Fecha <span className="required">*</span></label>
                <input id="mov-fecha" className="input" name="fecha" type="date" required
                  defaultValue={movimiento.fecha} />
              </div>
              <div className="input-group ter-col-full">
                <label htmlFor="mov-cat">Categoría</label>
                <select id="mov-cat" className="input" name="categoria_id" defaultValue={movimiento.categoria_id ?? ''}>
                  <option value="">— Sin categoría —</option>
                  {categorias.map(c => (
                    <option key={c.categoria_id} value={c.categoria_id}>
                      {c.parent_id ? '· ' : ''}{c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="input-group ter-col-full">
                <label htmlFor="mov-notas">Notas</label>
                <input id="mov-notas" className="input" name="notas" defaultValue={movimiento.notas ?? ''} />
              </div>
              <div className="input-group ter-col-full">
                <span className="input-hint">
                  La cuenta y la moneda no se cambian aquí: mover dinero de una caja a otra
                  toca dos saldos, y para eso está borrar y registrar de nuevo.
                </span>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: Transferencia ────────────────────────────────────────────────────────

function TransferenciaModal({
  cuentas, empresaNombres, onClose, onSaved,
}: {
  cuentas: CuentaConSaldo[]
  empresaNombres: Record<string, string>
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [origen, setOrigen]   = useState(cuentas[0]?.cuenta_id ?? '')
  const [destino, setDestino] = useState(cuentas[1]?.cuenta_id ?? '')
  const [monto, setMonto]     = useState('')
  const [montoRecibido, setMontoRecibido] = useState('')
  const [tasaInput, setTasaInput] = useState('')
  /** Tasa traída o escrita a mano; solo cuenta si las monedas difieren. */
  const [tasaCargada, setTasaCargada] = useState<number>(0)
  const [feeEnvio, setFeeEnvio]   = useState('')
  const [feeRecibo, setFeeRecibo] = useState('')
  const [tasaDisplay, setTasaDisplay] = useState<number | null>(null)
  const [tasaEsInversa, setTasaEsInversa] = useState(false)
  /** Par cuya tasa ya llegó; «cargando» se deriva de él (ver el modal de movimiento). */
  const [parResuelto, setParResuelto] = useState<string | null>(null)
  const [editandoMontoRecibido, setEditandoMontoRecibido] = useState(false)

  const cuentaOrigen  = cuentas.find(c => c.cuenta_id === origen)
  const cuentaDestino = cuentas.find(c => c.cuenta_id === destino)
  const monedasDiferentes = !!(cuentaOrigen && cuentaDestino && cuentaOrigen.moneda !== cuentaDestino.moneda)

  // Solo el resultado de la petición se escribe en estado; el caso «misma moneda» se
  // deriva (`tasaCompleta` más abajo) en vez de resetear cinco `useState` a mano dentro
  // del efecto, que era una cascada de repintados y cinco sitios donde olvidarse uno.
  const parTasa = monedasDiferentes && cuentaOrigen && cuentaDestino
    ? `${cuentaOrigen.moneda}>${cuentaDestino.moneda}` : ''
  const cargandoTasa = !!parTasa && parResuelto !== parTasa

  useEffect(() => {
    if (!parTasa) return
    const [desde, hasta] = parTasa.split('>')
    let vivo = true
    obtenerTasaTransferencia(desde, hasta)
      .then(r => {
        if (!vivo) return
        if (r.ok && r.tasa) {
          setTasaCargada(r.tasa)
          setTasaInput(truncar4(r.tasa))
          setTasaDisplay(r.tasaDisplay ?? r.tasa)
          setTasaEsInversa(r.esInversa ?? false)
        } else {
          setTasaCargada(0)
          setTasaDisplay(null)
          setTasaEsInversa(false)
          setTasaInput('')
        }
        setMontoRecibido('')
        setEditandoMontoRecibido(false)
      })
      .catch(() => {
        if (!vivo) return
        setTasaCargada(0); setTasaDisplay(null); setTasaEsInversa(false)
        setTasaInput(''); setMontoRecibido('')
      })
      .finally(() => { if (vivo) setParResuelto(parTasa) })
    return () => { vivo = false }
  }, [parTasa])

  // Sin cambio de moneda no hay tasa que aplicar: 1 a 1.
  const tasaCompleta = monedasDiferentes ? tasaCargada : 0

  const montoNum     = parseFloat(monto) || 0
  const feeEnvioNum  = parseFloat(feeEnvio) || 0
  const feeReciboNum = parseFloat(feeRecibo) || 0
  const montoRecibidoNum = parseFloat(montoRecibido) || 0
  // Derivado, igual que en el modal de movimiento: el efecto que copiaba esta cifra al
  // estado repintaba por cada tecla y mantenía dos copias del mismo número.
  const montoConvertido = Math.round(montoNum * tasaCompleta * 1e6) / 1e6
  const montoDestino = monedasDiferentes
    ? (editandoMontoRecibido ? montoRecibidoNum : montoConvertido)
    : montoNum
  const montoRecibidoVista = editandoMontoRecibido
    ? montoRecibido
    : (monedasDiferentes && montoConvertido > 0 ? String(montoConvertido) : '')
  const totalOrigen  = montoNum + feeEnvioNum
  const netoDestino  = montoDestino - feeReciboNum

  function handleMontoRecibidoChange(value: string) {
    setMontoRecibido(value)
    setEditandoMontoRecibido(true)
    const mr = parseFloat(value) || 0
    if (mr > 0 && montoNum > 0) {
      const nuevaTasa = mr / montoNum
      setTasaCargada(nuevaTasa)
      setTasaInput(truncar4(nuevaTasa))
    }
  }

  function handleTasaChange(value: string) {
    setTasaInput(value)
    const num = parseFloat(value) || 0
    setTasaCargada(num)
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
        setTasaCargada(nuevaTasa)
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
    const ld = toastLoading('Transfiriendo…')
    startTransition(async () => {
      const res = await registrarTransferencia(fd)
      await ld.dismiss()
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
                {/* Mover dinero entre empresas está permitido, pero no es lo mismo que
                    moverlo dentro de una: en los papeles es un préstamo entre ellas. */}
                {cuentaOrigen && cuentaDestino && cuentaOrigen.empresa_id !== cuentaDestino.empresa_id && (
                  <span className="input-hint-warning">
                    Es una transferencia entre {empresaNombres[cuentaOrigen.empresa_id] ?? 'una empresa'} y{' '}
                    {empresaNombres[cuentaDestino.empresa_id] ?? 'otra'}: el dinero cambia de empresa.
                  </span>
                )}
              </div>
              <div className="input-group ter-col-span-3">
                <label>Monto {cuentaOrigen ? `(${cuentaOrigen.moneda})` : ''} <span className="required">*</span></label>
                <input className="input" name="monto" type="number" min="0" step="any" required
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
                    <input className="input" name="tasa_cambio" type="number" min="0" step="any" required
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
                    <input className="input" type="number" min="0" step="any"
                      placeholder="0.00"
                      value={montoRecibidoVista} onChange={e => handleMontoRecibidoChange(e.target.value)} />
                    <span className="input-hint">Editable si la tasa real difiere</span>
                  </div>
                </>
              )}

              <div className="input-group ter-col-span-3">
                <label>Fee de envío {cuentaOrigen ? `(${cuentaOrigen.moneda})` : ''}</label>
                <input className="input" name="fee_envio" type="number" min="0" step="any"
                  placeholder="0.00" value={feeEnvio} onChange={e => setFeeEnvio(e.target.value)} />
                <span className="input-hint">Comisión por enviar (opcional)</span>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Fee de recepción {cuentaDestino ? `(${cuentaDestino.moneda})` : ''}</label>
                <input className="input" name="fee_recibo" type="number" min="0" step="any"
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

// ── Checkbox de cabecera (con estado indeterminado) ──────────────────────────────

function HeaderCheck({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: () => void
}) {
  return (
    <input type="checkbox" className="row-check" checked={checked}
      ref={el => { if (el) el.indeterminate = indeterminate }}
      onChange={onChange} aria-label="Seleccionar todo" />
  )
}

// ── Vista principal ─────────────────────────────────────────────────────────────

export default function TesoreriaView({ data, pendientes }: { data: TesoreriaPageData; pendientes: Pendientes }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { colorOf } = useEmpresas()
  const multiempresa = data.empresas.length > 1

  const [cuentaModal,    setCuentaModal]    = useState(false)
  const [editCuenta,     setEditCuenta]     = useState<Cuenta | null>(null)
  const [movModal,       setMovModal]       = useState(false)
  const [movCuentaIni,   setMovCuentaIni]   = useState<string | null>(null)
  const [transferModal,  setTransferModal]  = useState(false)
  const [confirmCuenta,  setConfirmCuenta]  = useState<CuentaConSaldo | null>(null)
  const [confirmMov,     setConfirmMov]     = useState<Movimiento | null>(null)
  const [editMov,        setEditMov]        = useState<Movimiento | null>(null)

  const [verArchivadas,  setVerArchivadas]  = useState(false)
  const [filtroCuenta,   setFiltroCuenta]   = useState('')
  const [filtroTipo,     setFiltroTipo]     = useState('')
  const [filtroEmpresaMov, setFiltroEmpresaMov] = useState('')
  const [filtroCatMov,   setFiltroCatMov]   = useState('')
  const [tab,            setTab]            = useState<'cuentas' | 'movimientos'>('cuentas')

  const cuentasActivas = useMemo(() => data.cuentas.filter(c => c.activa), [data.cuentas])
  const cuentasVista   = useMemo(
    () => data.cuentas.filter(c => c.activa === !verArchivadas),
    [data.cuentas, verArchivadas],
  )
  const archivadas = data.cuentas.filter(c => !c.activa).length

  // ── Selección múltiple de cuentas (archivar/restaurar en lote) ──
  const cuentaIds = useMemo(() => cuentasVista.map(c => c.cuenta_id), [cuentasVista])
  const selCuentas = useRowSelection(cuentaIds)
  const [confirmLote, setConfirmLote] = useState(false)
  useEffect(() => { selCuentas.clear() }, [verArchivadas, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const plural = (n: number) => n === 1 ? '' : 's'

  function ejecutarLoteCuentas(fn: () => Promise<ResultadoLoteCuentas>, mensaje: (n: number) => string) {
    const ld = toastLoading('Actualizando…')
    startTransition(async () => {
      const r = await fn()
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess(mensaje(r.hechas))
      selCuentas.clear()
      router.refresh()
    })
  }
  function doArchivarLoteCuentas() {
    setConfirmLote(false)
    ejecutarLoteCuentas(() => archivarCuentasEnLote(selCuentas.selectedIds, true), n => `${n} cuenta${plural(n)} archivada${plural(n)}.`)
  }

  const cuentaNombre = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of data.cuentas) m[c.cuenta_id] = c.nombre
    return m
  }, [data.cuentas])

  // Descendientes de una categoría raíz: filtrar por «Suministros» tiene que traer sus
  // subcategorías, igual que en Gastos.
  const hijasDeCat = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const c of data.categorias_gastos) {
      if (!c.parent_id) continue
      const s = m.get(c.parent_id) ?? new Set<string>()
      s.add(c.categoria_id)
      m.set(c.parent_id, s)
    }
    return m
  }, [data.categorias_gastos])

  const movimientosFiltrados = useMemo(() => {
    const catsOk = filtroCatMov && filtroCatMov !== '__sin__'
      ? new Set<string>([filtroCatMov, ...(hijasDeCat.get(filtroCatMov) ?? [])])
      : null
    return data.movimientos.filter(m => {
      if (filtroCuenta && m.cuenta_id !== filtroCuenta) return false
      if (filtroTipo   && m.tipo      !== filtroTipo)   return false
      if (filtroEmpresaMov && m.empresa_id !== filtroEmpresaMov) return false
      if (filtroCatMov === '__sin__' && m.categoria_id) return false
      if (catsOk && !(m.categoria_id && catsOk.has(m.categoria_id))) return false
      return true
    })
  }, [data.movimientos, filtroCuenta, filtroTipo, filtroEmpresaMov, filtroCatMov, hijasDeCat])

  const { pageItems, ...pag } = usePagination(movimientosFiltrados)

  // ── Selección múltiple de movimientos (eliminar en lote) ──
  // Sobre los movimientos VISIBLES filtrados (persiste entre páginas; se limpia al
  // cambiar de filtro o de pestaña). Solo se eliminan los manuales: los que vienen
  // de cobro/pago o de transferencias los omite la acción de lote con su motivo.
  const movIds = useMemo(() => movimientosFiltrados.map(m => m.movimiento_id), [movimientosFiltrados])
  const selMov = useRowSelection(movIds)
  const [confirmLoteMov, setConfirmLoteMov] = useState(false)
  useEffect(() => { selMov.clear() }, [filtroCuenta, filtroTipo, filtroEmpresaMov, filtroCatMov, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  function doEliminarLoteMov() {
    setConfirmLoteMov(false)
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await eliminarMovimientosEnLote(selMov.selectedIds)
      await ld.dismiss()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas)          partes.push(`${r.hechas} eliminado${plural(r.hechas)}`)
      if (r.omitidas.length) partes.push(`${r.omitidas.length} omitido${plural(r.omitidas.length)}`)
      const msg = partes.join(' · ') || 'Nada que eliminar'
      if (r.hechas > 0) toastSuccess(msg)
      else              toastError(r.omitidas[0]?.motivo ? `Nada eliminado — ${r.omitidas[0].motivo}` : msg)
      selMov.clear()
      router.refresh()
    })
  }

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
          {/* Una descarga por pestaña: lo que se lleva es la tabla que se está mirando. */}
          {tab === 'movimientos' ? (
            <ExportarMenu
              clave="movimientos_tesoreria"
              filtro={{
                desde: data.rango.desde, hasta: data.rango.hasta, q: data.q,
                empresa_id: filtroEmpresaMov, cuenta_id: filtroCuenta,
                tipo: filtroTipo, categoria: filtroCatMov,
              }}
              resumen={[
                filtroEmpresaMov && (data.empresas.find(e => e.empresa_id === filtroEmpresaMov)?.nombre ?? ''),
                filtroCuenta && (data.cuentas.find(c => c.cuenta_id === filtroCuenta)?.nombre ?? ''),
                filtroTipo, filtroCatMov,
              ].filter((x): x is string => Boolean(x))}
            />
          ) : (
            <ExportarMenu
              clave="cuentas"
              filtro={{ archivadas: verArchivadas }}
              resumen={[verArchivadas ? 'archivadas' : 'activas']}
            />
          )}
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
      <Tabs
        ariaLabel="Secciones de tesorería"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'cuentas', label: 'Cuentas', count: cuentasActivas.length },
          { id: 'movimientos', label: 'Movimientos', count: data.movimientos.length },
        ]}
      />

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
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-check">
                    <HeaderCheck checked={selCuentas.allSelected} indeterminate={selCuentas.someSelected} onChange={selCuentas.toggleAll} />
                  </th>
                  <th>Cuenta</th>
                  <th className="col-center">Tipo</th>
                  {multiempresa && <th>Empresa</th>}
                  <th className="col-num">Saldo</th>
                  <th className="col-num">Ingresos</th>
                  <th className="col-num">Egresos</th>
                  <th className="col-num">Mov.</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {cuentasVista.map(c => (
                  <tr key={c.cuenta_id}
                    className={`${!c.activa ? 'tes-row-archivada ' : ''}${multiempresa ? 'row-empresa-accent' : ''}`}
                    style={multiempresa ? empresaColorVar(colorOf(c.empresa_id)) : undefined}>
                    <td className="col-check" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="row-check"
                        checked={selCuentas.isSelected(c.cuenta_id)}
                        onChange={() => selCuentas.toggle(c.cuenta_id)}
                        aria-label={`Seleccionar ${c.nombre}`} />
                    </td>
                    <td data-label="Cuenta"><strong>{c.nombre}</strong></td>
                    <td data-label="Tipo" className="col-center">
                      <span className={`badge ${TIPO_CUENTA_BADGE[c.tipo]}`}>{TIPO_CUENTA_LABEL[c.tipo]}</span>
                    </td>
                    {multiempresa && (
                      <td data-label="Empresa">
                        <EmpresaTag color={colorOf(c.empresa_id)} nombre={data.empresa_nombres[c.empresa_id]} />
                      </td>
                    )}
                    <td data-label="Saldo" className={`col-num${c.saldo < 0 ? ' tes-saldo-neg' : ''}`}>
                      <strong>{formatMonto(c.saldo)} {c.moneda}</strong>
                    </td>
                    <td data-label="Ingresos" className="col-num tes-monto-in">{formatMonto(c.total_ingresos)}</td>
                    <td data-label="Egresos" className="col-num tes-monto-out">{formatMonto(c.total_egresos)}</td>
                    <td data-label="Mov." className="col-num">{c.num_movimientos}</td>
                    <td className="col-actions">
                      <RowActions>
                        {c.activa ? (
                          <>
                            <button className="row-actions-item" onClick={() => openMovimiento(c.cuenta_id)}>
                              <Plus size={15} strokeWidth={2} /> Registrar movimiento
                            </button>
                            <button className="row-actions-item" onClick={() => { setEditCuenta(c); setCuentaModal(true) }}>
                              <Pencil size={15} strokeWidth={2} /> Editar
                            </button>
                            <button className="row-actions-item row-actions-item-danger" onClick={() => setConfirmCuenta(c)} disabled={isPending}>
                              <Archive size={15} strokeWidth={2} /> Archivar
                            </button>
                          </>
                        ) : (
                          <button className="row-actions-item" onClick={() => handleRestaurar(c)} disabled={isPending}>
                            <RotateCcw size={15} strokeWidth={2} /> Restaurar
                          </button>
                        )}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>)}

      {tab === 'movimientos' && (<>
      {/* Rango y búsqueda (en la URL; el rango se aplica en la query) */}
      <div className="ter-toolbar">
        <RangoBusqueda
          desde={data.rango.desde}
          hasta={data.rango.hasta}
          q={data.q}
          placeholder="Buscar por concepto, código o importe…"
        />
      </div>

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
        {/* Empresa y categoría: sin ellos, un negocio con dos empresas no podía mirar el
            movimiento de una sola, y «cuánto salió en Alquiler» no se respondía aquí. */}
        {data.empresas.length > 1 && (
          <select className="input ter-filter-select" value={filtroEmpresaMov} onChange={e => setFiltroEmpresaMov(e.target.value)}>
            <option value="">Todas las empresas</option>
            {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
          </select>
        )}
        <select className="input ter-filter-select" value={filtroCatMov} onChange={e => setFiltroCatMov(e.target.value)}>
          <option value="">Todas las categorías</option>
          <option value="__sin__">Sin categoría</option>
          {data.categorias_gastos.filter(c => !c.parent_id).map(c => (
            <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>
          ))}
        </select>
      </div>

      {data.hay_mas && (
        <p className="listado-tope">
          Se enseñan los primeros {LIMITE_LISTADO} movimientos del rango. Los saldos de arriba
          son de toda la historia, no del rango.
        </p>
      )}

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
                  <th className="col-check">
                    <HeaderCheck checked={selMov.allSelected} indeterminate={selMov.someSelected} onChange={selMov.toggleAll} />
                  </th>
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
                    <td className="col-check">
                      <input type="checkbox" className="row-check"
                        checked={selMov.isSelected(m.movimiento_id)}
                        onChange={() => selMov.toggle(m.movimiento_id)}
                        aria-label={`Seleccionar ${m.concepto}`} />
                    </td>
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
                        {/* Editar solo los MANUALES sin transferencia: mismas guardas que
                            el borrado, y por lo mismo — un movimiento de cobro/pago es el
                            reflejo de un documento y se corrige desde él. */}
                        {m.origen === 'MANUAL' && !m.transfer_grupo && (
                          <button className="ter-action-btn" title="Editar"
                            aria-label={`Editar ${m.concepto}`}
                            onClick={() => setEditMov(m)} disabled={isPending}><Pencil size={14} /></button>
                        )}
                        <button className="ter-action-btn ter-action-danger" title="Eliminar"
                          aria-label={`Eliminar ${m.concepto}`}
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

      {/* Barra de acciones en lote (solo pestaña de cuentas) */}
      {tab === 'cuentas' && (
        <BulkBar count={selCuentas.count} onClear={selCuentas.clear}>
          {verArchivadas ? (
            <button className="btn btn-secondary btn-sm" disabled={isPending}
              onClick={() => ejecutarLoteCuentas(
                () => archivarCuentasEnLote(selCuentas.selectedIds, false),
                n => `${n} cuenta${plural(n)} restaurada${plural(n)}.`)}>
              <RotateCcw size={14} strokeWidth={2} /> Restaurar
            </button>
          ) : (
            <button className="btn btn-danger-text btn-sm" disabled={isPending}
              onClick={() => setConfirmLote(true)}>
              <Archive size={14} strokeWidth={2} /> Archivar
            </button>
          )}
        </BulkBar>
      )}

      {confirmLote && (
        <ConfirmDialog
          title={`¿Archivar ${selCuentas.count} cuenta${plural(selCuentas.count)}?`}
          body="Sus saldos dejarán de contar en los totales. Los movimientos se conservan y podrás restaurarlas."
          confirmLabel="Archivar" danger
          onCancel={() => setConfirmLote(false)}
          onConfirm={doArchivarLoteCuentas}
        />
      )}

      {/* Barra de acciones en lote (solo pestaña de movimientos) */}
      {tab === 'movimientos' && (
        <BulkBar count={selMov.count} onClear={selMov.clear}>
          <button className="btn btn-danger-text btn-sm" disabled={isPending}
            onClick={() => setConfirmLoteMov(true)}>
            <Trash2 size={14} strokeWidth={2} /> Eliminar
          </button>
        </BulkBar>
      )}

      {confirmLoteMov && (
        <ConfirmDialog
          title={`¿Eliminar ${selMov.count} movimiento${plural(selMov.count)}?`}
          body="Solo se eliminan los movimientos manuales. Los que provienen de un cobro/pago o de una transferencia se omitirán (anúlalos desde su documento)."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmLoteMov(false)}
          onConfirm={doEliminarLoteMov}
        />
      )}

      {/* Modales */}
      {cuentaModal && (
        <CuentaModal cuenta={editCuenta} empresas={data.empresas} monedas={data.monedas}
          onClose={() => { setCuentaModal(false); setEditCuenta(null) }} onSaved={onSaved} />
      )}
      {movModal && (
        <MovimientoModal cuentas={cuentasActivas} categorias={data.categorias_gastos} pendientes={pendientes}
          cuentaInicial={movCuentaIni} empresaNombres={data.empresa_nombres}
          onClose={() => { setMovModal(false); setMovCuentaIni(null) }} onSaved={onSaved} />
      )}
      {transferModal && (
        <TransferenciaModal cuentas={cuentasActivas} empresaNombres={data.empresa_nombres}
          onClose={() => setTransferModal(false)} onSaved={onSaved} />
      )}
      {confirmCuenta && (
        <ConfirmArchivarCuenta cuenta={confirmCuenta} onConfirm={confirmarArchivar}
          onClose={() => setConfirmCuenta(null)} isPending={isPending} />
      )}
      {editMov && (
        <EditarMovimientoModal
          movimiento={editMov}
          categorias={data.categorias_gastos}
          cuentaNombre={cuentaNombre[editMov.cuenta_id] ?? editMov.cuenta_id}
          onClose={() => setEditMov(null)}
          onSaved={() => { setEditMov(null); router.refresh() }}
        />
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
