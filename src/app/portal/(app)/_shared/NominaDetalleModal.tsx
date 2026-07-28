'use client'

import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { useEffect, useState, useTransition } from 'react'
import {
  anadirItemPuntual,
  eliminarItemPuntual,
  guardarLineaNomina,
  previsualizarRecalculoNomina,
  recalcularNomina,
  reabrirYActualizarNomina,
  type ItemLinea,
  type NominaConLineas,
  type NominaLinea,
  type RecalculoNomina,
} from '@/app/actions/portal/rrhh'
import { registrarLiquidacion } from '@/app/actions/portal/gastos'
import LiquidarCuentaFields, { type LiquidarState } from '@/app/portal/(app)/_shared/LiquidarCuentaFields'
import { Check, CircleCheck, DollarSign, Plus, RefreshCw, Wallet, X } from 'lucide-react'

type CuentaInfo = { cuenta_id: string; nombre: string; empresa_id: string; moneda: string }

export function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function hoyISO(): string { return new Date().toISOString().split('T')[0] }
export function formatPeriodo(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Desglose de la línea (mig. 140) ─────────────────────────────────────────────
// De dónde sale cada importe. Antes la línea guardaba `deducciones` como un número
// sin explicación, así que no se podía decir qué se retuvo ni por qué. Lo PUNTUAL
// —el hecho de este mes— se distingue del resto porque es lo único que se quita
// desde aquí: lo que baja de la ficha del trabajador se cambia en su ficha, o el
// recálculo lo repondría y parecería que no se guardó.

function DesgloseLinea({
  linea, editable, onChanged, onAnadir,
}: {
  linea:     NominaLinea
  editable:  boolean
  onChanged: () => void
  onAnadir:  () => void
}) {
  const [quitando, setQuitando] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Un preservado puede quedar recortado a 0 y sigue en la base para que el
  // desglose cuadre; en pantalla no aporta nada, así que no se pinta.
  const items = linea.items.filter(i => i.monto > 0.005)

  function quitar(item: ItemLinea) {
    if (!item.item_id) return
    setQuitando(item.item_id)
    const ld = toastLoading('Quitando…')
    startTransition(async () => {
      const res = await eliminarItemPuntual(item.item_id!)
      await ld.dismiss()
      setQuitando(null)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Concepto quitado')
      onChanged()
    })
  }

  if (!items.length && !editable) return null

  return (
    <div className="nom-desglose">
      {items.map((it, i) => {
        const suma    = it.tipo === 'DEVENGO'
        const puntual = it.origen === 'PUNTUAL'
        return (
          <span key={it.item_id ?? i} className={`nom-desglose-item${puntual ? ' nom-desglose-puntual' : ''}`}>
            <span className={`nom-desglose-monto ${suma ? 'nom-desglose-mas' : 'nom-desglose-menos'}`}>
              {suma ? '+' : '−'}{formatMonto(it.monto)}
            </span>
            <span>{it.nombre}</span>
            {editable && puntual && (
              <button type="button" className="nom-desglose-quitar"
                aria-label={`Quitar ${it.nombre}`} title="Quitar"
                disabled={quitando === it.item_id}
                onClick={() => quitar(it)}>
                <X size={12} strokeWidth={2.5} />
              </button>
            )}
          </span>
        )
      })}
      {!items.length && editable && <span className="nom-desglose-vacio">Solo el salario del período</span>}
      {editable && (
        <button type="button" className="nom-desglose-add" onClick={onAnadir}>
          <Plus size={11} strokeWidth={2.5} /> Concepto del mes
        </button>
      )}
    </div>
  )
}

function PuntualModal({
  linea, moneda, onClose, onDone,
}: {
  linea:   NominaLinea
  moneda:  string
  onClose: () => void
  onDone:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [tipo, setTipo] = useState<'DEVENGO' | 'RETENCION'>('RETENCION')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('linea_id', linea.linea_id)
    const ld = toastLoading('Añadiendo…')
    startTransition(async () => {
      const res = await anadirItemPuntual(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Concepto añadido')
      onDone()
    })
  }

  return (
    <div className="modal-backdrop open dialog-top">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Concepto de este mes</h2>
            <p className="text-xs-muted mt-1">{linea.empleado_nombre}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="info-box">
            <strong className="info-box-title">Solo para esta nómina</strong>
            <span className="text-xs-muted">
              Un hecho de este mes: una rotura, un extra puntual, un descuento pactado una vez.
              A diferencia de los conceptos de la ficha, <strong>no se repite el mes que viene</strong> y
              se conserva si actualizas la nómina con los conceptos del trabajador.
            </span>
          </div>
          <form id="puntual-form" onSubmit={handleSubmit}>
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label htmlFor="puntual-nombre">Concepto <span className="required">*</span></label>
                <input className="input" id="puntual-nombre" name="nombre" required maxLength={80}
                  placeholder="Rotura de cristal, horas extra de diciembre…" />
              </div>
              <div className="input-group ter-col-span-3">
                <label htmlFor="puntual-tipo">Tipo <span className="required">*</span></label>
                <select className="input" id="puntual-tipo" name="tipo" value={tipo}
                  onChange={e => setTipo(e.target.value as 'DEVENGO' | 'RETENCION')}>
                  <option value="RETENCION">Se le descuenta</option>
                  <option value="DEVENGO">Se le suma</option>
                </select>
              </div>
              <div className="input-group ter-col-span-3">
                <label htmlFor="puntual-monto">Importe ({moneda}) <span className="required">*</span></label>
                <input className="input" id="puntual-monto" name="monto" type="number" min="0.01" step="any" required />
              </div>
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" form="puntual-form" className="btn btn-primary" disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Añadiendo…</> : 'Añadir'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LineaEditableRow({
  linea, moneda, onChanged, onAnadirPuntual, devengadoCalculado,
}: {
  linea:           NominaLinea
  moneda:          string
  onChanged:       () => void
  onAnadirPuntual: () => void
  /** Bajo MIPYME_CUBA el devengado no se teclea: los impuestos dependen de él. */
  devengadoCalculado: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [dev, setDev] = useState(String(linea.devengado))

  // Las deducciones NO se editan aquí: son de solo lectura y vienen de los conceptos
  // del trabajador (su ficha). Un importe suelto sin concepto no se podía explicar,
  // ni clasificar, ni sobrevivía al recálculo — y su guardado por fila se perdía en
  // silencio al cerrar el modal.
  const netoLive = Math.max(0, (parseFloat(dev) || 0) - linea.deducciones)
  const dirty    = (parseFloat(dev) || 0) !== linea.devengado

  function save() {
    const fd = new FormData()
    fd.set('linea_id', linea.linea_id)
    fd.set('devengado', dev)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarLineaNomina(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  return (
    <tr>
      <td data-label="Empleado">
        <strong>{linea.empleado_nombre}</strong>
        {linea.cargo && <div className="text-sm-muted">{linea.cargo}</div>}
        <DesgloseLinea linea={linea} editable onChanged={onChanged} onAnadir={onAnadirPuntual} />
      </td>
      <td data-label="Devengado" className="col-num">
        {devengadoCalculado
          ? <span className="tes-monto-cell">{formatMonto(linea.devengado)}</span>
          : <input className="input nom-input" type="number" min="0" step="any" value={dev}
              onChange={e => setDev(e.target.value)} aria-label={`Devengado de ${linea.empleado_nombre}`} />}
      </td>
      <td data-label="Deducciones" className="col-num tes-monto-cell">{formatMonto(linea.deducciones)}</td>
      <td data-label="Neto" className="col-num tes-monto-cell">
        {formatMonto(devengadoCalculado ? linea.neto : netoLive)} {moneda}
      </td>
      <td className="col-actions">
        {!devengadoCalculado && (
          <button type="button" className="ter-action-btn ter-action-restore" title="Guardar línea"
            onClick={save} disabled={isPending || !dirty}><Check size={15} strokeWidth={2} /></button>
        )}
      </td>
    </tr>
  )
}

// ── Actualizar con los conceptos vigentes ────────────────────────────────────────
// Para el olvido de siempre: la nómina ya está generada y falta una retención. Es
// un recálculo desde el salario del período, así que PISA lo escrito a mano en las
// líneas que toca — de ahí la previsualización: se ve el antes → después de cada
// trabajador, con el desglose que la línea no guarda, antes de tocar nada.

function Cambio({ antes, despues }: { antes: number; despues: number }) {
  if (Math.abs(antes - despues) < 0.005) return <>{formatMonto(despues)}</>
  return (
    <span className="nom-cambio">
      <span className="nom-cambio-antes">{formatMonto(antes)}</span>
      <span className="nom-cambio-flecha" aria-hidden>→</span>
      <span className="nom-cambio-despues">{formatMonto(despues)}</span>
    </span>
  )
}

export function ActualizarConceptosModal({
  nomina, empleadoId, onClose, onDone,
}: {
  nomina:      NominaConLineas
  /** Acota el recálculo a un trabajador; sin él, la nómina completa. */
  empleadoId?: string
  onClose:     () => void
  onDone:      () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [plan, setPlan] = useState<RecalculoNomina | null>(null)
  // Una confirmada hay que reabrirla antes: revertir sus gastos y volver a BORRADOR.
  const confirmada = nomina.estado === 'CONFIRMADA'

  useEffect(() => {
    let vivo = true
    previsualizarRecalculoNomina(nomina.nomina_id, empleadoId)
      .then(r => { if (vivo) setPlan(r) })
      .catch(() => { if (vivo) setPlan({ ok: false, error: 'No se pudo calcular la actualización.', lineas: [], total_antes: 0, total_despues: 0 }) })
    return () => { vivo = false }
  }, [nomina.nomina_id, empleadoId])

  const cambian   = (plan?.lineas ?? []).filter(l => l.cambia)
  const recortada = cambian.some(l => l.recortada)

  function aplicar() {
    const ld = toastLoading(confirmada ? 'Reabriendo y actualizando…' : 'Actualizando…')
    startTransition(async () => {
      const res = confirmada
        ? await reabrirYActualizarNomina(nomina.nomina_id, empleadoId)
        : await recalcularNomina(nomina.nomina_id, empleadoId)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      const lineas = res.actualizadas === 1 ? 'Actualizada 1 línea' : `Actualizadas ${res.actualizadas} líneas`
      toastSuccess(confirmada
        ? `${lineas} · Nómina reabierta en borrador: revísala y vuelve a confirmarla`
        : `${lineas} · Total ${formatMonto(res.total ?? 0)} ${nomina.moneda}`)
      onDone()
    })
  }

  return (
    <div className="modal-backdrop open dialog-top">
      <div className="modal modal-xl" role="dialog" aria-modal>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{confirmada ? 'Reabrir y actualizar' : 'Actualizar con los conceptos'}</h2>
            {/* El alcance, dicho: desde la ficha va solo ese trabajador; desde la
                nómina van todos los que no cuadren, en una pasada. */}
            <p className="text-xs-muted mt-1">
              Nómina {formatPeriodo(nomina.periodo)} · {nomina.moneda} ·{' '}
              {empleadoId
                ? `solo ${plan?.lineas[0]?.empleado_nombre ?? 'este trabajador'}`
                : `nómina completa (${nomina.lineas.length} ${nomina.lineas.length === 1 ? 'trabajador' : 'trabajadores'})`}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <div className="modal-body">
          {!plan ? (
            <div className="nom-recalculo-cargando"><span className="spinner" /> Calculando…</div>
          ) : !plan.ok ? (
            <div className="alert alert-error">{plan.error ?? 'No se pudo calcular la actualización.'}</div>
          ) : cambian.length === 0 ? (
            <div className="info-box">
              <strong className="info-box-title">Ya está al día</strong>
              <span className="text-xs-muted">
                {empleadoId
                  ? 'Su línea ya refleja los bonos y deducciones fijos que tiene puestos.'
                  : 'Las líneas ya reflejan los bonos y deducciones fijos de cada trabajador.'}
                {' '}Si esperabas un cambio, revisa que el concepto esté dado de alta en la ficha del trabajador.
              </span>
            </div>
          ) : (
            <>
              {/* Un solo hijo por aviso: `.alert` es flex, así que varios trozos de
                  texto se reparten en columnas en vez de leerse como una frase. */}
              {confirmada && (
                <div className="alert alert-warning alert-intro">
                  <span>Esta nómina está confirmada. Se revertirán sus gastos de Gastos y cobros
                    y volverá a borrador con estos números; los vuelve a registrar cuando la
                    confirmes de nuevo. Si ya tiene pagos en Tesorería, anúlalos primero.</span>
                </div>
              )}
              {/* Ya NO se pierde lo escrito a mano (mig. 140): los conceptos del mes
                  son ítems propios y el recálculo los conserva. Solo se recompone lo
                  que sale de la ficha del trabajador. */}
              <div className="alert alert-warning alert-intro">
                <span>Se recalcula desde el salario del período y los conceptos de la ficha
                  de cada trabajador. Los conceptos que hayas añadido para este mes se
                  conservan; el resto de la nómina no se toca.</span>
              </div>

              {recortada && (
                <div className="alert alert-error alert-intro">
                  <span>En alguna línea la deducción no cabe en el devengado: se recorta y el
                    neto queda en 0. Revisa el valor del concepto.</span>
                </div>
              )}

              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Trabajador</th>
                      <th className="col-num">Devengado</th>
                      <th className="col-num">Deducciones</th>
                      <th className="col-num">Neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cambian.map(l => (
                      <tr key={l.linea_id}>
                        <td data-label="Trabajador">
                          <strong>{l.empleado_nombre}</strong>
                          <div className="text-sm-muted">
                            {l.items.length === 0
                              ? 'Solo el salario del período'
                              : l.items
                                  .filter(it => it.monto > 0.005)
                                  .map(it => `${it.tipo === 'DEVENGO' ? '+' : '−'}${formatMonto(it.monto)} ${it.nombre}`)
                                  .join(' · ')}
                          </div>
                        </td>
                        <td data-label="Devengado" className="col-num tes-monto-cell">
                          <Cambio antes={l.devengado_antes} despues={l.devengado_despues} /></td>
                        <td data-label="Deducciones" className="col-num tes-monto-cell">
                          <Cambio antes={l.deducciones_antes} despues={l.deducciones_despues} /></td>
                        <td data-label="Neto" className="col-num tes-monto-cell">
                          <Cambio antes={l.neto_antes} despues={l.neto_despues} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="nom-total">
                <span>Total de la nómina</span>
                <strong><Cambio antes={plan.total_antes} despues={plan.total_despues} /> {nomina.moneda}</strong>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {plan?.ok && cambian.length === 0 ? 'Cerrar' : 'Cancelar'}
          </button>
          {plan?.ok && cambian.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={aplicar} disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> {confirmada ? 'Reabriendo…' : 'Actualizando…'}</>
                : <><RefreshCw size={15} strokeWidth={2} />
                    {confirmada ? ' Reabrir y actualizar' : ` Actualizar ${cambian.length === 1 ? 'la línea' : `${cambian.length} líneas`}`}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function NominaDetalleModal({
  nomina, onClose, onChanged, onConfirmar, onPagar, empleadoId, devengadoCalculado = false,
}: {
  nomina:      NominaConLineas
  onClose:     () => void
  onChanged:   () => void
  onConfirmar: () => void
  onPagar:     () => void
  empleadoId?: string
  /** True si esta nómina la calcula el motor cubano: el devengado no se teclea. */
  devengadoCalculado?: boolean
}) {
  const esBorrador = nomina.estado === 'BORRADOR'
  const [actualizar, setActualizar] = useState(false)
  // El estado del diálogo vive en el PADRE, no dentro de la fila: la fila se
  // remonta con cada revalidación y se llevaría el modal abierto por delante.
  const [puntualEn, setPuntualEn] = useState<NominaLinea | null>(null)

  const lineasVisibles = empleadoId
    ? nomina.lineas.filter(l => l.empleado_id === empleadoId)
    : nomina.lineas
  const totalVisible = empleadoId
    ? lineasVisibles.reduce((s, l) => s + l.neto, 0)
    : nomina.total
  const esVistaIndividual = !!empleadoId
  const desfasadas = lineasVisibles.filter(l => l.desfasada).length
  // Con pagos hechos contra sus gastos no se puede reabrir: hay dinero movido contra
  // un importe concreto y cambiarlo por debajo rompería la conciliación.
  const tienePagos = !esBorrador && nomina.pagado > 0.005

  return (
    <>
    <div className="modal-backdrop open">
      <div className="modal modal-xl" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Nómina {formatPeriodo(nomina.periodo)}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="info-box">
            <strong className="info-box-title">
              {formatPeriodo(nomina.periodo)} · {nomina.moneda}
              {' '}<span className={`badge ${esBorrador ? 'badge-warning' : 'badge-success'}`}>{esBorrador ? 'Borrador' : 'Confirmada'}</span>
            </strong>
            <span className="text-xs-muted">
              {esBorrador
                ? devengadoCalculado
                  ? 'Esta nómina la calcula el modelo MIPYME cubana, así que el devengado no se teclea: los impuestos dependen de él. Para cambiarlo, carga los días o el pago extra en «Incidencias del mes» de su ficha, o añade aquí un concepto puntual.'
                  : 'Bajo cada trabajador ves de dónde sale su importe. Lo fijo viene de los conceptos de su ficha; lo de este mes lo añades aquí con «Concepto del mes». Al confirmar se registra el gasto de salarios.'
                : nomina.saldo_pendiente <= 0.005
                  ? 'Confirmada y pagada por completo.'
                  : `Gasto registrado · Pagado ${formatMonto(nomina.pagado)} · Pendiente ${formatMonto(nomina.saldo_pendiente)} ${nomina.moneda}. Usa el botón Pagar para liquidar.`}
            </span>
          </div>

          {/* Solo si hay desfase real: el servidor marca cada línea que no cuadra
              con los conceptos del trabajador (`desfasada`), así que el aviso no
              sale «por si acaso» ni obliga a abrirlo para descubrir que no hay nada.
              `lineasVisibles` ya está acotado, así que en la vista de un trabajador
              cuenta solo la suya. Sale también en CONFIRMADA: ahí actualizar implica
              reabrirla, y no se ofrece si ya hay dinero movido contra sus gastos. */}
          {desfasadas > 0 && (
            <div className="alert alert-warning alert-cta">
              <span className="alert-cta-texto">
                {esVistaIndividual
                  ? 'Sus conceptos no están aplicados en esta nómina.'
                  : desfasadas === 1
                    ? 'Un trabajador tiene conceptos sin aplicar en esta nómina.'
                    : `${desfasadas} trabajadores tienen conceptos sin aplicar en esta nómina.`}
                {tienePagos && ' Para actualizarla hay que reabrirla, y ya tiene pagos registrados: anúlalos en Tesorería primero.'}
              </span>
              {!tienePagos && (
                <button type="button" className="btn btn-aviso btn-sm" onClick={() => setActualizar(true)}>
                  <RefreshCw size={14} strokeWidth={2} />
                  {esBorrador ? ' Actualizar con los conceptos' : ' Reabrir y actualizar'}
                </button>
              )}
            </div>
          )}

          {lineasVisibles.length === 0 ? (
            <div className="mon-empty"><Wallet size={32} strokeWidth={1} opacity={0.2} /><p>Esta nómina no tiene líneas.</p></div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th className="col-num">Devengado</th>
                    <th className="col-num">Deducciones</th>
                    <th className="col-num">Neto</th>
                    {esBorrador && <th className="col-actions"></th>}
                  </tr>
                </thead>
                <tbody>
                  {esBorrador
                    ? lineasVisibles.map(l => (
                        <LineaEditableRow key={l.linea_id} linea={l} moneda={nomina.moneda}
                          onChanged={onChanged} onAnadirPuntual={() => setPuntualEn(l)}
                          devengadoCalculado={devengadoCalculado} />
                      ))
                    : lineasVisibles.map(l => (
                        <tr key={l.linea_id}>
                          <td data-label="Empleado">
                            <strong>{l.empleado_nombre}</strong>
                            {l.cargo && <div className="text-sm-muted">{l.cargo}</div>}
                            {/* También en la confirmada: el desglose es justo lo que
                                hay que poder consultar cuando la nómina ya está
                                cerrada y alguien pregunta qué se le retuvo. */}
                            <DesgloseLinea linea={l} editable={false} onChanged={onChanged} onAnadir={() => {}} />
                          </td>
                          <td data-label="Devengado" className="col-num tes-monto-cell">{formatMonto(l.devengado)}</td>
                          <td data-label="Deducciones" className="col-num tes-monto-cell">{formatMonto(l.deducciones)}</td>
                          <td data-label="Neto" className="col-num tes-monto-cell">{formatMonto(l.neto)} {nomina.moneda}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="nom-total">
            <span>{esVistaIndividual ? 'Neto del trabajador' : 'Total nómina'}</span>
            <strong>{formatMonto(totalVisible)} {nomina.moneda}</strong>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          {esBorrador ? (
            <button type="button" className="btn btn-primary" onClick={onConfirmar}>
              <CircleCheck size={15} strokeWidth={2} /> Confirmar nómina
            </button>
          ) : nomina.gasto_id && nomina.saldo_pendiente > 0.005 ? (
            <button type="button" className="btn btn-primary" onClick={onPagar}>
              <DollarSign size={15} strokeWidth={2} /> Pagar
            </button>
          ) : null}
        </div>
      </div>
    </div>

    {actualizar && (
      <ActualizarConceptosModal
        nomina={nomina}
        empleadoId={empleadoId}
        onClose={() => setActualizar(false)}
        onDone={() => { setActualizar(false); onChanged() }}
      />
    )}

    {puntualEn && (
      <PuntualModal
        linea={puntualEn}
        moneda={nomina.moneda}
        onClose={() => setPuntualEn(null)}
        onDone={() => { setPuntualEn(null); onChanged() }}
      />
    )}
    </>
  )
}

export function ConfirmarNominaModal({
  nomina, onConfirm, onClose, isPending,
}: {
  nomina:    NominaConLineas
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  // El coste de personal es el DEVENGADO; el neto es solo lo que sale hacia el
  // trabajador. Lo retenido no se pierde: va en su propio gasto (mig. 139).
  const devengado = nomina.lineas.reduce((s, l) => s + l.devengado, 0)
  const retenido  = nomina.lineas.reduce((s, l) => s + l.deducciones, 0)

  return (
    <div className="modal-backdrop open">
      <div className={`modal ${retenido > 0.005 ? 'modal-lg' : 'modal-md'}`} role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Confirmar nómina</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            {retenido > 0.005 ? (
              <>
                Se registrarán <strong>dos gastos</strong> en Gastos y cobros por la nómina
                de {formatPeriodo(nomina.periodo)}, que suman el coste real
                de <strong>{formatMonto(devengado)} {nomina.moneda}</strong>:
              </>
            ) : (
              <>
                Se registrará un gasto <strong>«Salarios»</strong> de <strong>{formatMonto(nomina.total)} {nomina.moneda}</strong> en
                Gastos y cobros (nómina de {formatPeriodo(nomina.periodo)}), que podrás pagar con el botón Pagar y aparecerá en
                Cuentas por pagar y Reportes. La nómina dejará de ser editable.
              </>
            )}
          </p>
          {retenido > 0.005 && (
            <>
              {/* Dos acreedores, dos filas: pagarle a la plantilla no paga los
                  impuestos, y en una sola fila eso era un clic de más de la cuenta. */}
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr><th>Gasto</th><th>Se le paga a</th><th className="col-num">Importe</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td data-label="Gasto"><strong>Salarios</strong></td>
                      <td data-label="Se le paga a">La plantilla</td>
                      <td data-label="Importe" className="col-num tes-monto-cell">{formatMonto(nomina.total)} {nomina.moneda}</td>
                    </tr>
                    <tr>
                      <td data-label="Gasto"><strong>Retenciones de nómina</strong></td>
                      <td data-label="Se le paga a">La agencia tributaria</td>
                      <td data-label="Importe" className="col-num tes-monto-cell">{formatMonto(retenido)} {nomina.moneda}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="modal-body-text">
                Cada uno se paga por separado desde Cuentas por pagar; el botón Pagar de la
                nómina liquida el de Salarios. La nómina dejará de ser editable.
              </p>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Confirmando…</> : 'Confirmar y registrar gasto'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PagarNominaModal({
  nomina, cuentas, onClose, onPaid,
}: {
  nomina:  NominaConLineas
  cuentas: CuentaInfo[]
  onClose: () => void
  onPaid:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  // Todas las cajas (sin filtrar por empresa ni por moneda): la de la misma
  // moneda aparece primero; si eliges otra, LiquidarCuentaFields aplica la tasa.
  const cuentasOrdenadas = [...cuentas].sort((a, b) =>
    (a.moneda === nomina.moneda ? 0 : 1) - (b.moneda === nomina.moneda ? 0 : 1))
  const [liq, setLiq]  = useState<LiquidarState | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!liq || !liq.valido) return
    const fd = new FormData(e.currentTarget)
    fd.set('registro_id', nomina.gasto_id ?? '')
    fd.set('cuenta_id', liq.cuentaId)
    fd.set('monto', liq.monto)
    fd.set('tasa_cambio', String(liq.tasa))
    const ld = toastLoading('Registrando…')
    startTransition(async () => {
      const res = await registrarLiquidacion(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onPaid()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Pagar nómina {formatPeriodo(nomina.periodo)}</h2>
            <p className="text-xs-muted mt-1">
              Salarios · Total {formatMonto(nomina.total)} {nomina.moneda} ·
              Pendiente <strong>{formatMonto(nomina.saldo_pendiente)} {nomina.moneda}</strong>
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          {cuentasOrdenadas.length === 0 ? (
            <div className="alert alert-warning">No tienes cajas disponibles. Crea una en Tesorería para registrar el pago.</div>
          ) : (
            <form id="pagar-nomina-form" onSubmit={handleSubmit} className="gc-liq-form">
              <div className="ter-form-grid">
                <LiquidarCuentaFields
                  cuentas={cuentasOrdenadas}
                  docMoneda={nomina.moneda}
                  saldo={nomina.saldo_pendiente}
                  onChange={setLiq}
                />
                <div className="input-group ter-col-span-3">
                  <label>Fecha <span className="required">*</span></label>
                  <input className="input" name="fecha" type="date" required defaultValue={hoyISO()} />
                </div>
                <div className="input-group ter-col-full">
                  <label>Notas</label>
                  <input className="input" name="notas" placeholder="Referencia…" />
                </div>
              </div>
            </form>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          {cuentasOrdenadas.length > 0 && (
            <button type="submit" form="pagar-nomina-form" className="btn btn-primary" disabled={isPending || !liq?.valido}>
              {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : 'Registrar pago'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
