'use client'

import { AlertTriangle, Bell, Mail } from 'lucide-react'
import { useState, useTransition } from 'react'
import { guardarSetting } from '@/app/actions/settings'
import { TIPOS_EMAIL, type TipoEmail } from '@/lib/email/variables'
import type { PlantillaEmailAdmin } from '@/app/actions/email-plantillas'
import PlantillasEditor from './PlantillasEditor'
import Tabs from '@/components/Tabs'

type Props = {
  diasAviso:            number
  emailAvisosInternos:  string
  togglesIniciales:     Record<TipoEmail, boolean>
  plantillas:           PlantillaEmailAdmin[]
}

export default function NotificacionesForm({ diasAviso, emailAvisosInternos, togglesIniciales, plantillas }: Props) {
  const [tab, setTab] = useState<'alertas' | 'plantillas'>('alertas')

  const [dias, setDias]         = useState(String(diasAviso))
  const [emailAvisos, setEmailAvisos] = useState(emailAvisosInternos)
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
    const email = emailAvisos.trim()
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!EMAIL_RE.test(email)) {
      setMsg({ ok: false, text: 'El correo de avisos internos no es válido.' })
      return
    }
    setLoading(true); setMsg(null)
    const [r1, r2] = await Promise.all([
      guardarSetting('dias_aviso', String(val)),
      guardarSetting('email_avisos_internos', email),
    ])
    setLoading(false)
    setMsg(r1.ok && r2.ok
      ? { ok: true,  text: 'Configuración guardada correctamente.' }
      : { ok: false, text: r1.error ?? r2.error ?? 'Error al guardar.' })
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
      <Tabs
        ariaLabel="Secciones de notificaciones"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'alertas', label: 'Alertas' },
          { id: 'plantillas', label: 'Plantillas de correo' },
        ]}
      />

      {tab === 'alertas' && (
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
                    <p className="notif-section-sub">Buzón que recibe los avisos de nuevo lead, nuevo cliente y nuevo mensaje de soporte</p>
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="email-avisos-internos">Correo de avisos internos</label>
                  <input
                    id="email-avisos-internos"
                    type="email"
                    className="input"
                    value={emailAvisos}
                    onChange={e => { setEmailAvisos(e.target.value); setMsg(null) }}
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
