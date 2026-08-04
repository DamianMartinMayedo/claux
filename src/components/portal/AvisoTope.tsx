'use client'

// ────────────────────────────────────────────────────────────────────────────
// «Hay más filas de las que caben»: no es un error, es un límite — y lleva dentro la forma
// de superarlo, que es lo que le faltaba.
//
// ── LO QUE DECÍA ESTABA AL REVÉS ──────────────────────────────────────────────
// «Se enseñan los primeros 500 del rango. Acota el rango para ver el resto». Las dos frases
// eran falsas: el listado ordena por fecha DESCENDENTE, así que el techo no recorta «los
// primeros» sino **los más VIEJOS** — y acotar el rango no sirve para llegar a lo antiguo,
// hay que adivinar unas fechas pasadas a mano. Un negocio con 523 registros veía los 500
// recientes y creía que su histórico empezaba en enero.
//
// El arreglo estaba escrito en `lib/listados.ts` y aplicado SOLO en Gastos y cobros; Ventas,
// Tesorería, Compras y Movimientos seguían con el texto viejo y sin forma de traer más.
// Vive aquí para que no haya un quinto sitio donde se pueda volver a escribir al revés.
// ────────────────────────────────────────────────────────────────────────────

import { useRouter } from 'next/navigation'
import { LIMITE_LISTADO, TOPE_VER_MAS } from '@/lib/listados'

interface Props {
  /** Cuántas filas se están enseñando. */
  mostrados: number
  /** Cuántas cumplen el filtro DE VERDAD (el `count: 'exact'` de la consulta). */
  total:     number
  /** Techo con el que se consultó, para saber si aún se puede subir. */
  limite:    number
  /** En plural y en las palabras del dueño: «movimientos», «compras», «facturas». */
  sustantivo: string
  /** Para que concuerde: «las 500 más recientes» en vez de «los 500 más recientes». */
  femenino?: boolean
  /** Una coletilla propia de la pantalla (los saldos de Tesorería, por ejemplo). */
  children?: React.ReactNode
}

export default function AvisoTope({
  mostrados, total, limite, sustantivo, femenino, children,
}: Props) {
  const router = useRouter()
  const faltan = Math.max(0, total - mostrados)

  /** Sube el techo en la URL: el servidor vuelve a consultar con más filas. */
  function verMas() {
    const url = new URL(window.location.href)
    url.searchParams.set('limite', String(Math.min(limite + LIMITE_LISTADO, TOPE_VER_MAS)))
    router.replace(`${url.pathname}${url.search}`, { scroll: false })
  }

  return (
    <p className="listado-tope">
      {/* El `sustantivo` se pedía como prop obligatoria, lo pasaban las cinco pantallas… y no
          se imprimía: el aviso decía «se enseñan los 10 más recientes de 47» —¿diez qué?— y
          el `femenino` estaba concordando con una palabra que no salía. */}
      Se enseñan {femenino ? 'las' : 'los'} <strong>{mostrados} {sustantivo} más recientes</strong> de {total}
      {' '}del rango: {femenino ? 'faltan las' : 'faltan los'} {faltan} más {femenino ? 'antiguas' : 'antiguos'}.
      {limite < TOPE_VER_MAS && faltan > 0 && (
        <>
          {' '}
          <button type="button" className="btn btn-ghost btn-xs" onClick={verMas}>
            Traer {Math.min(LIMITE_LISTADO, faltan)} más
          </button>
        </>
      )}
      {children && <> {children}</>}
    </p>
  )
}
