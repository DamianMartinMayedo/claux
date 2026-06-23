'use client'

import { useState, useTransition, useMemo } from 'react'
import {
  crearCitaPublica,
  obtenerSlotsCita,
  type ServicioPublico,
  type RecursoPublico,
  type SlotCita,
} from '@/app/actions/portal/citas'
import type { EtiquetasSector } from '@/lib/sector'
import type { ReglasReserva } from '@/app/actions/portal/reservas'
import { Calendar, Check, Loader2 } from 'lucide-react'

function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function sumarDiasISO(dias: number): string {
  const d = new Date(); d.setDate(d.getDate() + dias)
  return d.toISOString().split('T')[0]
}

type Paso = 'servicio' | 'recurso' | 'horario' | 'datos' | 'ok'

export default function CitasPublicaForm({
  clientId, negocio, servicios, recursos, etiquetas, slug, reglas,
}: {
  clientId:  string
  negocio:   { nombre: string }
  servicios: ServicioPublico[]
  recursos:  RecursoPublico[]
  etiquetas: EtiquetasSector
  slug:      string
  reglas:    ReglasReserva
}) {
  const [isPending, startTransition] = useTransition()
  const et = etiquetas
  const fechaMax = reglas.ventana_max_dias > 0 ? sumarDiasISO(reglas.ventana_max_dias) : undefined

  const [paso, setPaso] = useState<Paso>('servicio')
  const [servicioId, setServicioId] = useState('')
  const [recursoSel, setRecursoSel] = useState<string | 'any'>('any')  // elección del cliente
  const [fecha, setFecha] = useState(hoyISO())
  const [slots, setSlots] = useState<SlotCita[]>([])
  const [hora, setHora] = useState('')
  const [horaRecurso, setHoraRecurso] = useState('')  // recurso concreto del hueco elegido
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [consultado, setConsultado] = useState(false)

  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [notas, setNotas] = useState('')
  const [hp, setHp] = useState('')   // honeypot anti-bots
  const [tokenCita, setTokenCita] = useState<string | null>(null)
  const [estadoFinal, setEstadoFinal] = useState<'CONFIRMADA' | 'PENDIENTE'>('PENDIENTE')
  const [error, setError] = useState('')

  const servicio = servicios.find(s => s.servicio_id === servicioId) ?? null

  const recursosParaServicio = useMemo(() =>
    recursos.filter(r => r.servicio_ids.length === 0 || r.servicio_ids.includes(servicioId)),
    [recursos, servicioId])

  // Huecos únicos por hora (en modo "cualquiera", cada hora apunta a un recurso libre)
  const horasUnicas = useMemo(() => {
    const map = new Map<string, SlotCita>()
    for (const s of slots) if (!map.has(s.hora)) map.set(s.hora, s)
    return Array.from(map.values()).sort((a, b) => a.hora.localeCompare(b.hora))
  }, [slots])

  function elegirServicio(id: string) {
    setServicioId(id)
    setRecursoSel('any')
    const cands = recursos.filter(r => r.servicio_ids.length === 0 || r.servicio_ids.includes(id))
    if (cands.length === 1) { setRecursoSel(cands[0].recurso_id); setPaso('horario') }
    else                    { setPaso('recurso') }
  }

  function elegirRecurso(sel: string | 'any') {
    setRecursoSel(sel)
    setPaso('horario')
  }

  function cargarHorarios() {
    setLoadingSlots(true); setError(''); setConsultado(true); setHora(''); setHoraRecurso('')
    const recursoParam = recursoSel === 'any' ? null : recursoSel
    obtenerSlotsCita(clientId, servicioId, recursoParam, fecha)
      .then(s => { setSlots(s); setLoadingSlots(false) })
      .catch(() => { setError('No se pudieron cargar los horarios.'); setLoadingSlots(false) })
  }

  function elegirHora(s: SlotCita) {
    setHora(s.hora); setHoraRecurso(s.recurso_id); setError(''); setPaso('datos')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hora || !horaRecurso) { setError('Selecciona una hora.'); return }
    const fd = new FormData()
    fd.set('client_id', clientId)
    fd.set('servicio_id', servicioId)
    fd.set('recurso_id', horaRecurso)
    fd.set('fecha', fecha)
    fd.set('hora', hora)
    fd.set('nombre', nombre)
    fd.set('telefono', telefono)
    fd.set('notas', notas)
    fd.set('hp', hp)
    startTransition(async () => {
      const res = await crearCitaPublica(fd)
      if (!res.ok) { setError(res.error ?? 'No se pudo reservar la cita.'); return }
      setTokenCita(res.token ?? null)
      setEstadoFinal(res.estado === 'CONFIRMADA' ? 'CONFIRMADA' : 'PENDIENTE')
      setPaso('ok')
    })
  }

  function formatFecha(f: string): string {
    const [y, m, d] = f.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  }

  const nombreRecursoSel = recursoSel === 'any'
    ? `Cualquier ${et.recurso.toLowerCase()}`
    : recursos.find(r => r.recurso_id === recursoSel)?.nombre ?? ''

  return (
    <div className="rp-card">
      <div className="rp-card-body">
        <h1 className="rp-title">{negocio.nombre}</h1>

        {paso === 'ok' ? (
          <div className="rp-success">
            <Check size={40} strokeWidth={2} className="rp-success-icon" />
            <p className="rp-subtitle">{estadoFinal === 'CONFIRMADA' ? '¡Cita confirmada!' : '¡Cita recibida!'}</p>
            <div className="rp-resumen">
              <span><strong>{servicio?.nombre}</strong></span>
              <span className="rp-resumen-hora">{formatFecha(fecha)} · {hora}</span>
            </div>
            <p className="rp-hint">{estadoFinal === 'CONFIRMADA' ? '¡Te esperamos!' : 'Te avisaremos en cuanto la confirmemos.'}</p>
            {tokenCita && (
              <a className="rp-manage-link" href={`/${slug}/r/${tokenCita}`}>Gestionar o cancelar mi cita</a>
            )}
          </div>
        ) : servicios.length === 0 ? (
          <p className="rp-hint">Este negocio aún no tiene servicios disponibles para reservar.</p>
        ) : (
          <>
            <p className="rp-subtitle">Pide tu cita en línea</p>

            {/* Paso 1 — Servicio */}
            {paso === 'servicio' && (
              <>
                <p className="rp-step-label">Elige un {et.servicio.toLowerCase()}</p>
                <div className="rp-opt-list">
                  {servicios.map(s => (
                    <button key={s.servicio_id} type="button" className="rp-opt" onClick={() => elegirServicio(s.servicio_id)}>
                      <span className="rp-opt-main">{s.nombre}</span>
                      <span className="rp-opt-meta">{s.duracion_minutos} min{s.precio != null ? ` · $${s.precio.toFixed(2)}` : ''}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Paso 2 — Recurso / profesional */}
            {paso === 'recurso' && (
              <>
                <button className="rp-back" onClick={() => setPaso('servicio')}>← {servicio?.nombre}</button>
                <p className="rp-step-label">Elige {et.recurso.toLowerCase()}</p>
                {recursosParaServicio.length === 0 ? (
                  <p className="rp-hint">No hay {et.recurso_pl.toLowerCase()} disponibles para este {et.servicio.toLowerCase()}.</p>
                ) : (
                  <div className="rp-opt-list">
                    <button type="button" className="rp-opt" onClick={() => elegirRecurso('any')}>
                      <span className="rp-opt-main">Cualquiera</span>
                      <span className="rp-opt-meta">primero disponible</span>
                    </button>
                    {recursosParaServicio.map(r => (
                      <button key={r.recurso_id} type="button" className="rp-opt" onClick={() => elegirRecurso(r.recurso_id)}>
                        <span className="rp-opt-main">{r.nombre}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Paso 3 — Día y hora */}
            {paso === 'horario' && (
              <>
                <button className="rp-back" onClick={() => setPaso(recursosParaServicio.length === 1 ? 'servicio' : 'recurso')}>
                  ← {servicio?.nombre} · {nombreRecursoSel}
                </button>
                <div className="rp-field">
                  <label className="rp-label">Día</label>
                  <input type="date" className="rp-input" value={fecha} min={hoyISO()} max={fechaMax}
                    onChange={e => { setFecha(e.target.value); setConsultado(false); setSlots([]) }} />
                </div>
                <button type="button" className="rp-btn-primary" onClick={cargarHorarios} disabled={loadingSlots}>
                  {loadingSlots ? <Loader2 size={16} className="rp-spin" /> : <Calendar size={16} />}
                  Ver horarios
                </button>

                {consultado && !loadingSlots && (
                  <div className="rp-turnos-section">
                    {horasUnicas.length === 0 ? (
                      <p className="rp-hint">No hay horarios libres ese día. Prueba con otra fecha.</p>
                    ) : (
                      <>
                        <div className="rp-turnos-day">{formatFecha(fecha)}</div>
                        <div className="rp-turnos-sub">Elige una hora</div>
                        <div className="rp-turnos-list">
                          {horasUnicas.map(s => (
                            <button key={s.hora} type="button" className="rp-turno" onClick={() => elegirHora(s)}>
                              <span className="rp-turno-hora-main">{s.hora}</span>
                              <span className="rp-turno-estado">Libre</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Paso 4 — Datos */}
            {paso === 'datos' && (
              <div className="rp-turno-form-section">
                <button className="rp-back" onClick={() => setPaso('horario')}>← Elegir otra hora</button>
                <div className="rp-turno-confirm">
                  <strong>{servicio?.nombre} · {formatFecha(fecha)}</strong>
                  <span className="rp-turno-confirm-hora">{hora} · {nombreRecursoSel}</span>
                </div>
                <form onSubmit={handleSubmit} className="rp-form">
                  <div className="rp-field">
                    <label className="rp-label">Nombre <span className="rp-required">*</span></label>
                    <input className="rp-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre completo" required autoFocus />
                  </div>
                  <div className="rp-field">
                    <label className="rp-label">Teléfono</label>
                    <input className="rp-input" value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="+53 5…" type="tel" />
                  </div>
                  <div className="rp-field">
                    <label className="rp-label">Notas</label>
                    <input className="rp-input" value={notas} onChange={e => setNotas(e.target.value)} placeholder="Algo que debamos saber…" />
                  </div>
                  <input type="text" className="rp-hp" name="hp" tabIndex={-1} autoComplete="off"
                    aria-hidden="true" value={hp} onChange={e => setHp(e.target.value)} />
                  {error && <div className="rp-error">{error}</div>}
                  <button type="submit" className="rp-btn-primary" disabled={isPending}>
                    {isPending ? <Loader2 size={16} className="rp-spin" /> : <Check size={16} />}
                    Confirmar cita
                  </button>
                </form>
              </div>
            )}

            {error && paso !== 'datos' && <div className="rp-error">{error}</div>}
          </>
        )}
      </div>
    </div>
  )
}
