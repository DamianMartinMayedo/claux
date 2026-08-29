import { PublicFooter } from '@/components/publico/Chrome'
import AyudaMasthead from './AyudaMasthead'
import Lectura from '@/lib/academia/Lectura'

/**
 * El marco del centro de ayuda: la marca de CLAUX, el comportamiento de lectura
 * del manual y el pie con los legales.
 *
 * La cabecera es propia (`AyudaMasthead`): la marca sin captación —como en los
 * legales— más el buscador y el tema, que son de leer y no del manual interno.
 * El pie sí es el compartido: ahí siguen la vuelta a la casa y los legales, para
 * el visitante que llegó de una búsqueda.
 *
 * Lo que NO se hereda de la landing es `.ld-page`, que fija `color-scheme:
 * light`. Aquello es marketing diseñado siempre en claro; esto son mil palabras
 * seguidas, y el manual ya se lee en claro o en oscuro según el tema del
 * navegador. `.acad-root` es lo que le da a esta página el fondo, la tipografía
 * y el salto de ancla sin animación de rebote.
 */
export default function AyudaShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="acad-root es-ayuda">
      <AyudaMasthead />
      <Lectura />
      {children}
      {/* Enlace de verdad: sin JS lleva arriba igual. El JS solo lo esconde
          mientras se está en la cabecera y le pone la animación. */}
      <a className="acad-nav acad-arriba" data-acad-arriba href="#" aria-label="Volver arriba">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </a>
      <PublicFooter />
    </div>
  )
}
