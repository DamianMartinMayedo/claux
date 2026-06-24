'use client'

import { Plus, X } from 'lucide-react'
import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { crearNecesidad, editarNecesidad } from '@/app/actions/diagnostico-necesidades'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { useToast } from '@/app/contexts/ToastContext'

export interface ModuloLite {
  clave: string
  nombre: string
}

export interface Necesidad {
  clave: string
  etiqueta: string
  descripcion: string | null
  icono: string | null
  modulos: string[]
  orden: number
  activa: boolean
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
}

export default function NecesidadModal({
  modulos,
  necesidad,
}: {
  modulos: ModuloLite[]
  necesidad?: Necesidad
}) {
  const esEdicion = Boolean(necesidad)
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const mounted = useMounted()

  // Estado controlado para auto-slug (alta).
  const [etiqueta, setEtiqueta] = useState(necesidad?.etiqueta ?? '')
  const [clave, setClave] = useState(necesidad?.clave ?? '')
  const [claveEdited, setClaveEdited] = useState(esEdicion)

  const handleClose = useCallback(() => setOpen(false), [])
  useModalKeyboard(open, handleClose)

  function handleEtiquetaChange(val: string) {
    setEtiqueta(val)
    if (!claveEdited) setClave(slugify(val))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const fd = new FormData(formRef.current!)
    const res = esEdicion ? await editarNecesidad(fd) : await crearNecesidad(fd)
    setLoading(false)
    if (!res.ok) {
      toastError(res.error ?? 'Error al guardar')
      return
    }
    toastSuccess(esEdicion ? 'Necesidad guardada' : 'Necesidad creada')
    handleClose()
    router.refresh()
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-md">
        <div className="modal-header">
          <h2 className="modal-title">{esEdicion ? `Editar — ${necesidad!.clave}` : 'Nueva necesidad'}</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit}>
          {esEdicion && <input type="hidden" name="clave" value={necesidad!.clave} />}
          <div className="modal-body">
            <div className="input-group">
              <label>
                Lo que el cliente quiere <span className="required">*</span>
              </label>
              <input
                name="etiqueta"
                className="input"
                required
                placeholder="ej: Mejorar mis reservas o citas"
                value={etiqueta}
                onChange={(e) => handleEtiquetaChange(e.target.value)}
              />
              <span className="input-hint">En lenguaje del cliente, no técnico.</span>
            </div>

            {!esEdicion && (
              <div className="input-group">
                <label>
                  Clave <span className="required">*</span>
                </label>
                <input
                  name="clave"
                  className="input"
                  required
                  pattern="[a-z][a-z0-9_]*"
                  placeholder="ej: reservas"
                  value={clave}
                  onChange={(e) => {
                    setClave(e.target.value)
                    setClaveEdited(true)
                  }}
                />
                <span className="input-hint">Identificador interno: minúsculas, números y _</span>
              </div>
            )}

            <div className="input-group">
              <label>Descripción</label>
              <input
                name="descripcion"
                className="input"
                placeholder="Ayuda corta que ve el cliente bajo la opción…"
                defaultValue={necesidad?.descripcion ?? ''}
              />
            </div>

            <div className="input-group">
              <label>
                Módulos que recomienda <span className="required">*</span>
              </label>
              <div className="grid-cols-2">
                {modulos.map((m) => (
                  <label key={m.clave} className="module-check">
                    <input
                      type="checkbox"
                      name="modulos"
                      value={m.clave}
                      defaultChecked={necesidad?.modulos.includes(m.clave) ?? false}
                    />
                    {m.nombre}
                  </label>
                ))}
              </div>
              <span className="input-hint">
                Lo que ofrecemos cuando el cliente marca esta opción (la contabilidad es un módulo más).
              </span>
            </div>

            {esEdicion && (
              <label className="module-check">
                <input type="checkbox" name="activa" value="true" defaultChecked={necesidad!.activa} />
                Activa (visible en el diagnóstico)
              </label>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" /> Guardando...
                </>
              ) : esEdicion ? (
                'Guardar'
              ) : (
                'Crear necesidad'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      {esEdicion ? (
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
          Editar
        </button>
      ) : (
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <Plus size={14} strokeWidth={2.5} />
          Nueva necesidad
        </button>
      )}
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
