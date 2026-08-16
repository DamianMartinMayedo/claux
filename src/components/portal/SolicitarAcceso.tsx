'use client'

import { useState, useTransition } from 'react'
import { Lock } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { solicitarAccesoModulo } from '@/app/actions/portal/accesos'

// Línea contextual que aparece en un módulo que el usuario solo puede consultar
// (los botones de escritura están ocultos). Deja pedir el acceso al administrador
// sin salir de donde estaba: la solicitud va a la campana interna y por correo a
// todos los admins. `modulo` es la clave de gating de la página (la misma de
// `requireAccesoModulo`), que el administrador concede en Usuarios.
export default function SolicitarAcceso({ modulo }: { modulo: string }) {
  const [enviado, setEnviado] = useState(false)
  const [isPending, startTransition] = useTransition()

  function pedir() {
    // El loading se crea FUERA de la transición: dentro no llega a pintarse, y en
    // Cuba el «cargando» es innegociable.
    const ld = toastLoading('Enviando solicitud…')
    startTransition(async () => {
      const r = await solicitarAccesoModulo(modulo)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo enviar la solicitud.'); return }
      setEnviado(true)
      toastSuccess(r.yaEnviada
        ? 'Ya habías pedido este acceso; los administradores lo tienen.'
        : 'Solicitud enviada a los administradores.')
    })
  }

  return (
    <div className="acceso-aviso" role="note">
      <Lock size={15} strokeWidth={2} />
      <span className="acceso-aviso-texto">Solo puedes consultar este módulo.</span>
      {enviado
        ? <span className="acceso-aviso-ok">Solicitud enviada</span>
        : (
          <button type="button" className="btn btn-sm btn-secondary" onClick={pedir} disabled={isPending}>
            {isPending ? 'Enviando…' : 'Solicitar acceso para editar'}
          </button>
        )}
    </div>
  )
}
