'use client'

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter, useSearchParams }        from 'next/navigation'
import { Archive, Pencil, Plus, RotateCcw, Warehouse, X } from 'lucide-react'
import {
  guardarAlmacen,
  archivarAlmacen,
  restaurarAlmacen,
  resumenAlmacen,
  type Almacen,
  type TipoAlmacen,
  type AlmacenesPageData,
} from '@/app/actions/portal/almacenes'
import Link                          from 'next/link'
import { fmtValor }                  from '@/lib/inventario/valoracion'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { RowActions }                  from '@/components/portal/RowActions'
import PrerequisitoAviso               from '@/components/portal/PrerequisitoAviso'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import ExportarMenu from '@/components/portal/ExportarMenu'
import Filtros                         from '@/components/portal/Filtros'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPOS: TipoAlmacen[] = ['FISICO', 'VIRTUAL', 'TRANSITO', 'CONSIGNACION']

const TIPO_ALMACEN_LABEL: Record<TipoAlmacen, string> = {
  FISICO:       'Físico',
  VIRTUAL:      'Virtual',
  TRANSITO:     'Tránsito',
  CONSIGNACION: 'Consignación',
}

const TIPO_ALMACEN_DESC: Record<TipoAlmacen, string> = {
  FISICO:       'Ubicación física real: nave, tienda, depósito',
  VIRTUAL:      'Stock asignado a una empresa sin ubicación física propia',
  TRANSITO:     'Mercancía en camino o entrega directa al cliente (drop-shipping)',
  CONSIGNACION: 'Mercancía de terceros en custodia — tratamiento fiscal diferente',
}

const TIPO_BADGE: Record<TipoAlmacen, string> = {
  FISICO:       'badge-info',
  VIRTUAL:      'badge-purple',
  TRANSITO:     'badge-warning',
  CONSIGNACION: 'badge-success',
}

// ── Modal de formulario ───────────────────────────────────────────────────────

