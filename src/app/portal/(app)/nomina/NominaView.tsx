'use client'

import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  crearNomina,
  eliminarNomina,
  confirmarNominasEnLote,
  eliminarNominasEnLote,
  guardarReglaDeduccion,
  alternarReglaDeduccion,
  eliminarReglaDeduccion,
  guardarConfigNomina,
  guardarMapeoGastoNomina,
  exportarNominaXlsx,
  type NominaConLineas,
  type ReglaDeduccion,
  type NominaPageData,
  type ResultadoLote,
} from '@/app/actions/portal/rrhh'
import { Check, Download, Eye, Pencil, Plus, Power, RefreshCw, Trash2, Wallet, X } from 'lucide-react'
import { CONCEPTOS_COSTE, NOMBRE_CONCEPTO_COSTE } from '@/lib/rrhh/conceptos'
import { descargarBase64, XLSX_MIME } from '@/lib/exportar/descargar'
import Tabs from '@/components/Tabs'
import { formatMonto, hoyISO, formatPeriodo, actualizarConceptosNominas } from '../_shared/NominaDetalleModal'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { RowActions }                  from '@/components/portal/RowActions'
import FormHelp                        from '@/components/portal/FormHelp'
import BulkBar                          from '@/components/portal/BulkBar'
import { useRowSelection }             from '@/components/portal/useRowSelection'
import { ConfirmDialog }               from '@/components/portal/Dialog'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso                 from '@/components/portal/PrerequisitoAviso'
import AvisoTope                         from '@/components/portal/AvisoTope'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import Filtros                         from '@/components/portal/Filtros'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'
import ExportarMenu from '@/components/portal/ExportarMenu'

// ── Reglas del negocio ───────────────────────────────────────────────────────────
// «Así funciona mi nómina»: se escribe UNA vez y se aplica a toda la plantilla.
// Vive aquí y no en la ficha del trabajador porque es configuración del NEGOCIO —
// en la ficha solo va lo que esa persona tiene de particular. Antes no existía esta
// distinción y una retención igual para todos eran tantas altas a mano como
// trabajadores; cambiarla, tantos borrados y tantas altas.

