'use client'

import { AlertTriangle, Bell, CheckCircle, Mail } from 'lucide-react'
import { useState } from 'react'
import { guardarSetting } from '@/app/actions/settings'

export default function NotificacionesForm({ diasAviso }: { diasAviso: number }) {
  const [dias, setDias]       = useState(String(diasAviso))
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = parseInt(dias, 10)
    if (isNaN(val) || val < 1 || val > 60) {
      setMsg({ ok: false, text: 'El valor debe estar entre 1 y 60 días.' })
      return
    }
    setLoading(true); setMsg(null)
    const res = await guardarSetting('dias_aviso', String(val))
    setLoading(false)
    setMsg(res.ok
      ? { ok: true,  text: 'Configuración guardada correctamente.' }
      : { ok: false, text: res.error ?? 'Error al guardar.' })
  }

  return (
    <form onSubmit={handleSubmit}>

      {/* ── Sección activa: Alertas del dashboard ── */}
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
      </div>

      {/* ── Sección futura: Configuración de email ── */}
      <div className="notif-section notif-section-disabled">
        <div className="notif-section-header">
          <div className="notif-section-icon notif-icon-disabled">
            <Mail size={18} />
          </div>
          <div>
            <div className="flex-center-2">
              <p className="notif-section-title">Configuración de email (SMTP)</p>
              <span className="badge badge-neutral text-xs">Próximamente</span>
            </div>
            <p className="notif-section-sub">
              Servidor, puerto, usuario y contraseña para el envío de emails automáticos
            </p>
          </div>
        </div>
        <div className="notif-coming-soon">
          <p>Configura aquí el servidor SMTP desde el que CLAUX enviará correos a tus clientes.</p>
        </div>
      </div>

      {/* ── Sección futura: Notificaciones automáticas ── */}
      <div className="notif-section notif-section-disabled">
        <div className="notif-section-header">
          <div className="notif-section-icon notif-icon-disabled">
            <Bell size={18} />
          </div>
          <div>
            <div className="flex-center-2">
              <p className="notif-section-title">Notificaciones automáticas a clientes</p>
              <span className="badge badge-neutral text-xs">Próximamente</span>
            </div>
            <p className="notif-section-sub">
              Emails automáticos de bienvenida, aviso de vencimiento y confirmación de pago
            </p>
          </div>
        </div>
        <div className="notif-coming-soon">
          <div className="notif-coming-item">
            <CheckCircle size={14} />
            <span>Email de bienvenida al crear un cliente</span>
          </div>
          <div className="notif-coming-item">
            <CheckCircle size={14} />
            <span>Aviso N días antes de que venza la suscripción</span>
          </div>
          <div className="notif-coming-item">
            <CheckCircle size={14} />
            <span>Confirmación de pago recibido</span>
          </div>
        </div>
      </div>

    </form>
  )
}
