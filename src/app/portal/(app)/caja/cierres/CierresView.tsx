'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, AlertTriangle, RefreshCw } from 'lucide-react'
import {
  reintentarContabilizar, cerrarYContabilizar,
  type Cierre, type PendienteContabilizar,
} from '@/app/actions/portal/caja'
import { usePagination, TablePagination } from '@/components/TablePagination'
import ExportarMenu from '@/components/portal/ExportarMenu'
import AvisoTope from '@/components/portal/AvisoTope'
import Tabs from '@/components/Tabs'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'

const money = (n: number) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = (s: string | null) => s ? new Date(s).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—'
function totales(t: Record<string, number>): string {
  const e = Object.entries(t ?? {})
  return e.length ? e.map(([m, v]) => `${money(v)} ${m}`).join(' · ') : '—'
}

/** Monedas vendidas que todavía no tienen su ingreso en Tesorería. */
function monedasQueFaltan(c: Cierre): string[] {
  const vendidas = Object.keys(c.total_por_moneda ?? {})
  const hechas   = Object.keys(c.tesoreria_movs ?? {})
  return vendidas.filter(m => !hechas.includes(m))
}

interface Props {
  data: {
    cierres: Cierre[]; cajaNombres: Record<string, string>
    hay_mas: boolean; total: number; limite: number
  }
  pendientes: PendienteContabilizar[]
  puedeEditar: boolean
}

export default function CierresView({ data, pendientes, puedeEditar }: Props) {
  const [tab, setTab] = useState<'cierres' | 'pendientes'>(pendientes.length > 0 ? 'pendientes' : 'cierres')
  const cajaNombre = (id: string) => data.cajaNombres[id] ?? id

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cierres</h1>
          <p className="page-subtitle">Cierres de caja de tus puntos de venta, con el resumen de cada día.</p>
        </div>
        <div className="tes-header-actions">
          <ExportarMenu clave="cierres_caja" />
        </div>
      </div>

      {/* La pestaña de pendientes solo existe cuando hay algo que rescatar: una pestaña
          vacía y permanente enseña a ignorarla, y esta es justo la que no se puede ignorar. */}
      {pendientes.length > 0 && (
        <Tabs<'cierres' | 'pendientes'>
          ariaLabel="Cierres y pendientes"
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'pendientes', label: 'Sin contabilizar', count: pendientes.length, countTone: 'warning' },
            { id: 'cierres',    label: 'Cierres' },
          ]}
        />
      )}

      {tab === 'pendientes' && pendientes.length > 0
        ? <PendientesTabla items={pendientes} cajaNombre={cajaNombre} puedeEditar={puedeEditar} />
        : <CierresTabla data={data} cajaNombre={cajaNombre} puedeEditar={puedeEditar} />}
    </div>
  )
}

// ── Sin contabilizar: el rescate ────────────────────────────────────────────────

