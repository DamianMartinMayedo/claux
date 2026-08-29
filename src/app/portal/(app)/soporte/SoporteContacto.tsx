'use client'

import { useState, useTransition } from 'react'
import { MessageSquarePlus, Send } from 'lucide-react'
import { enviarMensajeSoporte } from '@/app/actions/portal/soporte'
import { toastSuccess } from '@/app/contexts/ToastContext'
import ModalShell from '@/components/portal/ModalShell'

/**
 * Escribir al equipo, desde un botón que abre el formulario en un modal.
 *
 * Antes el formulario ocupaba media pantalla de Soporte, compitiendo con las
 * respuestas que casi siempre resuelven la duda sin escribirle a nadie. Ahora la
 * pantalla es ayuda —preguntas frecuentes y guías— y contactar es una acción de
 * la cabecera, como en el resto del portal.
 *
 * `asuntoInicial` llega de los enlaces que traen al dueño hasta aquí con algo ya
 * en mente («Quiero Contabilidad»): el formulario sale con el asunto escrito en
 * vez de una página en blanco. Es `defaultValue`, no valor controlado: sigue
 * siendo suyo y puede reescribirlo. Cuando viene un asunto, `abrirAlEntrar` abre
 * el modal solo — el clic que dio en el aviso ya era la intención de escribir, y
 * hacerle dar otro en la cabecera sería cobrarle dos veces por lo mismo.
 */
export default function SoporteContacto({
  asuntoInicial = '',
  abrirAlEntrar = false,
  variante = 'principal',
}: {
  asuntoInicial?: string
  abrirAlEntrar?: boolean
  /** `principal`: el botón de la cabecera. `discreto`: el remate de las preguntas. */
  variante?: 'principal' | 'discreto'
}) {
  const [abierto, setAbierto] = useState(abrirAlEntrar)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function cerrar() {
    if (isPending) return   // enviando: cerrar dejaría al dueño sin saber si salió
    setAbierto(false)
    setError('')
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await enviarMensajeSoporte(fd)
      // El error se queda DENTRO del modal: lo escrito sigue ahí y se reintenta
      // sin volver a teclearlo, que en una conexión mala es media tarde.
      if (!res.ok) { setError(res.error ?? 'No se pudo enviar.'); return }
      setAbierto(false)
      toastSuccess('Mensaje enviado. Te responderemos pronto.')
    })
  }

  return (
    <>
      <button
        type="button"
        className={variante === 'principal' ? 'btn btn-primary' : 'btn btn-secondary btn-sm'}
        onClick={() => setAbierto(true)}
      >
        <MessageSquarePlus size={variante === 'principal' ? 16 : 15} strokeWidth={2} />
        {variante === 'principal' ? 'Contactar' : 'Escríbenos'}
      </button>

      {abierto && (
        <ModalShell title="Escríbenos" onClose={cerrar} size="modal-520">
          <form onSubmit={handleSubmit} noValidate>
            <div className="modal-body modal-body-form">
              <p className="text-sm-muted">
                Cuéntanos en qué te ayudamos y te respondemos al correo de tu cuenta.
              </p>

              <div className="input-group">
                <label>Asunto <span className="required">*</span></label>
                <input
                  className="input"
                  name="asunto"
                  defaultValue={asuntoInicial}
                  maxLength={160}
                  placeholder="Ej: Duda al registrar un gasto"
                  required
                />
              </div>

              <div className="input-group">
                <label>Mensaje <span className="required">*</span></label>
                <textarea
                  className="input"
                  name="mensaje"
                  rows={6}
                  maxLength={4000}
                  placeholder="Cuéntanos con detalle en qué te ayudamos…"
                  required
                />
              </div>

              {error && <div className="alert alert-error">{error}</div>}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={cerrar} disabled={isPending}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={isPending}>
                {isPending
                  ? <><span className="spinner spinner-sm" /> Enviando…</>
                  : <><Send size={15} strokeWidth={2} /> Enviar mensaje</>}
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </>
  )
}
