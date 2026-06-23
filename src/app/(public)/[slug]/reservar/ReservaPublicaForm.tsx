'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import {
  crearReservaPublica,
  obtenerSlotsAforo,
  obtenerProximoDiaAforo,
  type FranjaPublica,
  type SlotAforo,
  type ReglasReserva,
} from '@/app/actions/portal/reservas'
import { Check, Loader2, Search, ChevronRight } from 'lucide-react'

// Fechas en calendario LOCAL (sin toISOString/UTC) para que "Hoy"/"Mañana" y las
// comparaciones sean correctas en cualquier zona horaria.
function ymd(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function hoyISO(): string { return ymd(new Date()) }
function sumarDiasISO(base: string, dias: number): string {
  const [y, m, d] = base.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + dias))
}
function formatFecha(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
}
function formatFechaCorta(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function ReservaPublicaForm({
  franjas, clientId, negocio, slug, reglas,
}: {
  franjas:  FranjaPublica[]
  clientId: string
  negocio:  { nombre: string }
  slug:     string
  reglas:   ReglasReserva
}) {
  const [isPending, startTransition] = useTransition()
  const maxPersonas = reglas.max_personas > 0 ? reglas.max_personas : 20
  const fechaMax    = reglas.ventana_max_dias > 0 ? sumarDiasISO(hoyISO(), reglas.ventana_max_dias) : undefined

  const [fecha, setFecha]       = useState(hoyISO())
  const [personas, setPersonas] = useState(2)
  const [slots, setSlots]       = useState<SlotAforo[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [buscando, setBuscando] = useState(false)

  const [sel, setSel]           = useState<SlotAforo | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [nombre, setNombre]     = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail]       = useState('')
  const [notas, setNotas]       = useState('')
  const [hp, setHp]             = useState('')

  const [listo, setListo]       = useState(false)
  const [estadoFinal, setEstadoFinal] = useState<'CONFIRMADA' | 'PENDIENTE'>('PENDIENTE')
  const [tokenRes, setTokenRes] = useState<string | null>(null)

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-carga al montar y al cambiar día/personas (debounced para el stepper)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    setLoading(true); setSel(null); setError('')
    debounce.current = setTimeout(() => {
      obtenerSlotsAforo(clientId, fecha, personas)
        .then(s => { setSlots(s); setLoading(false) })
        .catch(() => { setError('No se pudo cargar la disponibilidad.'); setLoading(false) })
    }, 250)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [clientId, fecha, personas])

  const hayLibres = slots.some(s => s.libre)

  function buscarProximo() {
    setBuscando(true)
    obtenerProximoDiaAforo(clientId, personas, sumarDiasISO(fecha, 1))
      .then(r => {
        setBuscando(false)
        if (r.fecha) setFecha(r.fecha)
        else setError('No hay disponibilidad en los próximos días. Prueba con menos personas.')
      })
      .catch(() => setBuscando(false))
  }

  // Paso intermedio: del formulario de datos al resumen de revisión (sin enviar aún).
  function handleRevisar(e: React.FormEvent) {
    e.preventDefault()
    if (!sel) { setError('Selecciona una hora.'); return }
    setError('')
    setRevisando(true)
  }

  // Envío real: ya con el resumen revisado por el cliente.
  function handleConfirmar() {
    if (!sel) { setError('Selecciona una hora.'); return }
    const fd = new FormData()
    fd.set('client_id', clientId)
    fd.set('franja_id', sel.franja_id)
    fd.set('fecha', fecha)
    fd.set('hora', sel.hora)
    fd.set('personas', String(personas))
    fd.set('nombre', nombre)
    fd.set('telefono', telefono)
    fd.set('email', email)
    fd.set('notas', notas)
    fd.set('hp', hp)
    startTransition(async () => {
      const res = await crearReservaPublica(fd)
      if (!res.ok) { setError(res.error ?? 'No se pudo crear la reserva.'); return }
      setTokenRes(res.token ?? null)
      setEstadoFinal(res.estado === 'CONFIRMADA' ? 'CONFIRMADA' : 'PENDIENTE')
      setListo(true)
    })
  }

  const esHoy    = fecha === hoyISO()
  const esManana = fecha === sumarDiasISO(hoyISO(), 1)

  return (
    <div className="rp-page">
      <div className="rp-card">
        <div className="rp-card-body">

          <h1 className="rp-title">{negocio.nombre}</h1>

          {/* ── Éxito ─────────────────────────────────────────────── */}
          {listo ? (
            <div className="rp-success">
              <Check size={40} strokeWidth={2} className="rp-success-icon" />
              <p className="rp-subtitle">{estadoFinal === 'CONFIRMADA' ? '¡Reserva confirmada!' : '¡Reserva recibida!'}</p>
              <div className="rp-resumen">
                <span><strong>{formatFecha(fecha)}</strong></span>
                <span className="rp-resumen-hora">{sel?.hora} · {personas} persona{personas !== 1 ? 's' : ''}</span>
              </div>
              <p className="rp-hint">
                {estadoFinal === 'CONFIRMADA' ? '¡Te esperamos!' : 'Te avisaremos en cuanto la confirmemos.'}
              </p>
              {tokenRes && (
                <a className="rp-manage-link" href={`/${slug}/r/${tokenRes}`}>Gestionar o cancelar mi reserva</a>
              )}
            </div>

          /* ── Negocio sin turnos configurados ────────────────────── */
          ) : franjas.length === 0 ? (
            <>
              <p className="rp-subtitle">Reservas</p>
              <p className="rp-hint">Este negocio aún no tiene horarios de reserva disponibles.</p>
            </>

          /* ── Paso revisar (resumen antes de confirmar) ──────────── */
          ) : revisando ? (
            <div className="rp-turno-form-section">
              <p className="rp-subtitle">Revisa tu reserva</p>

              <div className="rp-review-group">
                <div className="rp-review-head">
                  <span className="rp-review-title">Tu reserva</span>
                  <button type="button" className="rp-edit-link"
                    onClick={() => { setRevisando(false); setSel(null); setError('') }}>Cambiar</button>
                </div>
                <dl className="rp-review">
                  <div className="rp-review-row"><dt>Fecha</dt><dd>{formatFecha(fecha)}</dd></div>
                  <div className="rp-review-row"><dt>Hora</dt><dd>{sel?.hora}</dd></div>
                  <div className="rp-review-row"><dt>Personas</dt><dd>{personas}</dd></div>
                </dl>
              </div>

              <div className="rp-review-group">
                <div className="rp-review-head">
                  <span className="rp-review-title">Tus datos</span>
                  <button type="button" className="rp-edit-link"
                    onClick={() => { setRevisando(false); setError('') }}>Cambiar</button>
                </div>
                <dl className="rp-review">
                  <div className="rp-review-row"><dt>Nombre</dt><dd>{nombre}</dd></div>
                  <div className="rp-review-row"><dt>Teléfono</dt><dd>{telefono}</dd></div>
                  <div className="rp-review-row"><dt>Correo</dt><dd>{email}</dd></div>
                  {notas && <div className="rp-review-row"><dt>Notas</dt><dd>{notas}</dd></div>}
                </dl>
              </div>

              {error && <div className="rp-error">{error}</div>}

              <button type="button" className="rp-btn-primary" disabled={isPending} onClick={handleConfirmar}>
                {isPending ? <Loader2 size={16} className="rp-spin" /> : <Check size={16} />}
                Confirmar reserva
              </button>
            </div>

          /* ── Paso datos ─────────────────────────────────────────── */
          ) : sel ? (
            <div className="rp-turno-form-section">
              <button className="rp-back" onClick={() => { setSel(null); setRevisando(false); setError('') }}>← Elegir otra hora</button>
              <div className="rp-turno-confirm">
                <strong>{formatFecha(fecha)} · {sel.hora}</strong>
                <span className="rp-turno-confirm-hora">{personas} persona{personas !== 1 ? 's' : ''}</span>
              </div>
              <form onSubmit={handleRevisar} className="rp-form">
                <div className="rp-field">
                  <label className="rp-label" htmlFor="rp-nombre">Nombre <span className="rp-required">*</span></label>
                  <input id="rp-nombre" className="rp-input" value={nombre} onChange={e => setNombre(e.target.value)}
                    placeholder="Tu nombre completo" required autoFocus />
                </div>
                <div className="rp-field">
                  <label className="rp-label" htmlFor="rp-tel">Teléfono <span className="rp-required">*</span></label>
                  <input id="rp-tel" className="rp-input" value={telefono} onChange={e => setTelefono(e.target.value)}
                    placeholder="+53 5…" type="tel" required />
                </div>
                <div className="rp-field">
                  <label className="rp-label" htmlFor="rp-email">Correo <span className="rp-required">*</span></label>
                  <input id="rp-email" className="rp-input" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="tucorreo@ejemplo.com" type="email" required />
                  <span className="rp-hint">Para confirmarte la reserva.</span>
                </div>
                <div className="rp-field">
                  <label className="rp-label" htmlFor="rp-notas">Notas</label>
                  <input id="rp-notas" className="rp-input" value={notas} onChange={e => setNotas(e.target.value)}
                    placeholder="Alergias, ocasión especial…" />
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

          /* ── Paso elegir día/personas/hora ──────────────────────── */
          ) : (
            <>
              <p className="rp-subtitle">Haz tu reserva</p>

              <div className="rp-controls">
                <div className="rp-field">
                  <span className="rp-label">Día</span>
                  <div className="rp-day-chips">
                    <button type="button" className={`rp-chip ${esHoy ? 'rp-chip-active' : ''}`}
                      onClick={() => setFecha(hoyISO())}>Hoy</button>
                    <button type="button" className={`rp-chip ${esManana ? 'rp-chip-active' : ''}`}
                      onClick={() => setFecha(sumarDiasISO(hoyISO(), 1))}>Mañana</button>
                    <input type="date" className="rp-input rp-day-date" value={fecha} aria-label="Otro día"
                      min={hoyISO()} max={fechaMax} onChange={e => setFecha(e.target.value)} />
                  </div>
                </div>

                <div className="rp-field">
                  <span className="rp-label">Personas</span>
                  <div className="rp-stepper">
                    <button type="button" className="rp-btn-stepper" aria-label="Quitar persona"
                      onClick={() => setPersonas(p => Math.max(1, p - 1))}>−</button>
                    <span className="rp-stepper-val" aria-live="polite">{personas}</span>
                    <button type="button" className="rp-btn-stepper" aria-label="Añadir persona"
                      onClick={() => setPersonas(p => Math.min(maxPersonas, p + 1))}>+</button>
                  </div>
                </div>
              </div>

              <div className="rp-turnos-section">
                <div className="rp-turnos-day">{formatFechaCorta(fecha)}</div>
                <div className="rp-turnos-sub">{personas} persona{personas !== 1 ? 's' : ''} · Elige una hora</div>

                {loading ? (
                  <div className="rp-slots-loading"><Loader2 size={22} className="rp-spin" /></div>
                ) : slots.length === 0 || !hayLibres ? (
                  <div className="rp-empty">
                    <p className="rp-hint">{slots.length === 0 ? 'No hay horarios para este día.' : 'No quedan horas libres este día.'}</p>
                    <button type="button" className="rp-btn-secondary" onClick={buscarProximo} disabled={buscando}>
                      {buscando ? <Loader2 size={16} className="rp-spin" /> : <Search size={16} />}
                      Buscar próximo día disponible
                    </button>
                    {error && <div className="rp-error">{error}</div>}
                  </div>
                ) : (
                  <div className="rp-turnos-list">
                    {slots.map(s => (
                      <button key={s.hora}
                        className={`rp-turno ${!s.libre ? 'rp-turno-full' : ''}`}
                        disabled={!s.libre}
                        aria-label={`${s.hora}, ${s.libre ? 'libre' : 'lleno'}`}
                        onClick={() => { setSel(s); setError('') }}>
                        <span className="rp-turno-hora-main">{s.hora}</span>
                        <span className={`rp-turno-estado ${s.libre ? '' : 'rp-turno-estado-full'}`}>
                          {s.libre ? 'Libre' : 'Lleno'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {!loading && error && hayLibres && <div className="rp-error">{error}</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
