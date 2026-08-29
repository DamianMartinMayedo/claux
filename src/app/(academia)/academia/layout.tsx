import Link from 'next/link'
import { redirect } from 'next/navigation'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import AcademiaChrome from './AcademiaChrome'
import Buscador from '@/lib/academia/Buscador'
import AcademiaCapa from './AcademiaCapa'
import AcademiaSalir from './AcademiaSalir'
import { capaActual, puedeElegirCapa } from '@/lib/academia/capas-server'
import { leerManual } from '@/lib/academia/manual'
import { CAPA_POR_DEFECTO } from '@/lib/academia/capas'
import { RUTA_MANUAL } from '@/lib/roles'
import { MARCA } from '@/lib/academia/marca'

/**
 * Superficie común de la Academia: cabecera, buscador global y tema. Dentro va
 * la portada, cada pieza en su propia URL, o el manual entero de una tirada.
 *
 * El índice lateral NO está aquí: lo pinta cada pieza. Así el «dónde estoy» lo
 * resuelve el servidor con la URL —sin JS y sin parpadeo— en vez de un efecto
 * que tendría que recalcularlo en cada navegación.
 *
 * El índice de BÚSQUEDA tampoco: se lo trae el buscador de `/academia/indice`,
 * porque incrustado pesaba más que la pieza que se venía a leer.
 *
 * Lo que sí vive aquí es la capa: con qué ojos se lee el manual. Para el
 * super_admin es un selector, y va arriba del todo y siempre visible porque leer
 * «como vendedor» sin saberlo llevaría a dar por escrito algo que en realidad
 * está oculto. Para un vendedor no hay selector: su capa la fija el rol, y
 * enseñarle tres pastillas de las que dos no funcionan solo diría que hay más
 * manual detrás.
 *
 * La ruta es la misma para todos a propósito (`/academia`, con `/partners` como
 * puerta de entrada de quien vende): así un enlace a un apartado concreto sirve
 * igual para el equipo y para un revendedor, que es justo lo que se hace cuando
 * alguien pregunta algo por mensaje.
 */

export const dynamic = 'force-dynamic'

export default async function AcademiaLayout({ children }: { children: React.ReactNode }) {
  const ctx = await obtenerContextoAdmin()
  // Sin sesión, a la puerta del manual (`/partners`) y no a la del panel: quien
  // llega aquí desde un enlace a un apartado viene a leer, no a administrar, y
  // una pantalla que dice «Panel de administración» le enseña una puerta que
  // quizá no puede abrir. Al equipo no le cuesta nada: esa puerta también entra
  // al manual.
  if (!ctx) redirect('/partners')

  const capa = await capaActual(ctx.rol)
  const eligeCapa = puedeElegirCapa(ctx.rol)
  // El botón de salir es para quien entró por `/partners` a leer y nada más. El
  // sidebar de `/admin` también cierra sesión, pero llegar hasta él desde el
  // manual es un viaje: se ofrece aquí a quien no puede elegir capa —quien lee
  // en su capa impuesta— y se le ahorra al super_admin, que lo tiene al lado.
  const salida = !eligeCapa
  // Las dos cifras de la barra. `leerManual` está memorizado por capa dentro de
  // la petición, así que la de la capa actual es la misma lectura que hace la
  // página; la interna solo se relee cuando se está fuera de ella.
  const visibles = await leerManual(capa.clave)
  const apartados = visibles.reduce((n, p) => n + p.etiquetados, 0)
  const total = capa.clave === CAPA_POR_DEFECTO
    ? apartados
    : (await leerManual(CAPA_POR_DEFECTO)).reduce((n, p) => n + p.etiquetados, 0)

  return (
    <div className="acad-root">
      <header className="acad-masthead">
        <div className="acad-masthead-in">
          <Link className="acad-nav acad-brand" href={RUTA_MANUAL}>
            <span className="acad-logo">CLAUX</span>
            <span className="acad-brand-sep" aria-hidden="true">·</span>
            <span className="acad-brand-sub">{MARCA}</span>
            {/* La pastilla de capa es para quien PUEDE cambiarla: avisa de que se
                está mirando en filtrado. A quien la tiene impuesta no le dice
                nada — su vista no es una vista, es su manual. */}
            {eligeCapa && capa.clave !== CAPA_POR_DEFECTO && (
              /* En la cabecera, que queda fija: la barra de abajo se pierde al
                 bajar y la capa no se puede olvidar. */
              <span className="acad-brand-capa">{capa.nombre}</span>
            )}
          </Link>
          <Buscador urlIndice={`/academia/indice?capa=${capa.clave}`} base={RUTA_MANUAL}
                    placeholder="Buscar en el manual…" />
          <AcademiaChrome />
          {salida && <AcademiaSalir />}
        </div>
      </header>

      {eligeCapa && <AcademiaCapa capa={capa} apartados={apartados} total={total} />}

      {children}

      {/* Enlace de verdad: sin JS lleva arriba igual. El JS solo lo esconde
          mientras se está en la cabecera y le pone la animación. */}
      <a className="acad-nav acad-arriba" data-acad-arriba href="#" aria-label="Volver arriba">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </a>
    </div>
  )
}