function AlmacenModal({
  almacen, empresas, onClose, onSaved,
}: {
  almacen:  Almacen | null
  empresas: { empresa_id: string; nombre: string }[]
  onClose:  () => void
  onSaved:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [tipo,      setTipo]         = useState<TipoAlmacen>(almacen?.tipo ?? 'FISICO')

  const isEdit = !!almacen

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('tipo', tipo)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarAlmacen(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>

        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar almacén' : 'Nuevo almacén'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {almacen && <input type="hidden" name="almacen_id" value={almacen.almacen_id} />}

          <div className="modal-body">

            {/* ── Tipo ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Tipo de almacén</span>
              <div className="alm-tipo-grid">
                {TIPOS.map(t => (
                  <button key={t} type="button"
                    onClick={() => setTipo(t)}
                    className={`alm-tipo-btn${tipo === t ? ' active' : ''}`}>
                    <span className={`badge ${TIPO_BADGE[t]}`}>
                      {TIPO_ALMACEN_LABEL[t]}
                    </span>
                    <span className="text-xs-hint">
                      {TIPO_ALMACEN_DESC[t]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Datos ── */}
            <div className="ter-form-section mb-0">
              <span className="ter-form-section-title">Datos del almacén</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-4">
                  <label>Nombre <span className="required">*</span></label>
                  <input className="input" name="nombre" required autoFocus={!isEdit}
                    defaultValue={almacen?.nombre ?? ''}
                    placeholder="Ej: Almacén Central, Tienda Principal…" />
                </div>
                <div className="input-group ter-col-span-2">
                  <label>Empresa <span className="required">*</span></label>
                  {empresas.length === 1 ? (
                    <>
                      <input className="input input-static" readOnly value={empresas[0].nombre} />
                      <input type="hidden" name="empresa_id" value={empresas[0].empresa_id} />
                    </>
                  ) : (
                    <select className="input" name="empresa_id"
                      defaultValue={almacen?.empresa_id ?? ''} required>
                      <option value="">Selecciona una empresa…</option>
                      {empresas.map(e => (
                        <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="input-group ter-col-full">
                  <label>Descripción</label>
                  <textarea className="input input-textarea" name="descripcion" rows={2}
                    defaultValue={almacen?.descripcion ?? ''}
                    placeholder="Ubicación, características o notas del almacén…" />
                </div>
              </div>
            </div>

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear almacén'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Confirmación archivar ─────────────────────────────────────────────────────

function ConfirmArchivar({
  almacen, onConfirm, onClose, isPending,
}: {
  almacen:   Almacen
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  const [contenido, setContenido] = useState<{ referencias: number; unidades: number } | null>(null)
  useEffect(() => {
    let vivo = true
    resumenAlmacen(almacen.almacen_id).then(r => { if (vivo) setContenido(r) })
    return () => { vivo = false }
  }, [almacen.almacen_id])

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Archivar almacén</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            ¿Archivar <strong>{almacen.nombre}</strong>? No aparecerá en listas activas
            pero podrás restaurarlo cuando lo necesites.
          </p>
          {/* Archivar un almacén con mercancía dentro no se prohíbe, pero tiene que
              decirse: sus existencias siguen sumando en el total de cada producto
              mientras el almacén desaparece de movimientos, ajustes y compras. */}
          {contenido === null ? (
            <p className="modal-body-text text-xs-muted">Comprobando qué hay dentro…</p>
          ) : contenido.referencias > 0 && (
            <div className="alert alert-warning">
              <strong>{contenido.referencias} {contenido.referencias === 1 ? 'referencia' : 'referencias'}</strong>
              {' '}y {contenido.unidades.toLocaleString('es-ES')} unidades siguen dentro.
              Al archivarlo dejarás de verlo en movimientos, ajustes y compras, pero esas
              existencias seguirán contando en el total de cada producto. Transfiérelas antes
              si quieres que el total cuadre.
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isPending}>
            {isPending
              ? <><span className="spinner spinner-sm" /> Archivando…</>
              : 'Archivar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function AlmacenesView({ data }: { data: AlmacenesPageData }) {
  const router = useRouter()
  const { colorOf } = useEmpresas()
  const multiempresa = data.empresas.length > 1
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))
  const [isPending, startTransition] = useTransition()

  const [modalOpen,   setModalOpen]   = useState(false)
  const [editAlmacen, setEditAlmacen] = useState<Almacen | null>(null)
  const [confirmAlm,  setConfirmAlm]  = useState<Almacen | null>(null)

  const activos    = data.almacenes.filter(a =>  a.activo).length
  const archivados = data.almacenes.filter(a => !a.activo).length

  // Los filtros viven en la URL, como en el resto del portal: volver de la ficha de un
  // almacén ya no te devuelve a «todos».
  const params = useSearchParams()
  const filtroEmpresa = params.get('empresa') ?? ''
  const filtroTipo    = params.get('tipo')    ?? ''
  const verArchivados = params.get('archivadas') === '1'

  /**
   * LA DECLARACIÓN. Todos en `cliente` y es correcto: los almacenes son una tabla maestra
   * pequeña que se trae entera, así que filtrar en el navegador no puede quedarse corto.
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
      clave: 'tipo', label: 'Todos los tipos', valor: filtroTipo,
      rotulo: 'Tipo',
      widget: 'select', donde: 'cliente',
      opciones: TIPOS.map(t => ({ valor: t, label: TIPO_ALMACEN_LABEL[t] })),
    },
    {
      clave: 'archivadas',
      label: archivados > 0 ? `Archivados (${archivados})` : 'Archivados',
      valor: verArchivados ? '1' : '', widget: 'toggle', donde: 'cliente',
    },
  ], [filtroEmpresa, filtroTipo, verArchivados, empresasFiltro, archivados])

  const almacenesFiltrados = useMemo(() => {
    return data.almacenes.filter(a => {
      if (a.activo === verArchivados)                        return false
      if (filtroEmpresa && a.empresa_id !== filtroEmpresa)   return false
      if (filtroTipo    && a.tipo       !== filtroTipo)       return false
      return true
    })
  }, [data.almacenes, filtroEmpresa, filtroTipo, verArchivados])

  function openCreate()           { setEditAlmacen(null); setModalOpen(true) }
  function openEdit(a: Almacen)   { setEditAlmacen(a);   setModalOpen(true) }
  function closeModal()           { setModalOpen(false);  setEditAlmacen(null) }
  function onSaved()              { closeModal(); router.refresh() }

  // Archivar y restaurar SON escrituras: llevan su carga y su resultado como cualquier
  // otra. Iban mudas y además se tragaban el `{ ok, error }`, así que un fallo
  // —permisos, dependencias— se veía como «no ha pasado nada».
  function handleRestaurar(a: Almacen) {
    const ld = toastLoading('Restaurando…')
    startTransition(async () => {
      const r = await restaurarAlmacen(a.almacen_id)
      await ld.dismiss()
      if (!r?.ok) { toastError(r?.error ?? 'No se pudo restaurar.'); return }
      toastSuccess(`«${a.nombre}» vuelve a estar activo`)
      router.refresh()
    })
  }

  function confirmarArchivar() {
    if (!confirmAlm) return
    const alm = confirmAlm
    const ld = toastLoading('Archivando…')
    startTransition(async () => {
      const r = await archivarAlmacen(alm.almacen_id)
      await ld.dismiss()
      if (!r?.ok) { toastError(r?.error ?? 'No se pudo archivar.'); return }
      toastSuccess(`«${alm.nombre}» archivado`)
      setConfirmAlm(null)
      router.refresh()
    })
  }

  // Resumen del conjunto. Las cuatro tarjetas contaban «almacenes por tipo», que es
  // el número menos útil que se puede enseñar: nadie entra aquí a saber cuántos
  // almacenes virtuales tiene, sino cuánto hay guardado y cuánto vale.
  const totales = useMemo(() => {
    const vivos = data.almacenes.filter(a => a.activo)
    let referencias = 0, unidades = 0, alertas = 0
    const porMoneda = new Map<string, number>()
    for (const a of vivos) {
      const r = data.resumen[a.almacen_id]
      if (!r) continue
      referencias += r.referencias
      unidades    += r.unidades
      alertas     += r.alertas
      for (const v of r.valor) porMoneda.set(v.moneda, (porMoneda.get(v.moneda) ?? 0) + v.valor)
    }
    return { referencias, unidades, alertas, valor: [...porMoneda].map(([moneda, valor]) => ({ moneda, valor })) }
  }, [data.almacenes, data.resumen])

  return (
    <div className="view-container">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Almacenes</h1>
          <p className="page-subtitle">Lugares donde guardas y controlas tus existencias.</p>
        </div>
        <div className="tes-header-actions">
          <ExportarMenu
            clave="almacenes"
            filtro={filtroExport(declaracion)}
            resumen={resumenDe(declaracion)}
          />
          <button className="btn btn-primary" onClick={openCreate} disabled={data.empresas.length === 0}>
            <Plus size={14} strokeWidth={2.5} /> Nuevo almacén
          </button>
        </div>
      </div>

      {data.empresas.length === 0 && (
        <PrerequisitoAviso acciones={[{ label: 'Crear empresa', href: '/portal/empresas' }]}>
          Para crear almacenes necesitas <strong>una empresa</strong>.
        </PrerequisitoAviso>
      )}

      {/* ── Qué guardas, no cuántos almacenes de cada tipo tienes ── */}
      {activos > 0 && (
        <div className="alm-stats-grid">
          <div className="alm-stat-card">
            <div className="alm-stat-count">{totales.referencias}</div>
            <div className="alm-stat-label">referencias con existencias</div>
          </div>
          <div className="alm-stat-card">
            <div className="alm-stat-count">{totales.unidades.toLocaleString('es-ES')}</div>
            <div className="alm-stat-label">unidades</div>
          </div>
          <div className="alm-stat-card">
            <div className="alm-stat-count alm-stat-valor">
              {totales.valor.length === 0
                ? <span className="text-faint">—</span>
                : totales.valor.map(v => (
                    <span key={v.moneda} className="alm-valor-chip">{fmtValor(v.valor, v.moneda)}</span>
                  ))}
            </div>
            <div className="alm-stat-label">valor del inventario</div>
          </div>
          <div className="alm-stat-card">
            <div className={`alm-stat-count${totales.alertas > 0 ? ' alm-stat-count-alerta' : ''}`}>{totales.alertas}</div>
            <div className="alm-stat-label">bajo mínimo</div>
          </div>
        </div>
      )}

      {/* Sin rango ni buscador: los almacenes son un catálogo corto, no un histórico. */}
      <Filtros filtros={declaracion} />

      {/* ── Tabla ── */}
      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">
            {verArchivados ? 'Almacenes archivados' : 'Almacenes activos'}
          </h2>
          <span className="text-xs-muted">
            {almacenesFiltrados.length} de {verArchivados ? archivados : activos}
          </span>
        </div>

        {almacenesFiltrados.length === 0 ? (
          <div className="mon-empty">
            <Warehouse size={40} strokeWidth={1} opacity={0.2} />
            <p>
              {data.almacenes.length === 0
                ? 'Aún no hay almacenes registrados. Crea el primero para gestionar tu inventario.'
                : 'No hay resultados para los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  {multiempresa && <th>Empresa</th>}
                  <th>Tipo</th>
                  <th className="col-num">Referencias</th>
                  <th className="col-num">Unidades</th>
                  <th className="col-num">Valor</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {almacenesFiltrados.map(a => {
                  const r = data.resumen[a.almacen_id]
                  return (
                  <tr
                    key={a.almacen_id}
                    className={`table-row-clickable${!a.activo ? ' ter-row-archivada' : ''}${multiempresa ? ' row-empresa-accent' : ''}`}
                    style={multiempresa ? empresaColorVar(colorOf(a.empresa_id)) : undefined}
                    onClick={() => router.push(`/portal/almacenes/${a.almacen_id}`)}
                  >

                    {/* Se retira el ALM-XXXX: ninguna otra tabla del portal enseña el
                        código interno, y ocupaba el sitio de un dato que sí importa. */}
                    <td data-label="Nombre">
                      <Link href={`/portal/almacenes/${a.almacen_id}`} className="table-name-link cell-clamp"
                        onClick={e => e.stopPropagation()}>
                        {a.nombre}
                      </Link>
                      {a.descripcion && <div className="table-cell-sub">{a.descripcion}</div>}
                    </td>

                    {multiempresa && (
                      <td data-label="Empresa">
                        <EmpresaTag color={colorOf(a.empresa_id)} nombre={data.empresa_nombres[a.empresa_id] ?? a.empresa_id} />
                      </td>
                    )}

                    <td data-label="Tipo">
                      <span className={`badge ${TIPO_BADGE[a.tipo]}`}>
                        {TIPO_ALMACEN_LABEL[a.tipo]}
                      </span>
                    </td>

                    <td data-label="Referencias" className="col-num">
                      {r?.referencias ?? 0}
                      {(r?.alertas ?? 0) > 0 && <span className="text-xs-hint"> · {r!.alertas} bajo mín.</span>}
                    </td>

                    <td data-label="Unidades" className="col-num">
                      {(r?.unidades ?? 0).toLocaleString('es-ES')}
                    </td>

                    <td data-label="Valor" className="col-num alm-col-valor">
                      {!r || r.valor.length === 0
                        ? <span className="text-faint">—</span>
                        : r.valor.map(v => <div key={v.moneda}>{fmtValor(v.valor, v.moneda)}</div>)}
                    </td>

                    <td data-label="Estado">
                      <span className={`badge ${a.activo ? 'badge-success' : 'badge-neutral'}`}>
                        {a.activo ? 'Activo' : 'Archivado'}
                      </span>
                    </td>

                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item"
                          onClick={() => router.push(`/portal/almacenes/${a.almacen_id}`)}>
                          <Warehouse size={15} strokeWidth={2} /> Ver contenido
                        </button>
                        {a.activo ? (
                          <>
                            <button className="row-actions-item" onClick={() => openEdit(a)}>
                              <Pencil size={15} strokeWidth={2} /> Editar
                            </button>
                            <button className="row-actions-item row-actions-item-danger"
                              onClick={() => setConfirmAlm(a)} disabled={isPending}>
                              <Archive size={15} strokeWidth={2} /> Archivar
                            </button>
                          </>
                        ) : (
                          <button className="row-actions-item"
                            onClick={() => handleRestaurar(a)} disabled={isPending}>
                            <RotateCcw size={15} strokeWidth={2} /> Restaurar
                          </button>
                        )}
                      </RowActions>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modales ── */}
      {modalOpen && (
        <AlmacenModal
          almacen={editAlmacen}
          empresas={data.empresas}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}
      {confirmAlm && (
        <ConfirmArchivar
          almacen={confirmAlm}
          onConfirm={confirmarArchivar}
          onClose={() => setConfirmAlm(null)}
          isPending={isPending}
        />
      )}
    </div>
  )
}

