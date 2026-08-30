import Link from 'next/link'
import { rutaDe, BASE_MANUAL } from './piezas'
import { duracion, type PiezaLeida } from './manual'
import { caraDe } from './visual'
import { MONEDAS_CLAUX, importeClaux } from '@/lib/moneda-claux'

/**
 * Una pieza en la rejilla de una portada: nombre, para qué es, qué lleva dentro
 * y cuánto cuesta leerla.
 *
 * La pintan las dos portadas —la del manual y la del centro de ayuda—, y solo se
 * diferencian en dos cosas: a dónde llevan (`base`) y si dicen el precio
 * (`comercial`). Todo lo demás —el icono de color de la familia, las páginas del
 * portal, los apartados y los minutos— es idéntico, y una copia se habría
 * quedado atrás a la primera tarjeta que cambiara.
 */

/** Lo que se ve dentro de la pieza sin entrar: sus páginas del portal o dónde vive. */
function dentroDe(pieza: PiezaLeida): string | null {
  const paginas = pieza.ficha?.paginas
  if (paginas && paginas.length > 0) {
    const primeras = paginas.slice(0, 3).join(' · ')
    return paginas.length > 3 ? `${primeras} · +${paginas.length - 3}` : primeras
  }
  return pieza.ficha?.donde ?? null
}

export default function Tarjeta({ pieza, base = BASE_MANUAL, comercial = true }: {
  pieza: PiezaLeida; base?: string; comercial?: boolean
}) {
  const dentro = dentroDe(pieza)
  const { Icono, acento } = caraDe(pieza.slug, pieza.ficha?.clave)
  return (
    <Link className="acad-nav acad-card" href={rutaDe(pieza.slug, base)} prefetch={false}>
      <span className="acad-card-head">
        {/* El acento de color sale de la landing (.ld-ac-*), que es donde vive la
            familia de los seis: el mismo módulo se ve del mismo color en la web
            pública, en el manual y en el menú del portal. */}
        <span className={`acad-card-icono ld-ac-${acento}`} aria-hidden="true">
          <Icono size={20} strokeWidth={2} />
        </span>
        <span className="acad-card-nombre">{pieza.nombre}</span>
      </span>
      <span className="acad-card-res">{pieza.resumen}</span>
      {dentro && <span className="acad-card-dentro">{dentro}</span>}
      <span className="acad-card-pie">
        {pieza.cuerpo
          ? <span className="acad-card-num">{pieza.apartados.length} apartados · {duracion(pieza.minutos)}</span>
          : <span className="acad-card-pend">En preparación</span>}
        {/* Las dos monedas, nunca una convertida: el precio en euros es propio
            (mig. 225) y el comercial tiene que poder leer el que va a decir. */}
        {comercial && pieza.precio && (
          <span className="acad-card-precio">
            desde {MONEDAS_CLAUX.map(m => importeClaux(pieza.precio!.precios[m].inicial, m)).join(' · ')}
          </span>
        )}
      </span>
    </Link>
  )
}
