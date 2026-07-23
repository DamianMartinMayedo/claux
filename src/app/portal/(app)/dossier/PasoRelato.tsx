'use client'

import { useState, useTransition } from 'react'
import { Loader2, Save, Users, Sparkles, Plus, Trash2 } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useIa } from '@/components/portal/ia/IaContext'
import { redactarSeccionDossier } from '@/app/actions/portal/ia'
import {
  guardarSecciones, sugerirEquipoDesdeRrhh,
  type DossierBasico, type SeccionRelato,
} from '@/app/actions/portal/dossier'
import { SECCIONES_RELATO } from '@/lib/dossier/secciones'

// Límite por sección: un deck es de frases, no de párrafos largos (el inversor
// escanea). Se avisa en el contador y lo aplica el maxLength del textarea.
const MAX_SECCION = 1200

// El Equipo se edita en FILAS (nombre + puesto), no en texto libre, para que salga
// siempre en cuadrícula. Por debajo se sigue guardando como "Nombre — Puesto" por
// línea: el mismo formato que parsea el deck (parseEquipo), así no divergen.
interface MiembroEquipo { nombre: string; puesto: string }

function parseEquipoFilas(cuerpo: string): MiembroEquipo[] {
  return cuerpo.split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => {
    const guion = l.match(/^(.+?)\s+[—–-]\s+(.+)$/)
    if (guion) return { nombre: guion[1].trim(), puesto: guion[2].trim() }
    const paren = l.match(/^(.+?)\s*\((.+)\)$/)
    if (paren) return { nombre: paren[1].trim(), puesto: paren[2].trim() }
    return { nombre: l, puesto: '' }
  })
}

