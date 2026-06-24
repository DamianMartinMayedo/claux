'use client'

import { X } from 'lucide-react'
import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { editarModulo } from '@/app/actions/modulos'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { useToast } from '@/app/contexts/ToastContext'

function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function ensurePages(paginas: unknown): Pagina[] {
  if (Array.isArray(paginas)) return paginas
  if (typeof paginas === 'string') {
    try { const p = JSON.parse(paginas); return Array.isArray(p) ? p : [] }
    catch { return [] }
  }
  return []
}

interface Pagina {
  ruta: string
  label: string
  orden: number
}

type Modulo = {
  clave: string
  nombre: string
  descripcion: string | null
  precio_fundador_usd: number
  precio_estandar_usd: number
  tipo: string
  activo: boolean
  orden: number
  paginas?: Pagina[] | null
}

export default function EditarModuloModal({ modulo }: { modulo: Modulo }) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [paginas, setPaginas] = useState<Pagina[]>(() => ensurePages(modulo.paginas))
  const [nuevaRuta, setNuevaRuta]   = useState('')
  const [nuevoLabel, setNuevoLabel] = useState('')
  const [addError, setAddError]     = useState('')
  const [editTipo, setEditTipo]     = useState(modulo.tipo)
  const [routeEdited, setRouteEdited] = useState(false)
  const formRef               = useRef<HTMLFormElement>(null)
  const mounted               = useMounted()

  // Reset intencional del formulario cuando cambia el módulo editado (p.ej. tras guardar + refresh).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPaginas(ensurePages(modulo.paginas))
    setEditTipo(modulo.tipo)
    setNuevaRuta(''); setNuevoLabel(''); setRouteEdited(false)
  }, [modulo])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleClose = useCallback(() => {
    setOpen(false); setAddError('')
    setNuevaRuta(''); setNuevoLabel(''); setRouteEdited(false)
    setPaginas(ensurePages(modulo.paginas))
    setEditTipo(modulo.tipo)
  }, [modulo.paginas, modulo.tipo])

  useModalKeyboard(open, handleClose)

  function handleLabelChange(val: string) {
    setNuevoLabel(val)
    if (!routeEdited) {
      setNuevaRuta('/portal/' + slugify(val))
    }
  }

  function handleRouteChange(val: string) {
    setNuevaRuta(val)
    setRouteEdited(true)
    setAddError('')
  }

  function addPagina() {
    setAddError('')
    const ruta  = nuevaRuta.trim()
    const label = nuevoLabel.trim()
    if (!ruta || !label) { setAddError('Ruta y label son obligatorios.'); return }
    if (!ruta.startsWith('/portal/')) { setAddError('La ruta debe empezar por /portal/'); return }
    if (paginas.some(p => p.ruta === ruta)) { setAddError('Esa ruta ya existe en este módulo.'); return }
    setPaginas(prev => [...prev, { ruta, label, orden: prev.length }])
    setNuevaRuta(''); setNuevoLabel('')
  }

  function removePagina(index: number) {
    setPaginas(prev => prev.filter((_, i) => i !== index).map((p, i) => ({ ...p, orden: i })))
  }

  // Drag-and-drop: reordenar páginas
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  function handlePageDragStart(index: number) { setDragIndex(index) }
  function handlePageDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    const reordered = [...paginas]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(index, 0, moved)
    const final = reordered.map((p, i) => ({ ...p, orden: i }))
    setPaginas(final)
    setDragIndex(index)
  }
  function handlePageDragEnd() { setDragIndex(null) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const fd = new FormData(formRef.current!)
    fd.set('paginas', JSON.stringify(paginas))
    fd.set('tipo', editTipo)
    const res = await editarModulo(fd)
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al guardar'); return }
    toastSuccess('Módulo guardado')
    setTimeout(() => { handleClose(); router.refresh() }, 600)
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2 className="modal-title">Editar — {modulo.clave}</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit}>
          <input type="hidden" name="clave" value={modulo.clave} />
          <input type="hidden" name="orden" value={modulo.orden} />
          <div className="modal-body">
            {/* ── Datos básicos ── */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Nombre <span className="required">*</span></label>
                <input name="nombre" className="input" required defaultValue={modulo.nombre} />
              </div>
              <div className="input-group">
                <label>Tipo</label>
                <select
                  className="input"
                  value={editTipo}
                  onChange={e => setEditTipo(e.target.value)}
                  disabled={modulo.tipo === 'addon'}
                >
                  <option value="modulo">Módulo</option>
                  <option value="funcionalidad">Funcionalidad</option>
                  {modulo.tipo === 'addon' && <option value="addon">Addon</option>}
                </select>
                {modulo.tipo === 'addon' && <span className="input-hint">Los addons no pueden cambiar de tipo.</span>}
              </div>
            </div>
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Orden</label>
                <input name="orden" className="input" type="number" min="1" defaultValue={modulo.orden} />
              </div>
              <div className="input-group">
                <label>Descripción</label>
                <input name="descripcion" className="input" defaultValue={modulo.descripcion ?? ''} />
              </div>
            </div>
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Precio fundador (USD)</label>
                <input name="precio_fundador_usd" className="input" type="number" min="0" step="0.01" required defaultValue={modulo.precio_fundador_usd} />
              </div>
              <div className="input-group">
                <label>Precio estándar (USD)</label>
                <input name="precio_estandar_usd" className="input" type="number" min="0" step="0.01" required defaultValue={modulo.precio_estandar_usd} />
              </div>
            </div>
            <label className="module-check">
              <input type="checkbox" name="activo" value="true" defaultChecked={modulo.activo} />
              Activo (visible en los toggles de cliente)
            </label>

            {/* ── Páginas internas (solo para módulos) ── */}
            {editTipo === 'modulo' && (
              <div className="mod-paginas-section">
                <div className="mod-paginas-header">
                  <h3 className="mod-paginas-title">Páginas internas</h3>
                  <span className="text-xs-muted">{paginas.length} página{paginas.length !== 1 ? 's' : ''}</span>
                </div>

                {paginas.length > 0 && (
                  <div className="mod-paginas-list">
                    {paginas.map((p, i) => (
                      <div
                        key={p.ruta}
                        className={`mod-pagina-row${dragIndex === i ? ' mod-pagina-dragging' : ''}`}
                        draggable
                        onDragStart={() => handlePageDragStart(i)}
                        onDragOver={(e) => handlePageDragOver(e, i)}
                        onDragEnd={handlePageDragEnd}
                      >
                        <span className="mod-pagina-drag">⠿</span>
                        <div className="mod-pagina-info">
                          <code className="mod-pagina-ruta">{p.ruta}</code>
                          <span className="mod-pagina-label">{p.label}</span>
                        </div>
                        <button
                          type="button"
                          className="mod-pagina-remove"
                          onClick={() => removePagina(i)}
                          title="Quitar página"
                          aria-label="Quitar página"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mod-paginas-add">
                  <div className="mod-paginas-add-fields">
                    <input
                      type="text"
                      className="input"
                      placeholder="Nombre visible"
                      value={nuevoLabel}
                      onChange={e => handleLabelChange(e.target.value)}
                    />
                    <input
                      type="text"
                      className="input mod-pagina-ruta-input"
                      placeholder="/portal/nombre-continua"
                      value={nuevaRuta}
                      onChange={e => handleRouteChange(e.target.value)}
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={addPagina}>
                      + Añadir
                    </button>
                  </div>
                  {addError && <span className="input-hint text-error">{addError}</span>}
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>Editar</button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
