'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  guardarGastoCobro,
  eliminarGastoCobro,
  registrarLiquidacion,
  anularLiquidacion,
  type GastoCobro,
  type GastoCobroConSaldo,
  type TipoRegistro,
  type EstadoRegistro,
  type GastosCobrosPageData,
} from '@/app/actions/portal/gastos'
import CrearTerceroInline from '@/components/portal/CrearTerceroInline'
import { DollarSign, Pencil, Plus, Receipt, Trash2, X } from 'lucide-react'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import EmpresaPills                    from '@/components/portal/EmpresaPills'

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPO_LABEL:  Record<TipoRegistro, string> = { GASTO: 'Gasto', COBRO: 'Cobro' }
const TIPO_BADGE:  Record<TipoRegistro, string> = { GASTO: 'badge-error', COBRO: 'badge-success' }

const ESTADO_LABEL: Record<EstadoRegistro, string> = {
  PENDIENTE: 'Pendiente', PARCIAL: 'Parcial', LIQUIDADO: 'Liquidado',
}
const ESTADO_BADGE: Record<EstadoRegistro, string> = {
  PENDIENTE: 'badge-warning', PARCIAL: 'badge-info', LIQUIDADO: 'badge-success',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function formatFecha(f: string | null): string {
  if (!f) return '—'
  const [y, m, d] = f.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
function terceroEsCompatible(terceroTipo: string, registroTipo: TipoRegistro): boolean {
  if (terceroTipo === 'AMBOS') return true
  return registroTipo === 'GASTO' ? terceroTipo === 'PROVEEDOR' : terceroTipo === 'CLIENTE'
}

// ── Modal: crear / editar gasto-cobro ───────────────────────────────────────────

function RegistroModal({
  registro, tipoInicial, data, onClose, onSaved,
}: {
  registro:    GastoCobro | null
  tipoInicial: TipoRegistro
  data:        GastosCobrosPageData
  onClose:     () => void
  onSaved:     () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!registro
  const tipo   = registro?.tipo ?? tipoInicial

  const terceros = useMemo(
    () => data.terceros.filter(t => t.empresa_id && terceroEsCompatible(t.tipo, tipo)),
    [data.terceros, tipo],
  )

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('tipo', tipo)
    startTransition(async () => {
      const res = await guardarGastoCobro(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  const titulo = isEdit
    ? (tipo === 'GASTO' ? 'Editar gasto' : 'Editar cobro')
    : (tipo === 'GASTO' ? 'Nuevo gasto'  : 'Nuevo cobro')

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{titulo}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {registro && <input type="hidden" name="registro_id" value={registro.registro_id} />}
          <div className="modal-body">
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label>Descripción <span className="required">*</span></label>
                <input className="input" name="descripcion" required autoFocus={!isEdit}
                  defaultValue={registro?.descripcion ?? ''}
                  placeholder={tipo === 'GASTO' ? 'Ej: Compra de verduras, alquiler de local…' : 'Ej: Venta directa, anticipo de cliente…'} />
              </div>

              <div className="input-group ter-col-span-3">
                <label>{tipo === 'GASTO' ? 'Proveedor' : 'Cliente'}</label>
                <select className="input" name="tercero_id" defaultValue={registro?.tercero_id ?? ''}>
                  <option value="">— Sin {tipo === 'GASTO' ? 'proveedor' : 'cliente'} —</option>
                  {terceros.map(t => <option key={t.tercero_id} value={t.tercero_id}>{t.nombre}</option>)}
                </select>
                {terceros.length === 0 && (
                  <div className="crear-tercero-empty">
                    <span className="input-hint">No tienes {tipo === 'GASTO' ? 'proveedores' : 'clientes'} todavía.</span>
                    <CrearTerceroInline
                      empresas={data.empresas}
                      defaultTipo={tipo === 'GASTO' ? 'PROVEEDOR' : 'CLIENTE'}
                      label={tipo === 'GASTO' ? 'Crear proveedor' : 'Crear cliente'}
                    />
                  </div>
                )}
              </div>
              <div className="input-group ter-col-span-3">
                <label>Categoría</label>
                <input className="input" name="categoria" list="gc-categorias"
                  defaultValue={registro?.categoria ?? ''}
                  placeholder={tipo === 'GASTO' ? 'Alquiler, salarios, insumos…' : 'Ventas, servicios…'} />
                <datalist id="gc-categorias">
                  {data.categorias.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>

              <div className="input-group ter-col-span-2">
                <label>Fecha <span className="required">*</span></label>
                <input className="input" name="fecha" type="date" required
                  defaultValue={registro?.fecha?.split('T')[0] ?? hoyISO()} />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Vencimiento</label>
                <input className="input" name="vencimiento" type="date"
                  defaultValue={registro?.vencimiento?.split('T')[0] ?? ''} />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Empresa <span className="required">*</span></label>
                {data.empresas.length === 1 ? (
                  <>
                    <input className="input input-static" readOnly value={data.empresas[0].nombre} />
                    <input type="hidden" name="empresa_id" value={data.empresas[0].empresa_id} />
                  </>
                ) : (
                  <select className="input" name="empresa_id" defaultValue={registro?.empresa_id ?? ''} required>
                    <option value="">Selecciona…</option>
                    {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
                  </select>
                )}
              </div>

              <div className="input-group ter-col-span-3">
                <label>Monto <span className="required">*</span></label>
                <input className="input" name="monto" type="number" min="0" step="0.01" required
                  defaultValue={registro?.monto ?? ''} placeholder="0.00" />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Moneda <span className="required">*</span></label>
                {isEdit ? (
                  <>
                    <input className="input input-static" readOnly value={registro!.moneda} />
                    <span className="input-hint">La moneda no se cambia tras crear.</span>
                  </>
                ) : data.monedas.length === 0 ? (
                  <>
                    <input className="input input-static" readOnly value="Sin monedas activas" />
                    <span className="input-hint">Crea una moneda en Monedas y Tasas primero.</span>
                  </>
                ) : (
                  <select className="input" name="moneda" defaultValue="" required>
                    <option value="" disabled>Selecciona…</option>
                    {data.monedas.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </div>

              <div className="input-group ter-col-full">
                <label>Notas</label>
                <textarea className="input input-textarea" name="notas" rows={2}
                  defaultValue={registro?.notas ?? ''} placeholder="Referencia, observaciones…" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || (!isEdit && data.monedas.length === 0)}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : isEdit ? 'Guardar cambios' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: liquidar (pagar gasto / cobrar ingreso) + historial ──────────────────

function LiquidarModal({
  registro, cuentas, onClose, onChanged,
}: {
  registro: GastoCobroConSaldo
  cuentas:  GastosCobrosPageData['cuentas']
  onClose:  () => void
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()

  const esGasto         = registro.tipo === 'GASTO'
  const cuentasCompat   = cuentas.filter(c => c.moneda === registro.moneda)
  const [cuentaId, setCuentaId] = useState(cuentasCompat[0]?.cuenta_id ?? '')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('registro_id', registro.registro_id)
    fd.set('cuenta_id', cuentaId)
    startTransition(async () => {
      const res = await registrarLiquidacion(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  function handleAnular(movimiento_id: string) {
    startTransition(async () => {
      const res = await anularLiquidacion(movimiento_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{esGasto ? 'Pagar gasto' : 'Registrar cobro'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">

          {/* Resumen */}
          <div className="info-box">
            <strong className="info-box-title">{registro.descripcion}</strong>
            <span className="text-xs-muted">
              Total {formatMonto(registro.monto)} {registro.moneda} ·
              Pagado {formatMonto(registro.monto_liquidado)} ·
              <strong> Pendiente {formatMonto(registro.saldo_pendiente)} {registro.moneda}</strong>
            </span>
          </div>

          {/* Formulario de liquidación */}
          {registro.saldo_pendiente > 0.005 ? (
            cuentasCompat.length === 0 ? (
              <div className="alert alert-warning mt-3">
                No tienes cuentas en {registro.moneda}. Crea una en Tesorería para registrar el {esGasto ? 'pago' : 'cobro'}.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="gc-liq-form">
                <div className="ter-form-grid">
                  <div className="input-group ter-col-full">
                    <label>Cuenta <span className="required">*</span></label>
                    <select className="input" value={cuentaId} onChange={e => setCuentaId(e.target.value)} required>
                      {cuentasCompat.map(c => <option key={c.cuenta_id} value={c.cuenta_id}>{c.nombre} · {c.moneda}</option>)}
                    </select>
                  </div>
                  <div className="input-group ter-col-span-3">
                    <label>Monto ({registro.moneda}) <span className="required">*</span></label>
                    <input className="input" name="monto" type="number" min="0" step="0.01" required
                      defaultValue={registro.saldo_pendiente.toFixed(2)} />
                  </div>
                  <div className="input-group ter-col-span-3">
                    <label>Fecha <span className="required">*</span></label>
                    <input className="input" name="fecha" type="date" defaultValue={hoyISO()} required />
                  </div>
                  <div className="input-group ter-col-full">
                    <label>Notas</label>
                    <input className="input" name="notas" placeholder="Referencia del pago…" />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary btn-sm mt-2" disabled={isPending}>
                  {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : esGasto ? 'Registrar pago' : 'Registrar cobro'}
                </button>
              </form>
            )
          ) : (
            <div className="alert alert-success mt-3">Liquidado por completo.</div>
          )}

          {/* Historial */}
          {registro.liquidaciones.length > 0 && (
            <div className="gc-liq-historial">
              <span className="ter-form-section-title">Movimientos registrados</span>
              {registro.liquidaciones.map(l => (
                <div key={l.movimiento_id} className="gc-liq-row">
                  <span className="text-sm-muted tes-nowrap">{formatFecha(l.fecha)}</span>
                  <span className="gc-liq-cuenta">{l.cuenta_nombre}</span>
                  <span className="gc-liq-monto">{formatMonto(l.monto)} {registro.moneda}</span>
                  <button className="ter-action-btn ter-action-danger" title="Anular"
                    onClick={() => handleAnular(l.movimiento_id)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                </div>
              ))}
            </div>
          )}

        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

// ── Confirmación eliminar ───────────────────────────────────────────────────────

function ConfirmEliminar({
  registro, onConfirm, onClose, isPending,
}: {
  registro:  GastoCobroConSaldo
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Eliminar {registro.tipo === 'GASTO' ? 'gasto' : 'cobro'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">¿Eliminar <strong>{registro.descripcion}</strong> ({formatMonto(registro.monto)} {registro.moneda})?</p>
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

export default function GastosView({ data }: { data: GastosCobrosPageData }) {
  const router = useRouter()
  const { colorOf } = useEmpresas()
  const multiempresa = data.empresas.length > 1
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))
  const [isPending, startTransition] = useTransition()

  const [modalRegistro, setModalRegistro] = useState(false)
  const [editRegistro,  setEditRegistro]  = useState<GastoCobro | null>(null)
  const [tipoNuevo,     setTipoNuevo]      = useState<TipoRegistro>('GASTO')
  const [liquidar,      setLiquidar]       = useState<GastoCobroConSaldo | null>(null)
  const [confirmDel,    setConfirmDel]     = useState<GastoCobroConSaldo | null>(null)

  const [filtroTipo,    setFiltroTipo]    = useState('')
  const [filtroEstado,  setFiltroEstado]  = useState('')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')

  const registros = useMemo(() => {
    return data.registros.filter(r => {
      if (filtroTipo    && r.tipo    !== filtroTipo)    return false
      if (filtroEstado  && r.estado  !== filtroEstado)  return false
      if (filtroEmpresa && r.empresa_id !== filtroEmpresa) return false
      return true
    })
  }, [data.registros, filtroTipo, filtroEstado, filtroEmpresa])

  // Totales pendientes por tipo y moneda
  const pendientes = useMemo(() => {
    const porPagar  = new Map<string, number>()
    const porCobrar = new Map<string, number>()
    for (const r of data.registros) {
      if (r.saldo_pendiente <= 0.005) continue
      const m = r.tipo === 'GASTO' ? porPagar : porCobrar
      m.set(r.moneda, (m.get(r.moneda) ?? 0) + r.saldo_pendiente)
    }
    const toArr = (m: Map<string, number>) => Array.from(m.entries()).map(([moneda, monto]) => ({ moneda, monto })).sort((a, b) => a.moneda.localeCompare(b.moneda))
    return { porPagar: toArr(porPagar), porCobrar: toArr(porCobrar) }
  }, [data.registros])

  const terceroNombre = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of data.terceros) m[t.tercero_id] = t.nombre
    return m
  }, [data.terceros])

  function openNuevo(tipo: TipoRegistro) { setTipoNuevo(tipo); setEditRegistro(null); setModalRegistro(true) }
  function openEdit(r: GastoCobro)       { setEditRegistro(r); setModalRegistro(true) }
  function onSaved()  { setModalRegistro(false); setEditRegistro(null); router.refresh() }
  function onChanged() { router.refresh() }

  function confirmarEliminar() {
    if (!confirmDel) return
    startTransition(async () => {
      const res = await eliminarGastoCobro(confirmDel.registro_id)
      if (res.ok) { setConfirmDel(null); router.refresh() }
      else { alert(res.error); setConfirmDel(null) }
    })
  }

  // Re-sincroniza el registro abierto en Liquidar tras un refresh
  const liquidarVivo = liquidar
    ? data.registros.find(r => r.registro_id === liquidar.registro_id) ?? null
    : null

  return (
    <div className="view-container">

      {/* Cabecera */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Gastos y cobros</h1>
          <p className="page-subtitle">Ingresos y egresos directos (no facturados). Los pagos se reflejan en Tesorería.</p>
        </div>
        <div className="tes-header-actions">
          <button className="btn btn-secondary" onClick={() => openNuevo('COBRO')}><Plus size={14} strokeWidth={2.5} /> Nuevo cobro</button>
          <button className="btn btn-primary"   onClick={() => openNuevo('GASTO')}><Plus size={14} strokeWidth={2.5} /> Nuevo gasto</button>
        </div>
      </div>

      {/* Pendientes */}
      {(pendientes.porPagar.length > 0 || pendientes.porCobrar.length > 0) && (
        <div className="gc-stats">
          <div className="gc-stat-card gc-stat-pagar">
            <div className="gc-stat-label">Por pagar</div>
            {pendientes.porPagar.length === 0
              ? <div className="gc-stat-empty">Sin gastos pendientes</div>
              : pendientes.porPagar.map(p => (
                  <div key={p.moneda} className="gc-stat-line"><span>{p.moneda}</span><strong>{formatMonto(p.monto)}</strong></div>
                ))}
          </div>
          <div className="gc-stat-card gc-stat-cobrar">
            <div className="gc-stat-label">Por cobrar</div>
            {pendientes.porCobrar.length === 0
              ? <div className="gc-stat-empty">Sin cobros pendientes</div>
              : pendientes.porCobrar.map(p => (
                  <div key={p.moneda} className="gc-stat-line"><span>{p.moneda}</span><strong>{formatMonto(p.monto)}</strong></div>
                ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="ter-toolbar">
        <select className="input ter-filter-select" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="">Gastos y cobros</option>
          <option value="GASTO">Solo gastos</option>
          <option value="COBRO">Solo cobros</option>
        </select>
        <select className="input ter-filter-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="PENDIENTE">Pendientes</option>
          <option value="PARCIAL">Parciales</option>
          <option value="LIQUIDADO">Liquidados</option>
        </select>
        <EmpresaPills
          empresas={empresasFiltro}
          value={filtroEmpresa}
          onChange={setFiltroEmpresa}
          todasLabel="Todas las empresas"
        />
      </div>

      {/* Tabla */}
      <div className="card card-table">
        {registros.length === 0 ? (
          <div className="mon-empty">
            <Receipt size={40} strokeWidth={1} opacity={0.2} />
            <p>{data.registros.length === 0
              ? 'Aún no hay gastos ni cobros. Registra el primero para llevar tus ingresos y egresos directos.'
              : 'No hay registros para los filtros seleccionados.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Descripción</th>
                  {multiempresa && <th>Empresa</th>}
                  <th>Tipo</th>
                  <th className="tes-col-monto">Monto</th>
                  <th className="tes-col-monto">Pendiente</th>
                  <th>Estado</th>
                  <th className="alm-col-act"></th>
                </tr>
              </thead>
              <tbody>
                {registros.map(r => (
                  <tr key={r.registro_id}
                    className={multiempresa ? 'row-empresa-accent' : undefined}
                    style={multiempresa ? empresaColorVar(colorOf(r.empresa_id)) : undefined}>
                    <td className="text-sm-muted tes-nowrap">{formatFecha(r.fecha)}</td>
                    <td>
                      <strong>{r.descripcion}</strong>
                      <div className="tes-mov-sub">
                        {r.tercero_id && <span className="tes-mov-cat">{terceroNombre[r.tercero_id] ?? ''}</span>}
                        {r.categoria && <span className="badge badge-neutral tes-origen-badge">{r.categoria}</span>}
                      </div>
                    </td>
                    {multiempresa && (
                      <td>
                        <EmpresaTag color={colorOf(r.empresa_id)} nombre={data.empresa_nombres[r.empresa_id] ?? '—'} />
                      </td>
                    )}
                    <td><span className={`badge ${TIPO_BADGE[r.tipo]}`}>{TIPO_LABEL[r.tipo]}</span></td>
                    <td className="tes-col-monto tes-monto-cell">{formatMonto(r.monto)} {r.moneda}</td>
                    <td className="tes-col-monto tes-monto-cell">{r.saldo_pendiente > 0.005 ? `${formatMonto(r.saldo_pendiente)} ${r.moneda}` : '—'}</td>
                    <td><span className={`badge ${ESTADO_BADGE[r.estado]}`}>{ESTADO_LABEL[r.estado]}</span></td>
                    <td>
                      <div className="ter-actions">
                        <button className="ter-action-btn ter-action-money" title={r.tipo === 'GASTO' ? 'Pagar' : 'Cobrar'}
                          onClick={() => setLiquidar(r)}><DollarSign size={15} strokeWidth={2} /></button>
                        <button className="ter-action-btn" title="Editar" onClick={() => openEdit(r)}><Pencil size={15} strokeWidth={2} /></button>
                        <button className="ter-action-btn ter-action-danger" title="Eliminar"
                          onClick={() => setConfirmDel(r)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modales */}
      {modalRegistro && (
        <RegistroModal registro={editRegistro} tipoInicial={tipoNuevo} data={data}
          onClose={() => { setModalRegistro(false); setEditRegistro(null) }} onSaved={onSaved} />
      )}
      {liquidarVivo && (
        <LiquidarModal registro={liquidarVivo} cuentas={data.cuentas}
          onClose={() => setLiquidar(null)} onChanged={onChanged} />
      )}
      {confirmDel && (
        <ConfirmEliminar registro={confirmDel} onConfirm={confirmarEliminar}
          onClose={() => setConfirmDel(null)} isPending={isPending} />
      )}
    </div>
  )
}

