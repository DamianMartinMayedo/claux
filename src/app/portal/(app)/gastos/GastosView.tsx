'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  guardarGastoCobro,
  eliminarGastoCobro,
  registrarLiquidacion,
  anularLiquidacion,
  guardarCategoriaGasto,
  archivarCategoriaGasto,
  restaurarCategoriaGasto,
  type GastoCobro,
  type GastoCobroConSaldo,
  type CategoriaGasto,
  type TipoRegistro,
  type EstadoRegistro,
  type GastosCobrosPageData,
} from '@/app/actions/portal/gastos'
import CrearTerceroInline from '@/components/portal/CrearTerceroInline'
import { Archive, DollarSign, Pencil, Plus, Receipt, RotateCcw, Tag, Trash2, X } from 'lucide-react'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import EmpresaPills                    from '@/components/portal/EmpresaPills'
import IaTouchpoint                    from '@/components/portal/ia/IaTouchpoint'

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

  // Categorías activas para el select; incluye la del registro aunque esté
  // archivada, para no perderla al editar.
  const categoriasOpts = useMemo(() => {
    const activas = data.categorias_gastos.filter(c => c.estado === 'ACTIVO')
    if (registro?.categoria_id && !activas.some(c => c.categoria_id === registro.categoria_id)) {
      const actual = data.categorias_gastos.find(c => c.categoria_id === registro.categoria_id)
      if (actual) return [actual, ...activas]
    }
    return activas
  }, [data.categorias_gastos, registro])

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
                <select className="input" name="categoria_id" defaultValue={registro?.categoria_id ?? ''}>
                  <option value="">— Sin categoría —</option>
                  {categoriasOpts.map(c => <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>)}
                </select>
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

// ── Tab ─────────────────────────────────────────────────────────────────────────

function Tab({ active, onClick, icon, label, count }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number
}) {
  return (
    <button onClick={onClick} className={`prd-tab${active ? ' active' : ''}`}>
      {icon}
      {label}
      <span className="prd-tab-count">{count}</span>
    </button>
  )
}

// ── Modal: crear / editar categoría de gasto ─────────────────────────────────────

