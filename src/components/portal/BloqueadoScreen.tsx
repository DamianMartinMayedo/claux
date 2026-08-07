'use client'

import { useState, useTransition } from 'react'
import { Lock, RefreshCw, CheckCircle2 } from 'lucide-react'
import { pedirReactivacion } from '@/app/actions/portal/soporte'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'

const CORREO = 'contacto@claux.es'

// El texto apunta al BOTÓN, no al correo: la renovación es de un clic y sin escribir
// nada, y decir «escríbenos» de entrada mandaba al camino más largo de los dos.
const MENSAJES: Record<string, { titulo: string; texto: string }> = {
  DESACTIVADO: {
    titulo: 'Cuenta suspendida',
    texto:  'Tu suscripción está suspendida. Pide la renovación y te contactamos para reactivarla; tus datos siguen aquí.',
  },
  VENCIDO: {
    titulo: 'Suscripción vencida',
    texto:  'Tu período de suscripción ha expirado. Pide la renovación y sigues donde lo dejaste; tus datos siguen aquí.',
  },
}

/**
 * Lo único que ve un cliente suspendido o vencido. Hasta ahora era un cartel sin salida:
 * decía «contacta con soporte» sin decir con quién ni por dónde, y el botón llevaba dos
 * versiones comentado esperando una dirección de correo.
 *
 * El botón **no es un `mailto:`**: en un móvil sin cliente de correo configurado no hace
 * nada, y sobre todo no deja rastro de quién quiso pagar. Registra la petición en el panel
 * y nos manda el aviso (`pedirReactivacion`). La dirección se enseña igualmente debajo
 * para quien prefiera escribir por su cuenta — es el final del embudo de cobro y no puede
 * depender de que un clic funcione.
 */
export default function BloqueadoScreen({ estado }: { estado: string }) {
  const [pedido, setPedido] = useState(false)
  const [enviando, startTransition] = useTransition()

  const msg = MENSAJES[estado] ?? {
    titulo: 'Acceso restringido',
    texto:  'Tu cuenta no tiene acceso activo. Pide la renovación y lo resolvemos.',
  }

  function contactar() {
    // El toast de carga se crea ANTES de la transición: dentro no llega a pintarse.
    const ld = toastLoading('Enviando…')
    startTransition(async () => {
      const r = await pedirReactivacion()
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo enviar. Escríbenos a ' + CORREO); return }
      setPedido(true)
      toastSuccess(r.yaPedido
        ? 'Ya teníamos tu petición de renovación. Te contactamos.'
        : 'Renovación pedida. Te contactamos por correo.')
    })
  }

  return (
    <div className="bloqueado-screen">
      <div className="bloqueado-icon">
        <Lock size={32} strokeWidth={1.5} />
      </div>
      <h2 className="bloqueado-titulo">{msg.titulo}</h2>
      <p className="bloqueado-texto">{msg.texto}</p>

      {pedido ? (
        <p className="bloqueado-hecho">
          <CheckCircle2 size={16} strokeWidth={2} />
          Recibimos tu petición de renovación. Te contactamos por correo lo antes posible.
        </p>
      ) : (
        <button type="button" className="btn btn-primary" onClick={contactar} disabled={enviando}>
          {enviando
            ? <><span className="spinner spinner-sm" /> Enviando…</>
            : <><RefreshCw size={16} strokeWidth={2} /> Quiero renovar</>}
        </button>
      )}

      {/* DOS acciones distintas, y tienen que leerse como tales: arriba «quiero renovar»,
          que es un aviso de un clic y sin escribir nada; aquí, escribirnos para cualquier
          otra cosa. Con «Contactar con CLAUX» arriba y «o escríbenos» debajo parecían la
          misma cosa dos veces, y el dueño se paraba a elegir entre dos caminos iguales. */}
      <p className="bloqueado-texto">
        ¿Otra cosa? Escríbenos a <a href={`mailto:${CORREO}`} className="link-primary">{CORREO}</a>.
      </p>
    </div>
  )
}
