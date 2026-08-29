import type { Metadata } from 'next'
import Link from 'next/link'
import './no-encontrado.css'

export const metadata: Metadata = { title: 'Página no encontrada' }

/**
 * El 404 de todo lo que no cae en otra frontera: una URL inventada, un enlace
 * viejo de la web, un slug legal que no existe. Las superficies con shell propio
 * —portal, admin, Academia, ayuda y las públicas por-negocio— tienen el suyo y no
 * pasan por aquí.
 *
 * **Deliberadamente pobre.** Sin cabecera de marca, sin pie, sin iconos y sin las
 * fuentes de marca, aunque el resto de páginas públicas los tengan: al colgar del
 * layout raíz, esta pantalla viaja en la carga de TODAS las rutas del sitio y su
 * CSS se precarga en todas ellas. Con el cromo público completo eran 19 KB gz de
 * más en cada visita, el menú de un restaurante incluido. Lo que se conserva es lo
 * único que hace falta: la marca, el problema y la salida. Detalle y medición, en
 * `no-encontrado.css`.
 */
export default function NoEncontrado() {
  return (
    <div className="n4-page">
      <img src="/logo_color.svg" alt="CLAUX" className="n4-logo n4-logo-claro" />
      <img src="/logo_blanco.svg" alt="CLAUX" className="n4-logo n4-logo-oscuro" />
      <h1 className="n4-titulo">Esta página no existe</h1>
      <p className="n4-texto">El enlace puede ser de una versión anterior.</p>
      <Link href="/" className="n4-enlace">Volver al inicio</Link>
    </div>
  )
}
