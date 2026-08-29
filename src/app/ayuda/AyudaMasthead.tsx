import Link from 'next/link'
import Buscador from '@/lib/academia/Buscador'
import BotonTema from '@/lib/academia/BotonTema'
import { BASE_AYUDA } from '@/lib/academia/rutas'

/**
 * La cabecera del centro de ayuda.
 *
 * **No es la de captación** (`PublicHeader`, con «Acceso clientes» y
 * «Diagnóstico gratis»), por lo mismo que no la llevan los legales: quien más
 * abre una guía es un cliente que viene de «Ayuda y soporte» con una duda a
 * medias, y ofrecerle lo que ya paga sobra. La marca lleva a la portada de la
 * ayuda, **no a `/`**: pulsar el logo por costumbre no puede sacarte de aquí y
 * plantarte en la web comercial. La vuelta a la casa sigue en el pie.
 *
 * Y **sí lleva lo de leer**: el buscador y el interruptor de tema, los mismos
 * que el manual interno. Son de la lectura, no del manual: una guía sin buscador
 * obliga a volver al índice para cambiar de tema de consulta, y sin tema oscuro
 * se lee de noche en blanco. El buscador se queda en su contexto —su índice es
 * `/ayuda/indice`, que solo contiene lo publicado— y navega dentro de `/ayuda`.
 *
 * Reutiliza el vestido de la cabecera del manual (`.acad-masthead`) y no el de
 * los legales: es la misma superficie de lectura, con las mismas piezas dentro y
 * el mismo comportamiento en móvil y al imprimir.
 */
export default function AyudaMasthead() {
  return (
    <header className="acad-masthead">
      <div className="acad-masthead-in">
        <Link className="acad-nav acad-brand acad-brand-publica" href={BASE_AYUDA}>
          {/* Mismas clases que el logo de la cabecera pública: es la misma marca y
              el mismo par claro/oscuro, no una variante. */}
          <span className="ld-header-logo">
            <img src="/logo_color.svg" alt="CLAUX" className="logo-light" />
            <img src="/logo_blanco.svg" alt="CLAUX" className="logo-dark" />
          </span>
          <span className="acad-brand-sep" aria-hidden="true">·</span>
          <span className="acad-brand-sub">Centro de ayuda</span>
        </Link>
        <Buscador urlIndice={`${BASE_AYUDA}/indice`} base={BASE_AYUDA} placeholder="Buscar en la ayuda…" />
        <BotonTema />
      </div>
    </header>
  )
}
