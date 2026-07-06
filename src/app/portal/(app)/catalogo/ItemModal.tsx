'use client'

import { useState, useTransition } from 'react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import {
  guardarItem, subirFotoItem, quitarFotoItem,
  type CatalogoItem, type CatalogoCategoria, type MonedaOpcion,
} from '@/app/actions/portal/catalogo'
import { autocompletarItemCatalogo } from '@/app/actions/portal/ia'
import ImageUpload from '@/components/ImageUpload'
import { X, Check, Loader2, Sparkles } from 'lucide-react'

// Modal de alta/edición de un ítem del catálogo. Compartido entre el editor
// (lista/tarjetas) y la página de detalle, para que "Editar" abra el mismo
// formulario sin salir de la pantalla.
export default function ItemModal({ item, categorias, monedaCatalogo, monedasActivas, tieneIa, onClose, onSaved }: {
  item: CatalogoItem | null
  categorias: CatalogoCategoria[]
  monedaCatalogo: string
  monedasActivas: MonedaOpcion[]
  tieneIa: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [sugiriendo, setSugiriendo] = useState(false)
  const [nombre, setNombre] = useState(item?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(item?.descripcion ?? '')
  const [ingredientes, setIngredientes] = useState(item?.ingredientes ?? '')
  const [alergenos, setAlergenos] = useState(item?.alergenos ?? '')
  const [calorias, setCalorias] = useState(item?.calorias?.toString() ?? '')
  const [nuevaFoto, setNuevaFoto] = useState<File | null>(null)
  const [quitarFoto, setQuitarFoto] = useState(false)

  // Monedas disponibles en el selector: la del catálogo + la del ítem (por si es
  // una importada que ya no está activa) + las activas del cliente, sin repetir.
  const codigosMoneda = Array.from(
    new Set([monedaCatalogo, item?.moneda, ...monedasActivas.map(m => m.codigo)].filter(Boolean)),
  ) as string[]

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const r = await guardarItem(fd)
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }

      const itemId = r.item_id!
      if (nuevaFoto) {
        const fdFoto = new FormData()
        fdFoto.set('item_id', itemId)
        fdFoto.set('foto', nuevaFoto)
        const rf = await subirFotoItem(fdFoto)
        if (!rf.ok) toastError(rf.error ?? 'La foto no se pudo subir.')
      } else if (quitarFoto && item?.foto_url) {
        await quitarFotoItem(itemId)
      }

      toastSuccess('Producto guardado.')
      onSaved()
    })
  }

  function autocompletar() {
    if (!nombre.trim()) { toastError('Escribe primero el nombre.'); return }
    setSugiriendo(true)
    autocompletarItemCatalogo(nombre.trim()).then(r => {
      setSugiriendo(false)
      if (!r.ok) { toastError(r.error); return }
      if (r.sugerencia.descripcion)  setDescripcion(r.sugerencia.descripcion)
      if (r.sugerencia.ingredientes) setIngredientes(r.sugerencia.ingredientes)
      if (r.sugerencia.alergenos)    setAlergenos(r.sugerencia.alergenos)
      if (r.sugerencia.calorias != null) setCalorias(String(r.sugerencia.calorias))
      toastSuccess('Sugerencias aplicadas. Revísalas antes de guardar.')
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{item ? 'Editar producto' : 'Nuevo producto'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <input type="hidden" name="item_id" defaultValue={item?.item_id ?? ''} />
          <div className="modal-body">
            <ImageUpload
              label="foto"
              valorInicial={quitarFoto ? null : item?.foto_url}
              onChange={file => { setNuevaFoto(file); setQuitarFoto(!file) }}
              onRemove={() => setQuitarFoto(true)}
            />

            <div className="input-group">
              <label htmlFor="item-nombre">Nombre <span className="required">*</span></label>
              <input id="item-nombre" name="nombre" className="input" value={nombre}
                onChange={e => setNombre(e.target.value)} required autoFocus />
            </div>

            <div className="input-group">
              <label htmlFor="item-categoria">Categoría</label>
              <select id="item-categoria" name="categoria_id" className="input" defaultValue={item?.categoria_id ?? ''}>
                <option value="">Sin categoría</option>
                {categorias.map(c => <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>)}
              </select>
            </div>

            <div className="cat-form-row">
              <div className="input-group">
                <label htmlFor="item-precio">Precio</label>
                <input id="item-precio" name="precio" type="number" step="0.01" min="0" className="input" defaultValue={item?.precio ?? ''} />
              </div>
              <div className="input-group">
                <label htmlFor="item-moneda">Moneda</label>
                <select id="item-moneda" name="moneda" className="input" defaultValue={item?.moneda ?? monedaCatalogo}>
                  {codigosMoneda.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <p className="input-hint">Se mostrará convertido a {monedaCatalogo} (la moneda que verá el cliente) según la tasa de cambio.</p>

            <div className="cat-form-row">
              <div className="input-group">
                <label htmlFor="item-descuento">Descuento (%)</label>
                <input id="item-descuento" name="descuento_pct" type="number" min="0" max="100" step="0.01"
                  className="input" defaultValue={item?.descuento_pct ? item.descuento_pct : ''} placeholder="0" />
              </div>
              <div className="input-group">
                <label htmlFor="item-calorias">Calorías</label>
                <input id="item-calorias" name="calorias" type="number" min="0" className="input"
                  value={calorias} onChange={e => setCalorias(e.target.value)} />
              </div>
            </div>
            <p className="input-hint">Si la categoría tiene un descuento, el del producto manda cuando es mayor que 0.</p>

            {tieneIa && (
              <button type="button" className="btn btn-secondary btn-sm cat-ia-btn" onClick={autocompletar} disabled={sugiriendo}>
                {sugiriendo ? <Loader2 size={14} strokeWidth={2} className="img-upload-spin" /> : <Sparkles size={14} strokeWidth={2} />}
                {sugiriendo ? 'Pensando…' : 'Autocompletar con IA'}
              </button>
            )}

            <div className="input-group">
              <label htmlFor="item-descripcion">Descripción</label>
              <textarea id="item-descripcion" name="descripcion" className="input" rows={2}
                value={descripcion ?? ''} onChange={e => setDescripcion(e.target.value)} />
            </div>

            <div className="input-group">
              <label htmlFor="item-ingredientes">Ingredientes</label>
              <input id="item-ingredientes" name="ingredientes" className="input"
                value={ingredientes ?? ''} onChange={e => setIngredientes(e.target.value)} />
            </div>

            <div className="input-group">
              <label htmlFor="item-alergenos">Alérgenos</label>
              <input id="item-alergenos" name="alergenos" className="input"
                value={alergenos ?? ''} onChange={e => setAlergenos(e.target.value)} />
            </div>

            <label className="res-switch-wrap">
              <input type="checkbox" name="disponible" value="true" defaultChecked={item?.disponible ?? true} />
              <span className="res-switch-text">Disponible (desmarca si está agotado)</span>
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <Loader2 size={16} strokeWidth={2} className="img-upload-spin" /> : <Check size={16} strokeWidth={2} />} Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
