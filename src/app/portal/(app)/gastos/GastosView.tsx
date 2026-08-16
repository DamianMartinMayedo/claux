'use client'

import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter, useSearchParams }        from 'next/navigation'
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
import {
  ROL_PL_LABEL, ROL_PL_EFECTO, PREGUNTAS_ROL, PREGUNTA_FUERA, OPCIONES_FUERA,
  OPCION_INGRESO, ROLES_RESULTADO, ROLES_INGRESO, ROLES_FUERA_RESULTADO,
  esFueraDelResultado, esRolIngreso,
} from '@/lib/pl/estado'
import { claveCat } from '@/lib/catalogo/emparejar'
import { PERMITIR_RAIZ_MANUAL } from '@/lib/catalogo/politica'
import LiquidarCuentaFields, { type LiquidarState } from '@/app/portal/(app)/_shared/LiquidarCuentaFields'
import CrearTerceroInline from '@/components/portal/CrearTerceroInline'
import { Archive, ChevronRight, DollarSign, Pencil, Plus, Receipt, RotateCcw, Sprout, Tag, TrendingDown, TrendingUp, Trash2, X } from 'lucide-react'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import type { Filtro } from '@/lib/filtros'
import { filtroExport, resumenDe, opcionesTercero } from '@/lib/filtros'
import { RowActions }                  from '@/components/portal/RowActions'
import FormHelp                        from '@/components/portal/FormHelp'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso                 from '@/components/portal/PrerequisitoAviso'
import GavetaLanzador                       from '@/components/portal/GavetaLanzador'
import type { ResumenGaveta }            from '@/lib/caja/pendientes'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import IaTouchpoint                    from '@/components/portal/ia/IaTouchpoint'
import Tabs                            from '@/components/Tabs'
import AsistenteCatalogo               from './AsistenteCatalogo'
import { useRowSelection }             from '@/components/portal/useRowSelection'
import BulkBar                         from '@/components/portal/BulkBar'
import Filtros                        from '@/components/portal/Filtros'
import AvisoTope                      from '@/components/portal/AvisoTope'
import ExportarMenu                   from '@/components/portal/ExportarMenu'
import { ConfirmDialog }               from '@/components/portal/Dialog'
import { hoyEnTz } from '@/lib/fecha-tz'

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
// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: a partir de las 20:00
// `toISOString()` ya da la fecha de mañana, así que el defecto de un `type=date` se
// adelantaba un día cada noche. Una sola fuente: `lib/fecha-tz.ts`.
function hoyISO(): string { return hoyEnTz() }
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

  // Las raíces partidas por el lado del informe al que van (fase 3). El desplegable
  // propone primero las del lado que toca —ingreso si estás anotando un cobro— y
  // deja las otras debajo, con su encabezado, en vez de esconderlas: un cliente que
  // lleva meses anotando sus cobros con una categoría de gasto no puede encontrarse
  // con que la suya ya no está en la lista al editar el registro.
  const raicesIngreso = catOpciones.filter(c => esRolIngreso(c.rol_pl))
  const raicesGasto   = catOpciones.filter(c => !esRolIngreso(c.rol_pl))
  const gruposCat = tipo === 'COBRO'
    ? [{ label: 'Ingresos', filas: raicesIngreso }, { label: 'Otras categorías', filas: raicesGasto }]
    : [{ label: 'Gastos', filas: raicesGasto }, { label: 'Ingresos', filas: raicesIngreso }]

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
              {/* Concepto en los DOS tipos (mig. 152). En el gasto es ADEMÁS de la
                  categoría, no en su lugar: la categoría clasifica el informe y el
                  concepto identifica la fila. Sin él, dos «Suministros · Electricidad»
                  del mismo mes eran la misma línea repetida en la tabla. */}
              <div className="input-group ter-col-full">
                <div className="form-label-with-help">
                  <label htmlFor="gc-concepto">Concepto <span className="required">*</span></label>
                  <FormHelp text={tipo === 'GASTO'
                    ? 'En dos palabras, de qué es. Lo verás en la tabla; la categoría es para el informe.'
                    : 'Lo verás en la tabla y en Cuentas por cobrar.'} label="Qué poner en el concepto" />
                </div>
                <input
                  id="gc-concepto"
                  className="input" name="descripcion" required autoFocus={!isEdit}
                  defaultValue={registro?.concepto ?? registro?.descripcion ?? ''}
                  placeholder={tipo === 'GASTO'
                    ? 'Ej: Factura de la ONE de marzo, alquiler del local…'
                    : 'Ej: Venta directa, anticipo de cliente…'} />
              </div>

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
              {/* Clasificación: Categoría → Subcategoría, en los DOS tipos (fase 3).
                  El cobro también la lleva, y no es simetría: el dinero que entra sin
                  factura no tiene líneas de producto que mirar, así que su categoría
                  es lo ÚNICO que puede decir de qué vive el negocio. Sin ella, un
                  negocio de mostrador ve toda su facturación en un renglón mudo.
                  En el cobro es opcional a propósito —anotar el dinero primero y
                  clasificarlo después es el orden real— y sin clasificar cae en el
                  cajón «Sin categoría» del desglose, que es exactamente la verdad. */}
              <>
                <div className="input-group ter-col-span-3">
                  <div className="form-label-with-help">
                    <label htmlFor="gc-categoria">
                      Categoría {tipo === 'GASTO' && <span className="required">*</span>}
                    </label>
                    {tipo === 'COBRO' && (
                      <FormHelp text={raicesIngreso.length > 0
                        ? 'Con ella, tu informe desglosa de qué vienen los cobros. Puedes dejarla en blanco.'
                        : 'Todavía no tienes categorías de ingreso: créalas en la pestaña Categorías para desglosar tus cobros.'} label="Para qué sirve la categoría" />
                    )}
                  </div>
                  <select id="gc-categoria" className="input" value={catSel} required={tipo === 'GASTO'}
                    onChange={e => { setCatSel(e.target.value); setSubSel('') }}>
                    <option value="">{tipo === 'GASTO' ? '— Elige categoría —' : '— Sin categoría —'}</option>
                    {gruposCat.map(g => g.filas.length === 0 ? null : (
                      <optgroup key={g.label} label={g.label}>
                        {g.filas.map(c => <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>)}
                      </optgroup>
                    ))}
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
              </>

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
                <div className="form-label-with-help">
                  <label>Moneda <span className="required">*</span></label>
                  {isEdit && <FormHelp text="La moneda no se cambia tras crear." label="Por qué no se puede cambiar la moneda" />}
                </div>
                {isEdit ? (
                  <input className="input input-static" readOnly value={registro!.moneda} />
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

// ── Modal: crear / editar categoría de gasto ─────────────────────────────────────

// ── Crear, renombrar y editar una categoría (F1.6) ───────────────────────────
//
// El orden de la interfaz es lo que enseña, así que va al revés de como estaba:
//
//  1. **Dónde va** — y por defecto, dentro de una que ya tienes. Nueve de cada
//     diez categorías que hace un dueño son una subcategoría, y esa rama no tiene
//     que decidir nada del informe: hereda el papel de su madre.
//  2. **El nombre**, con los parecidos delante. La mitad de los duplicados nacen
//     de no acordarse de que «Comisiones bancarias» ya existía.
//  3. **Y solo entonces**, si de verdad es una categoría principal, las tres
//     preguntas sin jerga. El resultado se enseña en EFECTO, no en rol: «se
//     restará de tus ventas», no «coste de ventas».
//
// La decisión del punto 1 se toma ANTES de escribir nada y no se mueve mientras
// se rellena. Ese era el problema del formulario anterior: al elegir madre
// desaparecía el papel en el informe y aparecía otro aviso, y el formulario se
// transformaba solo debajo de las manos.

function CategoriaModal({ categoria, categorias, onClose, onSaved }: {
  categoria: CategoriaGasto | null; categorias: CategoriaGasto[]; onClose: () => void; onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!categoria

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

  // Al EDITAR, dónde vive es un hecho de lo que estás editando y no se pregunta.
  // Al CREAR sí se pregunta, y el defecto es «dentro de una que ya tengo».
  const [comoNueva, setComoNueva] = useState<'hija' | 'principal'>(
    padresPosibles.length ? 'hija' : 'principal')
  // Con las raíces fijas (PERMITIR_RAIZ_MANUAL = false) el dueño solo pone DETALLE:
  // crear a mano es SIEMPRE colgar una subcategoría de una raíz que ya tiene. La
  // rama de «categoría principal nueva» —con sus preguntas de rol— queda entera,
  // detrás del flag, para recuperarla tal cual si se reabre.
  const esHija = isEdit
    ? !!categoria!.parent_id
    : PERMITIR_RAIZ_MANUAL ? comoNueva === 'hija' : true

  const [nombre, setNombre] = useState(categoria?.nombre ?? '')

  // Parecidas, en el mismo nivel. Solo se AVISA: la del cliente manda, y a veces
  // «Transporte» de reparto y «Transporte» de personal son dos cuentas de verdad.
  const parecidas = useMemo(() => {
    const k = claveCat(nombre)
    if (k.length < 3) return []
    return categorias
      .filter(c => c.categoria_id !== categoria?.categoria_id)
      .filter(c => !!c.parent_id === esHija)
      .filter(c => claveCat(c.nombre) === k)
  }, [nombre, categorias, categoria?.categoria_id, esHija])

  // ── Las preguntas ──
  // Primero la de la fase 2 —«¿esto sale de tu caja pero no es un gasto?»—, y solo
  // si se responde que no, las tres de siempre. Ese orden no es cosmético: quien
  // se equivoca en la primera no se equivoca de renglón, se equivoca de informe.
  //
  // `noes` son los «no» acumulados de las tres: la primera que se responde «sí»
  // decide y el resto ni se pintan. Al editar una principal que ya existe no se
  // re-pregunta nada — se enseña lo que hace hoy y hay un botón para redecidirlo.
  const [rolElegido, setRolElegido] = useState<RolPL>(categoria?.rol_pl ?? 'OPERATIVO')
  const [preguntando, setPreguntando] = useState(!isEdit)
  const [paso, setPaso] = useState<'fuera' | 'cual' | 'gasto'>('fuera')
  const [noes, setNoes] = useState(0)

  const responderFuera = (si: boolean) => {
    if (si) { setPaso('cual'); return }
    setPaso('gasto'); setNoes(0)
  }
  const elegirFuera = (rol: RolPL) => { setRolElegido(rol); setPreguntando(false) }
  const elegirIngreso = () => { setRolElegido(OPCION_INGRESO.rol); setPreguntando(false) }

  const responder = (si: boolean) => {
    if (si) { setRolElegido(PREGUNTAS_ROL[noes].rol); setPreguntando(false); return }
    if (noes + 1 >= PREGUNTAS_ROL.length) { setRolElegido('OPERATIVO'); setPreguntando(false); return }
    setNoes(noes + 1)
  }
  const volverAPreguntar = () => { setNoes(0); setPaso('fuera'); setPreguntando(true) }

  // Las que ya cuelgan de esta categoría. Se enseñan para que quede claro que el
  // campo AÑADE a lo que hay, y para no teclear una que ya existe.
  const hijasActuales = isEdit
    ? categorias.filter(c => c.parent_id === categoria!.categoria_id && c.estado === 'ACTIVO')
    : []

  const usos = categoria?.uso_count ?? 0

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
      const que = !isEdit ? (esHija ? 'Subcategoría creada' : 'Categoría creada')
                          : (esHija ? 'Subcategoría guardada' : 'Categoría guardada')
      toastSuccess(que + (detalle ? ` — ${detalle}` : ''))
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">
            {!isEdit ? (esHija ? 'Nueva subcategoría' : 'Nueva categoría')
                     : esHija ? 'Editar subcategoría' : 'Editar categoría'}
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

            {/* 1 · Dónde va. Solo al crear, y antes que nada. Con las raíces fijas
                no se pregunta: es siempre subcategoría (el selector vuelve con el flag). */}
            {!isEdit && PERMITIR_RAIZ_MANUAL && padresPosibles.length > 0 && (
              <div className="input-group">
                <div className="form-label-with-help">
                  <label htmlFor="cat-donde">¿Dónde va?</label>
                  <FormHelp text={comoNueva === 'hija'
                    ? 'Cuenta en el informe dentro de la que elijas, con el papel que ella tenga. Es lo habitual.'
                    : 'Una categoría principal decide en qué renglón del informe cuentan sus gastos.'} label="Dónde encaja la categoría" />
                </div>
                <select id="cat-donde" className="input" value={comoNueva}
                  onChange={e => setComoNueva(e.target.value as 'hija' | 'principal')}>
                  <option value="hija">Dentro de una categoría que ya tengo</option>
                  <option value="principal">Es una categoría principal nueva</option>
                </select>
              </div>
            )}

            {/* 2 · El nombre, con los parecidos delante. */}
            <div className="input-group">
              <label htmlFor="cat-nombre">Nombre <span className="required">*</span></label>
              <input id="cat-nombre" className="input" name="nombre" required autoFocus
                value={nombre} onChange={e => setNombre(e.target.value)}
                placeholder="Ej: Alquiler, Insumos, Servicios…" />
              {parecidas.length > 0 && (
                <span className="input-hint input-hint-warning">
                  Ya tienes {parecidas.map(p => `«${p.nombre}»`).join(', ')}.
                  {' '}Si es la misma cuenta, mejor usar la que ya está: los registros quedan juntos.
                </span>
              )}
              {isEdit && usos > 0 && (
                <span className="input-hint">
                  Se renombrará también en los {usos} registro{usos > 1 ? 's' : ''} que ya la usan.
                </span>
              )}
            </div>

            {esHija ? (
              <div className="input-group">
                <div className="form-label-with-help">
                  <label htmlFor="cat-parent">Subcategoría de</label>
                  <FormHelp text="Cuenta en el informe dentro de esta categoría, con el papel que ella tenga. Cámbiala para moverla a otra." label="Qué implica la categoría madre" />
                </div>
                <select id="cat-parent" className="input" name="parent_id"
                  defaultValue={categoria?.parent_id ?? padresPosibles[0]?.categoria_id ?? ''}>
                  {padresPosibles.map(p => (
                    <option key={p.categoria_id} value={p.categoria_id}>
                      {p.nombre}{p.estado !== 'ACTIVO' ? ' (archivada)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : (<>
              <input type="hidden" name="parent_id" value="" />
              <input type="hidden" name="rol_pl" value={rolElegido} />

              {/* 3 · Las preguntas, y el resultado en efecto. */}
              {preguntando && paso === 'fuera' ? (
                /* La de la fase 2, primero. Se responde «no» sin pensarla en el
                   caso mayoritario, que es justo lo que se busca: el camino
                   ancho no puede costar una decisión difícil. */
                <div className="input-group">
                  <label id="cat-pregunta">{PREGUNTA_FUERA.pregunta}</label>
                  <div className="gc-cat-preg-botones" role="group" aria-labelledby="cat-pregunta">
                    <button type="button" className="btn btn-secondary" onClick={() => responderFuera(true)}>Sí</button>
                    <button type="button" className="btn btn-secondary" onClick={() => responderFuera(false)}>No</button>
                  </div>
                  <span className="input-hint">{PREGUNTA_FUERA.ejemplo}</span>
                  {/* La salida de INGRESO (fase 3), colgada de esta pregunta y no
                      como un paso propio: un paso más al principio le cuesta un
                      clic a todo el mundo, y casi toda categoría que se crea es de
                      gasto. Quien viene a crear la categoría de lo que cobra la
                      reconoce de un vistazo. */}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => elegirIngreso()}>
                    {OPCION_INGRESO.titulo}
                  </button>
                </div>
              ) : preguntando && paso === 'cual' ? (
                /* Las tres salidas, dichas en primera persona y con ejemplos: son
                   tres palabras de contable y se eligen por lo que el dueño hizo,
                   no por cómo se llama en el libro. */
                <div className="input-group">
                  <label id="cat-pregunta">¿Cuál de estas tres es?</label>
                  <div className="gc-cat-opciones" role="group" aria-labelledby="cat-pregunta">
                    {OPCIONES_FUERA.map(o => (
                      <button
                        key={o.rol} type="button" className="gc-cat-opcion"
                        onClick={() => elegirFuera(o.rol)}
                      >
                        <strong>{o.titulo}</strong>
                        <span>{o.ejemplo}</span>
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => responderFuera(false)}>
                    Ninguna: sí es un gasto
                  </button>
                </div>
              ) : preguntando ? (
                <div className="input-group">
                  <label id="cat-pregunta">{PREGUNTAS_ROL[noes].pregunta}</label>
                  <div className="gc-cat-preg-botones" role="group" aria-labelledby="cat-pregunta">
                    <button type="button" className="btn btn-secondary" onClick={() => responder(true)}>Sí</button>
                    <button type="button" className="btn btn-secondary" onClick={() => responder(false)}>No</button>
                  </div>
                  <span className="input-hint">{PREGUNTAS_ROL[noes].ejemplo}</span>
                </div>
              ) : (<>
                <div className="input-group">
                  <label>En tu informe</label>
                  <p className="gc-cat-efecto">{ROL_PL_EFECTO[rolElegido]}</p>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={volverAPreguntar}>
                    Cambiar
                  </button>
                  {isEdit && usos > 0 && rolElegido !== categoria!.rol_pl && (
                    <span className="input-hint input-hint-warning">
                      Cambiarlo recalcula los {usos} registro{usos > 1 ? 's' : ''} que ya la usan,
                      también los de meses cerrados.
                    </span>
                  )}
                </div>

                {/* El renglón exacto, para quien ya sabe cuál quiere (fase 4).
                    Las preguntas no llevan a los once papeles y no deben: llevan a
                    los que un dueño reconoce por lo que hizo. Pero desde la fase 4
                    hay tres —depreciación, impuesto sobre utilidades y los ingresos
                    que no son ventas— que solo pide quien lleva libros con un
                    contador, y sin esta lista no tendría por dónde pedirlos. Va
                    DESPUÉS de la respuesta, nunca en su lugar: aparece cuando ya
                    hay una decisión tomada, así que no le cuesta un clic a nadie. */}
                <div className="input-group">
                  <div className="form-label-with-help">
                    <label htmlFor="cat-rol">Renglón exacto</label>
                    <FormHelp text="Ya está elegido por lo que respondiste. Cámbialo solo si sabes cuál quieres." label="Qué es el renglón exacto" />
                  </div>
                  <select id="cat-rol" className="input" value={rolElegido}
                    onChange={e => setRolElegido(e.target.value as RolPL)}>
                    <optgroup label="Gastos">
                      {ROLES_RESULTADO.map(r => <option key={r} value={r}>{ROL_PL_LABEL[r]}</option>)}
                    </optgroup>
                    <optgroup label="Ingresos">
                      {ROLES_INGRESO.map(r => <option key={r} value={r}>{ROL_PL_LABEL[r]}</option>)}
                    </optgroup>
                    <optgroup label="No afecta a tu resultado">
                      {ROLES_FUERA_RESULTADO.map(r => <option key={r} value={r}>{ROL_PL_LABEL[r]}</option>)}
                    </optgroup>
                  </select>
                </div>
              </>)}

              <div className="input-group">
                <div className="form-label-with-help">
                  <label htmlFor="cat-subs">Subcategorías</label>
                  <FormHelp text={`Opcional, varias separadas por coma. ${hijasActuales.length > 0
                    ? 'Se añaden a las de arriba; las que ya estén se ignoran.'
                    : 'Puedes añadir más luego editando esta categoría.'}`} label="Cómo añadir subcategorías" />
                </div>
                {hijasActuales.length > 0 && (
                  <div className="badge-row">
                    {hijasActuales.map(h => (
                      <span key={h.categoria_id} className="badge badge-neutral">{h.nombre}</span>
                    ))}
                  </div>
                )}
                <textarea id="cat-subs" className="input input-textarea" name="subcategorias" rows={2}
                  placeholder="Bebidas, Carnes, Limpieza" />
              </div>
            </>)}

            <div className="input-group">
              <label htmlFor="cat-desc">Concepto</label>
              <textarea id="cat-desc" className="input input-textarea" name="descripcion" rows={2}
                defaultValue={categoria?.descripcion ?? ''} placeholder="Detalle opcional…" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || (!esHija && preguntando)}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : (esHija ? 'Crear subcategoría' : 'Crear categoría')}
            </button>
          </div>
        </form>
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

export default function GastosView({ data, puedeEditar, gaveta, children }: {
  data: GastosCobrosPageData
  puedeEditar: boolean
  gaveta: ResumenGaveta
  children?: React.ReactNode
}) {
  const router = useRouter()

  const { colorOf, nombreOf } = useEmpresas()
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

  const params = useSearchParams()
  // La pestaña inicial se puede fijar por URL (?tab=categorias): así un CTA de otro
  // módulo —p. ej. el dossier sin categorías clasificables— aterriza directo donde
  // hay que actuar, en vez de dejar al dueño buscando la pestaña.
  const tabParam = params.get('tab')
  const [tab, setTab] = useState<'gastos' | 'cobros' | 'categorias'>(
    tabParam === 'categorias' || tabParam === 'cobros' ? tabParam : 'gastos',
  )
  const [catModal,   setCatModal]   = useState(false)
  const [editCat,    setEditCat]    = useState<CategoriaGasto | null>(null)
  const [confirmCat, setConfirmCat] = useState<CategoriaGasto | null>(null)
  // El impacto se guarda junto a la categoría: el diálogo necesita las dos cosas y
  // pintarlo antes de tenerlo sería preguntar sin poder decir qué pasa al aceptar.
  const [borrarCat, setBorrarCat] = useState<{ cat: CategoriaGasto; impacto: ImpactoCategoria } | null>(null)
  // El asistente de adopción del catálogo (F1.4). Vive aquí y no en su propia
  // ruta: la decisión que toma es sobre ESTA lista, y verla detrás mientras se
  // decide es la mitad de la explicación.
  const [asistente, setAsistente] = useState(false)

  // Los filtros viven en la URL, como el rango y la búsqueda: refrescar —o que se caiga la
  // conexión, que aquí es el caso normal— ya no tira lo que el dueño acababa de poner. Y de
  // esta única declaración salen la barra, lo que viaja a la descarga y el texto del
  // desplegable, que antes se escribían tres veces y por eso divergían.
  const filtroEstado  = params.get('estado')  ?? ''
  const filtroEmpresa = params.get('empresa') ?? ''
  const filtroCat     = params.get('cat')     ?? ''
  const filtroTercero = params.get('tercero') ?? ''

  // La pestaña activa decide el tipo (Gastos vs Cobros)
  const tipoActual: TipoRegistro = tab === 'cobros' ? 'COBRO' : 'GASTO'

  /**
   * LA DECLARACIÓN. De aquí salen la barra, el `FiltroExport` de la descarga y el texto del
   * desplegable: escribir esas tres cosas por separado es lo que hacía que el fichero no se
   * pareciera a la pantalla.
   *
   * `escalado` en todos: mientras el listado quepa entero, el navegador filtra al instante y
   * da el MISMO resultado que la consulta; en cuanto hay filas sin traer, sube al servidor,
   * porque un filtro que solo mira las 500 más recientes miente sin decirlo.
   */
  const declaracion: Filtro[] = useMemo(() => [
    // La pestaña ES el tipo: en Gastos no se baja uno los cobros. Implícito — no se limpia
    // ni cuenta como filtro puesto, pero sí viaja al fichero.
    { clave: 'tipo', label: 'Tipo', valor: tipoActual, widget: 'select', donde: 'cliente', implicito: true },
    {
      clave: 'empresa_id', param: 'empresa', label: 'Todas',
      rotulo: 'Empresa',
      valor: filtroEmpresa, widget: 'pastillas', donde: 'escalado',
      ocultarSi: empresasFiltro.length <= 1,
      opciones: empresasFiltro.map(e => ({ valor: e.empresa_id, label: e.nombre, color: e.color })),
    },
    {
      // `cliente` y no `escalado` a propósito: PENDIENTE/PARCIAL/LIQUIDADO **no son una
      // columna**, se derivan de lo liquidado en Tesorería, así que la consulta no puede
      // filtrarlos. Escalar los OTROS filtros normalmente deshace el truncamiento y con él
      // el problema; si aun así queda recortado, el aviso del techo lo dice.
      clave: 'estado', label: 'Todos los estados', valor: filtroEstado,
      rotulo: 'Estado',
      widget: 'select', donde: 'cliente',
      opciones: (Object.keys(ESTADO_LABEL) as EstadoRegistro[])
        .map(k => ({ valor: k, label: ESTADO_LABEL[k] })),
    },
    {
      // Filtrar por «Suministros» trae sus subcategorías (lo resuelve la consulta y el
      // registro de exportación con la misma regla). Solo raíces en el desplegable.
      clave: 'categoria', param: 'cat', label: 'Todas las categorías', valor: filtroCat,
      rotulo: 'Categoría',
      widget: 'select', donde: 'escalado', ocultarSi: tab !== 'gastos',
      opciones: data.categorias_gastos
        .filter(c => !c.parent_id && c.estado === 'ACTIVO')
        .map(c => ({ valor: c.categoria_id, label: c.nombre })),
    },
    {
      clave: 'tercero', label: tab === 'gastos' ? 'Todos los proveedores' : 'Todos los clientes',
      rotulo: tab === 'gastos' ? 'Proveedor' : 'Cliente',
      valor: filtroTercero, widget: 'select', donde: 'escalado',
      ocultarSi: data.terceros.length === 0,
      // Agrupados POR EMPRESA: un tercero tiene una ficha por empresa, así que la lista
      // plana enseñaba «CLAUDIA» tres veces sin forma de saber cuál era cuál.
      opciones: opcionesTercero(data.terceros, nombreOf, empresasFiltro.length > 1, filtroEmpresa || undefined),
    },
  ], [tipoActual, filtroEmpresa, filtroEstado, filtroCat, filtroTercero, tab, empresasFiltro,
      data.categorias_gastos, data.terceros, nombreOf])

  // Descendientes de una categoría raíz: filtrar por «Suministros» tiene que traer sus
  // subcategorías, o el filtro miente por omisión (los gastos cuelgan de la hija).
  const hijasDe = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const c of data.categorias_gastos) {
      if (!c.parent_id) continue
      const s = m.get(c.parent_id) ?? new Set<string>()
      s.add(c.categoria_id)
      m.set(c.parent_id, s)
    }
    return m
  }, [data.categorias_gastos])

  const registros = useMemo(() => {
    const catsOk = filtroCat
      ? new Set<string>([filtroCat, ...(hijasDe.get(filtroCat) ?? [])])
      : null
    return data.registros.filter(r => {
      if (r.tipo !== tipoActual) return false
      if (filtroEstado  && r.estado  !== filtroEstado)  return false
      if (filtroEmpresa && r.empresa_id !== filtroEmpresa) return false
      if (catsOk && !(r.categoria_id && catsOk.has(r.categoria_id))) return false
      if (filtroTercero && r.tercero_id !== filtroTercero) return false
      return true
    })
  }, [data.registros, tipoActual, filtroEstado, filtroEmpresa, filtroCat, filtroTercero, hijasDe])

  // Totales pendientes por tipo y moneda. **De lo que se está viendo**, no de toda la
  // historia: la cabecera sumaba todo mientras la tabla enseñaba un filtro, y las dos
  // cifras no cuadraban sin ninguna pista de por qué (D4).
  const pendientes = useMemo(() => {
    const porPagar  = new Map<string, number>()
    const porCobrar = new Map<string, number>()
    for (const r of registros) {
      if (r.saldo_pendiente <= 0.005) continue
      const m = r.tipo === 'GASTO' ? porPagar : porCobrar
      m.set(r.moneda, (m.get(r.moneda) ?? 0) + r.saldo_pendiente)
    }
    const toArr = (m: Map<string, number>) => Array.from(m.entries()).map(([moneda, monto]) => ({ moneda, monto })).sort((a, b) => a.moneda.localeCompare(b.moneda))
    return { porPagar: toArr(porPagar), porCobrar: toArr(porCobrar) }
  }, [registros])

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
        <div className="tes-header-actions">
          {/* Solo en sesión de configuración: se pinta solo. La tabla que exporta es
              la de la pestaña abierta. */}
          {tab === 'categorias' ? (
            <ExportarMenu clave="categorias_gastos" />
          ) : (
            <ExportarMenu
              clave="gastos_cobros"
              /* GENERADOS de la declaración: no hay un objeto que escribir a mano y que se
                 pueda quedar corto, ni un resumen que pueda imprimir un código interno. */
              filtro={filtroExport(declaracion, { desde: data.rango.desde, hasta: data.rango.hasta, q: data.q })}
              resumen={[tab === 'gastos' ? 'gastos' : 'cobros', ...resumenDe(declaracion)]}
            />
          )}
          {puedeEditar && (
            tab === 'gastos' ? (
              <button className="btn btn-primary" onClick={() => openNuevo('GASTO')} disabled={data.empresas.length === 0 || data.monedas.length === 0}><Plus size={14} strokeWidth={2.5} /> Nuevo gasto</button>
            ) : tab === 'cobros' ? (
              <button className="btn btn-primary" onClick={() => openNuevo('COBRO')} disabled={data.empresas.length === 0 || data.monedas.length === 0}><Plus size={14} strokeWidth={2.5} /> Nuevo cobro</button>
            ) : (<>
              <button className="btn btn-secondary" onClick={() => setAsistente(true)}>
                <Sprout size={14} strokeWidth={2.5} /> Preparar mi catálogo
              </button>
              {/* Con las raíces fijas, crear a mano es solo una subcategoría: baja a
                  secundario y necesita al menos una raíz de la que colgar. El alta de
                  raíz (y su etiqueta) vuelve con PERMITIR_RAIZ_MANUAL. */}
              <button className="btn btn-secondary" onClick={openCreateCat}
                disabled={!PERMITIR_RAIZ_MANUAL && !categoriasActivas.some(c => !c.parent_id)}>
                <Plus size={14} strokeWidth={2.5} /> {PERMITIR_RAIZ_MANUAL ? 'Nueva categoría' : 'Nueva subcategoría'}
              </button>
            </>)
          )}
        </div>
      </div>
      {children}

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

      {/* Lo que salió de la gaveta del TPV y nadie ha dicho qué fue todavía: son
          gastos (y cobros) que FALTAN de esta tabla. Se avisa aquí, pero se
          clasifica en Tesorería, que es donde está el movimiento. En «Categorías»
          no: allí no falta nada. */}
      <GavetaLanzador resumen={gaveta} />

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
            <span className="gc-stat-label">
              {tab === 'gastos' ? 'Por pagar' : 'Por cobrar'}
              {' '}<em className="gc-stat-alcance">de lo que ves</em>
            </span>
            <span className="gc-stat-amounts">
              {(tab === 'gastos' ? pendientes.porPagar : pendientes.porCobrar).map(p => (
                <span key={p.moneda} className="gc-stat-amount"><strong>{formatMonto(p.monto)}</strong><em>{p.moneda}</em></span>
              ))}
            </span>
          </div>
        </div>
      )}

      <Filtros
        filtros={declaracion}
        rango={data.rango}
        q={data.q}
        placeholder="Buscar por concepto, notas o importe…"
        hayMas={data.hay_mas}
        /* Solo la empresa se queda en la fila; el estado baja al panel. Con las píldoras de
           tres empresas MÁS un desplegable, la barra envolvía a dos líneas y «Filtros»
           acababa suelto al principio de la segunda. */
        visibles={1}
      />

      {/* El techo recorta por FECHA DESCENDENTE: lo que falta son los registros más
          VIEJOS, no «los siguientes». Decir «los primeros N» era literalmente al revés,
          y mandar a acotar el rango no ayudaba a llegar a lo antiguo — había que
          adivinar unas fechas pasadas a mano. Ahora se dice cuántos faltan y se pueden
          traer. */}
      {data.hay_mas && (
        <AvisoTope mostrados={data.registros.length} total={data.total}
          limite={data.limite} sustantivo="registros" />
      )}

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
                  {/* El CONCEPTO es la columna principal (mig. 152): es lo que el dueño
                      reconoce. La categoría va al lado, que es donde sirve — clasificar
                      el informe, no identificar la fila. */}
                  <th>Concepto</th>
                  {tab === 'gastos' && <><th>Categoría</th><th>Subcategoría</th></>}
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
                    {/* El histórico (y lo que escriba un módulo sin concepto) cae a
                        `descripcion`, para que no quede ninguna celda en blanco. */}
                    <td data-label="Concepto">
                      {/* A dos líneas: los conceptos que vienen de la norma («Servicios
                          Comprados a Entidades · …») crecían a cinco y la fila se volvía un
                          párrafo. El texto completo, en el `title`. */}
                      <strong className="cell-clamp" title={r.concepto || r.descripcion}>{r.concepto || r.descripcion}</strong>
                      {r.tercero_id && <div className="tes-mov-sub"><span className="tes-mov-cat">{terceroNombre[r.tercero_id] ?? ''}</span></div>}
                    </td>
                    {tab === 'gastos' && (<>
                      <td data-label="Categoría" className="text-sm-muted">
                        <span className="cell-clamp" title={cs!.cat}>{cs!.cat}</span>
                      </td>
                      <td data-label="Subcategoría" className="text-sm-muted">
                        <span className="cell-clamp" title={cs!.sub ?? undefined}>{cs!.sub ?? '—'}</span>
                      </td>
                    </>)}
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
              <p>{PERMITIR_RAIZ_MANUAL
                ? 'Aún no hay categorías. Podemos cargarte las de tu tipo de negocio, o creas la primera a mano.'
                : 'Aún no hay categorías. Te cargamos las de tu tipo de negocio y luego les añades el detalle que quieras.'}</p>
              {puedeEditar && (
                <button className="btn btn-primary" onClick={() => setAsistente(true)}>
                  <Sprout size={14} strokeWidth={2.5} /> Preparar mi catálogo
                </button>
              )}
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
                      {/* Cuando el papel es de los que no entran en el resultado,
                          la columna tiene que DECIRLO: su encabezado promete «en
                          el informe» y estas categorías no salen en el waterfall.
                          Sin la nota, «Inversiones» se lee como un renglón de
                          gasto más — justo lo que la fase 2 evita. */}
                      <td data-label="En el informe" className="text-sm-muted">
                        {c.parent_id
                          ? <span className="gc-cat-rol-heredado">{ROL_PL_LABEL[rolPadre(c)]} (heredado)</span>
                          : ROL_PL_LABEL[c.rol_pl]}
                        {esFueraDelResultado(c.parent_id ? rolPadre(c) : c.rol_pl) && (
                          <span className="gc-cat-fuera">No resta</span>
                        )}
                        {/* Y las de ingreso lo dicen por el otro lado (fase 3): en
                            esta lista, donde todo lo demás es gasto, «Ingresos del
                            negocio» a secas se lee como un renglón más de lo que
                            sale. */}
                        {esRolIngreso(c.parent_id ? rolPadre(c) : c.rol_pl) && (
                          <span className="gc-cat-ingreso">Suma</span>
                        )}
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
      {/* Los dos diálogos a mano que quedaban en este fichero convergen a
          `<ConfirmDialog>`, que es lo que usa el resto del portal (y ya se usaba aquí
          mismo en cuatro sitios): un modal propio por confirmación es un sitio más donde
          el foco, el escape y el z-index se comportan distinto. */}
      {confirmDel && (
        <ConfirmDialog
          title={`Eliminar ${confirmDel.tipo === 'GASTO' ? 'gasto' : 'cobro'}`}
          body={`¿Eliminar «${confirmDel.concepto || confirmDel.descripcion}» (${formatMonto(confirmDel.monto)} ${confirmDel.moneda})?`}
          danger
          confirmLabel="Eliminar"
          onConfirm={confirmarEliminar}
          onCancel={() => setConfirmDel(null)}
        />
      )}
      {asistente && (
        <AsistenteCatalogo
          onClose={() => setAsistente(false)}
          onCambios={() => router.refresh()} />
      )}
      {catModal && (
        <CategoriaModal categoria={editCat} categorias={data.categorias_gastos}
          onClose={() => { setCatModal(false); setEditCat(null) }} onSaved={onCatSaved} />
      )}
      {confirmCat && (
        <ConfirmDialog
          title="Archivar categoría"
          body={`¿Archivar «${confirmCat.nombre}»? Dejará de aparecer al clasificar gastos nuevos, pero los registros que ya la usan la conservan y podrás restaurarla cuando quieras.`}
          danger
          confirmLabel="Archivar"
          onConfirm={confirmarArchivarCat}
          onCancel={() => setConfirmCat(null)}
        />
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

