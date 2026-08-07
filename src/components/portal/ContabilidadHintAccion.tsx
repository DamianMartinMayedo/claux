'use client'

import { useState, useTransition } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { registrarInteresModulo } from '@/app/actions/portal/soporte'
import { useNotificacionesOpcional } from '@/components/portal/notificaciones/NotificacionesContext'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'

/**
 * El botón de la nota de Contabilidad. Mismo gesto y mismas palabras que las tarjetas
 * del banner de captación del dashboard (`ContratarMasBanner`): «Me interesa» → queda
 * registrado y «Te contactamos». Dos sitios que ofrecen lo mismo no pueden pedirlo de
 * dos maneras distintas — aquí decía «Pídelo desde Soporte», que además obligaba al
 * dueño a redactar un mensaje para decirnos que quiere gastar dinero.
 *
 * `pedidoEl` llega del servidor: si ya lo pidió, se ve al cargar y no solo tras pulsar.
 */
export default function ContabilidadHintAccion({ pedidoEl }: { pedidoEl?: string }) {
  const [pedido, setPedido] = useState<string | undefined>(pedidoEl)
  const [enviando, startTransition] = useTransition()
  // La campana solo se refresca al volver a la pestaña (throttle de 60 s): sin esto el
  // aviso de «lo pediste» existe en BD pero no aparece hasta más tarde, que para el
  // dueño es lo mismo que no existir. Opcional: sin bandeja (no es admin) no refresca.
  const notificaciones = useNotificacionesOpcional()

  function pedir() {
    if (enviando || pedido) return
    startTransition(async () => {
      const r = await registrarInteresModulo('base', 'Contabilidad')
      if (!r.ok) { toastError(r.error ?? 'No se pudo enviar.'); return }
      setPedido('ahora')
      toastSuccess('Recibido. Te contactamos enseguida.')
      void notificaciones?.refrescar()
    })
  }

  if (pedido) {
    return (
      <span className="modulo-sugerencia-hecho">
        <Check size={14} strokeWidth={2.5} aria-hidden="true" />
        {pedido === 'ahora' ? 'Te contactamos' : `Pedido el ${pedido} · te contactamos`}
      </span>
    )
  }

  return (
    <button type="button" className="btn btn-secondary btn-sm modulo-sugerencia-btn"
      onClick={pedir} disabled={enviando}>
      {enviando
        ? <><span className="spinner spinner-sm" /> Enviando…</>
        : <>Me interesa <ArrowRight size={13} strokeWidth={2} aria-hidden="true" /></>}
    </button>
  )
}
