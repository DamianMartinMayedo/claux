import Link from 'next/link'
import AyudaShell from './AyudaShell'

/** Una guía que no existe (enlace viejo, URL a mano). Se vuelve al índice. */
export default function AyudaNoEncontrada() {
  return (
    <AyudaShell>
      <div className="acad-shell es-suelto">
        <main className="acad-main es-portada">
          <div className="acad-portada-head">
            <p className="acad-kicker">Centro de ayuda de CLAUX</p>
            <h1 className="acad-h1">Esa guía no está aquí</h1>
            <p className="acad-portada-entrada">
              Puede que el enlace sea de una versión anterior, o que la guía haya cambiado de
              nombre. El índice tiene todas las que hay.
            </p>
            <p className="acad-portada-estado">
              <Link href="/ayuda">Volver al centro de ayuda</Link>
            </p>
          </div>
        </main>
      </div>
    </AyudaShell>
  )
}
