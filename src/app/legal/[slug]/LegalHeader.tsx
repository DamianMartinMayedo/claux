import VolverLink from './VolverLink'

/**
 * Cabecera propia de las páginas legales.
 *
 * Usaban `PublicHeader`, la de la landing, con «Acceso clientes» y «Diagnóstico
 * gratis». Un aviso legal no es una página de captación: al visitante que llega de
 * Google no le vende nada y al cliente que abre las cookies desde su perfil le está
 * ofreciendo lo que ya tiene contratado. Aquí solo hay la marca y la salida.
 *
 * **El logo NO es un enlace.** En la cabecera compartida lleva a `/`, y ese es
 * exactamente el viaje que estamos evitando: un cliente del portal pulsa el logo por
 * costumbre y acaba en la web comercial. Quien quiera conocer CLAUX tiene «Volver»,
 * que sin historia ni parámetro también lleva a la home.
 */
export default function LegalHeader() {
  return (
    <header className="lg-header">
      {/* Mismas clases que el logo de la cabecera pública: es la misma marca y el
          mismo par claro/oscuro, no una variante. */}
      <span className="ld-header-logo">
        <img src="/logo_color.svg" alt="CLAUX" className="logo-light" />
        <img src="/logo_blanco.svg" alt="CLAUX" className="logo-dark" />
      </span>
      <VolverLink />
    </header>
  )
}