function ReglaModal({
  data, regla, onClose, onDone,
}: {
  data:    NominaPageData
  regla:   ReglaDeduccion | null
  onClose: () => void
  onDone:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [modo, setModo] = useState<'FIJO' | 'PORCENTAJE'>(regla?.modo ?? 'FIJO')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (regla) fd.set('regla_id', regla.regla_id)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarReglaDeduccion(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(regla ? 'Regla actualizada' : 'Regla creada')
      onDone()
    })
  }

  return (
    <div className="modal-backdrop open dialog-top">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{regla ? 'Editar regla' : 'Nueva regla'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="info-box">
            <strong className="info-box-title">Se aplica a toda la plantilla</strong>
            <span className="text-xs-muted">
              Entra sola en cada nómina que generes a partir de ahora. Si alguien tiene otro
              importe —o no le toca—, se marca como excepción en su ficha.
              Las nóminas ya generadas no cambian.
            </span>
          </div>
          <form id="regla-form" onSubmit={handleSubmit}>
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label htmlFor="rg-nombre">Nombre <span className="required">*</span></label>
                <input className="input" id="rg-nombre" name="nombre" required maxLength={80}
                  defaultValue={regla?.nombre ?? ''} placeholder="Impuesto sobre ingresos personales…" />
              </div>

              <div className="input-group ter-col-span-3">
                <label htmlFor="rg-tipo">Tipo <span className="required">*</span></label>
                <select className="input" id="rg-tipo" name="tipo" defaultValue={regla?.tipo ?? 'RETENCION'}>
                  <option value="RETENCION">Se le descuenta</option>
                  <option value="DEVENGO">Se le suma</option>
                </select>
              </div>

              <div className="input-group ter-col-span-3">
                <label htmlFor="rg-empresa">Se aplica en</label>
                <select className="input" id="rg-empresa" name="empresa_id" defaultValue={regla?.empresa_id ?? ''}>
                  <option value="">Todas las empresas</option>
                  {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
                </select>
              </div>

              <div className="input-group ter-col-span-3">
                <label htmlFor="rg-modo">Cómo se calcula <span className="required">*</span></label>
                <select className="input" id="rg-modo" name="modo" value={modo}
                  onChange={e => setModo(e.target.value as 'FIJO' | 'PORCENTAJE')}>
                  <option value="FIJO">Importe fijo</option>
                  <option value="PORCENTAJE">Porcentaje</option>
                </select>
              </div>

              <div className="input-group ter-col-span-3">
                <div className="form-label-with-help">
                  <label htmlFor="rg-valor">
                    {modo === 'PORCENTAJE' ? 'Porcentaje (%)' : 'Importe'} <span className="required">*</span>
                  </label>
                  {modo === 'FIJO' && (
                    <FormHelp text="En la moneda de cada nómina donde se aplique." label="En qué moneda se aplica el importe" />
                  )}
                </div>
                <input className="input" id="rg-valor" name="valor" type="number" required
                  min="0.01" step="any" max={modo === 'PORCENTAJE' ? 100 : undefined}
                  defaultValue={regla?.valor ?? ''} />
              </div>

              {modo === 'PORCENTAJE' && (
                <div className="input-group ter-col-full">
                  <label htmlFor="rg-base">Porcentaje de</label>
                  <select className="input" id="rg-base" name="base" defaultValue={regla?.base ?? 'SALARIO_BASE'}>
                    <option value="SALARIO_BASE">El salario del período</option>
                    <option value="DEVENGADO">El devengado (salario + lo que se le suma)</option>
                  </select>
                </div>
              )}
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" form="regla-form" className="btn btn-primary" disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// `editando` vive en el PADRE: el botón «Nueva regla» va en el `.page-header`, al
// lado del título y como el resto de las vistas, así que quien lo dispara está
// fuera de este panel.
function ReglasPanel({ data, editando, setEditando, puedeEditar }: {
  data:        NominaPageData
  editando:    ReglaDeduccion | 'nueva' | null
  setEditando: (r: ReglaDeduccion | 'nueva' | null) => void
  puedeEditar: boolean
}) {
  const router = useRouter()
  // Sin `isPending`: aquí la carga la enseña el toast de `toastLoading`, no un botón
  // deshabilitado, así que la bandera no se usaba.
  const [, startTransition] = useTransition()
  const [borrando, setBorrando] = useState<ReglaDeduccion | null>(null)

  const nombreEmpresa = (id: string | null) =>
    id ? (data.empresas.find(e => e.empresa_id === id)?.nombre ?? '—') : 'Todas'

  function toggle(r: ReglaDeduccion) {
    const ld = toastLoading(r.activa ? 'Desactivando…' : 'Activando…')
    startTransition(async () => {
      const res = await alternarReglaDeduccion(r.regla_id, !r.activa)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      router.refresh()
    })
  }

  function borrar() {
    if (!borrando) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarReglaDeduccion(borrando.regla_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setBorrando(null); return }
      setBorrando(null); router.refresh()
    })
  }

  return (
    <>
      <p className="text-sm-muted">
        Lo que se aplica <strong>a toda la plantilla</strong>. Se escribe una vez y entra sola
        en cada nómina nueva; lo particular de una persona va en su ficha.
      </p>

      <div className="card card-table">
        {data.reglas.length === 0 ? (
          <div className="mon-empty">
            <Wallet size={40} strokeWidth={1} opacity={0.2} />
            <p>Sin reglas. Si hay algo que se le aplica a todo el personal —un impuesto, un plus
              de transporte—, ponlo aquí una sola vez en lugar de repetirlo en cada ficha.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Regla</th>
                  <th>Empresa</th>
                  <th>Tipo</th>
                  <th className="col-num">Valor</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {data.reglas.map(r => (
                  <tr key={r.regla_id}>
                    <td data-label="Regla">
                      <strong>{r.nombre}</strong>{' '}
                      {!r.activa && <span className="badge badge-neutral">Desactivada</span>}
                    </td>
                    <td data-label="Empresa">{nombreEmpresa(r.empresa_id)}</td>
                    <td data-label="Tipo">
                      <span className={`badge ${r.tipo === 'DEVENGO' ? 'badge-success' : 'badge-warning'}`}>
                        {r.tipo === 'DEVENGO' ? 'Se le suma' : 'Se le descuenta'}
                      </span>
                    </td>
                    <td data-label="Valor" className="col-num tes-monto-cell">
                      {r.modo === 'PORCENTAJE'
                        ? `${r.valor}% ${r.base === 'DEVENGADO' ? 'del devengado' : 'del salario'}`
                        : formatMonto(r.valor)}
                    </td>
                    <td className="col-actions">
                      {puedeEditar && (
                        <RowActions>
                          <button className="row-actions-item" onClick={() => setEditando(r)}>
                            <Pencil size={14} strokeWidth={2} /> Editar
                          </button>
                          <button className="row-actions-item" onClick={() => toggle(r)}>
                            <Power size={14} strokeWidth={2} /> {r.activa ? 'Desactivar' : 'Activar'}
                          </button>
                          <button className="row-actions-item row-actions-item-danger" onClick={() => setBorrando(r)}>
                            <Trash2 size={14} strokeWidth={2} /> Eliminar
                          </button>
                        </RowActions>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editando && (
        <ReglaModal
          data={data}
          regla={editando === 'nueva' ? null : editando}
          onClose={() => setEditando(null)}
          onDone={() => { setEditando(null); router.refresh() }}
        />
      )}

      {borrando && (
        <ConfirmDialog
          danger
          title="Eliminar regla"
          body={`Se elimina «${borrando.nombre}» y las excepciones que algún trabajador tuviera sobre ella. Las nóminas ya generadas no cambian. Si solo quieres dejar de aplicarla, desactívala.`}
          confirmLabel="Eliminar"
          onConfirm={borrar}
          onCancel={() => setBorrando(null)}
        />
      )}
    </>
  )
}

// ── Configuración de nómina por empresa ─────────────────────────────────────────
// El modelo se elige POR EMPRESA, no por cliente: un negocio con varias empresas
// puede tener una en el modelo cubano y el resto en el general. Cambiarlo NO
// reescribe nada — solo afecta a las nóminas que se generen a partir de ahí.

function ConfigNominaPanel({ data, puedeEditar }: { data: NominaPageData; puedeEditar: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editando, setEditando] = useState<string | null>(null)

  const configDe = (empresa_id: string) =>
    data.config_nomina.find(c => c.empresa_id === empresa_id)
      ?? { empresa_id, modelo: 'GENERAL' as const, dias_laborables_default: 24, dia_pago: null }

  const hayCuba = data.empresas.some(e => configDe(e.empresa_id).modelo === 'MIPYME_CUBA')

  function guardar(e: React.FormEvent<HTMLFormElement>, empresa_id: string) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('empresa_id', empresa_id)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarConfigNomina(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Configuración guardada')
      setEditando(null); router.refresh()
    })
  }

  return (
    <>
      {/* El aviso solo sale si alguna empresa usa de verdad el modelo cubano: en el
          general estos tributos no se aplican y avisar de ellos sería ruido. */}
      {hayCuba && data.fiscales_provisionales.length > 0 && (
        <div className="alert alert-error alert-intro">
          <span>
            <strong>Los tipos de {data.fiscales_provisionales.join(', ')} son provisionales.</strong>{' '}
            Están puestos solo para que el cálculo funcione y no corresponden a la norma
            verificada. Puedes generar borradores y revisarlos, pero <strong>no se pueden
            confirmar</strong>: registrarían en tu contabilidad una deuda con ONAT por un
            importe que no es el real. En cuanto se carguen los tipos definitivos, las
            nóminas se confirman sin tener que rehacer nada.
          </span>
        </div>
      )}

      <div className="ter-toolbar">
        <p className="text-sm-muted">
          Cómo calcula la nómina cada una de tus empresas. Cambiarlo <strong>no altera las
          nóminas ya hechas</strong>: solo las que generes a partir de ahora.
        </p>
      </div>

      <div className="card card-table">
        {data.empresas.length === 0 ? (
          <div className="mon-empty">
            <Wallet size={40} strokeWidth={1} opacity={0.2} />
            <p>Sin empresas todavía.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Modelo de cálculo</th>
                  <th className="col-num">Días laborables</th>
                  <th className="col-num">Día de pago</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {data.empresas.map(emp => {
                  const cfg = configDe(emp.empresa_id)
                  const abierta = editando === emp.empresa_id
                  return (
                    <tr key={emp.empresa_id}>
                      <td data-label="Empresa"><strong>{emp.nombre}</strong></td>
                      {abierta ? (
                        <>
                          <td data-label="Modelo de cálculo">
                            <form id={`cfg-${emp.empresa_id}`} onSubmit={e => guardar(e, emp.empresa_id)}>
                              <select className="input nom-aplicar-sel" name="modelo" defaultValue={cfg.modelo}
                                aria-label={`Modelo de nómina de ${emp.nombre}`}>
                                <option value="GENERAL">General</option>
                                <option value="MIPYME_CUBA">MIPYME cubana</option>
                              </select>
                            </form>
                          </td>
                          <td data-label="Días laborables" className="col-num">
                            <input className="input nom-input" form={`cfg-${emp.empresa_id}`} type="number"
                              name="dias_laborables_default" min="1" max="31" step="any"
                              defaultValue={cfg.dias_laborables_default}
                              aria-label={`Días laborables de ${emp.nombre}`} />
                          </td>
                          {/* En blanco es válido: las deudas de la nómina nacen sin
                              vencimiento, como hasta ahora. */}
                          <td data-label="Día de pago" className="col-num">
                            <input className="input nom-input" form={`cfg-${emp.empresa_id}`} type="number"
                              name="dia_pago" min="1" max="31" step="1" placeholder="—"
                              defaultValue={cfg.dia_pago ?? ''}
                              aria-label={`Día de pago de la nómina de ${emp.nombre}`} />
                          </td>
                          <td className="col-actions">
                            <div className="ter-actions">
                              <button type="submit" form={`cfg-${emp.empresa_id}`}
                                className="btn btn-primary btn-sm" disabled={isPending}>
                                {isPending ? <span className="spinner spinner-sm" /> : 'Guardar'}
                              </button>
                              <button type="button" className="btn btn-secondary btn-sm"
                                onClick={() => setEditando(null)} disabled={isPending}>Cancelar</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td data-label="Modelo de cálculo">
                            {cfg.modelo === 'MIPYME_CUBA'
                              ? <span className="badge badge-info">MIPYME cubana</span>
                              : <span className="badge badge-neutral">General</span>}
                          </td>
                          <td data-label="Días laborables" className="col-num tes-monto-cell">
                            {cfg.dias_laborables_default}
                          </td>
                          <td data-label="Día de pago" className="col-num tes-monto-cell">
                            {cfg.dia_pago ?? <span className="text-xs-muted">Sin fijar</span>}
                          </td>
                          <td className="col-actions">
                            {puedeEditar && (
                              <button className="ter-action-btn" title="Cambiar"
                                aria-label={`Cambiar la configuración de ${emp.nombre}`}
                                onClick={() => setEditando(emp.empresa_id)}>
                                <Pencil size={14} strokeWidth={2} />
                              </button>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <MapeoGastosPanel data={data} puedeEditar={puedeEditar} />

      <div className="info-box mt-3">
        <strong className="info-box-title">Sobre el modelo MIPYME cubana</strong>
        <span className="text-xs-muted">
          Añade el cálculo de la ley cubana —impuesto sobre ingresos personales, Contribución
          Especial a la Seguridad Social, Impuesto por la Utilización de la Fuerza de Trabajo y
          la Contribución a la Seguridad Social a cargo de la empresa— y reparte el coste entre
          sus acreedores en tu contabilidad. <strong>Solo se aplica a las nóminas en CUP</strong>;
          si esa empresa además paga a alguien en divisa, esa nómina se calcula como General.
          El trabajador marcado como socio no paga la Contribución Especial; todo lo demás se le
          calcula igual.
        </span>
      </div>
    </>
  )
}

// ── A qué categoría de gasto va cada concepto de la nómina (mig. 166) ───────────
//
// Confirmar una nómina escribe su COSTE repartido por categoría. El reparto estaba fijo
// en código, así que el dueño no podía ver su coste de personal como lo lleva su propia
// contabilidad. Mandar dos conceptos a la misma categoría es una decisión suya
// legítima; en blanco, el concepto usa la categoría que crea el sistema.

function MapeoGastosPanel({ data, puedeEditar }: { data: NominaPageData; puedeEditar: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [abierta, setAbierta] = useState<string | null>(null)

  // Solo las categorías raíz y sus hijas, con la etiqueta «Padre · Hija» que usa el
  // resto de Contabilidad: elegir «Electricidad» sin saber de qué cuelga no dice nada.
  const opciones = useMemo(() => {
    const nombreDe = new Map(data.categorias_gasto.map(c => [c.categoria_id, c.nombre]))
    return data.categorias_gasto.map(c => ({
      categoria_id: c.categoria_id,
      etiqueta: c.parent_id
        ? `${nombreDe.get(c.parent_id) ?? '—'} · ${c.nombre}`
        : c.nombre,
    })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta))
  }, [data.categorias_gasto])

  const elegidaDe = (empresa_id: string, concepto: string) =>
    data.mapeo_gasto.find(m => m.empresa_id === empresa_id && m.concepto === concepto)?.categoria_id ?? ''

  function guardar(e: React.FormEvent<HTMLFormElement>, empresa_id: string) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('empresa_id', empresa_id)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarMapeoGastoNomina(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Reparto guardado')
      setAbierta(null); router.refresh()
    })
  }

  if (data.empresas.length === 0) return null

  return (
    <div className="det-card mt-3">
      <div className="card-header">
        <h2 className="card-title">Reparto del coste de la nómina</h2>
      </div>
      <div className="ter-toolbar">
        <p className="text-sm-muted">
          A qué categoría de gasto va cada concepto cuando confirmas una nómina. En blanco,
          se usa la categoría que crea CLAUX. <strong>Las retenciones no están aquí</strong>:
          su coste ya va dentro del salario, y contarlas otra vez lo duplicaría — solo
          generan la deuda con su acreedor.
        </p>
      </div>

      {data.empresas.map(emp => {
        const editando = abierta === emp.empresa_id
        return (
          <div key={emp.empresa_id} className="nom-mapeo-empresa">
            <div className="det-meta-row">
              <strong>{emp.nombre}</strong>
              {puedeEditar && !editando && (
                <button className="btn btn-ghost btn-sm" onClick={() => setAbierta(emp.empresa_id)}>
                  <Pencil size={14} strokeWidth={2} /> Cambiar reparto
                </button>
              )}
            </div>

            {editando ? (
              <form onSubmit={e => guardar(e, emp.empresa_id)}>
                <div className="ter-form-grid">
                  {CONCEPTOS_COSTE.map(concepto => (
                    <div className="input-group ter-col-full" key={concepto}>
                      <label htmlFor={`m-${emp.empresa_id}-${concepto}`}>
                        {NOMBRE_CONCEPTO_COSTE[concepto]}
                      </label>
                      <select className="input" id={`m-${emp.empresa_id}-${concepto}`}
                        name={`cat_${concepto}`} defaultValue={elegidaDe(emp.empresa_id, concepto)}>
                        <option value="">La que crea CLAUX</option>
                        {opciones.map(o => (
                          <option key={o.categoria_id} value={o.categoria_id}>{o.etiqueta}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="ter-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={isPending}>
                    {isPending ? <span className="spinner spinner-sm" /> : 'Guardar reparto'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm"
                    onClick={() => setAbierta(null)} disabled={isPending}>Cancelar</button>
                </div>
              </form>
            ) : (
              <ul className="nom-mapeo-lista">
                {CONCEPTOS_COSTE.map(concepto => {
                  const id = elegidaDe(emp.empresa_id, concepto)
                  const cat = opciones.find(o => o.categoria_id === id)
                  return (
                    <li key={concepto}>
                      <span className="text-sm-muted">{NOMBRE_CONCEPTO_COSTE[concepto]}</span>
                      <span>{cat ? cat.etiqueta : <span className="text-xs-muted">La que crea CLAUX</span>}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

// El mes en la zona del NEGOCIO (America/Havana), no en UTC: a partir de las 20:00 el
// `toISOString()` ya da la fecha de mañana, así que el último día del mes —justo la
// noche en que se cierra la nómina— el mes propuesto era el SIGUIENTE. Una sola
// fuente: `hoyISO()`, que sale de `lib/fecha-tz.ts`.
function mesActual(): string {
  return hoyISO().slice(0, 7)
}
function siguienteMes(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Modal: nueva nómina ──────────────────────────────────────────────────────────

function NuevaNominaModal({
  data, onClose, onSaved,
}: {
  data:    NominaPageData
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()

  // Solo combinaciones empresa→moneda que SÍ pueden generar nómina (empleados activos).
  // Así el usuario no "adivina": elige entre lo que de verdad tiene personal.
  const opciones = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of data.empleados) {
      if (e.estado !== 'ACTIVO') continue
      const arr = m.get(e.empresa_id) ?? []
      if (!arr.includes(e.moneda)) arr.push(e.moneda)
      m.set(e.empresa_id, arr)
    }
    return m
  }, [data.empleados])

  const empresasDisp = data.empresas.filter(e => opciones.has(e.empresa_id))
  const [empresaId, setEmpresaId] = useState(empresasDisp[0]?.empresa_id ?? '')
  const monedasDisp = (opciones.get(empresaId) ?? []).slice().sort()
  const [moneda, setMoneda]       = useState(monedasDisp[0] ?? '')

  // Sugerir el mes siguiente a la última nómina de la empresa (o el actual)
  const sugerir = (id: string) => {
    const ps = data.nominas.filter(n => n.empresa_id === id).map(n => n.periodo).sort()
    const last = ps[ps.length - 1]
    return last ? siguienteMes(last) : mesActual()
  }
  const [periodo, setPeriodo] = useState(sugerir(empresaId))

  function cambiarEmpresa(id: string) {
    setEmpresaId(id)
    const ms = (opciones.get(id) ?? []).slice().sort()
    setMoneda(ms[0] ?? '')
    setPeriodo(sugerir(id))
  }

  const duplicada = data.nominas.some(n => n.empresa_id === empresaId && n.periodo === periodo)
  const sinDatos  = empresasDisp.length === 0

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('empresa_id', empresaId)
    fd.set('moneda', moneda)
    const ld = toastLoading('Creando…')
    startTransition(async () => {
      const res = await crearNomina(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Nueva nómina</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        {sinDatos ? (
          <>
            <div className="modal-body">
              <div className="alert alert-warning">No hay empleados activos con salario en ninguna empresa. Da de alta personal (con su salario) antes de generar una nómina.</div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              <p className="modal-body-text">Se creará un borrador con todos los empleados activos de la empresa y moneda elegidas, listo para revisar.</p>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-3">
                  <label>Período <span className="required">*</span></label>
                  <input className="input" name="periodo" type="month" required value={periodo} onChange={e => setPeriodo(e.target.value)} />
                  {duplicada && <span className="input-hint input-hint-danger">Ya hay una nómina de este período para la empresa.</span>}
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Fecha <span className="required">*</span></label>
                  <input className="input" name="fecha" type="date" required defaultValue={hoyISO()} />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Empresa <span className="required">*</span></label>
                  {empresasDisp.length === 1 ? (
                    <input className="input input-static" readOnly value={empresasDisp[0].nombre} />
                  ) : (
                    <select className="input" value={empresaId} onChange={e => cambiarEmpresa(e.target.value)} required>
                      {empresasDisp.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
                    </select>
                  )}
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Moneda <span className="required">*</span></label>
                  {monedasDisp.length === 1 ? (
                    <input className="input input-static" readOnly value={monedasDisp[0]} />
                  ) : (
                    <select className="input" value={moneda} onChange={e => setMoneda(e.target.value)} required>
                      {monedasDisp.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                </div>
                <div className="input-group ter-col-full">
                  <label>Notas</label>
                  <input className="input" name="notas" placeholder="Quincena, observaciones…" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={isPending || !empresaId || !moneda || duplicada}>
                {isPending ? <><span className="spinner spinner-sm" /> Creando…</> : 'Crear borrador'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Confirmación eliminar nómina ─────────────────────────────────────────────────

function ConfirmEliminarNomina({
  nomina, onConfirm, onClose, isPending,
}: {
  nomina:    NominaConLineas
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Eliminar nómina</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            ¿Eliminar la nómina de <strong>{formatPeriodo(nomina.periodo)}</strong> ({formatMonto(nomina.total)} {nomina.moneda})?
            {/* «El gasto de salarios» era de cuando se escribía uno solo. Desde la
                mig. 166 una nómina confirmada deja hasta ocho apuntes —cada aporte y
                cada retención con su acreedor— y se revierten TODOS. */}
            {nomina.estado === 'CONFIRMADA' && ' También se revertirán todos los apuntes que generó en tu contabilidad.'}
          </p>
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

// ── Página: Nómina ───────────────────────────────────────────────────────────────

export default function NominaView({ data, puedeEditar }: { data: NominaPageData; puedeEditar: boolean }) {
  const router = useRouter()
  const { colorOf } = useEmpresas()
  const multiempresa = data.empresas.length > 1
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))
  const [isPending, startTransition] = useTransition()

  // La regla que se está creando/editando: el disparador es el botón del
  // `.page-header`, así que el estado no puede vivir dentro de `ReglasPanel`.
  const [editandoRegla, setEditandoRegla] = useState<ReglaDeduccion | 'nueva' | null>(null)

  // Disponible en BORRADOR y en CONFIRMADA: en borrador sirve para revisar el mes
  // antes de cerrarlo, que es justo cuando más falta hace.
  const [exportando, setExportando] = useState<string | null>(null)
  function exportar(n: NominaConLineas) {
    setExportando(n.nomina_id)
    const ld = toastLoading('Preparando el Excel…')
    startTransition(async () => {
      const res = await exportarNominaXlsx(n.nomina_id)
      await ld.dismiss()
      setExportando(null)
      if (!res.ok || !res.base64) { toastError(res.error ?? 'No se pudo exportar.'); return }
      descargarBase64(res.nombre ?? 'nomina.xlsx', res.base64, XLSX_MIME)
      toastSuccess('Excel descargado')
    })
  }
  const [modalNuevaNomina, setModalNuevaNomina] = useState(false)
  const [delNomina,        setDelNomina]        = useState<NominaConLineas | null>(null)

  // Los filtros viven en la URL, como en el resto del portal: volver del detalle de una
  // nómina ya no te devuelve a «todas las empresas».
  const params = useSearchParams()
  const filtroEmpresa = params.get('empresa') ?? ''
  const filtroAnio    = params.get('anio')    ?? ''

  // La pestaña vive en la URL, como en Reportes de Contabilidad: un enlace compartido
  // —o una recarga en mitad de configurar las reglas— caía siempre en «Nóminas».
  const tabUrl = params.get('tab')
  const tab: 'nominas' | 'reglas' | 'config' =
    tabUrl === 'reglas' || tabUrl === 'config' ? tabUrl : 'nominas'
  function setTab(t: string) {
    const url = new URLSearchParams(params.toString())
    if (t === 'nominas') url.delete('tab'); else url.set('tab', t)
    router.replace(`?${url.toString()}`, { scroll: false })
  }

  /**
   * LA DECLARACIÓN. El AÑO es la granularidad de esta pantalla —el período de una nómina
   * no son unos días sueltos— así que aquí no hay presets de rango, y a la descarga viaja
   * traducido a `desde`/`hasta`.
   *
   * El año va en `servidor`: acota EN LA CONSULTA, no en el navegador. Traerlas todas y
   * filtrar aquí es lo que hacía que esta pantalla cargara la historia entera de nómina
   * —con sus líneas y sus ítems— para pintar doce filas. La lista de años sale de una
   * consulta propia (`data.anios`), no de recorrer las traídas: con rango aplicado el
   * desplegable se quedaría sin los años que precisamente hay que poder elegir.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      clave: 'empresa_id', param: 'empresa', label: 'Todas',
      rotulo: 'Empresa',
      valor: filtroEmpresa, widget: 'pastillas', donde: 'cliente',
      ocultarSi: empresasFiltro.length <= 1,
      opciones: empresasFiltro.map(e => ({ valor: e.empresa_id, label: e.nombre, color: e.color })),
    },
    {
      // No es clave del contrato de exportación: el año se traduce a `desde`/`hasta` al
      // generar el filtro de la descarga. Aquí viaja solo en la URL.
      clave: 'anio', label: 'Todos los años', valor: filtroAnio,
      rotulo: 'Año',
      widget: 'select', donde: 'servidor', sinExportar: true,
      ocultarSi: data.anios.length <= 1,
      opciones: data.anios.map(a => ({ valor: a, label: a })),
    },
  ], [filtroEmpresa, filtroAnio, empresasFiltro, data.anios])

  // El año ya viene acotado por la consulta; aquí solo queda la empresa, que es `cliente`.
  const nominasFiltradas = useMemo(
    () => data.nominas.filter(n => !filtroEmpresa || n.empresa_id === filtroEmpresa),
    [data.nominas, filtroEmpresa])

  const { pageItems, ...pag } = usePagination(nominasFiltradas)

  // ── Selección múltiple (confirmar / eliminar en lote) ──
  const nominaIds = useMemo(() => nominasFiltradas.map(n => n.nomina_id), [nominasFiltradas])
  const sel = useRowSelection(nominaIds)
  const [confirmLoteConf, setConfirmLoteConf] = useState(false)
  const [confirmLoteDel,  setConfirmLoteDel]  = useState(false)
  useEffect(() => { sel.clear() }, [filtroEmpresa, filtroAnio]) // eslint-disable-line react-hooks/exhaustive-deps
  const plural = (n: number) => n === 1 ? '' : 's'
  const hayBorradores = nominasFiltradas.some(n => sel.isSelected(n.nomina_id) && n.estado === 'BORRADOR')
  // Las seleccionadas que de verdad se pueden actualizar: `actualizarConceptosNominas`
  // reabre las confirmadas, y con pagos hechos el servidor se niega — ofrecerlo sería
  // prometer algo que va a fallar.
  const desactualizadas = nominasFiltradas.filter(n =>
    sel.isSelected(n.nomina_id) && n.desactualizada
    && (n.estado === 'BORRADOR' || n.pagado <= 0.005))

  function ejecutarLote(fn: () => Promise<ResultadoLote>) {
    const ld = toastLoading('Procesando…')
    startTransition(async () => {
      const r = await fn()
      await ld.dismiss()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas)          partes.push(`${r.hechas} aplicada${plural(r.hechas)}`)
      if (r.omitidas.length) partes.push(`${r.omitidas.length} omitida${plural(r.omitidas.length)}`)
      if (r.errores.length)  partes.push(`${r.errores.length} con error`)
      const msg = partes.join(' · ') || 'Nada que hacer'
      if (r.hechas > 0 && r.errores.length === 0) toastSuccess(msg)
      else if (r.hechas > 0)                      toastError(msg)
      else                                        toastError(r.omitidas[0]?.motivo ? `Nada aplicado — ${r.omitidas[0].motivo}` : msg)
      sel.clear()
      router.refresh()
    })
  }
  function doConfirmarLote() { setConfirmLoteConf(false); ejecutarLote(() => confirmarNominasEnLote(sel.selectedIds)) }
  function doEliminarLote()  { setConfirmLoteDel(false);  ejecutarLote(() => eliminarNominasEnLote(sel.selectedIds)) }

  function onNominaCreada() { setModalNuevaNomina(false); router.refresh() }

  function doEliminarNomina() {
    if (!delNomina) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarNomina(delNomina.nomina_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelNomina(null); return }
      setDelNomina(null); router.refresh()
    })
  }

  return (
    <div className="view-container">

      <div className="page-header">
        <div>
          <h1 className="page-title">Nómina</h1>
          <p className="page-subtitle">Paga a tu personal y lleva el control de los salarios.</p>
        </div>
        <div className="tes-header-actions">
          {/* Solo en «Nóminas»: «Reglas» y «Configuración» no son listados de datos. */}
          {tab === 'nominas' && (
            <ExportarMenu
              clave="nominas"
              /* El año se traduce a rango: la descarga filtra por fecha, no por año. */
              filtro={filtroExport(declaracion, {
                desde: filtroAnio ? `${filtroAnio}-01-01` : '',
                hasta: filtroAnio ? `${filtroAnio}-12-31` : '',
              })}
              resumen={resumenDe(declaracion)}
            />
          )}
          {tab === 'nominas' && puedeEditar && (
            <button className="btn btn-primary" onClick={() => setModalNuevaNomina(true)} disabled={data.empresas.length === 0}>
              <Plus size={14} strokeWidth={2.5} /> Nueva nómina
            </button>
          )}
          {tab === 'reglas' && puedeEditar && (
            <button className="btn btn-primary" onClick={() => setEditandoRegla('nueva')}>
              <Plus size={14} strokeWidth={2.5} /> Nueva regla
            </button>
          )}
        </div>
      </div>

      {/* Dos cosas distintas: las nóminas de cada mes y CÓMO funciona la nómina de
          este negocio. La configuración vivía repartida por las fichas, que es lo
          que hacía que una regla del negocio se escribiera una vez por trabajador. */}
      <Tabs
        ariaLabel="Secciones de nómina"
        tabs={[
          { id: 'nominas', label: 'Nóminas', count: data.nominas.length },
          { id: 'reglas',  label: 'Reglas del negocio', count: data.reglas.length },
          { id: 'config',  label: 'Configuración' },
        ]}
        active={tab}
        // Al cambiar de pestaña se descarta la regla a medio abrir: el panel se
        // desmonta con el modal dentro, y sin esto volver a «Reglas» lo reabriría.
        onChange={(t) => { setEditandoRegla(null); setTab(t) }}
      />

      {data.empresas.length === 0 && (
        <PrerequisitoAviso acciones={[{ label: 'Crear empresa', href: '/portal/empresas' }]}>
          Para crear una nómina necesitas <strong>una empresa</strong>.
        </PrerequisitoAviso>
      )}

      {tab === 'reglas' && (
        <ReglasPanel data={data} editando={editandoRegla} setEditando={setEditandoRegla} puedeEditar={puedeEditar} />
      )}
      {tab === 'config' && <ConfigNominaPanel data={data} puedeEditar={puedeEditar} />}

      {tab === 'nominas' && (
      <>
      {/* Sin rango de fechas ni buscador: el período de una nómina es el AÑO, no unos días
          sueltos. El año acota EN LA CONSULTA (`donde: 'servidor'`). */}
      <Filtros filtros={declaracion} hayMas={data.hay_mas} />

      <div className="card card-table">
        {nominasFiltradas.length === 0 ? (
          <div className="mon-empty">
            <Wallet size={40} strokeWidth={1} opacity={0.2} />
            <p>{data.nominas.length === 0
              ? 'Aún no hay nóminas. Crea la primera para pagar a tu personal.'
              : 'No hay nóminas para los filtros seleccionados.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-check">
                    {puedeEditar && (
                      <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                    )}
                  </th>
                  <th>Período</th>
                  {multiempresa && <th>Empresa</th>}
                  <th>Empleados</th>
                  <th className="col-num">Total</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(n => (
                  <tr
                    key={n.nomina_id}
                    className={`table-row-clickable${multiempresa ? ' row-empresa-accent' : ''}`}
                    style={multiempresa ? empresaColorVar(colorOf(n.empresa_id)) : undefined}
                    onClick={() => router.push(`/portal/nomina/${n.nomina_id}`)}
                  >
                    <td className="col-check" onClick={e => e.stopPropagation()}>
                      {puedeEditar && (
                        <input type="checkbox" className="row-check"
                          checked={sel.isSelected(n.nomina_id)}
                          onChange={() => sel.toggle(n.nomina_id)}
                          aria-label={`Seleccionar nómina ${formatPeriodo(n.periodo)}`} />
                      )}
                    </td>
                    <td data-label="Período"><strong>{formatPeriodo(n.periodo)}</strong></td>
                    {multiempresa && (
                      <td data-label="Empresa">
                        <EmpresaTag color={colorOf(n.empresa_id)} nombre={data.empresa_nombres[n.empresa_id] ?? '—'} />
                      </td>
                    )}
                    <td data-label="Empleados" className="text-sm-muted">{n.lineas.length}</td>
                    <td data-label="Total" className="col-num tes-monto-cell">{formatMonto(n.total)} {n.moneda}</td>
                    <td data-label="Estado">
                      {/* Sin Contabilidad no hay Tesorería donde liquidar, así que
                          «Pendiente de pago» sería un estado que ese cliente no puede
                          apagar nunca. Los apuntes se escriben igual (independencia de
                          módulos); lo que no se le promete es un pago que no puede hacer. */}
                      <span className={`badge ${n.estado === 'BORRADOR' ? 'badge-warning' : (!data.tieneContabilidad || n.saldo_pendiente <= 0.005 ? 'badge-success' : 'badge-info')}`}>
                        {n.estado === 'BORRADOR'
                          ? 'Borrador'
                          : !data.tieneContabilidad ? 'Confirmada'
                          : (n.saldo_pendiente <= 0.005 ? 'Pagada' : 'Pendiente de pago')}
                      </span>
                      {/* El servidor ya marcaba `desactualizada` y el listado no lo
                          enseñaba: había que entrar nómina por nómina para descubrir
                          cuál no refleja los conceptos vigentes. */}
                      {n.desactualizada && (
                        <div><span className="badge badge-warning">Desactualizada</span></div>
                      )}
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => router.push(`/portal/nomina/${n.nomina_id}`)}><Eye size={15} strokeWidth={2} /> Ver detalle</button>
                        <button className="row-actions-item" onClick={() => exportar(n)} disabled={exportando === n.nomina_id}>
                          <Download size={15} strokeWidth={2} /> Exportar a Excel
                        </button>
                        <button className="row-actions-item row-actions-item-danger"
                          onClick={() => setDelNomina(n)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="nómina" />
      </div>
      {/* El techo dice CUÁNTAS faltan y las trae. Antes esta pantalla no tenía ninguno:
          traía la historia completa y el usuario no podía saber que la había traído. */}
      {data.hay_mas && (
        <AvisoTope mostrados={data.nominas.length} total={data.total} limite={data.limite}
          sustantivo="nóminas" femenino />
      )}
      </>
      )}

      {modalNuevaNomina && (
        <NuevaNominaModal data={data} onClose={() => setModalNuevaNomina(false)} onSaved={onNominaCreada} />
      )}
      {delNomina && (
        <ConfirmEliminarNomina nomina={delNomina} onConfirm={doEliminarNomina}
          onClose={() => setDelNomina(null)} isPending={isPending} />
      )}

      {puedeEditar && (
      <BulkBar count={sel.count} onClear={sel.clear}>
        {desactualizadas.length > 0 && (
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => actualizarConceptosNominas(desactualizadas, undefined, startTransition,
              () => { sel.clear(); router.refresh() })}>
            <RefreshCw size={14} strokeWidth={2} /> Actualizar {desactualizadas.length}
          </button>
        )}
        {hayBorradores && (
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => setConfirmLoteConf(true)}>
            <Check size={14} strokeWidth={2} /> Confirmar
          </button>
        )}
        <button className="btn btn-danger-text btn-sm" disabled={isPending}
          onClick={() => setConfirmLoteDel(true)}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      </BulkBar>
      )}

      {confirmLoteConf && (
        <ConfirmDialog
          title={`¿Confirmar ${sel.count} nómina${plural(sel.count)}?`}
          body="Se confirmarán las que estén en borrador y se registrarán sus apuntes en tu contabilidad, cada uno con su acreedor. Las ya confirmadas se omiten."
          confirmLabel="Confirmar"
          onCancel={() => setConfirmLoteConf(false)}
          onConfirm={doConfirmarLote}
        />
      )}
      {confirmLoteDel && (
        <ConfirmDialog
          title={`¿Eliminar ${sel.count} nómina${plural(sel.count)}?`}
          body="Se eliminarán las seleccionadas (y todos los apuntes de las confirmadas). Las que tengan pagos registrados en Tesorería se omitirán."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmLoteDel(false)}
          onConfirm={doEliminarLote}
        />
      )}
    </div>
  )
}

// ── Checkbox de cabecera (con estado indeterminado) ───────────────────────────

function HeaderCheck({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: () => void
}) {
  return (
    <input type="checkbox" className="row-check" checked={checked}
      ref={el => { if (el) el.indeterminate = indeterminate }}
      onChange={onChange} aria-label="Seleccionar todo" />
  )
}
