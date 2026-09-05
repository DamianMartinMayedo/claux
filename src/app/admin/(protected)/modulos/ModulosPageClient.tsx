'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import EditarModuloModal from './EditarModuloModal'
import NuevoModuloModal  from './NuevoModuloModal'
import SembrarColumnaModal from './SembrarColumnaModal'
import CatalogoTabs from '@/components/admin/CatalogoTabs'
import FilterPills from '@/components/portal/FilterPills'
import { RowActions } from '@/components/portal/RowActions'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { reordenarModulos, archivarModulo, eliminarModulo } from '@/app/actions/modulos'
import { useToast } from '@/app/contexts/ToastContext'
import { NIVELES, precioModulo, type Nivel } from '@/lib/niveles'
import { MONEDAS_CLAUX, importeClaux, type MonedaClaux } from '@/lib/moneda-claux'

const TIPO_LABEL: Record<string, string> = {
  base:          'Base',
  modulo:        'Módulo',
  funcionalidad: 'Funcionalidad',
  addon:         'Addon',
}
// Variantes de la familia `.badge` del design system, un tono por tipo.
const TIPO_BADGE: Record<string, string> = {
  base:          'badge-info',
  modulo:        'badge-success',
  funcionalidad: 'badge-purple',
  addon:         'badge-warning',
}

type Pagina = { ruta: string; label: string; orden: number }

// La rejilla del catálogo son SEIS precios (tres niveles × dos monedas, mig. 225),
// pero la tabla enseña tres: seis columnas de cifras al lado de nombre, tipo,
// páginas y estado no se barren con la vista. La moneda se elige arriba y el
// símbolo de cada celda la confirma. Comparar las dos monedas de un módulo se
// hace donde importa —el modal de edición, que las tiene las seis juntas.
const MONEDA_PILLS = MONEDAS_CLAUX.map(m => ({ id: m, label: m }))

export type Modulo = {
  clave: string
  nombre: string
  descripcion: string | null
  /** El «por qué le sirve» y la variante de dos líneas, los dos de la propuesta. */
  beneficio: string | null
  resumen: string | null
  tipo: string
  precio_inicial_usd: number
  precio_empresa_usd: number
  precio_pro_usd: number
  precio_inicial_eur: number
  precio_empresa_eur: number
  precio_pro_eur: number
  es_base: boolean
  activo: boolean
  orden: number
  paginas?: Pagina[] | null
}

function countPaginas(paginas: Pagina[] | null | undefined): number {
  if (Array.isArray(paginas)) return paginas.length
  // Intenta parsear si viene como string JSON (caso borde de Supabase)
  if (typeof paginas === 'string') {
    try { const arr = JSON.parse(paginas); return Array.isArray(arr) ? arr.length : 0 }
    catch { return 0 }
  }
  return 0
}

