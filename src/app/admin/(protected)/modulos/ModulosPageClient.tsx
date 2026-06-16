'use client'

import { useState } from 'react'
import EditarModuloModal from './EditarModuloModal'
import NuevoModuloModal  from './NuevoModuloModal'
import { reordenarModulos } from '@/app/actions/modulos'
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
  const [modulos, setModulos] = useState<Modulo[]>(() => initial.map(m => ({ ...m })))
  const { success: toastSuccess, loading: toastLoading } = useToast()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [hasDragged, setHasDragged] = useState(false)

  function handleDragStart(index: number) { setDragIndex(index) }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    const reordered = [...modulos]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(index, 0, moved)
    setModulos(reordered)
    setDragIndex(index)
    setHasDragged(true)
  }
  function handleDragEnd() { setDragIndex(null) }

  async function saveOrder() {
    const ld = toastLoading('Guardando orden…')
    setSaving(true)
    await reordenarModulos(modulos.map(m => m.clave))
    setHasDragged(false)
    setSaving(false)
    await ld.dismiss()
    toastSuccess('Orden guardado')
  }

  const showSave = hasDragged && !saving

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Catálogo de módulos</h1>
          <p className="page-subtitle">
            Gestiona módulos y funcionalidades. Arrastra para reordenar. Edita para cambiar precios y páginas internas.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {showSave && (
            <button className="btn btn-secondary" onClick={saveOrder} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar orden'}
            </button>
          )}
          <NuevoModuloModal />
        </div>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th className="mod-col-drag"></th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Páginas</th>
              <th className="text-right">Fundador</th>
              <th className="text-right">Estándar</th>
              <th>Activo</th>
              <th className="mod-col-act"></th>
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
                <td>
                  <span className="table-empresa">{m.nombre}</span>
                </td>
                <td>
                  <span className={`mod-tipo-badge mod-tipo-${m.tipo === 'funcionalidad' ? 'func' : m.tipo === 'addon' ? 'addon' : m.tipo}`}>
                    {TIPO_LABEL[m.tipo] ?? m.tipo}
                  </span>
                </td>
                <td>{countPaginas(m.paginas) || '—'}</td>
                <td className="table-price text-right">${Number(m.precio_fundador_usd).toFixed(2)}</td>
                <td className="table-price text-right">${Number(m.precio_estandar_usd).toFixed(2)}</td>
                <td>
                  <span className={`badge ${m.activo ? 'badge-success' : 'badge-neutral'}`}>
                    {m.activo ? 'Sí' : 'No'}
                  </span>
                </td>
                <td>
                  <EditarModuloModal modulo={m} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
