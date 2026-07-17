'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import EditarModuloModal from './EditarModuloModal'
import NuevoModuloModal  from './NuevoModuloModal'
import { RowActions } from '@/components/portal/RowActions'
import { reordenarModulos, archivarModulo, eliminarModulo } from '@/app/actions/modulos'
import { useToast } from '@/app/contexts/ToastContext'

const TIPO_LABEL: Record<string, string> = {
  base:          'Base',
  modulo:        'Módulo',
  funcionalidad: 'Funcionalidad',
  addon:         'Addon',
}

type Pagina = { ruta: string; label: string; orden: number }

export type Modulo = {
  clave: string
  nombre: string
  descripcion: string | null
  tipo: string
  precio_fundador_usd: number
  precio_estandar_usd: number
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

export default function ModulosPageClient({ modulos: initial }: { modulos: Modulo[] }) {
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

  async function handleEliminar(m: Modulo) {
    if (!window.confirm(`¿Eliminar el módulo "${m.nombre}"? Esta acción no se puede deshacer.`)) return
    const res = await eliminarModulo(m.clave)
    if (!res.ok) { toastError(res.error ?? 'Error al eliminar'); return }
    toastSuccess('Módulo eliminado')
    router.refresh()
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Catálogo de módulos</h1>
          <p className="page-subtitle">
            Gestiona módulos y funcionalidades. Arrastra para reordenar (se guarda solo).
            Edita para cambiar precios y páginas internas.
          </p>
        </div>
        <NuevoModuloModal />
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
              <th className="col-num">Fundador</th>
              <th className="col-num">Estándar</th>
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
                  <span className="table-empresa">{m.nombre}</span>
                </td>
                <td data-label="Tipo">
                  <span className={`mod-tipo-badge mod-tipo-${m.tipo === 'funcionalidad' ? 'func' : m.tipo === 'addon' ? 'addon' : m.tipo}`}>
                    {TIPO_LABEL[m.tipo] ?? m.tipo}
                  </span>
                </td>
                <td data-label="Páginas">{countPaginas(m.paginas) || '—'}</td>
                <td data-label="Fundador" className="col-num table-price">${Number(m.precio_fundador_usd).toFixed(2)}</td>
                <td data-label="Estándar" className="col-num table-price">${Number(m.precio_estandar_usd).toFixed(2)}</td>
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
                      <button className="row-actions-item row-actions-item-danger" onClick={() => handleEliminar(m)}>
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
        <EditarModuloModal modulo={editing} open onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
