'use client'

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import ExportarMenu from '@/components/portal/ExportarMenu'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { useState, useMemo, useTransition } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  Plus, X, Package, RefreshCw, RotateCcw, ClipboardList,
  ArrowDownToLine, ArrowUpFromLine, Settings2, ArrowRightLeft,
} from 'lucide-react'
import {
  registrarMovimiento,
  reconciliarStock,
  revertirMovimiento,
  type MovimientosPageData,
  type Movimiento,
  type AvisoRevision,
} from '@/app/actions/portal/inventario'
import {
  MOTIVOS_MOVIMIENTO, MOTIVO_LABEL,
  type TipoMovimiento,
} from '@/app/actions/portal/_inventario-helpers'
import { fmtFechaEs } from '@/lib/date-utils'
import Tabs from '@/components/Tabs'
import { RowActions } from '@/components/portal/RowActions'
import { ConfirmDialog } from '@/components/portal/Dialog'
import RangoBusqueda from '@/components/portal/RangoBusqueda'
import EmpresaPills from '@/components/portal/EmpresaPills'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { useEmpresas } from '@/components/portal/EmpresaColorContext'
import { LIMITE_LISTADO } from '@/lib/listados'
import { etiquetaCobertura } from '@/lib/inventario/consumo'
import { StockAjusteModal } from '../productos/_StockAjusteModal'

// ── Configuración de tipos ──────────────────────────────────────────────────────

const TIPOS: TipoMovimiento[] = ['ENTRADA', 'SALIDA', 'AJUSTE', 'TRANSFERENCIA']

const TIPO_LABEL: Record<TipoMovimiento, string> = {
  ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste', TRANSFERENCIA: 'Transferencia',
}
const TIPO_DESC: Record<TipoMovimiento, string> = {
  ENTRADA:       'Suma stock a un almacén (recepción manual)',
  SALIDA:        'Resta stock de un almacén (consumo, merma)',
  AJUSTE:        'Corrige el stock tras un conteo físico (+/−)',
  TRANSFERENCIA: 'Mueve stock de un almacén a otro',
}
const TIPO_BADGE: Record<TipoMovimiento, string> = {
  ENTRADA: 'badge-success', SALIDA: 'badge-warning', AJUSTE: 'badge-info', TRANSFERENCIA: 'badge-purple',
}
function TipoIcon({ tipo, size = 15 }: { tipo: TipoMovimiento; size?: number }) {
  const props = { size, strokeWidth: 2 }
  if (tipo === 'ENTRADA')       return <ArrowDownToLine {...props} />
  if (tipo === 'SALIDA')        return <ArrowUpFromLine {...props} />
  if (tipo === 'AJUSTE')        return <Settings2 {...props} />
  return <ArrowRightLeft {...props} />
}

// Columnas `date`: van por el helper compartido, que las parte en local. `new Date(iso)`
// las leería como medianoche UTC y en La Habana saldría el día anterior.
const fmtDate = fmtFechaEs

// ── Modal: nuevo movimiento ───────────────────────────────────────────────────

