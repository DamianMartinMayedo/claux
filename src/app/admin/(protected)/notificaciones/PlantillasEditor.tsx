'use client'

import { useMemo, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { guardarPlantilla, enviarPruebaPlantilla, type PlantillaEmailAdmin } from '@/app/actions/email-plantillas'
import { PLANTILLAS_VARS, TIPOS_EMAIL, type TipoEmail } from '@/lib/email/variables'
import { envolverEmail, textoAHtml } from '@/lib/email/layout'

function interpolarEjemplo(texto: string, tipo: TipoEmail): string {
  const vars = PLANTILLAS_VARS[tipo]
  return vars.reduce((acc, v) => acc.split(`{{${v.clave}}}`).join(v.ejemplo), texto)
}

export default function PlantillasEditor({ plantillasIniciales }: { plantillasIniciales: PlantillaEmailAdmin[] }) {
  const [plantillas, setPlantillas] = useState(plantillasIniciales)
  const [tipoActivo, setTipoActivo] = useState<TipoEmail>(plantillasIniciales[0]?.tipo ?? 'bienvenida')

  const plantilla = plantillas.find(p => p.tipo === tipoActivo)!
  const [asunto, setAsunto] = useState(plantilla.asunto)
  const [cuerpo, setCuerpo] = useState(plantilla.cuerpo)
  const [activo, setActivo] = useState(plantilla.activo)
  const [saving, setSaving] = useState(false)
  const [enviandoPrueba, setEnviandoPrueba] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const cuerpoRef = useRef<HTMLTextAreaElement>(null)

  function seleccionarTipo(tipo: TipoEmail) {
    const p = plantillas.find(pl => pl.tipo === tipo)!
    setTipoActivo(tipo)
    setAsunto(p.asunto)
    setCuerpo(p.cuerpo)
    setActivo(p.activo)
    setMsg(null)
  }

  function insertarVariable(clave: string) {
    const textarea = cuerpoRef.current
    const placeholder = `{{${clave}}}`
    if (!textarea) { setCuerpo(c => c + placeholder); return }
    const inicio = textarea.selectionStart ?? cuerpo.length
    const fin    = textarea.selectionEnd ?? cuerpo.length
    const nuevo  = cuerpo.slice(0, inicio) + placeholder + cuerpo.slice(fin)
    setCuerpo(nuevo)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(inicio + placeholder.length, inicio + placeholder.length)
    })
  }

  async function handleGuardar() {
    setSaving(true); setMsg(null)
    const fd = new FormData()
    fd.set('tipo', tipoActivo)
    fd.set('asunto', asunto)
    fd.set('cuerpo', cuerpo)
    fd.set('activo', activo ? 'true' : 'false')
    const res = await guardarPlantilla(fd)
    setSaving(false)
    if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'Error al guardar.' }); return }
    setMsg({ ok: true, text: 'Plantilla guardada.' })
    setPlantillas(prev => prev.map(p => p.tipo === tipoActivo ? { ...p, asunto, cuerpo, activo } : p))
  }

  async function handleEnviarPrueba() {
    setEnviandoPrueba(true); setMsg(null)
    const res = await enviarPruebaPlantilla(tipoActivo)
    setEnviandoPrueba(false)
    setMsg(res.ok
      ? { ok: true, text: 'Prueba enviada a tu correo.' }
      : { ok: false, text: res.error ?? 'No se pudo enviar la prueba.' })
  }

  const previewHtml = useMemo(
    () => envolverEmail(textoAHtml(interpolarEjemplo(cuerpo, tipoActivo))),
    [cuerpo, tipoActivo],
  )
  const previewAsunto = useMemo(() => interpolarEjemplo(asunto, tipoActivo), [asunto, tipoActivo])

  return (
    <div className="plantillas-layout">
      <div className="plantillas-lista card">
        {TIPOS_EMAIL.map(t => {
          const p = plantillas.find(pl => pl.tipo === t.tipo)
          return (
            <button
              key={t.tipo}
              className={`plantillas-lista-item${t.tipo === tipoActivo ? ' active' : ''}`}
              onClick={() => seleccionarTipo(t.tipo)}
            >
              <span>{t.label}</span>
              <span className={`badge ${p?.activo ? 'badge-success' : 'badge-neutral'}`}>
                {p?.activo ? 'Activa' : 'Texto por defecto'}
              </span>
            </button>
          )
        })}
      </div>

      <div className="plantillas-editor card">
        <div className="input-group">
          <label htmlFor="pl-asunto">Asunto</label>
          <input
            id="pl-asunto"
            className="input"
            value={asunto}
            onChange={e => { setAsunto(e.target.value); setMsg(null) }}
          />
        </div>

        <div className="input-group">
          <label htmlFor="pl-cuerpo">Cuerpo</label>
          <textarea
            id="pl-cuerpo"
            ref={cuerpoRef}
            className="input"
            rows={10}
            value={cuerpo}
            onChange={e => { setCuerpo(e.target.value); setMsg(null) }}
          />
        </div>

        <div className="plantillas-vars">
          <span className="plantillas-vars-label">Variables disponibles:</span>
          {PLANTILLAS_VARS[tipoActivo].map(v => (
            <button
              key={v.clave}
              type="button"
              className="btn btn-secondary btn-sm"
              title={v.label}
              onClick={() => insertarVariable(v.clave)}
            >
              {`{{${v.clave}}}`}
            </button>
          ))}
        </div>

        <label className="checkbox-group">
          <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} />
          <span className="checkbox-label">Usar este contenido (desmarca para volver al texto por defecto del sistema sin perder lo escrito arriba)</span>
        </label>

        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'} mt-3`}>{msg.text}</div>}

        <div className="form-actions-end mt-4">
          <button type="button" className="btn btn-secondary" disabled={enviandoPrueba} onClick={handleEnviarPrueba}>
            {enviandoPrueba ? <><span className="spinner spinner-sm" /> Enviando…</> : <><Send size={14} /> Enviar prueba</>}
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={handleGuardar}>
            {saving ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar plantilla'}
          </button>
        </div>

        <div className="plantillas-preview">
          <p className="plantillas-preview-label">Vista previa (con datos de ejemplo)</p>
          <p className="plantillas-preview-asunto">Asunto: {previewAsunto}</p>
          <iframe
            title="Vista previa del correo"
            srcDoc={previewHtml}
            sandbox=""
            className="plantillas-preview-frame"
          />
        </div>
      </div>
    </div>
  )
}
