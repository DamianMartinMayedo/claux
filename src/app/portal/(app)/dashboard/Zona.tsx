import { Fragment, type ReactNode } from 'react'

// ── Zona del dashboard ───────────────────────────────────────────────────────
//
// El dashboard se agrupa por lo que RESUELVE (dinero · día · negocio), no por
// cosa contratada: así una funcionalidad nueva entra en la zona que le toca en
// vez de añadir una tarjeta suelta, y el dashboard no crece sin fin. Antes el
// orden estaba escrito a mano en el JSX y cada módulo nuevo era otra tarjeta más
// en una lista de ocho.
//
// El REPARTO no lo decide la tarjeta, lo decide la zona según quién más hay:
//  · sola      → ancho completo (y sin alto mínimo, o quedaría estirada y vacía)
//  · dos       → mitades; 2fr/1fr si una pesa más que la otra
//  · tres o +  → rejilla de tiles que se ajusta al ancho
//
// El título de la zona SOLO sale con dos o más tarjetas: con una, el título de
// la propia tarjeta ya dice lo que es y el rótulo sobraría.

export type PesoTarjeta = 'principal' | 'operativo' | 'estado'

export interface TarjetaZona {
  clave: string
  peso:  PesoTarjeta
  nodo:  ReactNode
  /**
   * La tarjeta ocupa TODA la fila (lleva `.dash-col-full`). No entra en el
   * reparto de columnas, así que tampoco cuenta para decidirlo: contabilidad
   * ocupa el ancho entero y las de debajo se reparten entre ellas.
   */
  ancho?: 'full'
}

export default function Zona({ titulo, tarjetas }: { titulo: string; tarjetas: TarjetaZona[] }) {
  if (tarjetas.length === 0) return null

  const sola = tarjetas.length === 1
  // El modo lo deciden las que SÍ compiten por columna. Contarlas todas hacía que
  // añadir una tercera tarjeta bajo la de ancho completo cambiara la rejilla a
  // tiles y dejara un hueco vacío en la fila de abajo.
  const enRejilla = tarjetas.filter(t => t.ancho !== 'full')
  const modo = sola
    ? 'solo'
    : enRejilla.length >= 3
      ? 'tiles'
      : enRejilla.length === 2 && enRejilla[0].peso === enRejilla[1].peso
        ? 'duo'
        : 'duo-desigual'

  return (
    <section className="dash-zona">
      {!sola && <h2 className="dash-zona-titulo">{titulo}</h2>}
      {/* Las tarjetas son hijas DIRECTAS de la rejilla (Fragment no crea nodo):
          envolverlas en un div rompería el reparto por columnas. */}
      <div className={`dash-zona-grid dash-zona-${modo}`}>
        {tarjetas.map(t => <Fragment key={t.clave}>{t.nodo}</Fragment>)}
      </div>
    </section>
  )
}
