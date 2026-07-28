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
  eliminarCategoriaGasto,
  impactoCategoria,
  type ImpactoCategoria,
  type GastoCobro,
  type GastoCobroConSaldo,
  type CategoriaGasto,
  type TipoRegistro,
  type EstadoRegistro,
  type GastosCobrosPageData,
  type ResultadoLote,
  type RolPL,
} from '@/app/actions/portal/gastos'
import { ROLES_PL, ROL_PL_LABEL, ROL_PL_AYUDA } from '@/lib/pl/estado'
import LiquidarCuentaFields, { type LiquidarState } from '@/app/portal/(app)/_shared/LiquidarCuentaFields'
import CrearTerceroInline from '@/components/portal/CrearTerceroInline'
import { Archive, ChevronRight, DollarSign, Pencil, Plus, Receipt, RotateCcw, Tag, TrendingDown, TrendingUp, Trash2, X } from 'lucide-react'
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
                <input className="input" name="monto" type="number" min="0" step="any" required
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
  registro, cuentas, empresaNombres, onClose, onChanged,
}: {
  registro: GastoCobroConSaldo
  cuentas:  GastosCobrosPageData['cuentas']
  empresaNombres: Record<string, string>
  onClose:  () => void
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [anularLiq, setAnularLiq] = useState<GastoCobroConSaldo['liquidaciones'][number] | null>(null)

  const esGasto        = registro.tipo === 'GASTO'
  // Todas las cajas (sin filtrar por empresa ni moneda): pagar desde la caja de otra
  // empresa está permitido, y LiquidarCuentaFields lo avisa con el nombre delante — el
  // movimiento se sella con la empresa de la CAJA, no con la del registro.
  // La de la misma moneda aparece primero; si eliges otra, se aplica la tasa.
  const cuentasOrdenadas = [...cuentas]
    .sort((a, b) => (a.moneda === registro.moneda ? 0 : 1) - (b.moneda === registro.moneda ? 0 : 1))
    .map(c => ({ ...c, empresa_nombre: empresaNombres[c.empresa_id] }))
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
                    docEmpresaId={registro.empresa_id}
                    docEmpresaNombre={empresaNombres[registro.empresa_id]}
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
                    onClick={() => setAnularLiq(l)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
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
      {anularLiq && (
        <ConfirmDialog
          title={esGasto ? '¿Anular este pago?' : '¿Anular este cobro?'}
          body={`Se eliminará el movimiento de ${formatMonto(anularLiq.monto)} ${registro.moneda} en ${anularLiq.cuenta_nombre} del ${formatFecha(anularLiq.fecha)}. El registro volverá a quedar pendiente. No se puede deshacer.`}
          confirmLabel={esGasto ? 'Anular pago' : 'Anular cobro'}
          danger
          onCancel={() => setAnularLiq(null)}
          onConfirm={() => { const mov = anularLiq.movimiento_id; setAnularLiq(null); handleAnular(mov) }}
        />
      )}
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

  // Dos formularios distintos, decididos ANTES de pintar y que no cambian mientras
  // se rellenan:
  //
  //  · Una categoría nueva es SIEMPRE principal, y sus subcategorías se escriben
  //    aquí mismo. No se pregunta por «categoría padre»: era la pregunta que hacía
  //    que el formulario se transformara solo (al elegir padre desaparecía el papel
  //    en el informe y aparecía otro aviso), y la que obligaba a entender la
  //    jerarquía antes de poder escribir un nombre.
  //  · Para colgar subcategorías de una principal que ya existe, se EDITA la madre
  //    y se añaden. Es el mismo campo, en el mismo sitio.
  //
  // `esHija` pasa a ser un HECHO de lo que estás editando, no un estado que se
  // mueve: solo es cierto al editar una subcategoría que ya lo era.
  const esHija = isEdit && !!categoria!.parent_id
  const [rolElegido, setRolElegido] = useState<RolPL>(categoria?.rol_pl ?? 'OPERATIVO')

  // Mover una subcategoría a otra madre: el único caso en que sigue haciendo falta
  // elegir padre. Sin esto, una subcategoría creada en la madre equivocada solo se
  // podría arreglar archivándola y volviéndola a crear.
  //
  // La madre ACTUAL va en la lista aunque esté archivada. Si no, el `defaultValue`
  // no casaría con ninguna opción, el navegador seleccionaría la primera y guardar
  // movería la subcategoría de madre SIN QUE NADIE LO PIDA. Un select cuyo valor por
  // defecto no existe entre sus opciones no se queda vacío: miente.
  const madreActual = categoria?.parent_id
    ? categorias.find(c => c.categoria_id === categoria.parent_id)
    : undefined
  const padresPosibles = [
    ...(madreActual && madreActual.estado !== 'ACTIVO' ? [madreActual] : []),
    ...categorias.filter(c =>
      c.estado === 'ACTIVO' && !c.parent_id && c.categoria_id !== categoria?.categoria_id),
  ]

  // Las que ya cuelgan de esta categoría. Se enseñan para que quede claro que el
  // campo AÑADE a lo que hay, y para no teclear una que ya existe.
  const hijasActuales = isEdit
    ? categorias.filter(c => c.parent_id === categoria!.categoria_id && c.estado === 'ACTIVO')
    : []

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarCategoriaGasto(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      // Acuse de éxito siempre (antes no había ninguno: se cerraba el modal y a
      // adivinar). Con el detalle de cuántas hijas entraron, que es lo que confirma
      // que la coma se entendió sin tener que cerrar y mirar la lista.
      const n = res.subcategorias_creadas ?? 0
      const r = res.subcategorias_reactivadas ?? 0
      const detalle = [
        n ? `${n} subcategoría${n > 1 ? 's' : ''}` : '',
        r ? `${r} restaurada${r > 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(' · ')
      const que = !isEdit ? 'Categoría creada' : esHija ? 'Subcategoría guardada' : 'Categoría guardada'
      toastSuccess(que + (detalle ? ` — ${detalle}` : ''))
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">
            {!isEdit ? 'Nueva categoría' : esHija ? 'Editar subcategoría' : 'Editar categoría'}
          </h2>
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
              <label htmlFor="cat-nombre">Nombre <span className="required">*</span></label>
              <input id="cat-nombre" className="input" name="nombre" required autoFocus
                defaultValue={categoria?.nombre ?? ''} placeholder="Ej: Alquiler, Insumos, Servicios…" />
            </div>
            {esHija ? (
              /* Subcategoría: solo su nombre, de quién cuelga y el concepto. Ni papel
                 en el informe (lo hereda de la madre) ni subcategorías dentro. */
              <div className="input-group">
                <label htmlFor="cat-parent">Subcategoría de</label>
                <select id="cat-parent" className="input" name="parent_id"
                  defaultValue={categoria!.parent_id ?? ''}>
                  {padresPosibles.map(p => (
                    <option key={p.categoria_id} value={p.categoria_id}>
                      {p.nombre}{p.estado !== 'ACTIVO' ? ' (archivada)' : ''}
                    </option>
                  ))}
                </select>
                <span className="input-hint">
                  Cuenta en el informe dentro de esta categoría, con el papel que ella tenga.
                  Cámbiala para moverla a otra.
                </span>
              </div>
            ) : (<>
              {/* Principal: es la que decide el papel en el informe, y la que lleva
                  las subcategorías colgadas. */}
              <input type="hidden" name="parent_id" value="" />
              <div className="input-group">
                <label htmlFor="cat-rol">En el estado de resultados</label>
                <select id="cat-rol" className="input" name="rol_pl" value={rolElegido}
                  onChange={e => setRolElegido(e.target.value as RolPL)}>
                  {ROLES_PL.map(r => <option key={r} value={r}>{ROL_PL_LABEL[r]}</option>)}
                </select>
                <span className="input-hint">{ROL_PL_AYUDA[rolElegido]}</span>
              </div>
              <div className="input-group">
                <label htmlFor="cat-subs">Subcategorías</label>
                {hijasActuales.length > 0 && (
                  <div className="badge-row">
                    {hijasActuales.map(h => (
                      <span key={h.categoria_id} className="badge badge-neutral">{h.nombre}</span>
                    ))}
                  </div>
                )}
                <textarea id="cat-subs" className="input input-textarea" name="subcategorias" rows={2}
                  placeholder="Bebidas, Carnes, Limpieza" />
                <span className="input-hint">
                  Opcional, varias separadas por coma. {hijasActuales.length > 0
                    ? 'Se añaden a las de arriba; las que ya estén se ignoran.'
                    : 'Puedes añadir más luego editando esta categoría.'}
                </span>
              </div>
            </>)}
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
  // El impacto se guarda junto a la categoría: el diálogo necesita las dos cosas y
  // pintarlo antes de tenerlo sería preguntar sin poder decir qué pasa al aceptar.
  const [borrarCat, setBorrarCat] = useState<{ cat: CategoriaGasto; impacto: ImpactoCategoria } | null>(null)

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

  // Árbol de categorías: orden jerárquico (cada raíz seguida de sus
  // subcategorías) + nº de hijas por padre para pintar el desplegable.
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set())
  const { categoriasOrdenadas, hijasPorPadre } = useMemo(() => {
    const todas = data.categorias_gastos
    const hijasDe = new Map<string, CategoriaGasto[]>()
    for (const c of todas) {
      if (!c.parent_id) continue
      const arr = hijasDe.get(c.parent_id) ?? []
      arr.push(c)
      hijasDe.set(c.parent_id, arr)
    }
    const orden: CategoriaGasto[] = []
    for (const c of todas) {
      if (c.parent_id) continue
      orden.push(c)
      for (const hija of hijasDe.get(c.categoria_id) ?? []) orden.push(hija)
    }
    // Huérfanas (padre inexistente o inactivo fuera de lista): al final.
    const incluidas = new Set(orden.map(c => c.categoria_id))
    for (const c of todas) if (!incluidas.has(c.categoria_id)) orden.push(c)
    const conteo = new Map<string, number>()
    for (const [padre, hijas] of hijasDe) conteo.set(padre, hijas.length)
    return { categoriasOrdenadas: orden, hijasPorPadre: conteo }
  }, [data.categorias_gastos])

  // Oculta las subcategorías cuyo padre está colapsado.
  const categoriasVisibles = useMemo(
    () => categoriasOrdenadas.filter(c => !(c.parent_id && colapsadas.has(c.parent_id))),
    [categoriasOrdenadas, colapsadas],
  )
  // Papel efectivo de una subcategoría: el de su madre (el informe hace lo mismo).
  const rolPadre = (c: CategoriaGasto): RolPL => {
    if (!c.parent_id) return c.rol_pl
    return data.categorias_gastos.find(p => p.categoria_id === c.parent_id)?.rol_pl ?? c.rol_pl
  }

  const toggleColapso = (id: string) =>
    setColapsadas(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const { pageItems: regItems, ...regPag } = usePagination(registros)
  const { pageItems: catItems, ...catPag } = usePagination(categoriasVisibles)

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
  // ── Eliminar categoría ──────────────────────────────────────────────────────
  // No se pregunta «¿seguro?» a ciegas: primero se consulta al servidor QUÉ se
  // lleva por delante (subcategorías por la cascada, y si tiene movimiento), y el
  // diálogo lo dice. Si no se puede borrar, el mismo diálogo ofrece archivar, que
  // es lo que el usuario quería casi siempre.
  function pedirBorrarCat(c: CategoriaGasto) {
    const ld = toastLoading('Comprobando…')
    startTransition(async () => {
      const res = await impactoCategoria(c.categoria_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      setBorrarCat({ cat: c, impacto: res })
    })
  }

  function confirmarBorrarCat() {
    if (!borrarCat) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarCategoriaGasto(borrarCat.cat.categoria_id)
      await ld.dismiss()
      setBorrarCat(null)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Categoría eliminada')
      router.refresh()
    })
  }

  // Del diálogo de «no se puede borrar» se sale archivando: un clic, sin volver a
  // buscar la categoría en la lista.
  function archivarDesdeBorrado() {
    if (!borrarCat) return
    const c = borrarCat.cat
    const ld = toastLoading('Archivando…')
    startTransition(async () => {
      const res = await archivarCategoriaGasto(c.categoria_id)
      await ld.dismiss()
      setBorrarCat(null)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(`«${c.nombre}» archivada`)
      router.refresh()
    })
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
          <p className="page-subtitle">Ingresos y egresos sin factura de por medio.</p>
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
                    <th>En el informe</th>
                    <th className="col-center">Usos</th>
                    <th>Estado</th>
                    <th className="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {catItems.map(c => {
                    const nHijas = hijasPorPadre.get(c.categoria_id) ?? 0
                    const colapsada = colapsadas.has(c.categoria_id)
                    return (
                    <tr key={c.categoria_id} className={c.estado === 'INACTIVO' ? 'ter-row-archivada' : undefined}>
                      <td data-label="Nombre">
                        <div className="gc-cat-fila">
                          {c.parent_id ? (
                            <span className="gc-cat-hija-hueco" aria-hidden="true" />
                          ) : nHijas > 0 ? (
                            <button type="button"
                              className={`gc-cat-toggle${colapsada ? '' : ' gc-cat-toggle-abierto'}`}
                              aria-expanded={!colapsada}
                              aria-label={`${colapsada ? 'Mostrar' : 'Ocultar'} subcategorías de ${c.nombre}`}
                              onClick={() => toggleColapso(c.categoria_id)}>
                              <ChevronRight size={16} strokeWidth={2.5} />
                            </button>
                          ) : (
                            <span className="gc-cat-toggle-placeholder" aria-hidden="true" />
                          )}
                          {c.parent_id
                            ? <span className="gc-cat-hija-nombre">{c.nombre}</span>
                            : <strong className="text-sm-bold">{c.nombre}</strong>}
                          {nHijas > 0 && <span className="gc-cat-count">{nHijas}</span>}
                          {c.es_sistema && <span className="badge badge-neutral gc-cat-sistema">Sistema</span>}
                        </div>
                      </td>
                      {/* Una subcategoría no tiene papel propio: enseña el de su
                          madre, que es el que de verdad aplica en el informe. */}
                      <td data-label="En el informe" className="text-sm-muted">
                        {c.parent_id
                          ? <span className="gc-cat-rol-heredado">{ROL_PL_LABEL[rolPadre(c)]} (heredado)</span>
                          : ROL_PL_LABEL[c.rol_pl]}
                      </td>
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
                                {!c.es_sistema && (<>
                                  <button className="row-actions-item" onClick={() => setConfirmCat(c)} disabled={isPending}><Archive size={15} strokeWidth={2} /> Archivar</button>
                                  <button className="row-actions-item row-actions-item-danger" onClick={() => pedirBorrarCat(c)} disabled={isPending}><Trash2 size={15} strokeWidth={2} /> Eliminar</button>
                                </>)}
                              </>
                            ) : (
                              <button className="row-actions-item" onClick={() => handleRestaurarCat(c)} disabled={isPending}><RotateCcw size={15} strokeWidth={2} /> Restaurar</button>
                            )}
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
          empresaNombres={data.empresa_nombres}
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

      {/* Borrado: dos diálogos distintos según lo que diga el servidor, no uno con
          un aviso genérico. Si la categoría tiene movimiento NO se ofrece borrar
          siquiera: se explica por qué y se ofrece archivar, que es la acción que
          resuelve el caso sin tocar la historia. */}
      {borrarCat && !borrarCat.impacto.puede_borrar && (
        <ConfirmDialog
          title="Mejor archivarla"
          confirmLabel="Archivar"
          cancelLabel="Cancelar"
          onConfirm={archivarDesdeBorrado}
          onCancel={() => setBorrarCat(null)}
          body={
            <>
              <strong>{borrarCat.impacto.nombre}</strong> se usa en{' '}
              {borrarCat.impacto.registros > 0 && (
                <>{borrarCat.impacto.registros} {borrarCat.impacto.registros === 1 ? 'gasto o cobro' : 'gastos y cobros'}</>
              )}
              {borrarCat.impacto.registros > 0 && borrarCat.impacto.movimientos > 0 && ' y '}
              {borrarCat.impacto.movimientos > 0 && (
                <>{borrarCat.impacto.movimientos} {borrarCat.impacto.movimientos === 1 ? 'movimiento de tesorería' : 'movimientos de tesorería'}</>
              )}
              {borrarCat.impacto.subcategorias.length > 0 && ' (contando sus subcategorías)'}.
              {' '}Borrarla dejaría esos importes sin clasificar y <strong>cambiaría informes de
              meses ya cerrados</strong>.
              <br /><br />
              Archivarla la quita de los desplegables al registrar gastos nuevos y conserva
              intacto todo el historial. Puedes restaurarla cuando quieras.
            </>
          }
        />
      )}

      {borrarCat && borrarCat.impacto.puede_borrar && (
        <ConfirmDialog
          danger
          title="Eliminar categoría"
          confirmLabel="Eliminar"
          onConfirm={confirmarBorrarCat}
          onCancel={() => setBorrarCat(null)}
          body={
            <>
              ¿Eliminar <strong>{borrarCat.impacto.nombre}</strong>? No la usa ningún gasto
              ni movimiento, así que no se pierde nada del historial.
              {borrarCat.impacto.subcategorias.length > 0 && (
                <>
                  <br /><br />
                  Se {borrarCat.impacto.subcategorias.length === 1 ? 'eliminará también su subcategoría' : 'eliminarán también sus subcategorías'}:{' '}
                  <strong>{borrarCat.impacto.subcategorias.join(', ')}</strong>.
                </>
              )}
            </>
          }
        />
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