function PendientesTabla({ items, cajaNombre, puedeEditar }: {
  items: PendienteContabilizar[]; cajaNombre: (id: string) => string; puedeEditar: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirmar, setConfirmar] = useState<PendienteContabilizar | null>(null)

  function contabilizar(g: PendienteContabilizar) {
    setConfirmar(null)
    const ld = toastLoading('Contabilizando…')
    startTransition(async () => {
      const r = await cerrarYContabilizar(g.caja_id, g.sesion_uuid)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo contabilizar.'); return }
      toastSuccess('Turno cerrado y contabilizado.')
      router.refresh()
    })
  }

  return (
    <>
      <div className="alert alert-warning alert-intro">
        <AlertTriangle size={16} strokeWidth={2} />
        {/* «No es un problema de sincronización» va explícito porque es justo lo que se
            entiende al ver esta lista: el dispositivo dice «Todo sincronizado» y aquí sale
            un turno pendiente, así que parece que algo no ha subido. Las ventas ya están;
            lo que falta es el CIERRE, que es otra cosa. */}
        <span>
          Estas ventas ya llegaron a Claux —<strong>no es un problema de sincronización</strong>—, pero
          todavía <strong>no están en tu contabilidad</strong>: su turno no se cerró, y es el cierre lo que
          lleva el dinero a Tesorería y descuenta el stock. Ciérralos desde aquí y se registrarán con
          <strong> la fecha en que se vendieron</strong>, no con la de hoy.
        </span>
      </div>

      <div className="card card-table">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Punto de venta</th><th>Desde</th><th>Hasta</th>
                <th className="col-num">Ventas</th><th>Totales</th><th>Motivo</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(g => (
                <tr key={`${g.caja_id}-${g.sesion_uuid}`}>
                  <td data-label="Punto de venta">{cajaNombre(g.caja_id)}</td>
                  <td data-label="Desde">{fecha(g.desde)}</td>
                  <td data-label="Hasta">{fecha(g.hasta)}</td>
                  <td data-label="Ventas" className="col-num">{g.tickets}</td>
                  <td data-label="Totales">{totales(g.totales)}</td>
                  {/* Los dos motivos por los que unas ventas no están contabilizadas, y no
                      son lo mismo: en `ABIERTA` el turno SÍ está en Claux y sigue sin
                      cerrar (el caso normal desde que el dispositivo sube la sesión
                      abierta); en `SIN_SESION` las ventas llegaron solas, sin su turno
                      —histórico de cuando el dispositivo solo subía los turnos cerrados—.
                      Decía «Turno que no llegó», que se lee como si el turno estuviera de
                      camino: lo que pasa es que esas ventas no tienen turno ninguno. */}
                  <td data-label="Motivo">
                    <span className="badge badge-warning"
                      title={g.motivo === 'ABIERTA'
                        ? 'El turno está en Claux pero nadie lo cerró. Al cerrarlo, su dinero entra en Tesorería.'
                        : 'Estas ventas llegaron sin su turno: el dispositivo las subió pero el turno nunca se registró. Al contabilizarlas se les crea uno con su propia fecha.'}>
                      {g.motivo === 'ABIERTA' ? 'Turno sin cerrar' : 'Ventas sin turno'}
                    </span>
                  </td>
                  <td className="col-actions">
                    {puedeEditar && (
                      <button className="btn btn-secondary btn-sm" disabled={isPending}
                        onClick={() => setConfirmar(g)}>
                        Cerrar y contabilizar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirmar && (
        <ConfirmDialog
          title="Cerrar el turno y contabilizarlo"
          confirmLabel="Cerrar y contabilizar"
          onCancel={() => setConfirmar(null)}
          onConfirm={() => contabilizar(confirmar)}
          body={
            <>
              <p>
                Se cerrará el turno de <strong>{cajaNombre(confirmar.caja_id)}</strong> con sus{' '}
                <strong>{confirmar.tickets}</strong>{' '}
                {confirmar.tickets === 1 ? 'venta' : 'ventas'} ({totales(confirmar.totales)}).
              </p>
              <p>
                Se registrará con la fecha del <strong>último ticket</strong> ({fecha(confirmar.hasta)}),
                que es cuando se vendió — no con la de hoy.
              </p>
              <p>
                Con Contabilidad entrará en Tesorería y en tus ingresos; con Inventario descontará
                el stock. Si el punto de venta sigue usándose, <strong>abrirá un turno nuevo</strong>:
                este ya no volverá a recibir ventas.
              </p>
            </>
          }
        />
      )}
    </>
  )
}

// ── Cierres ─────────────────────────────────────────────────────────────────────

function CierresTabla({ data, cajaNombre, puedeEditar }: {
  data: Props['data']; cajaNombre: (id: string) => string; puedeEditar: boolean
}) {
  const router = useRouter()
  const { pageItems, ...pag } = usePagination(data.cierres)
  const [isPending, startTransition] = useTransition()

  function reintentar(c: Cierre) {
    const ld = toastLoading('Contabilizando…')
    startTransition(async () => {
      const r = await reintentarContabilizar(c.sesion_uuid)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo contabilizar.'); return }
      toastSuccess('Cierre contabilizado.')
      router.refresh()
    })
  }

  return (
    <div className="card card-table">
      {data.hay_mas && (
        <AvisoTope mostrados={data.cierres.length} total={data.total}
          limite={data.limite} sustantivo="cierres" />
      )}

      {data.cierres.length === 0 ? (
        <div className="mon-empty">
          <Lock size={36} strokeWidth={1} opacity={0.25} />
          <p>Sin cierres sincronizados todavía.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Punto de venta</th><th>Abierta</th><th>Cerrada</th><th>Totales</th>
                <th>Contabilidad</th><th>Inventario</th><th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(c => {
                // No basta con que `tesoreria_movs` exista: `{}` es truthy, así que un
                // cierre sin NADA posteado salía «Registrado» en verde. Registrado = todas
                // las monedas vendidas tienen su ingreso.
                const vendidas = Object.keys(c.total_por_moneda ?? {})
                const faltan   = monedasQueFaltan(c)
                const hechas   = Object.keys(c.tesoreria_movs ?? {})
                return (
                  <tr key={c.sesion_uuid}>
                    <td data-label="Punto de venta">{cajaNombre(c.caja_id)}</td>
                    <td data-label="Abierta">{fecha(c.abierta_at)}</td>
                    <td data-label="Cerrada">{fecha(c.cerrada_at)}</td>
                    <td data-label="Totales">{totales(c.total_por_moneda)}</td>
                    <td data-label="Contabilidad">
                      {vendidas.length > 0 && faltan.length === 0
                        ? <span className="badge badge-success">Registrado</span>
                        : hechas.length > 0
                          ? <span className="badge badge-warning" title={`Falta: ${faltan.join(', ')}`}>Falta {faltan.join(', ')}</span>
                          : <span className="badge">Pendiente</span>}
                    </td>
                    <td data-label="Inventario">
                      <span className={`badge ${c.stock_movs ? 'badge-success' : ''}`}>
                        {c.stock_movs ? 'Descontado' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="col-actions">
                      {/* La vuelta que faltaba: el badge señalaba el problema y no ofrecía
                          nada, y el dispositivo ya no reenvía un cierre que dio por enviado.
                          Es idempotente, así que solo escribe lo que falte. */}
                      {puedeEditar && vendidas.length > 0 && faltan.length > 0 && (
                        <button className="btn btn-secondary btn-sm" disabled={isPending}
                          onClick={() => reintentar(c)}>
                          <RefreshCw size={14} strokeWidth={2} /> Contabilizar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <TablePagination {...pag} label="cierre" />
    </div>
  )
}
