'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Pencil, Package } from 'lucide-react'
import type { CatalogoData, CatalogoItem } from '@/app/actions/portal/catalogo'
import { useIa } from '@/components/portal/ia/IaContext'
import ItemModal from '../ItemModal'

export default function ItemDetalleView({ data, item }: { data: CatalogoData; item: CatalogoItem }) {
  const router = useRouter()
  const { tieneIa } = useIa()
  const [editando, setEditando] = useState(false)

  const categoriaNombre = data.categorias.find(c => c.categoria_id === item.categoria_id)?.nombre ?? null
  const etiqueta = data.etiquetas.catalogo
  const moneda = item.monedaMostrada ?? ''

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <Link href="/portal/catalogo" className="btn btn-ghost btn-sm">
            <ArrowLeft size={16} strokeWidth={2} /> Volver al {etiqueta.toLowerCase()}
          </Link>
          <h1 className="page-title">{item.nombre}</h1>
          {categoriaNombre && <p className="page-subtitle">{categoriaNombre}</p>}
        </div>
        <button className="btn btn-primary" onClick={() => setEditando(true)}>
          <Pencil size={16} strokeWidth={2} /> Editar
        </button>
      </div>

      <div className="card">
        <div className="cat-detalle-grid">
          <div className="cat-detalle-photo">
            {item.foto_url
              ? <Image src={item.foto_url} alt={item.nombre} fill sizes="300px" className="cat-detalle-photo-img" unoptimized />
              : <Package size={40} strokeWidth={1.5} />}
          </div>
          <div>
            <div className="cat-detalle-badges">
              {!item.disponible && <span className="badge badge-neutral">Agotado</span>}
              {item.descuentoPct ? <span className="badge badge-fill badge-success">-{item.descuentoPct}%</span> : null}
            </div>

            {item.precioMostrado != null && (
              <p className="cat-detalle-precio">
                {item.precioAntes != null && (
                  <span className="cat-precio-antes">{item.precioAntes.toFixed(2)} {moneda}</span>
                )}
                {item.precioMostrado.toFixed(2)} {moneda}
              </p>
            )}
            {data.tieneInventario && item.stock != null && (
              <p className="cat-detalle-stock">Stock en Inventario: {item.stock}</p>
            )}
            {item.descripcion && <p className="cat-detalle-desc">{item.descripcion}</p>}

            <div className="cat-detalle-meta">
              {item.ingredientes && (
                <div className="cat-detalle-meta-row">
                  <span className="cat-detalle-meta-label">Ingredientes</span>
                  <span>{item.ingredientes}</span>
                </div>
              )}
              {item.alergenos && (
                <div className="cat-detalle-meta-row">
                  <span className="cat-detalle-meta-label">Alérgenos</span>
                  <span>{item.alergenos}</span>
                </div>
              )}
              {item.calorias != null && (
                <div className="cat-detalle-meta-row">
                  <span className="cat-detalle-meta-label">Calorías</span>
                  <span>{item.calorias} kcal</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {editando && (
        <ItemModal
          item={item}
          categorias={data.categorias}
          monedaCatalogo={data.monedaCatalogo}
          monedasActivas={data.monedasActivas}
          tieneIa={tieneIa}
          onClose={() => setEditando(false)}
          onSaved={() => { setEditando(false); router.refresh() }}
        />
      )}
    </div>
  )
}
