import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft, UtensilsCrossed, Package } from 'lucide-react'
import { obtenerItemPublico } from '@/app/actions/portal/catalogo'
import '../catalogo-publica.css'

export const revalidate = 60

interface Props {
  params: Promise<{ slug: string; itemId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, itemId } = await params
  const item = await obtenerItemPublico(slug, itemId)
  if (!item) return {}
  return {
    title: `${item.nombre} — ${item.negocio?.nombre ?? ''}`.trim(),
    description: item.descripcion ?? `${item.nombre} en ${item.negocio?.nombre ?? ''}`,
  }
}

export default async function CatalogoItemPublicoPage({ params }: Props) {
  const { slug, itemId } = await params
  const item = await obtenerItemPublico(slug, itemId)
  if (!item) notFound()

  return (
    <div className="cp-page">
      <div className="cp-shell">
        <Link href={`/${slug}/catalogo`} className="cp-back">
          <ArrowLeft size={18} strokeWidth={2} />
          {item.etiquetaCatalogo}
        </Link>

        <article className="cp-detalle">
          <div className="cp-detalle-photo">
            {item.foto_url
              ? <Image src={item.foto_url} alt="" fill sizes="(max-width:640px) 100vw, 640px" className="cp-item-photo-img" priority />
              : <span className="cp-card-photo-empty">{item.catalogoIcono === 'comida' ? <UtensilsCrossed size={40} strokeWidth={1.5} /> : <Package size={40} strokeWidth={1.5} />}</span>}
          </div>

          <div className="cp-detalle-body">
            {item.categoriaNombre && <p className="cp-detalle-cat">{item.categoriaNombre}</p>}
            <h1 className="cp-detalle-title">{item.nombre}</h1>
            {item.precio != null && (
              <p className="cp-detalle-precio">
                {item.precioAntes != null && (
                  <span className="cp-precio-antes">{item.precioAntes.toFixed(2)}</span>
                )}
                {item.precio.toFixed(2)} {item.moneda ?? ''}
                {item.descuentoPct > 0 && <span className="cp-badge-desc-inline">-{item.descuentoPct}%</span>}
              </p>
            )}
            {!item.disponible && <span className="cp-badge cp-badge-inline">Agotado</span>}
            {item.descripcion && <p className="cp-detalle-desc">{item.descripcion}</p>}
            {item.ingredientes && <p className="cp-sheet-meta"><strong>Ingredientes:</strong> {item.ingredientes}</p>}
            {item.alergenos && <p className="cp-sheet-meta"><strong>Alérgenos:</strong> {item.alergenos}</p>}
            {item.calorias != null && <p className="cp-sheet-meta"><strong>Calorías:</strong> {item.calorias} kcal</p>}
          </div>
        </article>
      </div>
    </div>
  )
}
