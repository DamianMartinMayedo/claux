import Link from 'next/link'
import { MARCA_LARGA } from '@/lib/academia/marca'

/** Una pieza que no existe (enlace viejo, URL a mano). Se vuelve al índice. */
export default function AcademiaNoEncontrada() {
  return (
    <div className="acad-shell es-suelto">
      <main className="acad-main es-portada">
        <div className="acad-portada-head">
          <p className="acad-kicker">{MARCA_LARGA}</p>
          <h1 className="acad-h1">Esa pieza no está en el manual</h1>
          <p className="acad-portada-entrada">
            Puede que el enlace sea de una versión anterior, o que la pieza haya cambiado de
            nombre. El índice tiene todas las que hay.
          </p>
          <p className="acad-portada-estado">
            <Link href="/academia">Volver al índice del manual</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
