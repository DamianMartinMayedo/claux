'use client'

import { Info, Plus, X } from 'lucide-react'
import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { crearModulo } from '@/app/actions/modulos'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import FormHelp from '@/components/portal/FormHelp'
import { useMounted } from '@/lib/use-mounted'
import { useToast } from '@/app/contexts/ToastContext'
import { NIVELES, CAMPO_PRECIO, type Nivel } from '@/lib/niveles'
import { MONEDAS_CLAUX } from '@/lib/moneda-claux'

export default function NuevoModuloModal({ nombresNivel }: { nombresNivel: Record<Nivel, string> }) {
  const [open, setOpen]       = useState(false)
  const { success: toastSuccess, error: toastError } = useToast()
  const [loading, setLoading] = useState(false)
  const formRef               = useRef<HTMLFormElement>(null)
  const mounted               = useMounted()

  const handleClose = useCallback(() => { setOpen(false) }, [])
  useModalKeyboard(open, handleClose)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await crearModulo(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al crear'); return }
    toastSuccess('Módulo creado')
    handleClose()
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-md">
        <div className="modal-header">
          <h2 className="modal-title">Nuevo módulo</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="grid-cols-2">
              <div className="input-group">
                <div className="form-label-with-help">
                  <label>Clave <span className="required">*</span></label>
                  <FormHelp text="Identificador único, solo minúsculas y _" label="Información sobre la clave" />
                </div>
                <input name="clave" className="input" required placeholder="ej: fidelizacion" pattern="[a-z][a-z0-9_]*" />
              </div>
              <div className="input-group">
                <label>Tipo <span className="required">*</span></label>
                <select name="tipo" className="input" required defaultValue="modulo">
                  <option value="modulo">Módulo</option>
                  <option value="funcionalidad">Funcionalidad</option>
                  <option value="addon">Addon</option>
                </select>
              </div>
            </div>
            <div className="input-group">
              <label>Nombre <span className="required">*</span></label>
              <input name="nombre" className="input" required placeholder="ej: Fidelización" />
            </div>
            {/* Los tres textos del módulo, cada uno con su destino: uno describe,
                otro vende y el tercero cabe. Se piden en el alta porque un módulo
                sin ellos sale mudo en la landing y en la propuesta, y nadie vuelve
                a por lo que no pidió nadie. */}
            <div className="input-group">
              <label>Descripción</label>
              <textarea name="descripcion" className="input" rows={2} placeholder="Describe qué incluye este módulo…" />
              <span className="input-hint">Qué es. Landing y factura.</span>
            </div>
            <div className="input-group">
              <label>Beneficio</label>
              <textarea name="beneficio" className="input" rows={2} placeholder="Qué gana el negocio con esto…" />
              <span className="input-hint">Por qué le sirve. Diapositiva «Pensado para tu negocio» de la propuesta.</span>
            </div>
            <div className="input-group">
              <label>Resumen</label>
              <input name="resumen" className="input" maxLength={80} placeholder="En dos líneas…" />
              <span className="input-hint">Ficha de precios de la propuesta, cuatro por página: unos 55 caracteres.</span>
            </div>
            {/* Un precio por nivel Y POR MONEDA. Las seis se piden aquí, en el alta:
                un módulo sin precio en euros sale GRATIS al que se le factura en
                euros, y eso no avisa por ningún lado (`audit:nivel` exige los seis). */}
            {MONEDAS_CLAUX.map(moneda => (
              <div className="grid-cols-3" key={moneda}>
                {NIVELES.map(n => (
                  <div className="input-group" key={n}>
                    <label htmlFor={`nuevo-${moneda}-${n}`}>Precio {nombresNivel[n]} ({moneda})</label>
                    <input id={`nuevo-${moneda}-${n}`} name={CAMPO_PRECIO[moneda][n]} className="input"
                           type="number" min="0" step="any" required defaultValue="0" />
                  </div>
                ))}
              </div>
            ))}
            <div className="info-banner info-banner-compacto">
              <Info aria-hidden />
              <p>Las páginas internas (módulo) o rutas (funcionalidad) se crean con el asistente de IA. Desde aquí solo gestionas el catálogo.</p>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Creando...</> : 'Crear módulo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={14} strokeWidth={2.5} />
        Nuevo módulo
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
