'use client'

import { useState, useTransition } from 'react'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { Bell, RefreshCw, Stethoscope } from 'lucide-react'
import {
  comprobarWebhook, repararWebhook, enviarPruebaBot, type DiagnosticoWebhook,
} from '@/app/actions/portal/agenda-comun'

/**
 * Diagnóstico en vivo del bot de Telegram (fase 7).
 *
 * La tarjeta enseñaba `webhook_registrado`, un booleano guardado el día del alta: decía
 * lo que pasó entonces, no lo que pasa ahora. Y como al guardar sin cambios no se
 * reintenta el registro, un bot con el webhook mal puesto solo se arreglaba borrándolo
 * y rehaciéndolo — perdiendo el código de vínculo y el chat del dueño.
 *
 * Telegram **guarda** la URL del webhook: cambiar el dominio del sistema NO rearregla
 * los bots ya registrados. Por eso «Reparar» existe y por eso no es automático.
 */
export default function BotDiagnostico({ columna }: {
  columna: 'bot_config' | 'bot_config_citas'
}) {
  const [isPending, startTransition] = useTransition()
  const [diag, setDiag] = useState<DiagnosticoWebhook | null>(null)

  function comprobar() {
    const ld = toastLoading('Preguntando a Telegram…')
    startTransition(async () => {
      const r = await comprobarWebhook(columna)
      await ld.dismiss()
      setDiag(r)
      if (!r.ok) toastError(r.error ?? 'No se pudo comprobar.')
    })
  }

  function reparar() {
    const ld = toastLoading('Registrando de nuevo…')
    startTransition(async () => {
      const r = await repararWebhook(columna)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo reparar.'); return }
      toastSuccess('Webhook registrado de nuevo.')
      const d = await comprobarWebhook(columna)
      setDiag(d)
    })
  }

  function probar() {
    const ld = toastLoading('Enviando…')
    startTransition(async () => {
      const r = await enviarPruebaBot(columna)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo enviar.'); return }
      toastSuccess('Enviado. Míralo en tu Telegram.')
    })
  }

  return (
    <div className="res-conf-pad-top">
      <div className="res-actions-row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={comprobar} disabled={isPending}>
          <Stethoscope size={15} strokeWidth={2} /> Comprobar
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={probar} disabled={isPending}>
          <Bell size={15} strokeWidth={2} /> Enviar aviso de prueba
        </button>
      </div>

      {diag && diag.ok && (
        <div className={`alert ${diag.coincide && !diag.last_error_message ? 'alert-success' : 'alert-warning'}`}>
          {diag.coincide
            ? <>Telegram está enviando los mensajes al sitio correcto.</>
            : diag.url
              ? <>Telegram está enviando los mensajes a <strong>otra dirección</strong> ({diag.url}). Repáralo para que vuelvan aquí.</>
              : <>Este bot <strong>no tiene webhook registrado</strong>: no llega nada. Repáralo.</>}
          {diag.last_error_message && (
            <div className="text-xs-muted">Último error que reportó Telegram: {diag.last_error_message}</div>
          )}
          {diag.pending_update_count > 0 && (
            <div className="text-xs-muted">{diag.pending_update_count} mensaje(s) esperando a entregarse.</div>
          )}
          {!diag.chat_vinculado && (
            <div className="text-xs-muted">
              Tu chat no está vinculado: aunque el bot funcione, <strong>a ti no te llega ningún aviso</strong>.
            </div>
          )}
          {!diag.coincide && (
            <button type="button" className="btn btn-aviso btn-sm" onClick={reparar} disabled={isPending}>
              <RefreshCw size={15} strokeWidth={2} /> Reparar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