function CategoriaModal({ categoria, onClose, onSaved }: {
  categoria: CategoriaGasto | null; onClose: () => void; onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!categoria

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await guardarCategoriaGasto(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar categoría' : 'Nueva categoría'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {categoria && <input type="hidden" name="categoria_id" value={categoria.categoria_id} />}
          <div className="modal-body">
            {categoria?.es_sistema && (
              <div className="alert alert-info mb-3">
                Categoría del sistema: CLAUX la asigna sola (comisiones de transferencia, nóminas…). Puedes renombrarla, pero no archivarla.
              </div>
            )}
            <div className="input-group">
              <label>Nombre <span className="required">*</span></label>
              <input className="input" name="nombre" required autoFocus
                defaultValue={categoria?.nombre ?? ''} placeholder="Ej: Alquiler, Insumos, Servicios…" />
            </div>
            <div className="input-group">
              <label>Descripción</label>
              <textarea className="input input-textarea" name="descripcion" rows={2}
                defaultValue={categoria?.descripcion ?? ''} placeholder="Descripción opcional…" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear categoría'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Confirmación archivar categoría ──────────────────────────────────────────────

function ConfirmArchivarCat({ nombre, onConfirm, onClose, isPending }: {
  nombre: string; onConfirm: () => void; onClose: () => void; isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Archivar categoría</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            ¿Archivar <strong>{nombre}</strong>? Dejará de aparecer al clasificar gastos nuevos,
            pero los registros que ya la usan la conservan y podrás restaurarla cuando quieras.
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

  const [tab,        setTab]        = useState<'gastos' | 'categorias'>('gastos')
  const [catModal,   setCatModal]   = useState(false)
  const [editCat,    setEditCat]    = useState<CategoriaGasto | null>(null)
  const [confirmCat, setConfirmCat] = useState<CategoriaGasto | null>(null)

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

  const categoriasActivas = data.categorias_gastos.filter(c => c.estado === 'ACTIVO')
  function openCreateCat()               { setEditCat(null); setCatModal(true) }
  function openEditCat(c: CategoriaGasto) { setEditCat(c);   setCatModal(true) }
  function onCatSaved()                  { setCatModal(false); setEditCat(null); router.refresh() }
  function handleRestaurarCat(c: CategoriaGasto) {
    startTransition(async () => { await restaurarCategoriaGasto(c.categoria_id); router.refresh() })
  }
  function confirmarArchivarCat() {
    if (!confirmCat) return
    startTransition(async () => {
      const res = await archivarCategoriaGasto(confirmCat.categoria_id)
      if (!res.ok) toastError(res.error ?? 'Error inesperado.')
      setConfirmCat(null); router.refresh()
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
          <div className="page-title-ia">
            <h1 className="page-title">Gastos y cobros</h1>
            <IaTouchpoint tipo="gastos" descripcion="un análisis de tus gastos" />
          </div>
          <p className="page-subtitle">Ingresos y egresos directos (no facturados). Los pagos se reflejan en Tesorería.</p>
        </div>
        {tab === 'gastos' ? (
          <div className="tes-header-actions">
            <button className="btn btn-secondary" onClick={() => openNuevo('COBRO')}><Plus size={14} strokeWidth={2.5} /> Nuevo cobro</button>
            <button className="btn btn-primary"   onClick={() => openNuevo('GASTO')}><Plus size={14} strokeWidth={2.5} /> Nuevo gasto</button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={openCreateCat}><Plus size={14} strokeWidth={2.5} /> Nueva categoría</button>
        )}
      </div>

      {/* Tabs */}
      <div className="prd-tabs">
        <Tab active={tab === 'gastos'}     onClick={() => setTab('gastos')}     icon={<Receipt size={15} strokeWidth={2} />} label="Gastos y cobros" count={data.registros.length} />
        <Tab active={tab === 'categorias'} onClick={() => setTab('categorias')} icon={<Tag size={15} strokeWidth={2} />}     label="Categorías"     count={categoriasActivas.length} />
      </div>

      {tab === 'gastos' && (<>

      {/* Pendientes */}
      {(pendientes.porPagar.length > 0 || pendientes.porCobrar.length > 0) && (
        <div className="gc-stats">
          <div className="gc-stat-card gc-stat-pagar">
            <span className="gc-stat-label">Por pagar</span>
            {pendientes.porPagar.length === 0
              ? <span className="gc-stat-empty">Sin pendientes</span>
              : (
                <span className="gc-stat-amounts">
                  {pendientes.porPagar.map(p => (
                    <span key={p.moneda} className="gc-stat-amount"><strong>{formatMonto(p.monto)}</strong><em>{p.moneda}</em></span>
                  ))}
                </span>
              )}
          </div>
          <div className="gc-stat-card gc-stat-cobrar">
            <span className="gc-stat-label">Por cobrar</span>
            {pendientes.porCobrar.length === 0
              ? <span className="gc-stat-empty">Sin pendientes</span>
              : (
                <span className="gc-stat-amounts">
                  {pendientes.porCobrar.map(p => (
                    <span key={p.moneda} className="gc-stat-amount"><strong>{formatMonto(p.monto)}</strong><em>{p.moneda}</em></span>
                  ))}
                </span>
              )}
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

      </>)}

      {/* ══ TAB CATEGORÍAS ══ */}
      {tab === 'categorias' && (
        <div className="card card-table">
          <div className="mon-card-header">
            <h2 className="mon-section-title">Categorías de gastos</h2>
            <span className="card-count">{data.categorias_gastos.length} total</span>
          </div>
          {data.categorias_gastos.length === 0 ? (
            <div className="mon-empty">
              <Tag size={36} strokeWidth={1} opacity={0.25} />
              <p>Aún no hay categorías. Crea la primera para clasificar tus gastos.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Descripción</th>
                    <th className="text-center">Usos</th>
                    <th>Estado</th>
                    <th className="alm-col-act"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.categorias_gastos.map(c => (
                    <tr key={c.categoria_id} className={c.estado === 'INACTIVO' ? 'ter-row-archivada' : undefined}>
                      <td>
                        <strong className="text-sm-bold">{c.nombre}</strong>
                        {c.es_sistema && <span className="badge badge-neutral gc-cat-sistema">Sistema</span>}
                      </td>
                      <td className="text-sm-muted">{c.descripcion ?? '—'}</td>
                      <td className="text-center text-sm-muted">{c.uso_count ? c.uso_count : '—'}</td>
                      <td>
                        <span className={`badge ${c.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
                          {c.estado === 'ACTIVO' ? 'Activa' : 'Archivada'}
                        </span>
                      </td>
                      <td>
                        <div className="ter-actions">
                          {c.estado === 'ACTIVO' ? (
                            <>
                              <button className="ter-action-btn" title="Editar" onClick={() => openEditCat(c)}><Pencil size={15} strokeWidth={2} /></button>
                              {!c.es_sistema && (
                                <button className="ter-action-btn ter-action-danger" title="Archivar"
                                  onClick={() => setConfirmCat(c)} disabled={isPending}><Archive size={15} strokeWidth={2} /></button>
                              )}
                            </>
                          ) : (
                            <button className="ter-action-btn ter-action-restore" title="Restaurar"
                              onClick={() => handleRestaurarCat(c)} disabled={isPending}><RotateCcw size={15} strokeWidth={2} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
      {catModal && (
        <CategoriaModal categoria={editCat}
          onClose={() => { setCatModal(false); setEditCat(null) }} onSaved={onCatSaved} />
      )}
      {confirmCat && (
        <ConfirmArchivarCat nombre={confirmCat.nombre} onConfirm={confirmarArchivarCat}
          onClose={() => setConfirmCat(null)} isPending={isPending} />
      )}
    </div>
  )
}

