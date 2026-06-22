'use client'

import { useState } from 'react'
import { guardarDiagnostico } from '@/app/actions/diagnostico'
import { CheckIcon, ArrowRightIcon, ArrowLeftIcon, SendIcon } from './icons'

/* ════════════════════════════════════════════════
   Data
   ════════════════════════════════════════════════ */

const STEPS = ['Tipo de negocio', '¿Qué necesitas?', '¿Cómo lo haces hoy?', 'Tus datos', 'Informe']
const TOTAL_STEPS = 5

const SECTORES = [
  { id: 'restaurante', label: 'Restaurante / Bar / Cafetería', icon: UtensilsIcon },
  { id: 'peluqueria', label: 'Peluquería / Barbería / Salón', icon: ScissorsIcon },
  { id: 'gimnasio', label: 'Gimnasio / Centro deportivo', icon: DumbbellIcon },
  { id: 'clinica', label: 'Clínica / Consultorio', icon: HeartIcon },
  { id: 'tienda', label: 'Tienda / Comercio', icon: StoreIcon },
  { id: 'otro', label: 'Otro servicio', icon: BriefcaseIcon },
]

const NECESIDADES = [
  { id: 'ventas', label: 'Gestionar ventas y facturación' },
  { id: 'inventario', label: 'Control de inventario y compras' },
  { id: 'catalogo', label: 'Catálogo / Menú digital con QR' },
  { id: 'reservas', label: 'Reservas online (mesas, aforo)' },
  { id: 'citas', label: 'Citas por agenda' },
  { id: 'rrhh', label: 'Gestionar empleados y nómina' },
  { id: 'ia', label: 'Chat con clientes por Telegram' },
]

const MODOS = [
  { id: 'papel', label: 'Papel / libreta', desc: 'Apuntas todo a mano' },
  { id: 'excel', label: 'Excel / Hojas de cálculo', desc: 'Usas hojas de cálculo para llevar las cuentas' },
  { id: 'nada', label: 'Nada, empiezo desde cero', desc: 'No tienes nada digitalizado aún' },
  { id: 'otra', label: 'Otra herramienta', desc: 'Usas otro sistema pero quieres cambiar' },
]

interface ModuloInfo {
  name: string
  desc: string
}

const MODULOS_INFO: Record<string, ModuloInfo> = {
  base:      { name: 'Base contable', desc: 'Ventas, gastos, tesorería, reportes. Incluida siempre.' },
  inventario:{ name: 'Inventario', desc: 'Productos, almacenes, compras y control de stock.' },
  rrhh:      { name: 'RRHH', desc: 'Personal, contratos, turnos y nómina simple.' },
  catalogo:  { name: 'Catálogo digital QR', desc: 'Menú o catálogo de servicios que tus clientes ven al escanear un QR.' },
  reservas:  { name: 'Reservas', desc: 'Reservas por franja horaria con control de aforo. Ideal para mesas.' },
  citas:     { name: 'Citas', desc: 'Agenda por profesional con servicios de duración. Para peluquerías y clínicas.' },
  ia:        { name: 'Asistente IA', desc: 'Chat automático con tus clientes vía Telegram.' },
}

function generarRecomendacion(
  sector: string,
  necesidades: string[],
): { modulos: string[]; precioMin: number; precioMax: number } {
  const modulos = new Set<string>(['base'])

  if (necesidades.includes('inventario')) modulos.add('inventario')
  if (necesidades.includes('rrhh')) modulos.add('rrhh')
  if (necesidades.includes('catalogo')) modulos.add('catalogo')
  if (necesidades.includes('reservas')) modulos.add('reservas')
  if (necesidades.includes('citas')) modulos.add('citas')
  if (necesidades.includes('ia')) modulos.add('ia')

  if (sector === 'restaurante') {
    modulos.add('catalogo')
    if (!necesidades.includes('reservas') && !necesidades.includes('citas')) modulos.add('reservas')
  }
  if (sector === 'peluqueria') {
    modulos.add('citas')
    modulos.add('catalogo')
  }
  if (sector === 'gimnasio') {
    modulos.add('citas')
  }
  if (sector === 'clinica') {
    modulos.add('citas')
  }
  if (sector === 'tienda') {
    modulos.add('catalogo')
    modulos.add('inventario')
  }

  const precios: Record<string, [number, number]> = {
    inventario: [8, 14],
    rrhh: [8, 14],
    catalogo: [10, 18],
    reservas: [10, 18],
    citas: [10, 18],
    ia: [15, 25],
  }

  let precioMin = 20
  let precioMax = 35

  for (const m of modulos) {
    if (precios[m]) {
      precioMin += precios[m][0]
      precioMax += precios[m][1]
    }
  }

  return {
    modulos: Array.from(modulos).filter((m) => m !== 'base'),
    precioMin,
    precioMax,
  }
}