function MovimientoModal({
  data, onClose, onSaved,
}: {
  data:    MovimientosPageData
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [tipo,      setTipo]      = useState<TipoMovimiento>('ENTRADA')
  const [productoId, setProductoId] = useState('')
  const [almacenId, setAlmacenId]  = useState('')
  const [destinoId, setDestinoId]  = useState('')
  const [cantidad,  setCantidad]   = useState('')
  const [motivoTipo, setMotivoTipo] = useState('')
  const hoy = new Date().toISOString().split('T')[0]

  const producto = data.productos.find(p => p.producto_id === productoId)
  const esTransfer = tipo === 'TRANSFERENCIA'
  const destinos = data.almacenes.filter(a => a.almacen_id !== almacenId)
  const motivoObligatorio = tipo === 'SALIDA' || tipo === 'AJUSTE'

  // Aviso de transferencia entre empresas: es un flujo permitido (flexibilidad),
  // pero no puede ser invisible. Mismo criterio que Contabilidad para cobrar en la
  // caja de otra empresa.
  const empresaOrigen  = data.almacenes.find(a => a.almacen_id === almacenId)?.empresa_id
  const empresaDestino = data.almacenes.find(a => a.almacen_id === destinoId)?.empresa_id
  const cruzaEmpresa   = esTransfer && empresaOrigen && empresaDestino && empresaOrigen !== empresaDestino

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('tipo', tipo)
    const ld = toastLoading('Registrando…')
    startTransition(async () => {
      const res = await registrarMovimiento(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Movimiento registrado')
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Nuevo movimiento</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">

            {/* Tipo */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Tipo de movimiento</span>
              <div className="alm-tipo-grid">
                {TIPOS.map(t => (
                  <button key={t} type="button"
                    onClick={() => setTipo(t)}
                    className={`alm-tipo-btn${tipo === t ? ' active' : ''}`}>
                    <span className={`badge ${TIPO_BADGE[t]}`}>
                      <TipoIcon tipo={t} size={12} /> {TIPO_LABEL[t]}
                    </span>
                    <span className="text-xs-hint">{TIPO_DESC[t]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Datos */}
            <div className="ter-form-section mb-0">
              <span className="ter-form-section-title">Datos del movimiento</span>
              <div className="ter-form-grid">

                <div className="input-group ter-col-span-4">
                  <label htmlFor="mov-prod">Producto <span className="required">*</span></label>
                  <select id="mov-prod" className="input" name="producto_id" required
                    value={productoId} onChange={e => setProductoId(e.target.value)}>
                    <option value="">Selecciona un producto…</option>
                    {data.productos.map(p => (
                      <option key={p.producto_id} value={p.producto_id}>{p.nombre} ({p.codigo})</option>
                    ))}
                  </select>
                  {data.productos.length === 0 && (
                    <span className="text-xs-hint">No hay productos activos. Crea uno en Productos.</span>
                  )}
                </div>

                <div className="input-group ter-col-span-2">
                  <label htmlFor="mov-fecha">Fecha</label>
                  {/* max=hoy: un movimiento fechado en el futuro no es un movimiento. */}
                  <input id="mov-fecha" className="input" type="date" name="fecha"
                    max={hoy} defaultValue={hoy} />
                </div>

                <div className="input-group ter-col-span-3">
                  <label htmlFor="mov-alm">{esTransfer ? 'Almacén origen' : 'Almacén'} <span className="required">*</span></label>
                  <select id="mov-alm" className="input" name="almacen_id" required
                    value={almacenId} onChange={e => setAlmacenId(e.target.value)}>
                    <option value="">Selecciona un almacén…</option>
                    {data.almacenes.map(a => (
                      <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>
                    ))}
                  </select>
                </div>

                {esTransfer && (
                  <div className="input-group ter-col-span-3">
                    <label htmlFor="mov-dest">Almacén destino <span className="required">*</span></label>
                    <select id="mov-dest" className="input" name="almacen_destino_id" required
                      value={destinoId} onChange={e => setDestinoId(e.target.value)}>
                      <option value="">Selecciona destino…</option>
                      {destinos.map(a => (
                        <option key={a.almacen_id} value={a.almacen_id}>
                          {a.nombre}{data.empresa_nombres[a.empresa_id] && Object.keys(data.empresa_nombres).length > 1 ? ` · ${data.empresa_nombres[a.empresa_id]}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {cruzaEmpresa && (
                  <div className="input-group ter-col-full">
                    <div className="alert alert-warning moneda-cambio">
                      Estás moviendo mercancía de <strong>{data.empresa_nombres[empresaOrigen!] ?? '—'}</strong> a
                      {' '}<strong>{data.empresa_nombres[empresaDestino!] ?? '—'}</strong>. El movimiento se registra
                      en la empresa de origen y no genera ningún apunte contable.
                    </div>
                  </div>
                )}

                <div className={`input-group ${esTransfer ? 'ter-col-span-3' : 'ter-col-span-3'}`}>
                  <label htmlFor="mov-cant">
                    Cantidad {producto ? `(${producto.unidad})` : ''} <span className="required">*</span>
                  </label>
                  {/* type="text" + inputMode: con `type=number` un navegador en locale es
                      entrega «0,5» y el servidor lo leía como 0 (ver lib/numeros.ts). */}
                  <input id="mov-cant" className="input" type="text" inputMode="decimal" name="cantidad" required
                    value={cantidad} onChange={e => setCantidad(e.target.value)}
                    placeholder={tipo === 'AJUSTE' ? 'ej: 10 o −5' : 'ej: 10'} />
                  {tipo === 'AJUSTE' && (
                    <span className="text-xs-hint">Usa signo: positivo suma, negativo resta.</span>
                  )}
                </div>

                {tipo === 'ENTRADA' && (
                  <div className="input-group ter-col-span-3">
                    <label htmlFor="mov-costo">Costo unitario</label>
                    <input id="mov-costo" className="input" type="text" inputMode="decimal" name="costo_unitario"
                      placeholder="opcional" />
                  </div>
                )}

                {/* Motivo tipificado: la SALIDA es justo la que necesita un porqué
                    (merma, rotura, autoconsumo) y era la única que no lo pedía. El tipo
                    permite SUMAR la merma; el texto libre de abajo explica el caso. */}
                <div className="input-group ter-col-span-3">
                  <label htmlFor="mov-motivo-tipo">
                    Motivo {motivoObligatorio && <span className="required">*</span>}
                  </label>
                  <select id="mov-motivo-tipo" className="input" name="motivo_tipo"
                    required={motivoObligatorio}
                    value={motivoTipo} onChange={e => setMotivoTipo(e.target.value)}>
                    <option value="">{motivoObligatorio ? 'Elige el motivo…' : 'Sin motivo'}</option>
                    {MOTIVOS_MOVIMIENTO.map(m => <option key={m} value={m}>{MOTIVO_LABEL[m]}</option>)}
                  </select>
                </div>

                <div className="input-group ter-col-span-3">
                  <label htmlFor="mov-motivo">Detalle (opcional)</label>
                  <input id="mov-motivo" className="input" type="text" name="motivo"
                    placeholder="ej: caja rota al descargar" />
                </div>

              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : 'Registrar movimiento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Panel «Revisar» ───────────────────────────────────────────────────────────
//
// Lo que hasta ahora solo se veía consultando la base de datos, con la acción que
// lo arregla en la propia fila. El stock negativo aparece aquí y NO en la campana:
// es un flujo permitido a propósito (el dueño vende de mostrador y repone después),
// así que se informa sin juicio de valor y sin alarma diaria.

const REVISION_TITULO: Record<AvisoRevision['tipo'], string> = {
  stock_negativo:               'Stock en negativo',
  producto_archivado_con_stock: 'Producto archivado con existencias',
  almacen_archivado_con_stock:  'Almacén archivado con existencias',
  producto_sin_coste:           'Producto sin coste registrado',
}
const REVISION_EXPLICA: Record<AvisoRevision['tipo'], string> = {
  stock_negativo:               'Se vendió más de lo que el sistema tenía registrado. No es un error: ajusta cuando cuentes.',
  producto_archivado_con_stock: 'Está archivado pero sus existencias siguen sumando en el total del producto.',
  almacen_archivado_con_stock:  'El almacén está archivado y ya no sale en movimientos ni compras, pero conserva mercancía.',
  producto_sin_coste:           'Sin coste no se puede calcular el valor de tu inventario: no vale 0, es que no se sabe.',
}
const REVISION_BADGE: Record<AvisoRevision['tipo'], string> = {
  stock_negativo:               'badge-purple',
  producto_archivado_con_stock: 'badge-warning',
  almacen_archivado_con_stock:  'badge-warning',
  producto_sin_coste:           'badge-info',
}

function PanelRevisar({
  revision, onAjustar,
}: {
  revision: AvisoRevision[]
  onAjustar: (a: AvisoRevision) => void
}) {
  const router = useRouter()

  if (revision.length === 0) {
    return (
      <div className="card card-table">
        <div className="mon-empty">
          <Package size={40} strokeWidth={1} opacity={0.2} />
          <p>Nada que revisar: no hay negativos, ni existencias en almacenes archivados, ni productos sin coste.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card card-table">
      <div className="mon-card-header">
        <div className="page-title-ia">
          <h2 className="mon-section-title">Cosas que mirar</h2>
          {/* El dato lo produce esta pantalla; la IA solo lo cuenta en una frase. */}
          {revision.some(a => a.tipo === 'stock_negativo') && (
            <IaTouchpoint tipo="revisar" descripcion="una explicación de tus descuadres" />
          )}
        </div>
        <span className="text-xs-muted">{revision.length}</span>
      </div>
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Qué pasa</th>
              <th>Producto</th>
              <th>Almacén</th>
              <th className="col-num">Cantidad</th>
              <th className="col-num" title="Estimación al ritmo de los últimos 90 días">Cobertura</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {revision.map((a, i) => (
              <tr key={`${a.tipo}-${a.producto_id}-${a.almacen_id ?? ''}-${i}`}>
                <td data-label="Qué pasa">
                  <span className={`badge ${REVISION_BADGE[a.tipo]}`}>{REVISION_TITULO[a.tipo]}</span>
                  <div className="table-cell-sub">{a.causa ?? REVISION_EXPLICA[a.tipo]}</div>
                </td>
                <td data-label="Producto"><strong>{a.producto}</strong></td>
                <td data-label="Almacén" className="text-sm-muted">{a.almacen ?? '—'}</td>
                <td data-label="Cantidad" className={`col-num ${a.cantidad < 0 ? 'mov-cant-neg' : ''}`}>
                  {a.cantidad.toLocaleString('es-ES')} {a.unidad}
                </td>
                <td data-label="Cobertura" className="col-num text-sm-muted">
                  {etiquetaCobertura(a.cobertura)}
                </td>
                <td className="col-actions">
                  <RowActions>
                    {a.almacen_id && (
                      <button className="row-actions-item" onClick={() => onAjustar(a)}>
                        <Settings2 size={15} strokeWidth={2} /> Ajustar stock
                      </button>
                    )}
                    <button className="row-actions-item"
                      onClick={() => router.push(`/portal/productos/${a.producto_id}`)}>
                      <Package size={15} strokeWidth={2} /> Ver producto
                    </button>
                    {/* Contar es lo que arregla un negativo de verdad: se ajusta a lo
                        que hay en el estante, no a un número inventado. Lleva al ALMACÉN
                        y no directo a la hoja: abrir el conteo escribe, y esa escritura
                        vive detrás de un botón, nunca de una navegación (mig. 160). */}
                    {a.tipo === 'stock_negativo' && a.almacen_id && (
                      <button className="row-actions-item"
                        onClick={() => router.push(`/portal/almacenes/${a.almacen_id}`)}>
                        <ClipboardList size={15} strokeWidth={2} /> Contar el almacén
                      </button>
                    )}
                    {a.tipo === 'almacen_archivado_con_stock' && (
                      <button className="row-actions-item" onClick={() => router.push('/portal/almacenes')}>
                        <ArrowRightLeft size={15} strokeWidth={2} /> Ir a almacenes
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
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function MovimientosView({
  data, revision = [],
}: {
  data: MovimientosPageData
  revision?: AvisoRevision[]
}) {
  const router = useRouter()
  const [tab,         setTab]         = useState<'movimientos' | 'revisar'>('movimientos')
  const [modalOpen,   setModalOpen]   = useState(false)
  const [showRecalc,  setShowRecalc]  = useState(false)
  const [filtroTipo,  setFiltroTipo]  = useState('')
  const [filtroAlm,   setFiltroAlm]   = useState('')
  const [filtroMotivo,  setFiltroMotivo]  = useState('')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [ajuste,      setAjuste]      = useState<AvisoRevision | null>(null)
  const [revertir,    setRevertir]    = useState<Movimiento | null>(null)
  const { colorOf }   = useEmpresas()
  const empresasFiltro = Object.entries(data.empresa_nombres).map(([empresa_id, nombre]) => ({
    empresa_id, nombre, color: colorOf(empresa_id),
  }))
  const multiempresa = empresasFiltro.length > 1
  const [, startTransition]           = useTransition()
  const [recalcPending, startRecalc]  = useTransition()

  function doRecalcular() {
    const ld = toastLoading('Recalculando…')
    startRecalc(async () => {
      const res = await reconciliarStock()
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      // «Todo cuadraba» es la respuesta más útil de las dos: dice que el botón miró
      // y no hizo falta tocar nada, en vez de un número que no significa descuadres.
      const cambios = res.cambios ?? []
      if (cambios.length === 0) {
        toastSuccess('Todo cuadraba: no hizo falta corregir nada.')
      } else {
        const primero = cambios[0]
        toastSuccess(
          `${cambios.length} ${cambios.length === 1 ? 'descuadre corregido' : 'descuadres corregidos'}: ` +
          `${primero.producto} en ${primero.almacen} pasó de ${primero.antes.toLocaleString('es-ES')} ` +
          `a ${primero.despues.toLocaleString('es-ES')}${cambios.length > 1 ? '…' : ''}`,
        )
      }
      setShowRecalc(false)
      router.refresh()
    })
  }

  const filtrados = useMemo(() => {
    return data.movimientos.filter(m => {
      if (filtroTipo && m.tipo !== filtroTipo) return false
      if (filtroAlm && m.almacen_id !== filtroAlm && m.almacen_destino_id !== filtroAlm) return false
      if (filtroMotivo && m.motivo_tipo !== filtroMotivo) return false
      if (filtroEmpresa && m.empresa_id !== filtroEmpresa) return false
      return true
    })
  }, [data.movimientos, filtroTipo, filtroAlm, filtroMotivo, filtroEmpresa])

  const { pageItems, ...pag } = usePagination(filtrados)

  function onSaved() { setModalOpen(false); startTransition(() => router.refresh()) }

  function signo(m: Movimiento): { txt: string; cls: string } {
    const n = m.cantidad.toLocaleString('es-ES')
    if (m.tipo === 'ENTRADA')       return { txt: `+${n}`, cls: 'mov-cant-pos' }
    if (m.tipo === 'SALIDA')        return { txt: `−${n}`, cls: 'mov-cant-neg' }
    if (m.tipo === 'AJUSTE')        return { txt: m.cantidad >= 0 ? `+${n}` : `−${Math.abs(m.cantidad).toLocaleString('es-ES')}`, cls: m.cantidad >= 0 ? 'mov-cant-pos' : 'mov-cant-neg' }
    return { txt: n, cls: 'mov-cant-neutral' }
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Movimientos</h1>
            <IaTouchpoint tipo="inventario" descripcion="un análisis de tu inventario" />
          </div>
          <p className="page-subtitle">Entradas, salidas, ajustes y transferencias de stock entre almacenes.</p>
        </div>
        <div className="det-actions">
          <ExportarMenu
            clave="movimientos_inventario"
            filtro={{ tipo: filtroTipo, almacen_id: filtroAlm }}
            resumen={[
              filtroTipo,
              filtroAlm && (data.almacenes.find(a => a.almacen_id === filtroAlm)?.nombre ?? ''),
            ].filter((x): x is string => Boolean(x))}
          />
          <button className="btn btn-secondary" onClick={() => setShowRecalc(true)} disabled={recalcPending}
            title="Recalcula las existencias desde su historial de entradas y salidas">
            <RefreshCw size={14} strokeWidth={2} /> Recalcular stock
          </button>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}
            disabled={data.almacenes.length === 0 || data.productos.length === 0}>
            <Plus size={14} strokeWidth={2.5} /> Nuevo movimiento
          </button>
        </div>
      </div>

      {(data.almacenes.length === 0 || data.productos.length === 0) && (
        <PrerequisitoAviso acciones={[
          ...(data.productos.length === 0 ? [{ label: 'Crear producto', href: '/portal/productos' }] : []),
          ...(data.almacenes.length === 0 ? [{ label: 'Crear almacén', href: '/portal/almacenes' }] : []),
        ]}>
          Para registrar movimientos necesitas <strong>al menos un producto activo y un almacén</strong>.
        </PrerequisitoAviso>
      )}

      <Tabs
        tabs={[
          { id: 'movimientos', label: 'Movimientos', count: data.movimientos.length },
          { id: 'revisar',     label: 'Revisar',     count: revision.length, countTone: 'warning' },
        ]}
        active={tab}
        onChange={id => setTab(id as 'movimientos' | 'revisar')}
      />

      {tab === 'revisar' && (
        <PanelRevisar revision={revision} onAjustar={setAjuste} />
      )}

      {tab === 'movimientos' && (
      <>
      <div className="ter-toolbar">
        <RangoBusqueda desde={data.rango.desde} hasta={data.rango.hasta} sinBuscador presets={['mes', 'mes_pasado', 'trimestre', 'anio', 'todo']} />
      </div>

      {/* Toolbar */}
      <div className="ter-toolbar">
        <select className="input ter-filter-select" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS.map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
        </select>
        {data.almacenes.length > 1 && (
          <select className="input ter-filter-select" value={filtroAlm} onChange={e => setFiltroAlm(e.target.value)}>
            <option value="">Todos los almacenes</option>
            {data.almacenes.map(a => <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>)}
          </select>
        )}
        <select className="input ter-filter-select" value={filtroMotivo} onChange={e => setFiltroMotivo(e.target.value)}>
          <option value="">Todos los motivos</option>
          {MOTIVOS_MOVIMIENTO.map(m => <option key={m} value={m}>{MOTIVO_LABEL[m]}</option>)}
        </select>
        {/* La empresa ya se cargaba en el servidor y la vista no la renderizaba: con
            tres empresas la tabla las mezclaba sin columna ni filtro. */}
        {empresasFiltro.length > 1 && (
          <EmpresaPills
            empresas={empresasFiltro}
            value={filtroEmpresa}
            onChange={setFiltroEmpresa}
            todasLabel="Todas las empresas"
          />
        )}
      </div>

      {data.hay_mas && (
        <p className="listado-tope">
          Se enseñan los primeros {LIMITE_LISTADO} movimientos del rango. Acota el rango
          para ver el resto — la descarga sí se lleva el rango completo.
        </p>
      )}

      {/* Salidas por motivo: es la mitad del valor de tipificar el porqué. La merma era
          texto libre y por tanto dinero que el negocio perdía y no medía. */}
      {data.salidasPorMotivo.length > 0 && (
        <div className="card mov-motivos-card">
          <div className="mon-card-header">
            <h2 className="mon-section-title">Salidas por motivo</h2>
            <span className="text-xs-muted">en el rango · desde que existen los motivos</span>
          </div>
          <div className="mov-motivos-grid">
            {data.salidasPorMotivo.map(s => (
              <div key={s.motivo} className="mov-motivo-item">
                <span className="mov-motivo-label">{MOTIVO_LABEL[s.motivo]}</span>
                <strong className="mov-motivo-valor">{s.unidades.toLocaleString('es-ES')}</strong>
                <span className="text-xs-muted">{s.movimientos} mov.</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">Historial de movimientos</h2>
          <span className="text-xs-muted">{filtrados.length} de {data.movimientos.length}</span>
        </div>

        {filtrados.length === 0 ? (
          <div className="mon-empty">
            <Package size={40} strokeWidth={1} opacity={0.2} />
            <p>
              {data.movimientos.length === 0
                ? 'Aún no hay movimientos de inventario. Registra el primero o confirma una compra.'
                : 'No hay resultados para los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Producto</th>
                  <th>Almacén</th>
                  {multiempresa && <th>Empresa</th>}
                  <th className="col-num">Cantidad</th>
                  <th className="col-num">Coste unit.</th>
                  <th>Motivo</th>
                  <th>Origen</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(m => {
                  const s = signo(m)
                  return (
                    <tr key={m.movimiento_id}
                      className={multiempresa ? 'row-empresa-accent' : undefined}
                      style={multiempresa ? empresaColorVar(colorOf(m.empresa_id)) : undefined}>
                      <td data-label="Fecha" className="text-sm-muted">{fmtDate(m.fecha)}</td>
                      <td data-label="Tipo">
                        <span className={`badge ${TIPO_BADGE[m.tipo]}`}>
                          <TipoIcon tipo={m.tipo} size={12} /> {TIPO_LABEL[m.tipo]}
                        </span>
                      </td>
                      <td data-label="Producto"><strong>{data.producto_nombres[m.producto_id] ?? m.producto_id}</strong></td>
                      <td data-label="Almacén" className="text-sm-muted">
                        {m.tipo === 'TRANSFERENCIA' && m.almacen_destino_id
                          ? <>{data.almacen_nombres[m.almacen_id] ?? m.almacen_id} <ArrowRightLeft size={11} strokeWidth={2} /> {data.almacen_nombres[m.almacen_destino_id] ?? m.almacen_destino_id}</>
                          : (data.almacen_nombres[m.almacen_id] ?? m.almacen_id)}
                      </td>
                      {multiempresa && (
                        <td data-label="Empresa">
                          <EmpresaTag color={colorOf(m.empresa_id)} nombre={data.empresa_nombres[m.empresa_id] ?? m.empresa_id} />
                        </td>
                      )}
                      <td data-label="Cantidad" className={`col-num ${s.cls}`}>{s.txt}</td>
                      {/* El coste unitario se guardaba en ENTRADA y no se enseñaba en ningún sitio. */}
                      <td data-label="Coste unit." className="col-num text-sm-muted">
                        {m.costo_unitario != null ? m.costo_unitario.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td data-label="Motivo" className="text-sm-muted">
                        {m.motivo_tipo ? MOTIVO_LABEL[m.motivo_tipo] : (m.motivo ?? '—')}
                        {m.motivo_tipo && m.motivo && <div className="table-cell-secondary">{m.motivo}</div>}
                      </td>
                      <td data-label="Origen">
                        {m.origen === 'MANUAL'
                          ? <span className="text-xs-muted">Manual</span>
                          : <span className="badge badge-neutral">{m.origen === 'COMPRA' ? 'Compra' : 'Venta'}</span>}
                      </td>
                      <td className="col-actions">
                        {/* Solo los manuales: compras y ventas se deshacen anulando su
                            documento, no compensando el movimiento a mano. */}
                        {m.origen === 'MANUAL' && (
                          <RowActions>
                            <button className="row-actions-item" onClick={() => setRevertir(m)}>
                              <RotateCcw size={15} strokeWidth={2} /> Revertir
                            </button>
                          </RowActions>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="movimiento" />
      </div>
      </>
      )}

      {ajuste && (
        <StockAjusteModal
          producto_id={ajuste.producto_id}
          nombre={ajuste.producto}
          unidad={ajuste.unidad}
          almacenes={data.almacenes}
          almacenInicial={ajuste.almacen_id ?? undefined}
          modoInicial="fijar"
          onClose={() => setAjuste(null)}
          onSaved={() => { setAjuste(null); router.refresh() }}
        />
      )}

      {revertir && (
        <ConfirmDialog
          danger
          title="Revertir movimiento"
          confirmLabel="Revertir"
          onCancel={() => setRevertir(null)}
          body={
            <>
              Se creará el movimiento contrario de <strong>{data.producto_nombres[revertir.producto_id] ?? revertir.producto_id}</strong>
              {' '}({TIPO_LABEL[revertir.tipo].toLowerCase()} de {Math.abs(revertir.cantidad).toLocaleString('es-ES')}), dejando
              rastro de que fue una corrección. El original no se borra.
            </>
          }
          onConfirm={() => {
            const m = revertir
            const ld = toastLoading('Revirtiendo…')
            startTransition(async () => {
              const res = await revertirMovimiento(m.movimiento_id)
              await ld.dismiss()
              if (!res.ok) { toastError(res.error ?? 'Error'); return }
              toastSuccess('Movimiento revertido')
              setRevertir(null)
              router.refresh()
            })
          }}
        />
      )}

      {modalOpen && (
        <MovimientoModal data={data} onClose={() => setModalOpen(false)} onSaved={onSaved} />
      )}

      {showRecalc && (
        <div className="modal-backdrop open">
          <div className="modal modal-sm" role="dialog" aria-modal>
            <div className="modal-header">
              <h2 className="modal-title">Recalcular stock</h2>
              <button type="button" className="modal-close" onClick={() => setShowRecalc(false)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="modal-body">
              <div className="modal-body-text">
                Vuelve a calcular las existencias de todos los productos sumando su historial de
                entradas y salidas. Úsalo si crees que alguna cantidad no cuadra.
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowRecalc(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={doRecalcular} disabled={recalcPending}>
                {recalcPending ? <><span className="spinner spinner-sm" /> Recalculando…</> : 'Recalcular'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
