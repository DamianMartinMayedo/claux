'use client'

import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, type TransitionStartFunction } from 'react'
import {
  recalcularNomina,
  reabrirYActualizarNomina,
  type NominaConLineas,
} from '@/app/actions/portal/rrhh'
import { registrarLiquidacion } from '@/app/actions/portal/gastos'
import LiquidarCuentaFields, { type LiquidarState } from '@/app/portal/(app)/_shared/LiquidarCuentaFields'
import { X } from 'lucide-react'
import { hoyEnTz } from '@/lib/fecha-tz'

type CuentaInfo = { cuenta_id: string; nombre: string; empresa_id: string; moneda: string }

export function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: a partir de las 20:00
// `toISOString()` ya da la fecha de mañana, así que el defecto de un `type=date` se
// adelantaba un día cada noche. Una sola fuente: `lib/fecha-tz.ts`.
export function hoyISO(): string { return hoyEnTz() }
export function formatPeriodo(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// `DesgloseLinea`/`PuntualModal`/`LineaEditableRow`/`NominaDetalleModal` vivieron
// aquí (revisar/editar una nómina en modal). Se retiraron al migrar a la página
// `/portal/nomina/[nomina_id]` (`NominaDetalleView.tsx`): una tabla en vez de un
// modal, con desglose por fila plegable y las incidencias editables en la tabla
// en vez de en un modal de «concepto del mes» separado.

// ── Actualizar con los conceptos vigentes ────────────────────────────────────────
// Para el olvido de siempre: la nómina ya está generada y falta una retención. Es
// un recálculo desde el salario del período y los conceptos de la ficha; lo que se
// escribió a mano para el mes (ítems PUNTUAL) se conserva, así que no hay nada que
// aprobar antes: se aplica directo y el resultado se ve en la propia tabla.
//
// Hubo un modal de previsualización (antes → después por trabajador). Se retiró: en
// la práctica siempre se aceptaba, y era un paso más entre el aviso y el arreglo.

/**
 * Aplica el recálculo a UNA O VARIAS nóminas y avisa por toast. Las confirmadas se
 * reabren antes (revierte sus gastos y vuelven a borrador) — salvo que ya tengan
 * pagos en Tesorería, donde la acción se niega sola.
 *
 * Acepta una lista porque el aviso de la ficha del trabajador puede señalar cuatro
 * borradores a la vez: un botón por nómina no cabe en el aviso y obliga a pulsar
 * cuatro veces para lo mismo. Van en serie, no en paralelo: cada una escribe en las
 * mismas tablas y varias a la vez se pisarían el total.
 *
 * El toast de carga se crea AQUÍ, fuera de la transición, a propósito: creado
 * dentro no llega a pintarse y en una conexión lenta la pantalla parece muerta.
 */
export function actualizarConceptosNominas(
  nominas:         NominaConLineas[],
  /** Acota el recálculo a un trabajador; sin él, la nómina completa. */
  empleadoId:      string | undefined,
  startTransition: TransitionStartFunction,
  onDone:          () => void,
): void {
  if (!nominas.length) return
  const varias   = nominas.length > 1
  const reabrir  = nominas.some(n => n.estado === 'CONFIRMADA')
  const ld = toastLoading(varias
    ? `Actualizando ${nominas.length} nóminas…`
    : (reabrir ? 'Reabriendo y actualizando…' : 'Actualizando…'))

  startTransition(async () => {
    let lineas     = 0
    let hechas     = 0
    let reabiertas = 0
    let total      = 0
    const fallos: string[] = []

    for (const n of nominas) {
      const confirmada = n.estado === 'CONFIRMADA'
      const res = confirmada
        ? await reabrirYActualizarNomina(n.nomina_id, empleadoId)
        : await recalcularNomina(n.nomina_id, empleadoId)
      if (!res.ok) { fallos.push(`${formatPeriodo(n.periodo)}: ${res.error ?? 'error inesperado'}`); continue }
      hechas++
      lineas += res.actualizadas ?? 0
      total   = res.total ?? 0
      if (confirmada) reabiertas++
    }
    await ld.dismiss()

    // Se informa de lo hecho ANTES de lo fallido: en un lote a medias, saber qué sí
    // se aplicó importa tanto como el error.
    if (lineas === 0 && hechas > 0) {
      // Puede pasar: el aviso se calcula con los datos de la página, que pudieron
      // quedarse atrás. Decirlo es mejor que un «hecho» que no cambió nada.
      toastSuccess('Ya estaba al día: no había nada que actualizar.')
    } else if (lineas > 0) {
      const txt = lineas === 1 ? 'Actualizada 1 línea' : `Actualizadas ${lineas} líneas`
      const donde = varias ? ` en ${hechas} ${hechas === 1 ? 'nómina' : 'nóminas'}` : ''
      toastSuccess(reabiertas > 0
        ? `${txt}${donde} · ${reabiertas === 1 ? 'La nómina vuelve' : 'Las nóminas vuelven'} a borrador: revísalas y vuelve a confirmarlas`
        : `${txt}${donde}${varias ? '' : ` · Total ${formatMonto(total)} ${nominas[0].moneda}`}`)
    }
    if (fallos.length) toastError(fallos.join(' · '))

    onDone()
  })
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
