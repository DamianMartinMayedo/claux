import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Enlace no disponible' }

/**
 * Lo que ve quien abre un enlace público que ya no vale: un QR de un negocio que
 * cambió de nombre, una carta despublicada, un token de reserva caducado, un deck
 * revocado.
 *
 * **Sin nada de CLAUX**: ni logo, ni «volver al inicio», ni enlace a nuestra web.
 * Quien está aquí es el cliente del negocio —o alguien a quien le pasaron un
 * enlace—, no un visitante nuestro, y mandarlo a claux.es es mandarlo a un sitio
 * que no buscaba. Solo el mensaje y qué hacer con él.
 *
 * Tampoco carga el design system: cuelga de `(public)/layout.tsx`, que solo trae
 * el reset (§6) — y de ahí salen también sus cuatro reglas, para no añadir una
 * hoja que se precargaría en todas las públicas sin pintarse casi nunca.
 */
export default function PublicoNoEncontrado() {
  return (
    <div className="np-page">
      <div className="np-caja">
        <h1 className="np-titulo">Este enlace ya no está disponible</h1>
        <p className="np-texto">Pide el enlace actualizado a quien te lo compartió.</p>
      </div>
    </div>
  )
}
