'use client'

import { useIa } from '@/components/portal/ia/IaContext'
import IaSparkle from '@/components/portal/ia/IaSparkle'
import { abrirChatIa } from '@/components/portal/ia/abrir-chat'
import SoporteContacto from './SoporteContacto'

/**
 * El cierre de las preguntas frecuentes: qué hacer cuando ninguna respondía.
 *
 * Con el asistente contratado, esa salida es él y no otro «escríbenos» —el de la
 * cabecera ya está—: responde al momento, a cualquier hora, y sabe de este
 * negocio. Sin el addon, el pie vuelve a ser el contacto con el equipo.
 *
 * Lee `useIa()` y no los módulos del cliente a propósito: el chat solo está
 * montado si ESTE usuario puede verlo (contratado ∩ sus permisos). Ofrecerlo a
 * quien no lo tiene visible sería un botón que no abre nada.
 */
export default function SoportePie() {
  const { tieneIa, nombreAgente } = useIa()

  if (!tieneIa) {
    return (
      <div className="soporte-pie">
        <span className="text-sm-muted">¿No encuentras la respuesta?</span>
        <SoporteContacto variante="discreto" />
      </div>
    )
  }

  return (
    <div className="ia-banner ia-banner-suave">
      <span className="ia-banner-icon"><IaSparkle size={22} strokeWidth={2} /></span>
      <div className="ia-banner-body">
        <span className="ia-banner-title">¿No encuentras la respuesta?</span>
      </div>
      <button type="button" className="btn btn-ia btn-sm" onClick={abrirChatIa}>
        Preguntar a {nombreAgente}
      </button>
    </div>
  )
}
