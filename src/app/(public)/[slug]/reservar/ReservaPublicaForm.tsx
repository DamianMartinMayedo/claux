'use client'

import { useState, useTransition, useMemo } from 'react'
import {
  crearReservaPublica,
  obtenerDisponibilidadPublica,
  type FranjaPublica,
} from '@/app/actions/portal/reservas'
import { Calendar, Check, Loader2 } from 'lucide-react'

function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function horaActual(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface Slot {
  franja_id: string
  franja_nombre: string
  hora: string
  disponible: boolean
}

function isodowDe(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() // 0=Dom … 6=Sáb
  return dow === 0 ? 7 : dow                  // 1=Lun … 7=Dom
}

function generarSlots(franjas: FranjaPublica[], fecha: string): Slot[] {
  const isodow = isodowDe(fecha)
  const slots: Slot[] = []
  for (const f of franjas) {
    // Respetar los días de la semana del turno (NULL/vacío = todos los días)
    if (f.dias_semana && f.dias_semana.length > 0 && !f.dias_semana.includes(isodow)) continue
    if (f.hora_inicio && f.hora_fin) {
      const [hIni, mIni] = f.hora_inicio.split(':').map(Number)
      const [hFin, mFin] = f.hora_fin.split(':').map(Number)
      const inicio = hIni * 60 + mIni
      const fin    = hFin * 60 + mFin
      for (let t = inicio; t < fin; t += 30) {
        const hh = String(Math.floor(t / 60)).padStart(2, '0')
        const mm = String(t % 60).padStart(2, '0')
        slots.push({ franja_id: f.franja_id, franja_nombre: f.nombre, hora: `${hh}:${mm}`, disponible: false })
      }
    } else {
      // Fallback para franjas sin hora definida (el dueño debe completarlas)
      slots.push({ franja_id: f.franja_id, franja_nombre: f.nombre, hora: '12:00', disponible: false })
    }
  }
  return slots
}

export default function ReservaPublicaForm({
  franjas, clientId, negocio, slug,
}: {
  franjas:  FranjaPublica[]
  clientId: string
  negocio:  { nombre: string }
  slug:     string
}) {
  const [isPending, startTransition] = useTransition()

  const [fecha, setFecha] = useState(hoyISO())
  const [personas, setPersonas] = useState(2)
  const [franjaId, setFranjaId] = useState('')
  const [hora, setHora] = useState('')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [notas, setNotas] = useState('')
  const [hp, setHp] = useState('')   // honeypot anti-bots

  const slotsBase = useMemo(() => generarSlots(franjas, fecha), [franjas, fecha])
  const [slots, setSlots] = useState<Slot[]>([])
  const [consultado, setConsultado] = useState(false)
  const [loadingDisp, setLoadingDisp] = useState(false)
  const [mostrandoForm, setMostrandoForm] = useState(false)
  const [listo, setListo] = useState(false)
  const [tokenRes, setTokenRes] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Filtrar slots pasados cuando se consulta para hoy
  const slotsVisibles = useMemo(() => {
    if (fecha !== hoyISO()) return slots
    const ahora = horaActual()
    return slots.filter(s => s.hora > ahora)
  }, [slots, fecha])

  // Agrupar slots por franja para la UI
  const slotsPorFranja = agruparPorFranja(slotsVisibles)

  function cargarDisponibilidad(f: string) {
    if (!f) return
    setLoadingDisp(true)
    setError('')
    setConsultado(true)
    setFranjaId('')
    setHora('')
    setMostrandoForm(false)
    Promise.all(slotsBase.map(s =>
      obtenerDisponibilidadPublica(clientId, s.franja_id, f, s.hora)
        .then(r => ({ ...s, disponible: r.disponibles >= personas }))
    )).then(results => {
      setSlots(results)
      setLoadingDisp(false)
    }).catch(() => {
      setError('Error al consultar disponibilidad.')
      setLoadingDisp(false)
    })
  }

  function elegirHora(s: Slot) {
    setFranjaId(s.franja_id)
    setHora(s.hora)
    setMostrandoForm(true)
    setError('')
  }

  function handleVerTurnos(e: React.FormEvent) {
    e.preventDefault()
    cargarDisponibilidad(fecha)
  }

  function handleReservaSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!franjaId || !hora) { setError('Selecciona una hora.'); return }
    const fd = new FormData()
    fd.set('client_id', clientId)
    fd.set('franja_id', franjaId)
    fd.set('fecha', fecha)
    fd.set('hora', hora)
    fd.set('personas', String(personas))
    fd.set('nombre', nombre)
    fd.set('telefono', telefono)
    fd.set('notas', notas)
    fd.set('hp', hp)
    startTransition(async () => {
      const res = await crearReservaPublica(fd)
      if (!res.ok) { setError(res.error ?? 'Error al crear la reserva.'); return }
      setTokenRes(res.token ?? null)
      setListo(true)
    })
  }

  function formatFecha(f: string): string {
    const [y, m, d] = f.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  }
  function formatHora(h: string): string { return h.substring(0, 5) }

  const slotSel = slots.find(s => s.franja_id === franjaId && s.hora === hora)

  return (
    <div className="rp-page">
      <div className="rp-card">
        <div className="rp-card-body">

          <h1 className="rp-title">{negocio.nombre}</h1>

          {listo ? (
            <div className="rp-success">
              <Check size={40} strokeWidth={2} className="rp-success-icon" />
              <p className="rp-subtitle">¡Reserva enviada!</p>
              <div className="rp-resumen">
                <span><strong>{formatFecha(fecha)}</strong></span>
                <span className="rp-resumen-hora">{formatHora(hora)} · {personas} persona{personas !== 1 ? 's' : ''}</span>
              </div>
              <p className="rp-hint">Te contactaremos para confirmar.</p>
              {tokenRes && (
                <a className="rp-manage-link" href={`/${slug}/r/${tokenRes}`}>Gestionar o cancelar mi reserva</a>
              )}
            </div>
          ) : (
            <>
              <p className="rp-subtitle">Reserva tu mesa</p>

              <form onSubmit={handleVerTurnos}>
                <div className="rp-inline-fields">
                  <div className="rp-field">
                    <label className="rp-label">Día</label>
                    <input type="date" className="rp-input" value={fecha}
                      min={hoyISO()} onChange={e => setFecha(e.target.value)} />
                  </div>
                  <div className="rp-field">
                    <label className="rp-label">Personas</label>
                    <div className="rp-stepper">
                      <button type="button" className="rp-btn-stepper" onClick={() => setPersonas(p => Math.max(1, p - 1))}>−</button>
                      <span className="rp-stepper-val">{personas}</span>
                      <button type="button" className="rp-btn-stepper" onClick={() => setPersonas(p => Math.min(20, p + 1))}>+</button>
                    </div>
                  </div>
                </div>

                <button type="submit" className="rp-btn-primary" disabled={loadingDisp}>
                  {loadingDisp ? <Loader2 size={16} className="rp-spin" /> : <Calendar size={16} />}
                  Ver disponibilidad
                </button>
              </form>

              {/* Slots horarios (aparecen tras consultar) */}
              {consultado && !mostrandoForm && (
                <div className="rp-turnos-section">
                  {slotsVisibles.length === 0 ? (
                    <p className="rp-hint">
                      {slots.length === 0
                        ? 'No hay horarios disponibles para este día.'
                        : 'Ya pasaron todos los horarios de hoy. Prueba con otro día.'}
                    </p>
                  ) : (
                    <>
                      <div className="rp-turnos-day">{formatFecha(fecha)}</div>
                      <div className="rp-turnos-sub">{personas} persona{personas !== 1 ? 's' : ''} · Elige una hora</div>

                      {slotsPorFranja.map(grupo => (
                        <div key={grupo.franjaId} className="rp-turnos-grupo">
                          <div className="rp-turnos-grupo-label">{grupo.nombre}</div>
                          <div className="rp-turnos-list">
                            {grupo.slots.map(s => (
                              <button key={s.hora}
                                className={`rp-turno ${!s.disponible ? 'rp-turno-full' : ''}`}
                                disabled={!s.disponible}
                                onClick={() => elegirHora(s)}>
                                <span className="rp-turno-hora-main">{formatHora(s.hora)}</span>
                                <span className={`rp-turno-estado ${s.disponible ? '' : 'rp-turno-estado-full'}`}>
                                  {s.disponible ? 'Libre' : 'Lleno'}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* Formulario de datos */}
              {mostrandoForm && slotSel && (
                <div className="rp-turno-form-section">
                  <button className="rp-back" onClick={() => { setMostrandoForm(false); setFranjaId(''); setHora(''); setError('') }}>
                    ← Elegir otra hora
                  </button>

                  <div className="rp-turno-confirm">
                    <strong>{formatFecha(fecha)} · {formatHora(slotSel.hora)}</strong>
                    <span className="rp-turno-confirm-hora">{personas} persona{personas !== 1 ? 's' : ''}</span>
                  </div>

                  <form onSubmit={handleReservaSubmit} className="rp-form">
                    <div className="rp-field">
                      <label className="rp-label">Nombre <span className="rp-required">*</span></label>
                      <input className="rp-input" value={nombre} onChange={e => setNombre(e.target.value)}
                        placeholder="Tu nombre completo" required autoFocus />
                    </div>
                    <div className="rp-field">
                      <label className="rp-label">Teléfono</label>
                      <input className="rp-input" value={telefono} onChange={e => setTelefono(e.target.value)}
                        placeholder="+53 5…" type="tel" />
                    </div>
                    <div className="rp-field">
                      <label className="rp-label">Notas</label>
                      <input className="rp-input" value={notas} onChange={e => setNotas(e.target.value)}
                        placeholder="Alergias, ocasión especial…" />
                    </div>

                    <input type="text" className="rp-hp" name="hp" tabIndex={-1} autoComplete="off"
                      aria-hidden="true" value={hp} onChange={e => setHp(e.target.value)} />

                    {error && <div className="rp-error">{error}</div>}

                    <button type="submit" className="rp-btn-primary" disabled={isPending}>
                      {isPending ? <Loader2 size={16} className="rp-spin" /> : <Check size={16} />}
                      Confirmar reserva
                    </button>
                  </form>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function agruparPorFranja(slots: Slot[]): { franjaId: string; nombre: string; slots: Slot[] }[] {
  const map = new Map<string, { franjaId: string; nombre: string; slots: Slot[] }>()
  for (const s of slots) {
    const g = map.get(s.franja_id)
    if (g) { g.slots.push(s) }
    else   { map.set(s.franja_id, { franjaId: s.franja_id, nombre: s.franja_nombre, slots: [s] }) }
  }
  return Array.from(map.values())
}
