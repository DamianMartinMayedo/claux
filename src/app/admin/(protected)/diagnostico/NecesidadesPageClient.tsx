'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import NecesidadModal, { type ModuloLite, type Necesidad } from './NecesidadModal'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { eliminarNecesidad, reordenarNecesidades } from '@/app/actions/diagnostico-necesidades'
import { useToast } from '@/app/contexts/ToastContext'

export type { ModuloLite, Necesidad }

export default function NecesidadesPageClient({
  necesidades: initial,
  modulos,
}: {
  necesidades: Necesidad[]
  modulos: ModuloLite[]
}) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError, loading: toastLoading } = useToast()
  const [necesidades, setNecesidades] = useState<Necesidad[]>(() => initial.map((n) => ({ ...n })))
  // Sincroniza con las props cuando el servidor manda datos nuevos (router.refresh
  // tras crear/editar/eliminar): el inicializador de useState solo corre al montar,
  // así que sin esto la lista mostraba datos viejos aunque el guardado sí persistía.
  const [prevInitial, setPrevInitial] = useState(initial)
  if (initial !== prevInitial) {
    setPrevInitial(initial)
    setNecesidades(initial.map((n) => ({ ...n })))
  }
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [hasDragged, setHasDragged] = useState(false)
  const [confirmarBorrado, setConfirmarBorrado] = useState<Necesidad | null>(null)

  const nombreModulo = new Map(modulos.map((m) => [m.clave, m.nombre]))

  function handleDragStart(index: number) { setDragIndex(index) }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    const reordered = [...necesidades]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(index, 0, moved)
    setNecesidades(reordered)
    setDragIndex(index)
    setHasDragged(true)
  }
  function handleDragEnd() { setDragIndex(null) }

  async function saveOrder() {
    const ld = toastLoading('Guardando orden…')
    setSaving(true)
    await reordenarNecesidades(necesidades.map((n) => n.clave))
    setHasDragged(false)
    setSaving(false)
    await ld.dismiss()
    toastSuccess('Orden guardado')
    router.refresh()
  }

  // Confirmación in-app (ConfirmDialog, patrón de la plataforma), centralizada
  // en el padre para no anidar el modal dentro de la fila.
  async function doEliminar(n: Necesidad) {
    setConfirmarBorrado(null)
    const res = await eliminarNecesidad(n.clave)
    if (!res.ok) { toastError(res.error ?? 'Error al eliminar'); return }
    setNecesidades((prev) => prev.filter((x) => x.clave !== n.clave))
    toastSuccess('Necesidad eliminada')
    router.refresh()
  }

  const showSave = hasDragged && !saving

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Necesidades del diagnóstico</h1>
          <p className="page-subtitle">
            Las opciones del paso «¿Qué necesitas?». En lenguaje del cliente; cada una recomienda
            uno o varios módulos. Arrastra para reordenar.
          </p>
        </div>
        <div className="dgn-header-actions">
          {showSave && (
            <button className="btn btn-secondary" onClick={saveOrder} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar orden'}
            </button>
          )}
          <NecesidadModal modulos={modulos} />
        </div>
      </div>

      {necesidades.length === 0 ? (
        <div className="dgn-empty">
          <p>No hay necesidades configuradas. Crea la primera para que aparezca en el diagnóstico.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th className="mod-col-drag"></th>
                <th>Necesidad</th>
                <th>Recomienda</th>
                <th>Estado</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {necesidades.map((n, i) => {
                return (
                  <tr
                    key={n.clave}
                    className={dragIndex === i ? 'mod-row-dragging' : ''}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragEnd={handleDragEnd}
                  >
                    <td className="mod-drag-cell">
                      <span className="mod-drag-handle" title="Arrastrar para reordenar">⠿</span>
                    </td>
                    <td data-label="Necesidad">
                      <div className="dgn-need-cell">
                        <div>
                          <span className="table-empresa">{n.etiqueta}</span>
                          {n.descripcion && <div className="dgn-need-desc">{n.descripcion}</div>}
                        </div>
                      </div>
                    </td>
                    <td data-label="Recomienda">
                      <div className="dgn-chips">
                        {n.modulos.map((c) => (
                          <span key={c} className="dgn-chip">{nombreModulo.get(c) ?? c}</span>
                        ))}
                      </div>
                    </td>
                    <td data-label="Estado">
                      <span className={`badge ${n.activa ? 'badge-success' : 'badge-neutral'}`}>
                        {n.activa ? 'Activa' : 'Oculta'}
                      </span>
                    </td>
                    <td className="col-actions">
                      <div className="ter-actions" onClick={(e) => e.stopPropagation()}>
                        <NecesidadModal modulos={modulos} necesidad={n} />
                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmarBorrado(n)}>
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmarBorrado && (
        <ConfirmDialog
          title={`¿Eliminar "${confirmarBorrado.etiqueta}"?`}
          body="Dejará de aparecer como opción en el diagnóstico. Esta acción no se puede deshacer."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmarBorrado(null)}
          onConfirm={() => doEliminar(confirmarBorrado)}
        />
      )}
    </div>
  )
}
