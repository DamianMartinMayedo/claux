'use client'

import { AlertTriangle, Bell, Mail } from 'lucide-react'
import { useState, useTransition, type ReactNode } from 'react'
import { guardarSetting } from '@/app/actions/settings'
import { TIPOS_EMAIL, type TipoEmail } from '@/lib/email/variables'
import { buzonesDe } from '@/lib/email/buzones'
import ChipsInput from '@/components/ChipsInput'
import type { PlantillaEmailAdmin } from '@/app/actions/email-plantillas'
import { useAvisos } from '@/components/admin/notificaciones/AvisosContext'
import PlantillasEditor from './PlantillasEditor'
import Tabs from '@/components/Tabs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Lo que se le dice a quien escribe algo que no es un correo, en su propio campo. */
function validarCorreo(v: string): string | null {
  return EMAIL_RE.test(v) ? null : `«${v}» no es un correo válido.`
}

type Tab = 'bandeja' | 'preferencias' | 'correos' | 'plantillas'

type Props = {
  diasAviso:            number
  emailAvisosInternos:  string
  emailAvisosLeads:     string
  emailContratacion:    string
  togglesIniciales:     Record<TipoEmail, boolean>
  plantillas:           PlantillaEmailAdmin[]
  /** Paneles ya resueltos en el servidor (patrón del design system §3.1). */
  bandeja:              ReactNode
  preferencias:         ReactNode
  /** Las preferencias son del equipo entero: solo super_admin las cambia. */
  esSuperAdmin:         boolean
  /** Permiso `notificaciones`: sin él se entra solo a la bandeja (ver page.tsx). */
  puedeCorreos:         boolean
}

