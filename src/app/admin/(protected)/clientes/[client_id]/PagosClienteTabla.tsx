'use client'

// ── Historial de pagos de la ficha del cliente ──
//
// Era una tabla de solo lectura con un botón de confirmar suelto. El cobro de
// configuración que deja el alta se quedaba ahí para siempre con la cifra del
// primer presupuesto, aunque después se reescribiera el borrador o se aprobara
// otro: el admin no tenía por dónde tocarlo y el cliente veía esa cifra vieja en
// su panel. Desde aquí se confirma, se ajusta al presupuesto vigente o —mientras
// siga POR CONFIRMAR, que es el borrador de un cobro— se elimina.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, RefreshCw, Trash2 } from 'lucide-react'
import { RowActions } from '@/components/portal/RowActions'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { confirmarPago, eliminarPago } from '@/app/actions/pagos'
import { ajustarCobroConfiguracion } from '@/app/actions/presupuestos'
import { importeClaux, normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'

export type PagoFicha = {
  pago_id:        string
  concepto:       string | null
  estado:         string | null
  monto:      number | null
  /** La del cobro, no la del cliente: un pago viejo en dólares se lee en dólares
   *  aunque hoy se le facture en euros (mig. 225). El historial no se reetiqueta. */
  moneda:         string | null
  metodo:         string | null
  fecha:          string | null
  presupuesto_id: number | null
}

/** Presupuestos aprobados del cliente, del más reciente al más antiguo. */
export type PresupuestoRef = { id: number; total: number; moneda: MonedaClaux }

type Accion = 'confirmar' | 'ajustar' | 'eliminar'
type Pendiente = { accion: Accion; pago: PagoFicha; objetivo: PresupuestoRef | null }

const METODO_LABEL: Record<string, string> = {
  tropipay:      'TropiPay',
  transferencia: 'Transferencia',
  efectivo:      'Efectivo',
}

const monedaDe = (x: { moneda: string | null }) => normalizarMonedaClaux(x.moneda)
const imp = (n: number | null | undefined, m: unknown) => importeClaux(n, m)

function formatFecha(fecha: string | null) {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(-2)}`
}

export default function PagosClienteTabla({
  pagos,
  clienteNombre,
  presupuestos,
  /** El admin de turno tiene la sección Pagos (si no, el historial es de mirar). */
  puedeGestionar,
}: {
  pagos: PagoFicha[]
  clienteNombre: string
  presupuestos: PresupuestoRef[]
  puedeGestionar: boolean
}) {
  const router = useRouter()
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [enCurso, setEnCurso]     = useState(false)

  /* El presupuesto contra el que se mide un cobro de configuración: el suyo si
     ya está ligado (mig. 204) y, si no, el último aprobado — que es de donde
     salió antes de que el vínculo existiera. */
  function presupuestoDe(p: PagoFicha): PresupuestoRef | null {
    if (p.concepto !== 'configuracion' || p.estado !== 'por_confirmar') return null
    if (p.presupuesto_id) return presupuestos.find(x => x.id === p.presupuesto_id) ?? null
    return presupuestos[0] ?? null
  }

  async function ejecutar() {
    if (!pendiente) return
    const { accion, pago, objetivo } = pendiente
    setEnCurso(true)
    const res =
      accion === 'confirmar' ? await confirmarPago(pago.pago_id)
      : accion === 'eliminar' ? await eliminarPago(pago.pago_id)
      : await ajustarCobroConfiguracion(objetivo!.id)
    setEnCurso(false)

    if (!res.ok) { toastError(res.error ?? 'No se pudo completar la operación.'); return }
    toastSuccess(
      accion === 'confirmar' ? 'Cobro confirmado'
      : accion === 'eliminar' ? 'Cobro eliminado'
      : ('aviso' in res && res.aviso) || 'Cobro ajustado',
    )
    setPendiente(null)
    router.refresh()
  }

  return (
    <>
      <div className="table-wrapper table-wrapper-flush">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th className="col-num">Monto</th>
              <th>Estado</th>
              <th>Método</th>
              {puedeGestionar && <th className="col-actions" />}
            </tr>
          </thead>
          <tbody>
            {pagos.map(p => {
              const porConfirmar = p.estado === 'por_confirmar'
              const objetivo     = presupuestoDe(p)
              const moneda       = monedaDe(p)
              // Ajustar solo se ofrece si hay algo que ajustar: si la cifra ya es
              // la del presupuesto, el botón sobra. LA MONEDA CUENTA COMO CIFRA: si
              // el cliente re-firmó en euros, el cobro pendiente en dólares está
              // desajustado aunque el número sea el mismo (no se convierte, se
              // rehace en la moneda del presupuesto vigente).
              const desajustado  = !!objetivo && (
                Math.abs(Number(p.monto ?? 0) - objetivo.total) > 0.005 || objetivo.moneda !== moneda
              )

              return (
                <tr key={p.pago_id}>
                  <td data-label="Fecha" className="table-muted">{formatFecha(p.fecha)}</td>
                  <td data-label="Monto" className="col-num table-price">
                    {imp(p.monto, moneda)}
                    {desajustado && (
                      <span className="text-xs-muted"> · presupuesto {imp(objetivo.total, objetivo.moneda)}</span>
                    )}
                  </td>
                  <td data-label="Estado">
                    <span className={`badge ${porConfirmar ? 'badge-warning' : 'badge-success'}`}>
                      {porConfirmar ? 'Por confirmar' : 'Confirmado'}
                    </span>
                  </td>
                  <td data-label="Método">
                    <span className="badge badge-neutral">
                      {METODO_LABEL[p.metodo ?? ''] ?? p.metodo ?? '—'}
                    </span>
                  </td>
                  {puedeGestionar && (
                  <td className="col-actions">
                    {porConfirmar && (
                      <RowActions>
                        <button
                          className="row-actions-item row-actions-item-success"
                          onClick={() => setPendiente({ accion: 'confirmar', pago: p, objetivo })}
                        >
                          <Check size={15} /> Confirmar cobro
                        </button>
                        {desajustado && (
                          <button
                            className="row-actions-item"
                            onClick={() => setPendiente({ accion: 'ajustar', pago: p, objetivo })}
                          >
                            <RefreshCw size={14} /> Ajustar al presupuesto
                          </button>
                        )}
                        <button
                          className="row-actions-item row-actions-item-danger"
                          onClick={() => setPendiente({ accion: 'eliminar', pago: p, objetivo })}
                        >
                          <Trash2 size={14} /> Eliminar
                        </button>
                      </RowActions>
                    )}
                  </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pendiente?.accion === 'confirmar' && (
        <ConfirmDialog
          title="Confirmar cobro"
          body={<>
            Marca como cobrado <strong>{pendiente.pago.pago_id}</strong> de {clienteNombre}
            {' '}({pendiente.pago.concepto === 'configuracion' ? 'configuración' : 'suscripción'})
            {' '}por <strong>{imp(pendiente.pago.monto, monedaDe(pendiente.pago))}</strong>. A partir de aquí cuenta
            como ingreso y deja de ajustarse solo. Hazlo cuando hayas verificado el dinero.
          </>}
          confirmLabel="Confirmar cobro"
          pending={enCurso}
          pendingLabel="Confirmando…"
          onConfirm={ejecutar}
          onCancel={() => setPendiente(null)}
        />
      )}

      {pendiente?.accion === 'ajustar' && pendiente.objetivo && (
        <ConfirmDialog
          title="Ajustar al presupuesto"
          body={pendiente.objetivo.total <= 0 ? (
            /* Un presupuesto a cero (100% de descuento) no deja un cobro de $0 en
               la ficha: se retira, y hay que decirlo antes de hacerlo. */
            <>
              El presupuesto aprobado queda en <strong>{imp(0, pendiente.objetivo.moneda)}</strong>, así
              que el cobro de <strong>{imp(pendiente.pago.monto, monedaDe(pendiente.pago))}</strong> se
              retira del historial: no hay nada que cobrarle a {clienteNombre}.
            </>
          ) : (
            <>
              El cobro pasa de <strong>{imp(pendiente.pago.monto, monedaDe(pendiente.pago))}</strong> a{' '}
              <strong>{imp(pendiente.objetivo.total, pendiente.objetivo.moneda)}</strong>, que es lo que
              vale hoy el presupuesto aprobado. El cliente verá esa cifra en su panel.
            </>
          )}
          confirmLabel={pendiente.objetivo.total <= 0 ? 'Retirar cobro' : 'Ajustar cobro'}
          pending={enCurso}
          pendingLabel="Ajustando…"
          onConfirm={ejecutar}
          onCancel={() => setPendiente(null)}
        />
      )}

      {pendiente?.accion === 'eliminar' && (
        <ConfirmDialog
          title={`¿Eliminar ${pendiente.pago.pago_id}?`}
          body={<>
            Se borra del historial de {clienteNombre} el cobro de{' '}
            <strong>{imp(pendiente.pago.monto, monedaDe(pendiente.pago))}</strong>. Está por confirmar, así que no
            había entrado dinero: no se toca la suscripción. No se puede deshacer.
          </>}
          confirmLabel="Eliminar"
          pendingLabel="Eliminando…"
          danger
          pending={enCurso}
          onConfirm={ejecutar}
          onCancel={() => setPendiente(null)}
        />
      )}
    </>
  )
}
