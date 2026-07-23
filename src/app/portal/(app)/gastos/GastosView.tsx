'use client'

import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  guardarGastoCobro,
  eliminarGastoCobro,
  eliminarGastosCobrosEnLote,
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
  type ResultadoLote,
} from '@/app/actions/portal/gastos'
import LiquidarCuentaFields, { type LiquidarState } from '@/app/portal/(app)/_shared/LiquidarCuentaFields'
import CrearTerceroInline from '@/components/portal/CrearTerceroInline'
import { Archive, DollarSign, Pencil, Plus, Receipt, RotateCcw, Tag, TrendingDown, TrendingUp, Trash2, X } from 'lucide-react'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { RowActions }                  from '@/components/portal/RowActions'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso                 from '@/components/portal/PrerequisitoAviso'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import EmpresaPills                    from '@/components/portal/EmpresaPills'
import IaTouchpoint                    from '@/components/portal/ia/IaTouchpoint'
import Tabs                            from '@/components/Tabs'
import { useRowSelection }             from '@/components/portal/useRowSelection'
import BulkBar                         from '@/components/portal/BulkBar'
import { ConfirmDialog }               from '@/components/portal/Dialog'

// ── Constantes ────────────────────────────────────────────────────────────────

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

  // Clasificación en dos niveles: Categoría (raíz) → Subcategoría (hija).
  // El registro puede apuntar a una raíz o a una subcategoría; se resuelve el
  // par inicial y se conservan las archivadas para no perderlas al editar.
  const raices = useMemo(
    () => data.categorias_gastos.filter(c => c.estado === 'ACTIVO' && !c.parent_id),
    [data.categorias_gastos],
  )
  const subsPorPadre = useMemo(() => {
    const m = new Map<string, CategoriaGasto[]>()
    for (const c of data.categorias_gastos) {
      if (c.estado === 'ACTIVO' && c.parent_id) {
        const arr = m.get(c.parent_id) ?? []; arr.push(c); m.set(c.parent_id, arr)
      }
    }
    return m
  }, [data.categorias_gastos])

  const parInicial = useMemo(() => {
    const id = registro?.categoria_id
    if (!id) return { cat: '', sub: '' }
    const nodo = data.categorias_gastos.find(c => c.categoria_id === id)
    if (!nodo) return { cat: '', sub: '' }
    return nodo.parent_id ? { cat: nodo.parent_id, sub: nodo.categoria_id } : { cat: nodo.categoria_id, sub: '' }
  }, [registro, data.categorias_gastos])

  const [catSel, setCatSel] = useState(parInicial.cat)
  const [subSel, setSubSel] = useState(parInicial.sub)

  // Opciones, conservando la categoría/subcategoría del registro aunque esté archivada
  const conActual = (base: CategoriaGasto[], id: string) => {
    if (id && !base.some(c => c.categoria_id === id)) {
      const actual = data.categorias_gastos.find(c => c.categoria_id === id)
      if (actual) return [actual, ...base]
    }
    return base
  }
  const catOpciones = conActual(raices, catSel)
  const subOpciones = conActual(catSel ? (subsPorPadre.get(catSel) ?? []) : [], subSel)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('tipo', tipo)
    fd.set('categoria_id', subSel || catSel || '')  // la subcategoría manda; si no, la categoría
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarGastoCobro(fd)
      await ld.dismiss()
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
              {tipo === 'COBRO' && (
                <div className="input-group ter-col-full">
                  <label>Concepto <span className="required">*</span></label>
                  <input className="input" name="descripcion" required autoFocus={!isEdit}
                    defaultValue={registro?.descripcion ?? ''}
                    placeholder="Ej: Venta directa, anticipo de cliente…" />
                </div>
              )}

              <div className="input-group ter-col-full">
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
                      monedas={data.monedas}
                      defaultTipo={tipo === 'GASTO' ? 'PROVEEDOR' : 'CLIENTE'}
                      label={tipo === 'GASTO' ? 'Crear proveedor' : 'Crear cliente'}
                    />
                  </div>
                )}
              </div>
              {/* Clasificación (solo gastos): Categoría → Subcategoría. En cobros no se pide. */}
              {tipo === 'GASTO' && (<>
                <div className="input-group ter-col-span-3">
                  <label>Categoría <span className="required">*</span></label>
                  <select className="input" value={catSel} required
                    onChange={e => { setCatSel(e.target.value); setSubSel('') }}>
                    <option value="">— Elige categoría —</option>
                    {catOpciones.map(c => <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Subcategoría</label>
                  <select className="input" value={subSel}
                    onChange={e => setSubSel(e.target.value)}
                    disabled={!catSel || subOpciones.length === 0}>
                    <option value="">
                      {!catSel ? '— Elige categoría —' : subOpciones.length === 0 ? '— Sin subcategorías —' : '— Sin subcategoría —'}
                    </option>
                    {subOpciones.map(c => <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>)}
                  </select>
                </div>
              </>)}

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

  const esGasto        = registro.tipo === 'GASTO'
  // Todas las cajas (sin filtrar por empresa ni moneda): la de la misma moneda
  // aparece primero; si eliges otra, LiquidarCuentaFields aplica la tasa.
  const cuentasOrdenadas = [...cuentas].sort((a, b) =>
    (a.moneda === registro.moneda ? 0 : 1) - (b.moneda === registro.moneda ? 0 : 1))
  const [liq, setLiq]  = useState<LiquidarState | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!liq || !liq.valido) return
    const fd = new FormData(e.currentTarget)
    fd.set('registro_id', registro.registro_id)
    fd.set('cuenta_id', liq.cuentaId)
    fd.set('monto', liq.monto)
    fd.set('tasa_cambio', String(liq.tasa))
    const ld = toastLoading('Registrando…')
    startTransition(async () => {
      const res = await registrarLiquidacion(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  function handleAnular(movimiento_id: string) {
    const ld = toastLoading('Anulando…')
    startTransition(async () => {
      const res = await anularLiquidacion(movimiento_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{esGasto ? 'Registrar pago' : 'Registrar cobro'}</h2>
            <p className="text-xs-muted mt-1">
              {registro.descripcion} · Total {formatMonto(registro.monto)} {registro.moneda} ·
              Pendiente <strong>{formatMonto(registro.saldo_pendiente)} {registro.moneda}</strong>
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">

          {/* Formulario de liquidación */}
          {registro.saldo_pendiente > 0.005 ? (
            cuentasOrdenadas.length === 0 ? (
              <div className="alert alert-warning mt-3">
                No tienes cajas disponibles. Crea una en Tesorería para registrar el {esGasto ? 'pago' : 'cobro'}.
              </div>
            ) : (
              <form id="liquidar-form" onSubmit={handleSubmit} className="gc-liq-form">
                <div className="ter-form-grid">
                  <LiquidarCuentaFields
                    cuentas={cuentasOrdenadas}
                    docMoneda={registro.moneda}
                    saldo={registro.saldo_pendiente}
                    onChange={setLiq}
                  />
                  <div className="input-group ter-col-span-3">
                    <label>Fecha <span className="required">*</span></label>
                    <input className="input" name="fecha" type="date" defaultValue={hoyISO()} required />
                  </div>
                  <div className="input-group ter-col-full">
                    <label>Notas</label>
                    <input className="input" name="notas" placeholder="Referencia del pago…" />
                  </div>
                </div>
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
          {registro.saldo_pendiente > 0.005 && cuentasOrdenadas.length > 0 && (
            <button type="submit" form="liquidar-form" className="btn btn-primary" disabled={isPending || !liq?.valido}>
              {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : esGasto ? 'Registrar pago' : 'Registrar cobro'}
            </button>
          )}
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

// ── Modal: crear / editar categoría de gasto ─────────────────────────────────────

function CategoriaModal({ categoria, categorias, onClose, onSaved }: {
  categoria: CategoriaGasto | null; categorias: CategoriaGasto[]; onClose: () => void; onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!categoria
  // Una categoría con subcategorías no puede volverse subcategoría (solo 2 niveles)
  const tieneHijos     = isEdit && categorias.some(c => c.parent_id === categoria!.categoria_id)
  const padresPosibles = categorias.filter(c =>
    c.estado === 'ACTIVO' && !c.parent_id && c.categoria_id !== categoria?.categoria_id)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarCategoriaGasto(fd)
      await ld.dismiss()
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
            {tieneHijos ? (
              <input type="hidden" name="parent_id" value="" />
            ) : (
              <div className="input-group">
                <label>Categoría padre</label>
                <select className="input" name="parent_id" defaultValue={categoria?.parent_id ?? ''}>
                  <option value="">— Ninguna (categoría principal) —</option>
                  {padresPosibles.map(p => <option key={p.categoria_id} value={p.categoria_id}>{p.nombre}</option>)}
                </select>
                <span className="input-hint">Elige una para convertir esta en subcategoría.</span>
              </div>
            )}
            <div className="input-group">
              <label>Concepto</label>
              <textarea className="input input-textarea" name="descripcion" rows={2}
                defaultValue={categoria?.descripcion ?? ''} placeholder="Detalle opcional…" />
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

export default function GastosView({ data, puedeEditar }: { data: GastosCobrosPageData; puedeEditar: boolean }) {
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

  const [tab,        setTab]        = useState<'gastos' | 'cobros' | 'categorias'>('gastos')
  const [catModal,   setCatModal]   = useState(false)
  const [editCat,    setEditCat]    = useState<CategoriaGasto | null>(null)
  const [confirmCat, setConfirmCat] = useState<CategoriaGasto | null>(null)

  const [filtroEstado,  setFiltroEstado]  = useState('')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')

  // La pestaña activa decide el tipo (Gastos vs Cobros)
  const tipoActual: TipoRegistro = tab === 'cobros' ? 'COBRO' : 'GASTO'
  const registros = useMemo(() => {
    return data.registros.filter(r => {
      if (r.tipo !== tipoActual) return false
      if (filtroEstado  && r.estado  !== filtroEstado)  return false
      if (filtroEmpresa && r.empresa_id !== filtroEmpresa) return false
      return true
    })
  }, [data.registros, tipoActual, filtroEstado, filtroEmpresa])

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

  const catNombre = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of data.categorias_gastos) m[c.categoria_id] = c.nombre
    return m
  }, [data.categorias_gastos])

  const catById = useMemo(() => {
    const m = new Map<string, CategoriaGasto>()
    for (const c of data.categorias_gastos) m.set(c.categoria_id, c)
    return m
  }, [data.categorias_gastos])
  const catSubDe = (categoriaId: string | null): { cat: string; sub: string | null } => {
    if (!categoriaId) return { cat: '—', sub: null }
    const nodo = catById.get(categoriaId)
    if (!nodo) return { cat: '—', sub: null }
    if (nodo.parent_id) return { cat: catById.get(nodo.parent_id)?.nombre ?? '—', sub: nodo.nombre }
    return { cat: nodo.nombre, sub: null }
  }

  const { pageItems: regItems, ...regPag } = usePagination(registros)
  const { pageItems: catItems, ...catPag } = usePagination(data.categorias_gastos)

  // ── Selección múltiple (solo pestaña gastos) ──
  const ids = useMemo(() => registros.map(r => r.registro_id), [registros])
  const sel = useRowSelection(ids)
  const [confirmLote, setConfirmLote] = useState(false)
  useEffect(() => { sel.clear() }, [tab, filtroEstado, filtroEmpresa]) // eslint-disable-line react-hooks/exhaustive-deps

  function ejecutar(fn: () => Promise<ResultadoLote>) {
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await fn()
      await ld.dismiss()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas)          partes.push(`${r.hechas} eliminada${r.hechas === 1 ? '' : 's'}`)
      if (r.omitidas.length) partes.push(`${r.omitidas.length} omitida${r.omitidas.length === 1 ? '' : 's'}`)
      if (r.errores.length)  partes.push(`${r.errores.length} con error`)
      const msg = partes.join(' · ') || 'Nada que hacer'
      if (r.hechas > 0 && r.errores.length === 0) toastSuccess(msg)
      else if (r.hechas > 0)                      toastError(msg)
      else                                        toastError(r.omitidas[0]?.motivo ? `Nada aplicado — ${r.omitidas[0].motivo}` : msg)
      sel.clear()
      router.refresh()
    })
  }
  function doEliminarLote() {
    setConfirmLote(false)
    ejecutar(() => eliminarGastosCobrosEnLote(sel.selectedIds))
  }

  function openNuevo(tipo: TipoRegistro) { setTipoNuevo(tipo); setEditRegistro(null); setModalRegistro(true) }
  function openEdit(r: GastoCobro)       { setEditRegistro(r); setModalRegistro(true) }
  function onSaved()  { setModalRegistro(false); setEditRegistro(null); router.refresh() }
  function onChanged() { router.refresh() }

  function confirmarEliminar() {
    if (!confirmDel) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarGastoCobro(confirmDel.registro_id)
      await ld.dismiss()
      setConfirmDel(null)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      router.refresh()
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
    const ld = toastLoading('Archivando…')
    startTransition(async () => {
      const res = await archivarCategoriaGasto(confirmCat.categoria_id)
      await ld.dismiss()
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
        {puedeEditar && (
          tab === 'gastos' ? (
            <button className="btn btn-primary" onClick={() => openNuevo('GASTO')} disabled={data.empresas.length === 0 || data.monedas.length === 0}><Plus size={14} strokeWidth={2.5} /> Nuevo gasto</button>
          ) : tab === 'cobros' ? (
            <button className="btn btn-primary" onClick={() => openNuevo('COBRO')} disabled={data.empresas.length === 0 || data.monedas.length === 0}><Plus size={14} strokeWidth={2.5} /> Nuevo cobro</button>
          ) : (
            <button className="btn btn-primary" onClick={openCreateCat}><Plus size={14} strokeWidth={2.5} /> Nueva categoría</button>
          )
        )}
      </div>

      {/* Tabs */}
      <Tabs
        ariaLabel="Secciones de gastos y cobros"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'gastos',     label: 'Gastos',     count: data.registros.filter(r => r.tipo === 'GASTO').length },
          { id: 'cobros',     label: 'Cobros',     count: data.registros.filter(r => r.tipo === 'COBRO').length },
          { id: 'categorias', label: 'Categorías', count: categoriasActivas.length },
        ]}
      />

      {(tab === 'gastos' || tab === 'cobros') && (<>

      {(data.empresas.length === 0 || data.monedas.length === 0) && (
        <PrerequisitoAviso acciones={data.empresas.length === 0
          ? [{ label: 'Crear empresa', href: '/portal/empresas' }]
          : [{ label: 'Crear moneda', href: '/portal/monedas' }]}>
          {data.empresas.length === 0
            ? <>Para registrar gastos y cobros necesitas <strong>una empresa</strong>.</>
            : <>Para registrar gastos y cobros necesitas <strong>al menos una moneda</strong> configurada.</>}
        </PrerequisitoAviso>
      )}

      {/* Pendiente del tipo activo */}
      {(tab === 'gastos' ? pendientes.porPagar : pendientes.porCobrar).length > 0 && (
        <div className="gc-stats">
          <div className={`gc-stat-card ${tab === 'gastos' ? 'gc-stat-pagar' : 'gc-stat-cobrar'}`}>
            <span className="gc-stat-ico">{tab === 'gastos' ? <TrendingDown size={16} strokeWidth={2.2} /> : <TrendingUp size={16} strokeWidth={2.2} />}</span>
            <span className="gc-stat-label">{tab === 'gastos' ? 'Por pagar' : 'Por cobrar'}</span>
            <span className="gc-stat-amounts">
              {(tab === 'gastos' ? pendientes.porPagar : pendientes.porCobrar).map(p => (
                <span key={p.moneda} className="gc-stat-amount"><strong>{formatMonto(p.monto)}</strong><em>{p.moneda}</em></span>
              ))}
            </span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="ter-toolbar">
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
                  {puedeEditar && (
                    <th className="col-check">
                      <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                    </th>
                  )}
                  <th>Fecha</th>
                  {tab === 'gastos' ? <><th>Categoría</th><th>Subcategoría</th></> : <th>Concepto</th>}
                  {multiempresa && <th>Empresa</th>}
                  <th className="col-num">Monto</th>
                  <th className="col-num">Pendiente</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {regItems.map(r => {
                  const cs = tab === 'gastos' ? catSubDe(r.categoria_id) : null
                  return (
                  <tr key={r.registro_id}
                    className={multiempresa ? 'row-empresa-accent' : undefined}
                    style={multiempresa ? empresaColorVar(colorOf(r.empresa_id)) : undefined}>
                    {puedeEditar && (
                      <td className="col-check" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="row-check"
                          checked={sel.isSelected(r.registro_id)}
                          onChange={() => sel.toggle(r.registro_id)}
                          aria-label={`Seleccionar ${r.descripcion}`} />
                      </td>
                    )}
                    <td data-label="Fecha" className="text-sm-muted tes-nowrap">{formatFecha(r.fecha)}</td>
                    {tab === 'gastos' ? (<>
                      <td data-label="Categoría">
                        <strong>{cs!.cat}</strong>
                        {r.tercero_id && <div className="tes-mov-sub"><span className="tes-mov-cat">{terceroNombre[r.tercero_id] ?? ''}</span></div>}
                      </td>
                      <td data-label="Subcategoría" className="text-sm-muted">{cs!.sub ?? '—'}</td>
                    </>) : (
                      <td data-label="Concepto">
                        <strong>{r.descripcion}</strong>
                        {r.tercero_id && <div className="tes-mov-sub"><span className="tes-mov-cat">{terceroNombre[r.tercero_id] ?? ''}</span></div>}
                      </td>
                    )}
                    {multiempresa && (
                      <td data-label="Empresa">
                        <EmpresaTag color={colorOf(r.empresa_id)} nombre={data.empresa_nombres[r.empresa_id] ?? '—'} />
                      </td>
                    )}
                    <td data-label="Monto" className="col-num tes-monto-cell">{formatMonto(r.monto)} {r.moneda}</td>
                    <td data-label="Pendiente" className="col-num tes-monto-cell">{r.saldo_pendiente > 0.005 ? `${formatMonto(r.saldo_pendiente)} ${r.moneda}` : '—'}</td>
                    <td data-label="Estado"><span className={`badge ${ESTADO_BADGE[r.estado]}`}>{ESTADO_LABEL[r.estado]}</span></td>
                    <td className="col-actions">
                      {puedeEditar && (
                        <RowActions>
                          <button className="row-actions-item" onClick={() => setLiquidar(r)}>
                            <DollarSign size={15} strokeWidth={2} /> {r.tipo === 'GASTO' ? 'Pagar' : 'Cobrar'}
                          </button>
                          <button className="row-actions-item" onClick={() => openEdit(r)}>
                            <Pencil size={15} strokeWidth={2} /> Editar
                          </button>
                          <button className="row-actions-item row-actions-item-danger" onClick={() => setConfirmDel(r)} disabled={isPending}>
                            <Trash2 size={14} strokeWidth={2} /> Eliminar
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
        <TablePagination {...regPag} label="registro" />
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
                    <th>Categoría padre</th>
                    <th className="col-center">Usos</th>
                    <th>Estado</th>
                    <th className="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {catItems.map(c => (
                    <tr key={c.categoria_id} className={c.estado === 'INACTIVO' ? 'ter-row-archivada' : undefined}>
                      <td data-label="Nombre">
                        <strong className="text-sm-bold">{c.nombre}</strong>
                        {c.es_sistema && <span className="badge badge-neutral gc-cat-sistema">Sistema</span>}
                      </td>
                      <td data-label="Categoría padre" className="text-sm-muted cell-truncate">{c.parent_id ? (catNombre[c.parent_id] ?? '—') : '—'}</td>
                      <td data-label="Usos" className="col-center text-sm-muted">{c.uso_count ? c.uso_count : '—'}</td>
                      <td data-label="Estado">
                        <span className={`badge ${c.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
                          {c.estado === 'ACTIVO' ? 'Activa' : 'Archivada'}
                        </span>
                      </td>
                      <td className="col-actions">
                        {puedeEditar && (
                          <RowActions>
                            {c.estado === 'ACTIVO' ? (
                              <>
                                <button className="row-actions-item" onClick={() => openEditCat(c)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                                {!c.es_sistema && (
                                  <button className="row-actions-item row-actions-item-danger" onClick={() => setConfirmCat(c)} disabled={isPending}><Archive size={15} strokeWidth={2} /> Archivar</button>
                                )}
                              </>
                            ) : (
                              <button className="row-actions-item" onClick={() => handleRestaurarCat(c)} disabled={isPending}><RotateCcw size={15} strokeWidth={2} /> Restaurar</button>
                            )}
                          </RowActions>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <TablePagination {...catPag} label="categoría" />
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
        <CategoriaModal categoria={editCat} categorias={data.categorias_gastos}
          onClose={() => { setCatModal(false); setEditCat(null) }} onSaved={onCatSaved} />
      )}
      {confirmCat && (
        <ConfirmArchivarCat nombre={confirmCat.nombre} onConfirm={confirmarArchivarCat}
          onClose={() => setConfirmCat(null)} isPending={isPending} />
      )}

      {/* Barra de acciones en lote (solo pestaña de gastos y con permiso de edición) */}
      {(tab === 'gastos' || tab === 'cobros') && puedeEditar && (
        <BulkBar count={sel.count} onClear={sel.clear}>
          <button className="btn btn-danger-text btn-sm" disabled={isPending}
            onClick={() => setConfirmLote(true)}>
            <Trash2 size={14} strokeWidth={2} /> Eliminar
          </button>
        </BulkBar>
      )}

      {confirmLote && (
        <ConfirmDialog
          title={`¿Eliminar ${sel.count} registro${sel.count === 1 ? '' : 's'}?`}
          body="Se eliminarán los seleccionados. Los que tengan pagos o cobros registrados en Tesorería se omitirán (anúlalos antes)."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmLote(false)}
          onConfirm={doEliminarLote}
        />
      )}
    </div>
  )
}

