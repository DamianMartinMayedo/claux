'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { UtensilsCrossed, Package, CalendarDays, LayoutGrid, List } from 'lucide-react'
import type { CatalogoPublico as CatalogoPublicoData } from '@/app/actions/portal/catalogo'

type Vista = 'card' | 'lista'

// Página pública ligera del catálogo (menú/carta/servicios según sector). Solo
// navegación (sin carrito). El cliente puede alternar entre tarjetas (con foto)
// y lista compacta (sin foto). Al pinchar un ítem se abre su página de detalle
// (/[slug]/catalogo/[itemId]). Presupuesto de rendimiento: solo lucide-react +
// hooks de React, nada del ERP.
export default function CatalogoPublico({ data, slug }: { data: CatalogoPublicoData; slug: string }) {
  const [vista, setVista] = useState<Vista>('lista')

  // Si el único grupo es el sintético "Otros" (ítems sin categoría), no tiene
  // sentido rotularlo: se listan sin cabecera de sección.
  const soloOtros = data.categorias.length === 1 && data.categorias[0].categoria_id === '__sin__'

  // Icono de la card sin foto según el sector: restaurante → cubiertos, resto → caja.
  const PhotoIcon = data.etiquetas.catalogoIcono === 'comida' ? UtensilsCrossed : Package

  return (
    <div className="cp-shell">
      <header className="cp-header">
        <div className="cp-header-main">
          {data.negocio?.logo_url && (
            <Image src={data.negocio.logo_url} alt="" width={48} height={48} className="cp-logo" />
          )}
          <div className="cp-header-titles">
            <h1 className="cp-title">{data.negocio?.nombre}</h1>
            <p className="cp-subtitle">{data.etiquetas.catalogo}</p>
          </div>
        </div>
        {(data.tieneReservas || data.tieneCitas) && (
          <a className="cp-cta" href={`/${slug}/${data.tieneCitas ? 'citas' : 'reservar'}`}>
            <CalendarDays size={15} strokeWidth={2} />
            {data.tieneCitas ? 'Pedir cita' : 'Reservar'}
          </a>
        )}
      </header>

      {data.categorias.length === 0 ? (
        <div className="cp-empty">
          <PhotoIcon size={32} strokeWidth={1.5} />
          <p>Este {data.etiquetas.catalogo.toLowerCase()} todavía no tiene productos.</p>
        </div>
      ) : (
        <>
          <div className="cp-toolbar">
            <div className="cp-viewtoggle" role="group" aria-label="Cambiar vista">
              <button className={`cp-viewtoggle-btn ${vista === 'card' ? 'active' : ''}`}
                onClick={() => setVista('card')} aria-label="Ver en tarjetas" aria-pressed={vista === 'card'}>
                <LayoutGrid size={16} strokeWidth={2} />
              </button>
              <button className={`cp-viewtoggle-btn ${vista === 'lista' ? 'active' : ''}`}
                onClick={() => setVista('lista')} aria-label="Ver en lista" aria-pressed={vista === 'lista'}>
                <List size={16} strokeWidth={2} />
              </button>
            </div>
          </div>

          {data.categorias.map(cat => (
            <section key={cat.categoria_id} className="cp-categoria">
              {!soloOtros && <h2 className="cp-categoria-title">{cat.nombre}</h2>}

              {vista === 'card' ? (
                <div className="cp-grid">
                  {cat.items.map(item => (
                    <Link
                      key={item.item_id}
                      href={`/${slug}/catalogo/${item.item_id}`}
                      className={`cp-card ${!item.disponible ? 'cp-card-agotado' : ''}`}
                    >
                      <span className="cp-card-photo">
                        {item.foto_thumb_url
                          ? <Image src={item.foto_thumb_url} alt="" fill sizes="(max-width:520px) 50vw, 200px" className="cp-item-photo-img" />
                          : <span className="cp-card-photo-empty"><PhotoIcon size={26} strokeWidth={1.5} /></span>}
                        {!item.disponible && <span className="cp-badge">Agotado</span>}
                        {item.descuentoPct > 0 && <span className="cp-badge-desc">-{item.descuentoPct}%</span>}
                      </span>
                      <span className="cp-card-body">
                        <span className="cp-card-nombre">{item.nombre}</span>
                        {item.descripcion && <span className="cp-card-desc">{item.descripcion}</span>}
                        {item.precio != null && (
                          <span className="cp-card-precio">
                            {item.precioAntes != null && <span className="cp-precio-antes">{item.precioAntes.toFixed(2)}</span>}
                            {item.precio.toFixed(2)} {item.moneda ?? ''}
                          </span>
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="cp-list">
                  {cat.items.map(item => (
                    <Link
                      key={item.item_id}
                      href={`/${slug}/catalogo/${item.item_id}`}
                      className={`cp-row ${!item.disponible ? 'cp-card-agotado' : ''}`}
                    >
                      <span className="cp-row-main">
                        <span className="cp-row-nombre">
                          {item.nombre}
                          {!item.disponible && <span className="cp-badge cp-badge-inline">Agotado</span>}
                          {item.descuentoPct > 0 && <span className="cp-badge-desc-inline">-{item.descuentoPct}%</span>}
                        </span>
                        {item.descripcion && <span className="cp-row-desc">{item.descripcion}</span>}
                      </span>
                      {item.precio != null && (
                        <span className="cp-row-precio">
                          {item.precioAntes != null && <span className="cp-precio-antes">{item.precioAntes.toFixed(2)}</span>}
                          {item.precio.toFixed(2)} {item.moneda ?? ''}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  )
}
