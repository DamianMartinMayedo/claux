import Link from 'next/link'

// ── Gancho pre-compra de Contabilidad (M3) ───────────────────────────────────
//
// EL AGUJERO QUE CIERRA: el cliente con `dossier` SIN `base` teclea sus números
// sin saber que el producto puede rellenarlos solos. Todos los usos de `tieneBase`
// en la UI del dossier son `tieneBase &&`, así que sin el módulo la vía automática
// ni siquiera se DIBUJA: no hay botón «Traer mis números» y los guardias de
// servidor que dicen «Necesitas la Contabilidad» son inalcanzables. El
// descubrimiento POST-compra sí estaba resuelto (el aviso «Ahora tienes
// Contabilidad»); faltaba el pre-compra, que es el que vende.
//
// NO ES UN CANDADO, y esa es la línea que no se cruza (CONTEXTO §2 /
// MODELO-MODULOS §3.1): la función se entrega igual y solo se NOMBRA lo que la
// haría mejor. Mismo patrón exacto que la pestaña «Facturación del período» de
// Suscripciones: `alert alert-warning alert-cta` + `.btn-aviso` → /portal/soporte.
//
// La promesa de «lo que ya escribiste se conserva» es literalmente cierta y ya
// está construida: la fusión es no destructiva por fila (`dossier_serie.origen`),
// con previsualización de conflictos. Poder prometer «no perderás nada» sin mentir
// es el mejor argumento contra el miedo a contratar.

export default function AvisoContabilidad({ texto }: { texto: string }) {
  return (
    <div className="alert alert-warning alert-cta">
      <span className="alert-cta-texto">{texto}</span>
      <Link href="/portal/soporte" className="btn btn-aviso btn-sm">Quiero Contabilidad</Link>
    </div>
  )
}
