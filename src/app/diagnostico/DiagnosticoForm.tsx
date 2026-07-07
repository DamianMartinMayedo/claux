'use client'

import { useState } from 'react'
import { guardarDiagnostico } from '@/app/actions/diagnostico'
import { generarRecomendacion } from '@/lib/publico/recomendacion'
import type {
  EtiquetasSector,
  ModuloPublico,
  NecesidadPublica,
  SectorPublico,
} from '@/lib/publico/tipos'
import { ETIQUETAS_DEFAULT } from '@/lib/sector'
import { iconoSector } from '@/components/publico/iconos'
import { CheckIcon, ArrowRightIcon, ArrowLeftIcon, SendIcon } from './icons'

/* ════════════════════════════════════════════════
   Datos fijos (no del catálogo): pasos y modo actual
   ════════════════════════════════════════════════ */

const STEPS = ['Tipo de negocio', '¿Qué necesitas?', '¿Cómo lo haces hoy?', 'Tus datos', 'Informe']
const TOTAL_STEPS = STEPS.length

const MODOS = [
  { id: 'papel', label: 'Papel / libreta', desc: 'Apuntas todo a mano' },
  { id: 'excel', label: 'Excel / Hojas de cálculo', desc: 'Llevas las cuentas en hojas de cálculo' },
  { id: 'nada', label: 'Nada, empiezo desde cero', desc: 'No tienes nada digitalizado aún' },
  { id: 'otra', label: 'Otra herramienta', desc: 'Usas otro sistema pero quieres cambiar' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Adapta el nombre/descripción de un módulo al sector elegido (etiquetas). */
function adaptarModulo(m: ModuloPublico, et: EtiquetasSector): { nombre: string; desc: string } {
  switch (m.clave) {
    case 'base':
      return { nombre: 'Contabilidad', desc: 'Ventas, gastos, tesorería y reportes. Incluida siempre.' }
    case 'catalogo_qr':
      return {
        nombre: `Catálogo digital (${et.catalogo})`,
        desc: `Tu ${et.catalogo.toLowerCase()} con fotos y precios, que tus clientes ven al escanear un QR.`,
      }
    case 'reservas_citas':
      return {
        nombre: et.reservas,
        desc: `${et.reservas} por franja con control de aforo. Tus clientes reservan online o por Telegram.`,
      }
    case 'agenda':
      return {
        nombre: et.reservas,
        desc: `Agenda por ${et.recurso.toLowerCase()}: ${et.servicio.toLowerCase()} con duración, reserva pública y bot.`,
      }
    default:
      return { nombre: m.nombre, desc: m.descripcion }
  }
}

/* ════════════════════════════════════════════════
   Componente
   ════════════════════════════════════════════════ */

interface Props {
  modulos: ModuloPublico[]
  sectores: SectorPublico[]
  necesidades: NecesidadPublica[]
}

export function DiagnosticoForm({ modulos, sectores, necesidades: necesidadesOpts }: Props) {
  const ordenModulo = new Map(modulos.map((m, i) => [m.clave, i]))

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
  const [recClaves, setRecClaves] = useState<string[] | null>(null)
  const [contactado, setContactado] = useState(false)

  const progressPct = ((step + 1) / TOTAL_STEPS) * 100
  const sectorSel = sectores.find((s) => s.sector === sector)

  function next() {
    const errs: Record<string, string> = {}

    if (step === 0 && !sector) errs.sector = 'Selecciona el tipo de negocio.'
    if (step === 1 && necesidades.length === 0) errs.necesidades = 'Selecciona al menos una opción.'
    if (step === 2 && !modoActual) errs.modoActual = 'Selecciona una opción.'
    if (step === 3) {
      if (!nombre.trim()) errs.nombre = 'El nombre es obligatorio.'
      if (!telefono.trim()) errs.telefono = 'El teléfono es obligatorio.'
      if (!email.trim()) errs.email = 'El correo es obligatorio.'
      else if (!EMAIL_RE.test(email.trim())) errs.email = 'Escribe un correo válido.'
    }

    if (Object.keys(errs).length > 0) {
      setErrores(errs)
      return
    }
    setErrores({})

    if (step === 3) {
      guardarYAvanzar()
      return
    }
    setStep(step + 1)
  }

  async function guardarYAvanzar() {
    setSubmitting(true)
    setSubmitError('')

    const claves = generarRecomendacion(sector, necesidades, sectores, necesidadesOpts)

    const resultado = await guardarDiagnostico({
      nombre,
      telefono,
      email,
      sector,
      necesidades,
      modoActual,
      modulosRec: claves,
    })

    setSubmitting(false)

    if (!resultado.ok) {
      setSubmitError(resultado.error ?? 'Error al guardar. Intenta de nuevo.')
      return
    }

    setRecClaves(claves)
    setStep(4)
  }

  function back() {
    if (step > 0) setStep(step - 1)
  }

  return (
    <div>
      {/* Progreso */}
      <div className="dg-progress">
        <div className="dg-progress-bar">
          <div
            className="dg-progress-fill"
            style={{ '--dg-progress': `${progressPct}%` } as React.CSSProperties}
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

      {/* Paso 0: sector */}
      {step === 0 && (
        <div className="dg-step-content">
          <h2 className="dg-step-title">¿Qué tipo de negocio tienes?</h2>
          <p className="dg-step-subtitle">
            Así te recomendamos los módulos que mejor se adaptan a tu sector.
          </p>
          <fieldset className="dg-fieldset">
            <legend className="dg-sr-only">Tipo de negocio</legend>
            <div className="dg-options">
              {sectores.map((s) => {
                const Icon = iconoSector(s.sector)
                return (
                  <label key={s.sector} className="dg-option-card">
                    <input
                      type="radio"
                      name="sector"
                      className="dg-option-input"
                      value={s.sector}
                      checked={sector === s.sector}
                      onChange={() => {
                        setSector(s.sector)
                        setErrores({})
                      }}
                    />
                    <Icon size={28} />
                    <span className="dg-option-card-label">{s.nombre}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          {errores.sector && <p className="dg-form-error dg-error-block">{errores.sector}</p>}
          <div className="dg-form-actions dg-form-actions-end">
            <button className="btn btn-primary" onClick={next}>
              Siguiente <ArrowRightIcon />
            </button>
          </div>
        </div>
      )}

      {/* Paso 1: necesidades */}
      {step === 1 && (
        <div className="dg-step-content">
          <h2 className="dg-step-title">¿Qué necesitas para tu negocio?</h2>
          <p className="dg-step-subtitle">
            Marca lo que te interesa. Te recomendaremos los módulos que mejor se adaptan.
          </p>
          <fieldset className="dg-fieldset">
            <legend className="dg-sr-only">Necesidades</legend>
            <div className="dg-options">
              {necesidadesOpts.map((n) => {
                const sel = necesidades.includes(n.clave)
                return (
                  <label key={n.clave} className="dg-option-check">
                    <input
                      type="checkbox"
                      className="dg-option-input"
                      value={n.clave}
                      checked={sel}
                      onChange={() => {
                        setNecesidades(
                          sel ? necesidades.filter((x) => x !== n.clave) : [...necesidades, n.clave],
                        )
                        setErrores({})
                      }}
                    />
                    <span className="dg-option-check-box">
                      <CheckIcon />
                    </span>
                    <span className="dg-option-check-text">
                      <span className="dg-option-check-label">{n.etiqueta}</span>
                      {n.descripcion && (
                        <span className="dg-option-check-desc">{n.descripcion}</span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          {errores.necesidades && (
            <p className="dg-form-error dg-error-block">{errores.necesidades}</p>
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

      {/* Paso 2: modo actual */}
      {step === 2 && (
        <div className="dg-step-content">
          <h2 className="dg-step-title">¿Cómo gestionas tu negocio hoy?</h2>
          <p className="dg-step-subtitle">
            No hay respuesta incorrecta. Nos ayuda a entender tu punto de partida.
          </p>
          <fieldset className="dg-fieldset">
            <legend className="dg-sr-only">Cómo gestionas tu negocio hoy</legend>
            <div className="dg-options">
              {MODOS.map((m) => (
                <label key={m.id} className="dg-option-radio">
                  <input
                    type="radio"
                    name="modo"
                    className="dg-option-input"
                    value={m.id}
                    checked={modoActual === m.id}
                    onChange={() => {
                      setModoActual(m.id)
                      setErrores({})
                    }}
                  />
                  <span className="dg-option-radio-dot" />
                  <span className="dg-option-radio-text">
                    <span className="dg-option-radio-label">{m.label}</span>
                    <span className="dg-option-check-desc">{m.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {errores.modoActual && (
            <p className="dg-form-error dg-error-block">{errores.modoActual}</p>
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

      {/* Paso 3: contacto */}
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
                autoComplete="name"
                value={nombre}
                onChange={(e) => {
                  setNombre(e.target.value)
                  setErrores({})
                }}
              />
              {errores.nombre && <span className="dg-form-error">{errores.nombre}</span>}
            </div>
            <div className="dg-form-group">
              <label htmlFor="dg-telefono">
                Teléfono <span className="required">*</span>
              </label>
              <input
                id="dg-telefono"
                className="dg-form-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+53 5XXXXXXX"
                value={telefono}
                onChange={(e) => {
                  setTelefono(e.target.value)
                  setErrores({})
                }}
              />
              {errores.telefono && <span className="dg-form-error">{errores.telefono}</span>}
            </div>
            <div className="dg-form-group">
              <label htmlFor="dg-email">
                Correo electrónico <span className="required">*</span>
              </label>
              <input
                id="dg-email"
                className="dg-form-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setErrores({})
                }}
              />
              {errores.email && <span className="dg-form-error">{errores.email}</span>}
            </div>
          </div>
          {submitError && (
            <div className="alert alert-error mt-4">
              <span>{submitError}</span>
            </div>
          )}
          <div className="dg-form-actions">
            <button className="btn btn-ghost" onClick={back} disabled={submitting}>
              <ArrowLeftIcon /> Atrás
            </button>
            <button className="btn btn-primary" onClick={next} disabled={submitting}>
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

      {/* Paso 4: informe */}
      {step === 4 && recClaves && (
        <div className="dg-report">
          <div className="dg-report-header">
            <div className="dg-report-icon">
              <CheckIcon large />
            </div>
            <h2 className="dg-report-title">
              {nombre.split(' ')[0]}, esto es lo que CLAUX puede hacer por ti
            </h2>
            <p className="dg-report-subtitle">
              Según lo que nos has contado{sectorSel ? ` para tu ${sectorSel.nombre.toLowerCase()}` : ''},
              estos son los módulos que mejor se adaptan a tu negocio.
            </p>
          </div>

          <div className="dg-report-modules">
            {[...recClaves]
              .sort((a, b) => (ordenModulo.get(a) ?? 99) - (ordenModulo.get(b) ?? 99))
              .map((clave, i) => {
                const mod = modulos.find((m) => m.clave === clave)
                if (!mod) return null
                const info = adaptarModulo(mod, sectorSel?.etiquetas ?? ETIQUETAS_DEFAULT)
                return (
                  <div
                    key={clave}
                    className="dg-report-module"
                    style={{ '--reveal-delay': `${i * 50}ms` } as React.CSSProperties}
                  >
                    <div className="dg-report-module-icon">
                      <CheckIcon />
                    </div>
                    <div>
                      <div className="dg-report-module-name">{info.nombre}</div>
                      <div className="dg-report-module-desc">{info.desc}</div>
                    </div>
                  </div>
                )
              })}
          </div>

          <div className="dg-report-cta">
            {contactado ? (
              <p className="dg-report-cta-text">
                ¡Gracias, {nombre.split(' ')[0]}! Hemos recibido tu solicitud. Te
                contactaremos muy pronto para ayudarte a ponerlo en marcha.
              </p>
            ) : (
              <>
                <p className="dg-report-cta-text">
                  Demos el siguiente paso juntos. Elige cómo prefieres que te
                  ayudemos a ponerlo en marcha. Sin compromiso.
                </p>
                <div className="dg-report-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    onClick={() => setContactado(true)}
                  >
                    Que me llamen gratis
                  </button>
                  {/* Pendiente: agendar una cita (Calendly u otro). */}
                  <button type="button" className="btn btn-secondary btn-lg" disabled>
                    Agendar una cita
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
