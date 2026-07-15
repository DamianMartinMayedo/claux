'use client'

import { useState, useTransition } from 'react'
import { Loader2, Save, Users, Sparkles } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useIa } from '@/components/portal/ia/IaContext'
import { redactarSeccionDossier } from '@/app/actions/portal/ia'
import {
  guardarSecciones, sugerirEquipoDesdeRrhh,
  type DossierBasico, type SeccionRelato,
} from '@/app/actions/portal/dossier'
import { SECCIONES_RELATO } from '@/lib/dossier/secciones'

// El relato: seis preguntas en lenguaje llano. Tracción NO se pregunta — sale de
// los números. Sin el addon de IA los botones "ayúdame a escribir" NO EXISTEN
// (ni deshabilitados ni con candado: lo no contratado se oculta) y la sección se
// escribe a mano igual de bien.

export default function PasoRelato({
  dossier, secciones, tieneRrhh, onGuardado,
}: {
  dossier: DossierBasico
  secciones: SeccionRelato[]
  tieneRrhh: boolean
  onGuardado?: () => void
}) {
  const { tieneIa } = useIa()

  const [texto, setTexto] = useState<Record<string, string>>(() => {
    const previo = new Map(secciones.map(s => [s.clave, s.cuerpo]))
    const o: Record<string, string> = {}
    for (const s of SECCIONES_RELATO) o[s.clave] = previo.get(s.clave) ?? ''
    return o
  })
  // Qué secciones nacieron de un borrador de IA (aunque el dueño las haya retocado).
  const [deIa, setDeIa] = useState<Set<string>>(() => new Set(secciones.filter(s => s.generado_ia).map(s => s.clave)))

  const [pending, startTransition] = useTransition()
  const [cargandoEquipo, startEquipo] = useTransition()
  const [redactando, setRedactando] = useState<string | null>(null)

  const escritas = SECCIONES_RELATO.filter(s => (texto[s.clave] ?? '').trim().length > 0).length

  function guardar() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      fd.set('secciones', JSON.stringify(SECCIONES_RELATO.map(s => ({
        clave: s.clave, cuerpo: texto[s.clave] ?? '', generado_ia: deIa.has(s.clave),
      }))))
      const res = await guardarSecciones(fd)
      if (res.ok) { toastSuccess('Relato guardado'); onGuardado?.() }
      else toastError(res.error || 'No se pudo guardar')
    })
  }

  // El borrador NO pisa lo escrito: si ya hay texto, se añade debajo. Lo que el
  // dueño escribió con su cabeza no lo borra un modelo.
  async function redactar(clave: string) {
    if (redactando) return
    setRedactando(clave)
    try {
      const res = await redactarSeccionDossier(clave)
      if (!res.ok) { toastError(res.error); return }
      setTexto(prev => ({ ...prev, [clave]: prev[clave]?.trim() ? `${prev[clave].trim()}\n\n${res.cuerpo}` : res.cuerpo }))
      setDeIa(prev => new Set(prev).add(clave))
      toastSuccess('Borrador listo: revísalo y ajústalo a tu manera')
    } finally {
      setRedactando(null)
    }
  }

  function precargarEquipo() {
    startEquipo(async () => {
      const sug = await sugerirEquipoDesdeRrhh()
      if (!sug) { toastError('No hay personal dado de alta en RRHH'); return }
      setTexto(prev => ({ ...prev, equipo: prev.equipo?.trim() ? `${prev.equipo}\n${sug}` : sug }))
    })
  }

  return (
    <section className="card">
      <div className="dos-body">
        <div className="dos-er-head">
          <div>
            <h2 className="dos-section-title">El relato</h2>
            <p className="dos-section-hint">
              Contesta con tus palabras; no hace falta que suene a informe. Lo que dejes en blanco no aparece en la presentación.
            </p>
          </div>
          <span className="dos-costo-tag">{escritas} de {SECCIONES_RELATO.length}</span>
        </div>

        <div className="dos-relato">
          {SECCIONES_RELATO.map(s => (
            <div key={s.clave} className="dos-campo">
              <label className="dos-label" htmlFor={`dos-sec-${s.clave}`}>{s.pregunta}</label>
              <p className="dos-section-hint dos-relato-ayuda">{s.ayuda}</p>
              <textarea
                id={`dos-sec-${s.clave}`} className="input dos-textarea" rows={3}
                value={texto[s.clave] ?? ''} maxLength={1200}
                onChange={e => setTexto(prev => ({ ...prev, [s.clave]: e.target.value }))}
              />
              {(tieneIa || (s.clave === 'equipo' && tieneRrhh)) && (
                <div className="dos-relato-extra">
                  {tieneIa && (
                    <button className="btn btn-secondary btn-sm" onClick={() => redactar(s.clave)} disabled={redactando !== null}>
                      {redactando === s.clave
                        ? <Loader2 size={13} strokeWidth={2.5} className="dos-spin" />
                        : <Sparkles size={13} strokeWidth={2.5} />}
                      {redactando === s.clave ? 'Pensando…' : 'Ayúdame a escribir'}
                    </button>
                  )}
                  {s.clave === 'equipo' && tieneRrhh && (
                    <button className="btn btn-secondary btn-sm" onClick={precargarEquipo} disabled={cargandoEquipo}>
                      {cargandoEquipo ? <Loader2 size={13} strokeWidth={2.5} className="dos-spin" /> : <Users size={13} strokeWidth={2.5} />}
                      Traer mi plantilla
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="dos-acciones">
          <button className="btn btn-primary" onClick={guardar} disabled={pending}>
            {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Save size={14} strokeWidth={2.5} />}
            Guardar relato
          </button>
        </div>
      </div>
    </section>
  )
}