function serializarEquipo(filas: MiembroEquipo[]): string {
  return filas
    .map(f => ({ nombre: f.nombre.trim(), puesto: f.puesto.trim() }))
    .filter(f => f.nombre || f.puesto)
    .map(f => (f.puesto ? `${f.nombre} — ${f.puesto}` : f.nombre))
    .join('\n')
}

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

  // Equipo en filas (fuente aparte de `texto`); al menos una fila para editar.
  const [equipoRows, setEquipoRows] = useState<MiembroEquipo[]>(() => {
    const filas = parseEquipoFilas(secciones.find(s => s.clave === 'equipo')?.cuerpo ?? '')
    return filas.length ? filas : [{ nombre: '', puesto: '' }]
  })
  const equipoCuerpo = serializarEquipo(equipoRows)

  const [pending, startTransition] = useTransition()
  const [cargandoEquipo, startEquipo] = useTransition()
  const [redactando, setRedactando] = useState<string | null>(null)

  // El cuerpo real de cada sección: el de Equipo sale de las filas, no de `texto`.
  const cuerpoDe = (clave: string) => (clave === 'equipo' ? equipoCuerpo : (texto[clave] ?? ''))
  const escritas = SECCIONES_RELATO.filter(s => cuerpoDe(s.clave).trim().length > 0).length

  const setFila = (i: number, campo: keyof MiembroEquipo, valor: string) =>
    setEquipoRows(prev => prev.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)))
  const addFila = () => setEquipoRows(prev => [...prev, { nombre: '', puesto: '' }])
  const quitarFila = (i: number) =>
    setEquipoRows(prev => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [{ nombre: '', puesto: '' }]))

  function guardar() {
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      fd.set('secciones', JSON.stringify(SECCIONES_RELATO.map(s => ({
        clave: s.clave, cuerpo: cuerpoDe(s.clave), generado_ia: deIa.has(s.clave),
      }))))
      const res = await guardarSecciones(fd)
      await ld.dismiss()
      if (res.ok) { toastSuccess('Relato guardado'); onGuardado?.() }
      else toastError(res.error || 'No se pudo guardar')
    })
  }

  // El borrador NO pisa lo escrito: si ya hay texto, se añade debajo. Lo que el
  // dueño escribió con su cabeza no lo borra un modelo.
  async function redactar(clave: string) {
    if (redactando) return
    setRedactando(clave)
    const ld = toastLoading('Generando…')
    try {
      const res = await redactarSeccionDossier(clave)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error); return }
      setTexto(prev => ({ ...prev, [clave]: prev[clave]?.trim() ? `${prev[clave].trim()}\n\n${res.cuerpo}` : res.cuerpo }))
      setDeIa(prev => new Set(prev).add(clave))
      toastSuccess('Borrador listo: revísalo y ajústalo a tu manera')
    } finally {
      setRedactando(null)
    }
  }

  function precargarEquipo() {
    const ld = toastLoading('Trayendo…')
    startEquipo(async () => {
      const sug = await sugerirEquipoDesdeRrhh()
      await ld.dismiss()
      if (!sug) { toastError('No hay personal dado de alta en RRHH'); return }
      // Añade la plantilla a las filas ya escritas (aditivo), sin duplicar vacías.
      const nuevas = parseEquipoFilas(sug)
      setEquipoRows(prev => {
        const base = prev.filter(f => f.nombre.trim() || f.puesto.trim())
        return [...base, ...nuevas]
      })
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
          {SECCIONES_RELATO.map(s => {
            const esEquipo = s.clave === 'equipo'
            return (
              <div key={s.clave} className="dos-campo">
                <div className="dos-relato-head">
                  <div className="dos-relato-titulos">
                    {esEquipo
                      ? <span className="dos-label">{s.pregunta}</span>
                      : <label className="dos-label" htmlFor={`dos-sec-${s.clave}`}>{s.pregunta}</label>}
                    <p className="dos-section-hint dos-relato-ayuda">
                      {esEquipo ? 'Una fila por persona: nombre y puesto. Salen en cuadrícula en la presentación.' : s.ayuda}
                    </p>
                  </div>
                  {tieneIa && !esEquipo && (
                    <button className="btn btn-secondary btn-sm" onClick={() => redactar(s.clave)} disabled={redactando !== null}>
                      {redactando === s.clave
                        ? <Loader2 size={13} strokeWidth={2.5} className="dos-spin" />
                        : <Sparkles size={13} strokeWidth={2.5} />}
                      {redactando === s.clave ? 'Pensando…' : 'Ayúdame a escribir'}
                    </button>
                  )}
                  {esEquipo && tieneRrhh && (
                    <button className="btn btn-secondary btn-sm" onClick={precargarEquipo} disabled={cargandoEquipo}>
                      {cargandoEquipo ? <Loader2 size={13} strokeWidth={2.5} className="dos-spin" /> : <Users size={13} strokeWidth={2.5} />}
                      Traer mi plantilla
                    </button>
                  )}
                </div>

                {esEquipo ? (
                  <div className="dos-equipo-editor">
                    {equipoRows.map((f, i) => (
                      <div key={i} className="dos-equipo-fila">
                        <input className="input" value={f.nombre} maxLength={80} placeholder="Nombre"
                          aria-label="Nombre" onChange={e => setFila(i, 'nombre', e.target.value)} />
                        <input className="input" value={f.puesto} maxLength={80} placeholder="Puesto"
                          aria-label="Puesto" onChange={e => setFila(i, 'puesto', e.target.value)} />
                        <button type="button" className="ter-action-btn" onClick={() => quitarFila(i)} aria-label="Quitar persona">
                          <Trash2 size={15} strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-secondary btn-sm dos-equipo-add" onClick={addFila}>
                      <Plus size={13} strokeWidth={2.5} /> Añadir persona
                    </button>
                  </div>
                ) : (
                  <>
                    <textarea
                      id={`dos-sec-${s.clave}`} className="input dos-textarea" rows={3}
                      value={texto[s.clave] ?? ''} maxLength={MAX_SECCION}
                      onChange={e => setTexto(prev => ({ ...prev, [s.clave]: e.target.value }))}
                    />
                    <span className={`dos-charcount${(texto[s.clave] ?? '').length >= MAX_SECCION ? ' is-limite' : ''}`}>
                      {(texto[s.clave] ?? '').length} / {MAX_SECCION}
                    </span>
                  </>
                )}
              </div>
            )
          })}
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
