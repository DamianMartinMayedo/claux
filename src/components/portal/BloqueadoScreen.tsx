'use client'

import { useState, useTransition } from 'react'
import { Lock, RefreshCw, CheckCircle2 } from 'lucide-react'
import { pedirReactivacion } from '@/app/actions/portal/soporte'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import type { MotivoBloqueo } from '@/lib/clientes/ciclo-vida'


// El texto apunta al BOTÓN, no al correo: la renovación es de un clic y sin escribir
// nada, y decir «escríbenos» de entrada mandaba al camino más largo de los dos.
// Las claves son el MOTIVO del bloqueo, no el `estado` de la fila. No es lo mismo:
// el guardia bloquea también por FECHA, con el estado todavía en ACTIVO, y ese es
// justo el caso más frecuente —la ventana entre que vence y que el barrido de
// mañana lo escribe—. Pasando el estado crudo, a ese cliente le salía el cartel
// genérico «Acceso restringido» en el momento en que más claro hay que hablarle.
const MENSAJES: Record<MotivoBloqueo, { titulo: string; texto: string }> = {
  DESACTIVADO: {
    titulo: 'Cuenta suspendida',
    texto:  'La suscripción está suspendida. Al solicitar la renovación, el equipo de CLAUX contacta para reactivarla; los datos siguen intactos.',
  },
  VENCIDO: {
    titulo: 'Suscripción vencida',
    texto:  'El período de suscripción ha expirado. Al renovar, todo continúa donde estaba; los datos siguen intactos.',
  },
  EXPIRADO: {
    titulo: 'Suscripción vencida',
    texto:  'El período de suscripción ha expirado. Al renovar, todo continúa donde estaba; los datos siguen intactos.',
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
// `correo` llega por prop y no tecleado aquí: es el buzón de contratación de
// `settings`, y esto es un componente de cliente que no puede leerlo. El layout
// solo lo consulta cuando hay bloqueo, así que no cuesta nada al resto.
export default function BloqueadoScreen({ motivo, correo }: { motivo: MotivoBloqueo; correo: string }) {
  const [pedido, setPedido] = useState(false)
  const [enviando, startTransition] = useTransition()

  const msg = MENSAJES[motivo]

  function contactar() {
    // El toast de carga se crea ANTES de la transición: dentro no llega a pintarse.
    const ld = toastLoading('Enviando…')
    startTransition(async () => {
      const r = await pedirReactivacion()
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se ha podido enviar. Correo de contacto: ' + correo); return }
      setPedido(true)
      toastSuccess(r.yaPedido
        ? 'La petición de renovación ya estaba registrada.'
        : 'Renovación solicitada. El equipo de CLAUX contactará por correo.')
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
          Petición de renovación recibida. El equipo de CLAUX contactará por correo lo antes posible.
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
        Para cualquier otra consulta: <a href={`mailto:${correo}`} className="link-primary">{correo}</a>.
      </p>
    </div>
  )
}
