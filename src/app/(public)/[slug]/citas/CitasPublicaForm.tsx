'use client'

import { useState, useTransition, useMemo, useEffect, useRef } from 'react'
import {
  crearCitaPublica,
  obtenerSlotsCita,
  type ServicioPublico,
  type RecursoPublico,
  type SlotCita,
} from '@/app/actions/portal/citas'
import type { EtiquetasSector } from '@/lib/sector'
import type { ReglasReserva } from '@/app/actions/portal/reservas'
import { Check, Loader2, ChevronRight } from 'lucide-react'

// Fechas en calendario LOCAL (sin toISOString/UTC) → correctas en cualquier zona.
function ymd(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function hoyISO(): string { return ymd(new Date()) }
function sumarDiasISO(dias: number): string {
  const d = new Date(); d.setDate(d.getDate() + dias)
  return ymd(d)
}
function formatFechaCorta(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
}

type Paso = 'servicio' | 'recurso' | 'horario' | 'datos' | 'revisar' | 'ok'

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
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
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

  // Auto-carga de horarios al entrar al paso y al cambiar día/profesional/servicio
  // (debounced), igual que la mini-web de Reservas: sin botón "Ver horarios".
  useEffect(() => {
    if (paso !== 'horario' || !servicioId) return
    if (debounce.current) clearTimeout(debounce.current)
    setLoadingSlots(true); setError(''); setHora(''); setHoraRecurso('')
    const recursoParam = recursoSel === 'any' ? null : recursoSel
    debounce.current = setTimeout(() => {
      obtenerSlotsCita(clientId, servicioId, recursoParam, fecha)
        .then(s => { setSlots(s); setLoadingSlots(false) })
        .catch(() => { setError('No se pudieron cargar los horarios.'); setLoadingSlots(false) })
    }, 250)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [clientId, servicioId, recursoSel, fecha, paso])

  function elegirHora(s: SlotCita) {
    setHora(s.hora); setHoraRecurso(s.recurso_id); setError(''); setPaso('datos')
  }

  // Paso intermedio: del formulario de datos al resumen de revisión (sin enviar aún).
  function handleRevisar(e: React.FormEvent) {
    e.preventDefault()
    if (!hora || !horaRecurso) { setError('Selecciona una hora.'); return }
    setError(''); setPaso('revisar')
  }

  // Envío real: ya con el resumen revisado por el cliente.
  function handleConfirmar() {
    if (!hora || !horaRecurso) { setError('Selecciona una hora.'); return }
    const fd = new FormData()
    fd.set('client_id', clientId)
    fd.set('servicio_id', servicioId)
    fd.set('recurso_id', horaRecurso)
    fd.set('fecha', fecha)
    fd.set('hora', hora)
    fd.set('nombre', nombre)
    fd.set('telefono', telefono)
    fd.set('email', email)
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

  const esHoy    = fecha === hoyISO()
  const esManana = fecha === sumarDiasISO(1)

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
            {/* Paso 1 — Servicio */}
            {paso === 'servicio' && (
              <>
                <p className="rp-subtitle">Pide tu cita en línea</p>
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

            {/* Paso 3 — Día y hora (auto-carga, sin botón intermedio) */}
            {paso === 'horario' && (
              <>
                <button className="rp-back" onClick={() => setPaso(recursosParaServicio.length === 1 ? 'servicio' : 'recurso')}>
                  ← {servicio?.nombre} · {nombreRecursoSel}
                </button>

                <div className="rp-controls">
                  <div className="rp-field">
                    <span className="rp-label">Día</span>
                    <div className="rp-day-chips">
                      <button type="button" className={`rp-chip ${esHoy ? 'rp-chip-active' : ''}`}
                        onClick={() => setFecha(hoyISO())}>Hoy</button>
                      <button type="button" className={`rp-chip ${esManana ? 'rp-chip-active' : ''}`}
                        onClick={() => setFecha(sumarDiasISO(1))}>Mañana</button>
                      <input type="date" className="rp-input rp-day-date" value={fecha} aria-label="Otro día"
                        min={hoyISO()} max={fechaMax} onChange={e => setFecha(e.target.value)} />
                    </div>
                  </div>
                </div>

                <div className="rp-turnos-section">
                  <div className="rp-turnos-day">{formatFechaCorta(fecha)}</div>
                  <div className="rp-turnos-sub">Elige una hora</div>

                  {loadingSlots ? (
                    <div className="rp-slots-loading"><Loader2 size={22} className="rp-spin" /></div>
                  ) : horasUnicas.length === 0 ? (
                    <div className="rp-empty">
                      <p className="rp-hint">No hay horarios libres ese día. Prueba con otra fecha.</p>
                    </div>
                  ) : (
                    <div className="rp-turnos-list">
                      {horasUnicas.map(s => (
                        <button key={s.hora} type="button" className="rp-turno"
                          aria-label={`${s.hora}, libre`} onClick={() => elegirHora(s)}>
                          <span className="rp-turno-hora-main">{s.hora}</span>
                          <span className="rp-turno-estado">Libre</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
                <form onSubmit={handleRevisar} className="rp-form">
                  <div className="rp-field">
                    <label className="rp-label" htmlFor="rp-c-nombre">Nombre <span className="rp-required">*</span></label>
                    <input id="rp-c-nombre" className="rp-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre completo" required autoFocus />
                  </div>
                  <div className="rp-field">
                    <label className="rp-label" htmlFor="rp-c-tel">Teléfono</label>
                    <input id="rp-c-tel" className="rp-input" value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="+53 5…" type="tel" />
                  </div>
                  <div className="rp-field">
                    <label className="rp-label" htmlFor="rp-c-email">Correo <span className="rp-required">*</span></label>
                    <input id="rp-c-email" className="rp-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="tucorreo@ejemplo.com" type="email" required />
                    <span className="rp-hint">Para confirmarte la cita.</span>
                  </div>
                  <div className="rp-field">
                    <label className="rp-label" htmlFor="rp-c-notas">Notas</label>
                    <input id="rp-c-notas" className="rp-input" value={notas} onChange={e => setNotas(e.target.value)} placeholder="Algo que debamos saber…" />
                  </div>
                  <input type="text" className="rp-hp" name="hp" tabIndex={-1} autoComplete="off"
                    aria-hidden="true" value={hp} onChange={e => setHp(e.target.value)} />
                  {error && <div className="rp-error">{error}</div>}
                  <button type="submit" className="rp-btn-primary">
                    Continuar
                    <ChevronRight size={16} />
                  </button>
                </form>
              </div>
            )}

            {/* Paso 5 — Revisar (resumen antes de confirmar) */}
            {paso === 'revisar' && (
              <div className="rp-turno-form-section">
                <p className="rp-step-label">Revisa tu cita</p>

                <div className="rp-review-group">
                  <div className="rp-review-head">
                    <span className="rp-review-title">Tu cita</span>
                    <button type="button" className="rp-edit-link"
                      onClick={() => { setPaso('horario'); setError('') }}>Cambiar</button>
                  </div>
                  <dl className="rp-review">
                    <div className="rp-review-row"><dt>{et.servicio}</dt><dd>{servicio?.nombre}</dd></div>
                    <div className="rp-review-row"><dt>{et.recurso}</dt><dd>{nombreRecursoSel}</dd></div>
                    <div className="rp-review-row"><dt>Fecha</dt><dd>{formatFecha(fecha)}</dd></div>
                    <div className="rp-review-row"><dt>Hora</dt><dd>{hora}</dd></div>
                  </dl>
                </div>

                <div className="rp-review-group">
                  <div className="rp-review-head">
                    <span className="rp-review-title">Tus datos</span>
                    <button type="button" className="rp-edit-link"
                      onClick={() => { setPaso('datos'); setError('') }}>Cambiar</button>
                  </div>
                  <dl className="rp-review">
                    <div className="rp-review-row"><dt>Nombre</dt><dd>{nombre}</dd></div>
                    {telefono && <div className="rp-review-row"><dt>Teléfono</dt><dd>{telefono}</dd></div>}
                    <div className="rp-review-row"><dt>Correo</dt><dd>{email}</dd></div>
                    {notas && <div className="rp-review-row"><dt>Notas</dt><dd>{notas}</dd></div>}
                  </dl>
                </div>

                {error && <div className="rp-error">{error}</div>}
                <button type="button" className="rp-btn-primary" disabled={isPending} onClick={handleConfirmar}>
                  {isPending ? <Loader2 size={16} className="rp-spin" /> : <Check size={16} />}
                  Confirmar cita
                </button>
              </div>
            )}

            {error && paso !== 'datos' && paso !== 'revisar' && <div className="rp-error">{error}</div>}
          </>
        )}
      </div>
    </div>
  )
}