/* ════════════════════════════════════════════════
   Component
   ════════════════════════════════════════════════ */

export function DiagnosticoForm() {
  const [step, setStep] = useState(0)
  const [sector, setSector] = useState('')
  const [necesidades, setNecesidades] = useState<string[]>([])
  const [modoActual, setModoActual] = useState('')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [recomendacion, setRecomendacion] = useState<{
    modulos: string[]
    precioMin: number
    precioMax: number
    nombre: string
    telefono: string
    email: string
  } | null>(null)

  const progressPct = ((step + 1) / TOTAL_STEPS) * 100

  function next() {
    const errs: Record<string, string> = {}

    if (step === 0 && !sector) errs.sector = 'Selecciona el tipo de negocio.'
    if (step === 1 && necesidades.length === 0) errs.necesidades = 'Selecciona al menos una opción.'
    if (step === 2 && !modoActual) errs.modoActual = 'Selecciona una opción.'
    if (step === 3) {
      if (!nombre.trim()) errs.nombre = 'El nombre es obligatorio.'
      if (!telefono.trim()) errs.telefono = 'El teléfono es obligatorio.'
      if (!email.trim()) errs.email = 'El email es obligatorio.'
    }

    if (Object.keys(errs).length > 0) {
      setErrores(errs)
      return
    }

    setErrores({})

    if (step === 3) {
      const rec = generarRecomendacion(sector, necesidades)
      setRecomendacion({
        ...rec,
        nombre: nombre.trim(),
        telefono: telefono.trim(),
        email: email.trim(),
      })
      guardarYAvanzar(rec.modulos)
      return
    }

    setStep(step + 1)
  }

  async function guardarYAvanzar(modulosRec: string[]) {
    setSubmitting(true)
    setSubmitError('')

    const resultado = await guardarDiagnostico({
      nombre,
      telefono,
      email,
      sector,
      necesidades,
      modoActual,
      modulosRec,
    })

    setSubmitting(false)

    if (!resultado.ok) {
      setSubmitError(resultado.error ?? 'Error al guardar. Intenta de nuevo.')
      return
    }

    setStep(4)
  }

  function back() {
    if (step > 0) setStep(step - 1)
  }

  return (
    <div>
      {/* Progress */}
      <div className="dg-progress">
        <div className="dg-progress-bar">
          <div
            className="dg-progress-fill"
            style={{ width: `${progressPct}%` } as React.CSSProperties}
          />
        </div>
        <div className="dg-progress-steps">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={`dg-progress-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Step 0: Sector */}
      {step === 0 && (
        <div className="dg-step-content">
          <h2 className="dg-step-title">¿Qué tipo de negocio tienes?</h2>
          <p className="dg-step-subtitle">
            Así te recomendamos los módulos que mejor se adaptan a tu sector.
          </p>
          <div className="dg-options">
            {SECTORES.map((s) => (
              <div
                key={s.id}
                className={`dg-option-card ${sector === s.id ? 'selected' : ''}`}
                onClick={() => { setSector(s.id); setErrores({}) }}
              >
                {s.icon}
                <span className="dg-option-card-label">{s.label}</span>
              </div>
            ))}
          </div>
          {errores.sector && <p className="dg-form-error mt-3">{errores.sector}</p>}
          <div className="dg-form-actions dg-form-actions-end">
            <button className="btn btn-primary" onClick={next}>
              Siguiente <ArrowRightIcon />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Needs */}
      {step === 1 && (
        <div className="dg-step-content">
          <h2 className="dg-step-title">¿Qué necesitas para tu negocio?</h2>
          <p className="dg-step-subtitle">
            Selecciona todo lo que te interesa. Puedes marcar varias opciones.
          </p>
          <div className="dg-options">
            {NECESIDADES.map((n) => {
              const sel = necesidades.includes(n.id)
              return (
                <div
                  key={n.id}
                  className={`dg-option-check ${sel ? 'selected' : ''}`}
                  onClick={() => {
                    setNecesidades(
                      sel
                        ? necesidades.filter((x) => x !== n.id)
                        : [...necesidades, n.id],
                    )
                    setErrores({})
                  }}
                >
                  <div className="dg-option-check-box">
                    {sel && <CheckIcon />}
                  </div>
                  <span className="dg-option-check-label">{n.label}</span>
                </div>
              )
            })}
          </div>
          {errores.necesidades && (
            <p className="dg-form-error mt-3">{errores.necesidades}</p>
          )}
          <div className="dg-form-actions">
            <button className="btn btn-ghost" onClick={back}>
              <ArrowLeftIcon /> Atrás
            </button>
            <button className="btn btn-primary" onClick={next}>
              Siguiente <ArrowRightIcon />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Modo actual */}
      {step === 2 && (
        <div className="dg-step-content">
          <h2 className="dg-step-title">¿Cómo gestionas tu negocio hoy?</h2>
          <p className="dg-step-subtitle">
            No hay respuesta incorrecta. Nos ayuda a entender tu punto de partida.
          </p>
          <div className="dg-options">
            {MODOS.map((m) => (
              <div
                key={m.id}
                className={`dg-option-radio ${modoActual === m.id ? 'selected' : ''}`}
                onClick={() => { setModoActual(m.id); setErrores({}) }}
              >
                <div className="dg-option-radio-dot" />
                <div>
                  <div className="dg-option-radio-label">{m.label}</div>
                  <div className="text-xs-muted">{m.desc}</div>
                </div>
              </div>
            ))}
          </div>
          {errores.modoActual && (
            <p className="dg-form-error mt-3">{errores.modoActual}</p>
          )}
          <div className="dg-form-actions">
            <button className="btn btn-ghost" onClick={back}>
              <ArrowLeftIcon /> Atrás
            </button>
            <button className="btn btn-primary" onClick={next}>
              Siguiente <ArrowRightIcon />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Contact */}
      {step === 3 && (
        <div className="dg-step-content">
          <h2 className="dg-step-title">¿Dónde te contactamos?</h2>
          <p className="dg-step-subtitle">
            Déjanos tus datos y te contactamos lo antes posible para preparar tu solución.
          </p>
          <div className="dg-form">
            <div className="dg-form-group">
              <label htmlFor="dg-nombre">
                Nombre <span className="required">*</span>
              </label>
              <input
                id="dg-nombre"
                className="dg-form-input"
                placeholder="Tu nombre completo"
                value={nombre}
                onChange={(e) => { setNombre(e.target.value); setErrores({}) }}
              />
              {errores.nombre && (
                <span className="dg-form-error">{errores.nombre}</span>
              )}
            </div>
            <div className="dg-form-group">
              <label htmlFor="dg-telefono">
                Teléfono <span className="required">*</span>
              </label>
              <input
                id="dg-telefono"
                className="dg-form-input"
                placeholder="+53 5XXXXXXX"
                value={telefono}
                onChange={(e) => { setTelefono(e.target.value); setErrores({}) }}
              />
              {errores.telefono && (
                <span className="dg-form-error">{errores.telefono}</span>
              )}
            </div>
            <div className="dg-form-group">
              <label htmlFor="dg-email">
                Correo electrónico <span className="required">*</span>
              </label>
              <input
                id="dg-email"
                className="dg-form-input"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrores({}) }}
              />
              {errores.email && (
                <span className="dg-form-error">{errores.email}</span>
              )}
            </div>
          </div>
          {submitError && (
            <div className="alert alert-error mt-4">
              <span>{submitError}</span>
            </div>
          )}
          <div className="dg-form-actions">
            <button className="btn btn-ghost" onClick={back}>
              <ArrowLeftIcon /> Atrás
            </button>
            <button
              className="btn btn-primary"
              onClick={next}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <span className="spinner spinner-sm" /> Guardando...
                </>
              ) : (
                <>
                  Ver mi informe <SendIcon />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Report */}
      {step === 4 && recomendacion && (
        <div className="dg-report">
          <div className="dg-report-header">
            <div className="dg-report-icon">
              <CheckIcon large />
            </div>
            <h2 className="dg-report-title">
              {recomendacion.nombre.split(' ')[0]}, esto es lo que CLAUX puede hacer por ti
            </h2>
            <p className="dg-report-subtitle">
              Según lo que nos has contado, estos son los módulos que mejor se adaptan a tu negocio.
            </p>
          </div>

          <div className="dg-report-modules">
            {['base', ...recomendacion.modulos].map((modId) => {
              const info = MODULOS_INFO[modId]
              if (!info) return null
              return (
                <div key={modId} className="dg-report-module">
                  <div className="dg-report-module-icon">
                    <CheckIcon />
                  </div>
                  <div>
                    <div className="dg-report-module-name">{info.name}</div>
                    <div className="dg-report-module-desc">{info.desc}</div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="dg-report-cta">
            <p className="dg-step-subtitle">
              Te contactaremos pronto para resolver tus dudas y ponerte en marcha.
              Sin compromiso.
            </p>
            <div className="ld-hero-actions">
              <span className="btn btn-primary btn-lg">
                Te llamamos gratis
              </span>
              <span className="btn btn-secondary btn-lg">
                Agendar una cita
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Submitting state — spinner shown inline in the button */}
    </div>
  )
}

/* ════════════════════════════════════════════════
   Icons
   ════════════════════════════════════════════════ */

function UtensilsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </svg>
  )
}

function ScissorsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </svg>
  )
}

function DumbbellIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6.5 6.5h11v11H6.5z" />
      <path d="M3 7.5h3.5v9H3zM17.5 7.5H21v9h-3.5z" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  )
}

function StoreIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
    </svg>
  )
}

function BriefcaseIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  )
}