export default function ModulosPageClient(
  { modulos: initial, nombresNivel }: { modulos: Modulo[]; nombresNivel: Record<Nivel, string> },
) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError, loading: toastLoading } = useToast()
  const [modulos, setModulos] = useState<Modulo[]>(() => initial.map(m => ({ ...m })))

  // Sincroniza con las props cuando el servidor manda datos nuevos (router.refresh
  // tras reordenar/editar/archivar/eliminar): el inicializador de useState solo
  // corre al montar, así que sin esto la lista mostraría datos viejos.
  const [prevInitial, setPrevInitial] = useState(initial)
  if (initial !== prevInitial) {
    setPrevInitial(initial)
    setModulos(initial.map(m => ({ ...m })))
  }

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const movedRef = useRef(false)
  const orderRef = useRef<string[]>([])
  const [editing, setEditing] = useState<Modulo | null>(null)
  const [confirmarBorrado, setConfirmarBorrado] = useState<Modulo | null>(null)
  const [moneda, setMoneda] = useState<MonedaClaux>('USD')

  function handleDragStart(index: number) { setDragIndex(index); movedRef.current = false }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    const reordered = [...modulos]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(index, 0, moved)
    setModulos(reordered)
    orderRef.current = reordered.map(m => m.clave)
    setDragIndex(index)
    movedRef.current = true
  }

  // Auto-guardar al soltar: si el orden cambió, persiste sin botón extra.
  async function handleDragEnd() {
    setDragIndex(null)
    if (!movedRef.current) return
    movedRef.current = false
    const ld = toastLoading('Guardando orden…')
    const res = await reordenarModulos(orderRef.current)
    await ld.dismiss()
    if (!res.ok) { toastError('No se pudo guardar el orden'); return }
    toastSuccess('Orden guardado')
    router.refresh()
  }

  async function handleArchivar(m: Modulo, archivar: boolean) {
    const res = await archivarModulo(m.clave, archivar)
    if (!res.ok) { toastError(res.error ?? 'Error al archivar'); return }
    toastSuccess(archivar ? 'Módulo archivado' : 'Módulo reactivado')
    router.refresh()
  }

  // Confirmación in-app (ConfirmDialog, patrón de la plataforma), centralizada
  // en el padre para no anidar el modal dentro del menú de acciones de la fila.
  async function doEliminar(m: Modulo) {
    setConfirmarBorrado(null)
    const res = await eliminarModulo(m.clave)
    if (!res.ok) { toastError(res.error ?? 'Error al eliminar'); return }
    toastSuccess(`${TIPO_LABEL[m.tipo] ?? 'Módulo'} eliminado`)
    router.refresh()
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Catálogo de módulos</h1>
          <p className="page-subtitle">
            Qué se vende y a qué precio en cada nivel. Arrastra para reordenar (se guarda solo).
            Cambiar un precio recalcula la cuota de quien tenga el módulo: antes de guardar se dice a quién.
          </p>
        </div>
        <div className="page-header-acciones">
          <SembrarColumnaModal nombresNivel={nombresNivel} />
          <NuevoModuloModal nombresNivel={nombresNivel} />
        </div>
      </div>

      <CatalogoTabs />

      <div className="ter-toolbar">
        <FilterPills
          items={MONEDA_PILLS}
          value={moneda}
          onChange={id => setMoneda(id as MonedaClaux)}
          ariaLabel="Moneda de los precios"
          sinTodas
        />
      </div>

      <div className="card card-table">
        <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th className="mod-col-drag"></th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Páginas</th>
              {NIVELES.map(n => <th className="col-num" key={n}>{nombresNivel[n]}</th>)}
              <th>Estado</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {modulos.map((m, i) => (
              <tr
                key={m.clave}
                className={dragIndex === i ? 'mod-row-dragging' : ''}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragEnd={handleDragEnd}
              >
                <td className="mod-drag-cell">
                  <span className="mod-drag-handle" title="Arrastrar para reordenar">⠿</span>
                </td>
                <td data-label="Nombre">
                  <span className="table-empresa cell-clamp">{m.nombre}</span>
                </td>
                <td data-label="Tipo">
                  {/* Familia canónica `.badge`: sin fondo dentro de la tabla. La antigua
                      `.mod-tipo-badge` estaba definida DOS veces (05-admin-paginas y
                      07-ventas-actividad) con fondos distintos, ganando la segunda. */}
                  <span className={`badge ${TIPO_BADGE[m.tipo] ?? 'badge-neutral'}`}>
                    {TIPO_LABEL[m.tipo] ?? m.tipo}
                  </span>
                </td>
                <td data-label="Páginas">{countPaginas(m.paginas) || '—'}</td>
                {NIVELES.map(n => (
                  <td data-label={nombresNivel[n]} className="col-num table-price" key={n}>
                    {importeClaux(precioModulo(m, n, moneda), moneda)}
                  </td>
                ))}
                <td data-label="Estado">
                  <span className={`badge ${m.activo ? 'badge-success' : 'badge-neutral'}`}>
                    {m.activo ? 'Activo' : 'Archivado'}
                  </span>
                </td>
                <td className="col-actions">
                  <RowActions>
                    <button className="row-actions-item" onClick={() => setEditing(m)}>
                      <Pencil size={15} strokeWidth={2} /> Editar
                    </button>
                    {!m.es_base && (m.activo ? (
                      <button className="row-actions-item" onClick={() => handleArchivar(m, true)}>
                        <Archive size={15} strokeWidth={2} /> Archivar
                      </button>
                    ) : (
                      <button className="row-actions-item row-actions-item-success" onClick={() => handleArchivar(m, false)}>
                        <ArchiveRestore size={15} strokeWidth={2} /> Reactivar
                      </button>
                    ))}
                    {!m.es_base && (
                      <button className="row-actions-item row-actions-item-danger" onClick={() => setConfirmarBorrado(m)}>
                        <Trash2 size={14} strokeWidth={2} /> Eliminar
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

      {editing && (
        <EditarModuloModal modulo={editing} nombresNivel={nombresNivel} open onClose={() => setEditing(null)} />
      )}

      {confirmarBorrado && (
        <ConfirmDialog
          title={`¿Eliminar "${confirmarBorrado.nombre}"?`}
          body="Esta acción no se puede deshacer. Si solo quieres dejar de ofrecerlo, archívalo en su lugar."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmarBorrado(null)}
          onConfirm={() => doEliminar(confirmarBorrado)}
        />
      )}
    </div>
  )
}