// Hub de notificaciones del panel. Junta en una sola pantalla las dos mitades:
// lo que el EQUIPO recibe (bandeja de avisos + de qué avisar) y lo que sale hacia
// los CLIENTES (correos automáticos y sus plantillas). Antes solo existía la
// segunda mitad, y la bandeja iba a vivir en otra ruta: tener «notificaciones» en
// dos sitios distintos era garantía de no encontrar ninguna.
export default function NotificacionesForm({
  diasAviso, emailAvisosInternos, emailAvisosLeads, emailContratacion, togglesIniciales, plantillas,
  bandeja, preferencias, esSuperAdmin, puedeCorreos,
}: Props) {
  const [tab, setTab] = useState<Tab>('bandeja')
  const { noLeidas } = useAvisos()

  const [dias, setDias]         = useState(String(diasAviso))
  // Listas, no cadenas: el setting sigue guardándose separado por comas, pero
  // dentro del formulario cada buzón es un elemento que se añade y se quita.
  const [emailAvisos, setEmailAvisos] = useState(() => buzonesDe(emailAvisosInternos, ''))
  const [emailLeads, setEmailLeads]   = useState(() => buzonesDe(emailAvisosLeads, ''))
  const [emailContrat, setEmailContrat] = useState(emailContratacion)
  const [loading, setLoading]   = useState(false)
  const [msg, setMsg]           = useState<{ ok: boolean; text: string } | null>(null)

  const [toggles, setToggles] = useState(togglesIniciales)
  const [pendingTipo, startTogglePending] = useTransition()
  const [togglePendiente, setTogglePendiente] = useState<TipoEmail | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = parseInt(dias, 10)
    if (isNaN(val) || val < 1 || val > 60) {
      setMsg({ ok: false, text: 'Los días de aviso deben estar entre 1 y 60.' })
      return
    }
    const contrat = emailContrat.trim()
    // Los dos campos de buzones se validan al añadir cada pastilla, así que aquí
    // solo queda lo que ninguna pastilla puede comprobar: que no se quede
    // ninguno. La lista de leads SÍ puede ir vacía —es un extra—; la del equipo
    // no: un aviso interno sin destino es un aviso perdido.
    if (emailAvisos.length === 0) {
      setMsg({ ok: false, text: 'Hace falta al menos un correo de avisos internos.' })
      return
    }
    if (!EMAIL_RE.test(contrat)) {
      setMsg({ ok: false, text: 'El correo de contratación no es válido.' })
      return
    }
    setLoading(true); setMsg(null)
    const [r1, r2, r3, r4] = await Promise.all([
      guardarSetting('dias_aviso', String(val)),
      guardarSetting('email_avisos_internos', emailAvisos.join(', ')),
      guardarSetting('email_avisos_leads', emailLeads.join(', ')),
      guardarSetting('email_contratacion', contrat),
    ])
    setLoading(false)
    setMsg(r1.ok && r2.ok && r3.ok && r4.ok
      ? { ok: true,  text: 'Configuración guardada correctamente.' }
      : { ok: false, text: r1.error ?? r2.error ?? r3.error ?? r4.error ?? 'Error al guardar.' })
  }

  function handleToggle(tipo: TipoEmail, activo: boolean) {
    setToggles(prev => ({ ...prev, [tipo]: activo }))
    setTogglePendiente(tipo)
    startTogglePending(async () => {
      await guardarSetting(`email_on_${tipo}`, activo ? 'true' : 'false')
      setTogglePendiente(null)
    })
  }

  return (
    <>
      <Tabs<Tab>
        ariaLabel="Secciones de notificaciones"
        active={tab}
        onChange={setTab}
        tabs={[
          // Sin `countTone`: el número dice cuántos hay, no que sean una alarma
          // (mismo criterio que el badge de la campana).
          { id: 'bandeja', label: 'Bandeja', count: noLeidas || undefined },
          ...(esSuperAdmin ? [{ id: 'preferencias' as const, label: 'Preferencias' }] : []),
          ...(puedeCorreos ? [
            { id: 'correos'    as const, label: 'Correos a clientes' },
            { id: 'plantillas' as const, label: 'Plantillas de correo' },
          ] : []),
        ]}
      />

      {tab === 'bandeja'      && bandeja}
      {tab === 'preferencias' && preferencias}

      {tab === 'correos' && (
        <div className="notif-alertas">
          <form onSubmit={handleSubmit}>

            <div className="grid-cols-2">
              {/* ── Alertas del dashboard ── */}
              <div className="notif-section">
                <div className="notif-section-header">
                  <div className="notif-section-icon notif-icon-active">
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <p className="notif-section-title">Alertas del dashboard</p>
                    <p className="notif-section-sub">Controla cuándo aparecen los clientes en la métrica «Próximos a vencer»</p>
                  </div>
                </div>

                <div className="notif-field-row">
                  <div className="notif-field-info">
                    <p className="notif-field-label">Días de aviso de vencimiento</p>
                    <p className="notif-field-hint">
                      Los clientes activos y en trial cuya suscripción venza en los próximos
                      <strong> N días</strong> se contabilizarán en el contador del dashboard.
                      La tabla de alertas siempre muestra hasta 14 días.
                    </p>
                  </div>
                  <div className="notif-field-control">
                    <div className="notif-number-wrap">
                      <input
                        type="number"
                        className="input notif-number-input"
                        min={1}
                        max={60}
                        value={dias}
                        onChange={e => { setDias(e.target.value); setMsg(null) }}
                        required
                      />
                      <span className="notif-number-suffix">días</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Avisos internos al equipo ── */}
              <div className="notif-section">
                <div className="notif-section-header">
                  <div className="notif-section-icon notif-icon-active">
                    <Mail size={18} />
                  </div>
                  <div>
                    <p className="notif-section-title">Avisos internos al equipo</p>
                    <p className="notif-section-sub">Buzones que reciben los avisos de nuevo lead, nuevo cliente y nuevo mensaje de soporte</p>
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="email-avisos-internos">Correos de avisos internos</label>
                  <ChipsInput
                    id="email-avisos-internos"
                    valores={emailAvisos}
                    onChange={v => { setEmailAvisos(v); setMsg(null) }}
                    validar={validarCorreo}
                    describedBy="email-avisos-ayuda"
                    placeholder="Escribe un correo y pulsa Enter"
                    etiquetaQuitar={v => `Quitar el correo ${v}`}
                  />
                  <p id="email-avisos-ayuda" className="form-hint">
                    Reciben TODOS los avisos: leads, altas de cliente, salud de la IA.
                  </p>
                </div>

                <div className="input-group">
                  <label htmlFor="email-avisos-leads">Correos solo para avisos de nuevo contacto</label>
                  <ChipsInput
                    id="email-avisos-leads"
                    valores={emailLeads}
                    onChange={v => { setEmailLeads(v); setMsg(null) }}
                    validar={validarCorreo}
                    describedBy="email-leads-ayuda"
                    placeholder="Escribe un correo y pulsa Enter"
                    etiquetaQuitar={v => `Quitar el correo ${v}`}
                  />
                  <p id="email-leads-ayuda" className="form-hint">
                    Correos personales que quieren enterarse de que alguien pide que le llamen,
                    y de nada más. Si lo dejas vacío, esos avisos van solo a los buzones de arriba.
                  </p>
                </div>
              </div>

              {/* ── Contratación ── */}
              <div className="notif-section">
                <div className="notif-section-header">
                  <div className="notif-section-icon notif-icon-active">
                    <Mail size={18} />
                  </div>
                  <div>
                    <p className="notif-section-title">Contratación</p>
                    <p className="notif-section-sub">Buzón al que escribe el cliente desde el dashboard cuando quiere activar un módulo</p>
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="email-contratacion">Correo de contratación</label>
                  <input
                    id="email-contratacion"
                    type="email"
                    className="input"
                    value={emailContrat}
                    onChange={e => { setEmailContrat(e.target.value); setMsg(null) }}
                    required
                  />
                </div>
              </div>
            </div>

            {msg && (
              <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'} mt-4`}>
                {msg.text}
              </div>
            )}

            <div className="form-actions-end mt-5">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar cambios'}
              </button>
            </div>
          </form>

          {/* ── Notificaciones automáticas a clientes (toggles inmediatos) ── */}
          <div className="notif-section">
            <div className="notif-section-header">
              <div className="notif-section-icon notif-icon-active">
                <Bell size={18} />
              </div>
              <div>
                <p className="notif-section-title">Notificaciones automáticas a clientes</p>
                <p className="notif-section-sub">Activa o desactiva cada correo automático (el contenido se edita en «Plantillas de correo»)</p>
              </div>
            </div>

            <div className="notif-toggle-list">
              {TIPOS_EMAIL.map(t => (
                <div key={t.tipo} className="notif-field-row">
                  <div className="notif-field-info">
                    <p className="notif-field-label">{t.label}</p>
                  </div>
                  <div className="notif-field-control">
                    <span className="switch">
                      <input
                        type="checkbox"
                        checked={toggles[t.tipo]}
                        onChange={e => handleToggle(t.tipo, e.target.checked)}
                        disabled={pendingTipo && togglePendiente === t.tipo}
                        aria-label={`Activar ${t.label}`}
                      />
                      <span className="switch-track" aria-hidden="true" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'plantillas' && <PlantillasEditor plantillasIniciales={plantillas} />}
    </>
  )
}
