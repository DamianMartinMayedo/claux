'use client'

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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
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
          <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 'var(--space-4)' }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-5)' }}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {/* ── Sección futura: Configuración de email ── */}
      <div className="notif-section notif-section-disabled">
        <div className="notif-section-header">
          <div className="notif-section-icon notif-icon-disabled">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <p className="notif-section-title">Configuración de email (SMTP)</p>
              <span className="badge badge-neutral" style={{ fontSize: '10px' }}>Próximamente</span>
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <p className="notif-section-title">Notificaciones automáticas a clientes</p>
              <span className="badge badge-neutral" style={{ fontSize: '10px' }}>Próximamente</span>
            </div>
            <p className="notif-section-sub">
              Emails automáticos de bienvenida, aviso de vencimiento y confirmación de pago
            </p>
          </div>
        </div>
        <div className="notif-coming-soon">
          <div className="notif-coming-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <span>Email de bienvenida al crear un cliente</span>
          </div>
          <div className="notif-coming-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <span>Aviso N días antes de que venza la suscripción</span>
          </div>
          <div className="notif-coming-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <span>Confirmación de pago recibido</span>
          </div>
        </div>
      </div>

    </form>
  )
}
