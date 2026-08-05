'use client'

import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, type TransitionStartFunction } from 'react'
import {
  recalcularNomina,
  reabrirYActualizarNomina,
  type NominaConLineas,
} from '@/app/actions/portal/rrhh'
import { revisarNominaIa } from '@/app/actions/portal/ia'
import { useIa } from '@/components/portal/ia/IaContext'
import { Sparkles, X } from 'lucide-react'
import { hoyEnTz } from '@/lib/fecha-tz'

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

/**
 * Lo que confirmar va a escribir DE VERDAD, derivado de los ítems de la nómina.
 *
 * El modal decía «se registrarán **dos** gastos» y hablaba de «el botón Pagar». Las dos
 * cosas quedaron falsas con la mig. 166: se escriben **hasta ocho** filas —cada aporte y
 * cada retención con su acreedor y su vencimiento— y el botón Pagar se retiró justo
 * porque uno solo no podía pagarlas todas. Confirmar es lo único irreversible de este
 * flujo, así que la lista se calcula en vez de escribirse a mano: un texto fijo vuelve a
 * caducar en la siguiente migración.
 */
function filasQueSeEscriben(nomina: NominaConLineas): {
  concepto: string; acreedor: string | null; monto: number
}[] {
  const porClave = new Map<string, { concepto: string; acreedor: string | null; monto: number }>()
  const sumar = (clave: string, concepto: string, acreedor: string | null, monto: number) => {
    if (monto <= 0.005) return
    const p = porClave.get(clave)
    if (p) p.monto += monto
    else porClave.set(clave, { concepto, acreedor, monto })
  }

  // La deuda con la plantilla: Σ netos. Es la fila que gobierna «Pagada».
  sumar('__neto__', 'Salario neto', 'La plantilla', nomina.total)

  for (const l of nomina.lineas) {
    // La acumulación de vacaciones es COSTE sin pago: se reconoce cuando se acumula y
    // sale cuando se disfruta, así que no tiene acreedor a quien liquidar.
    sumar('__vac__', 'Acumulación de vacaciones', null, l.vacaciones_acumuladas_periodo)
    // El subsidio lo cobra el trabajador pero no le cuesta a la empresa: nace como
    // cuenta por COBRAR a la Seguridad Social.
    sumar('__sub__', 'Subsidio por cobrar', 'Lo cobras tú de la Seguridad Social', l.subsidios)
    for (const it of l.items) {
      if (it.tipo === 'RETENCION') {
        sumar(`r:${it.clave ?? it.nombre}`, it.nombre, 'La agencia tributaria', it.monto)
      } else if (it.tipo === 'APORTE_EMPRESA') {
        sumar(`a:${it.clave ?? it.nombre}`, it.nombre, 'La agencia tributaria', it.monto)
      }
    }
  }
  return Array.from(porClave.values())
}

/**
 * R8.1 · «Repásala antes de confirmar».
 *
 * Confirmar es lo ÚNICO irreversible del módulo: crea la deuda con la plantilla y con
 * ONAT. Este es el punto exacto donde un segundo par de ojos vale, y por eso el botón
 * vive dentro del modal de confirmación y no en un icono suelto de la cabecera.
 *
 * La IA **solo señala**: no puede confirmar, no escribe nada y no bloquea. Si no hay
 * addon contratado, el bloque no se pinta y la pantalla queda exactamente como estaba.
 */
function RevisionIa({ nominaId }: { nominaId: string }) {
  const { tieneIa, nombreAgente } = useIa()
  const [texto,   setTexto]   = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!tieneIa) return null

  function revisar() {
    setError(null)
    startTransition(async () => {
      const r = await revisarNominaIa(nominaId)
      if (r.ok) { setTexto(r.texto); setError(null) }
      else      { setError(r.error); setTexto(null) }
    })
  }

  return (
    <div className="nom-revision-ia">
      {texto === null && !pending && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={revisar}>
          <Sparkles size={14} strokeWidth={2} /> Que {nombreAgente} la repase antes
        </button>
      )}
      {pending && (
        <p className="text-sm-muted">
          <span className="spinner spinner-sm" /> Comparando con los meses anteriores…
        </p>
      )}
      {texto && (
        <div className="info-box">
          <strong className="info-box-title">Lo que ve {nombreAgente}</strong>
          <span className="text-xs-muted">{texto}</span>
        </div>
      )}
      {error && <p className="text-sm-muted">{error}</p>}
    </div>
  )
}

export function ConfirmarNominaModal({
  nomina, tieneContabilidad = true, onConfirm, onClose, isPending,
}: {
  nomina:    NominaConLineas
  /** Sin el módulo de Contabilidad los apuntes se escriben igual, pero el dueño no
   *  tiene ni Gastos ni Cuentas por pagar donde verlos: nombrárselos sería mandarle a
   *  pantallas que no existen para él. */
  tieneContabilidad?: boolean
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  // El coste de personal es el DEVENGADO; el neto es solo lo que sale hacia el
  // trabajador. Lo retenido no se pierde: va en su propio gasto (mig. 139).
  const devengado = nomina.lineas.reduce((s, l) => s + l.devengado, 0)
  const filas     = filasQueSeEscriben(nomina)

  return (
    <div className="modal-backdrop open">
      <div className={`modal ${filas.length > 1 ? 'modal-lg' : 'modal-md'}`} role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Confirmar nómina</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            La nómina de {formatPeriodo(nomina.periodo)} tiene un coste real
            de <strong>{formatMonto(devengado)} {nomina.moneda}</strong>. Confirmar
            {tieneContabilidad
              ? ' registra en tu contabilidad '
              : ' deja registrado '}
            {filas.length === 1
              ? 'este apunte'
              : <>estos <strong>{filas.length} apuntes</strong></>}, cada uno con su acreedor:
          </p>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Concepto</th><th>Se le paga a</th><th className="col-num">Importe</th></tr>
              </thead>
              <tbody>
                {filas.map(f => (
                  <tr key={f.concepto}>
                    <td data-label="Concepto"><strong>{f.concepto}</strong></td>
                    <td data-label="Se le paga a">
                      {f.acreedor ?? <span className="text-xs-muted">Nadie — es coste, no deuda</span>}
                    </td>
                    <td data-label="Importe" className="col-num tes-monto-cell">{formatMonto(f.monto)} {nomina.moneda}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="modal-body-text">
            {tieneContabilidad
              ? <>Cada deuda se paga <strong>por separado</strong> desde Cuentas por pagar o Tesorería,
                  con su propio vencimiento: pagarle a la plantilla no paga los impuestos.</>
              : <>Los apuntes quedan guardados; con el módulo de <strong>Contabilidad</strong> los
                  verías en tus cuentas y podrías liquidarlos.</>}
            {' '}La nómina dejará de ser editable.
          </p>

          {/* Un segundo par de ojos JUSTO antes del único paso irreversible del módulo.
              No se lanza sola: cada análisis gasta una conversación del cupo del addon,
              y la nómina se puede confirmar sin pasar por aquí. */}
          <RevisionIa nominaId={nomina.nomina_id} />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Confirmando…</> : 'Confirmar nómina'}
          </button>
        </div>
      </div>
    </div>
  )
}

// `PagarNominaModal` vivía aquí y NO lo importaba nadie: código muerto desde que la
// mig. 166 retiró el botón «Pagar». Una nómina confirmada genera VARIAS deudas —el
// salario neto y cada retención, cada una con su acreedor y su vencimiento— y un solo
// botón únicamente podía pagar una, dando por liquidada la nómina entera. Se paga en
// Tesorería, con el resto.
