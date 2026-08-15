'use client'

import { useState, useTransition } from 'react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import {
  guardarItem, subirFotoItem, quitarFotoItem,
  type CatalogoItem, type CatalogoCategoria, type MonedaOpcion,
} from '@/app/actions/portal/catalogo'
import { autocompletarItemCatalogo } from '@/app/actions/portal/ia'
import { OPCIONES_PERIODO } from '@/lib/catalogo-periodo'
import ImageUpload from '@/components/ImageUpload'
import { X, Check, Loader2 } from 'lucide-react'
import IaSparkle from '@/components/portal/ia/IaSparkle'
import FormHelp from '@/components/portal/FormHelp'

// Modal de alta/edición de un ítem del catálogo. Compartido entre el editor
// (lista/tarjetas) y la página de detalle, para que "Editar" abra el mismo
// formulario sin salir de la pantalla.
export default function ItemModal({ item, categorias, monedaCatalogo, monedasActivas, tieneIa, esComida, articulo, onClose, onSaved }: {
  item: CatalogoItem | null
  categorias: CatalogoCategoria[]
  monedaCatalogo: string
  monedasActivas: MonedaOpcion[]
  tieneIa: boolean
  /** Sector de comida: solo entonces se piden ingredientes/alérgenos/calorías. */
  esComida: boolean
  /** Etiqueta singular del ítem según el negocio («Plato», «Artículo», «Servicio»). */
  articulo: string
  onClose: () => void
  onSaved: () => void
}) {
  const artL = articulo.toLowerCase()
  const [isPending, startTransition] = useTransition()
  const [sugiriendo, setSugiriendo] = useState(false)
  const [nombre, setNombre] = useState(item?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(item?.descripcion ?? '')
  const [ingredientes, setIngredientes] = useState(item?.ingredientes ?? '')
  const [alergenos, setAlergenos] = useState(item?.alergenos ?? '')
  const [calorias, setCalorias] = useState(item?.calorias?.toString() ?? '')
  const [agotado, setAgotado] = useState(!(item?.disponible ?? true))
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
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const r = await guardarItem(fd)
      if (!r.ok) { await ld.dismiss(); toastError(r.error ?? 'Error inesperado.'); return }

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

      await ld.dismiss()
      toastSuccess(`${articulo} guardado.`)
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
          <h2 className="modal-title">{item ? `Editar ${artL}` : `Nuevo ${artL}`}</h2>
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
                <div className="form-label-with-help">
                  <label htmlFor="item-precio">Precio</label>
                  <FormHelp text={`Se mostrará convertido a ${monedaCatalogo} (la moneda que verá el cliente) según la tasa de cambio. Déjalo en blanco para que el cliente vea «Consultar precio» (sin importe).`} label="Información sobre el precio" />
                </div>
                <input id="item-precio" name="precio" type="number" step="any" min="0" className="input" defaultValue={item?.precio ?? ''} />
              </div>
              <div className="input-group">
                <label htmlFor="item-moneda">Moneda</label>
                <select id="item-moneda" name="moneda" className="input" defaultValue={item?.moneda ?? monedaCatalogo}>
                  {codigosMoneda.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* «Cobro» (suscripción/periodicidad) solo tiene sentido fuera de la comida:
                un plato no se cobra «/mes». En un menú se omite y queda como pago único. */}
            {!esComida && (
              <div className="input-group">
                <div className="form-label-with-help">
                  <label htmlFor="item-periodicidad">Cobro</label>
                  <FormHelp text="Si se cobra por suscripción, el precio se mostrará con su periodo (por ejemplo «/mes»)." label="Información sobre el cobro" />
                </div>
                <select id="item-periodicidad" name="periodicidad" className="input" defaultValue={item?.periodicidad ?? ''}>
                  {OPCIONES_PERIODO.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                </select>
              </div>
            )}

            <div className="input-group">
              <div className="form-label-with-help">
                <label htmlFor="item-descuento">Descuento (%)</label>
                <FormHelp text={`Si le pones un descuento al ${artL}, ese manda sobre el de la categoría.`} label="Información sobre el descuento" />
              </div>
              <input id="item-descuento" name="descuento_pct" type="number" min="0" max="100" step="any"
                className="input" defaultValue={item?.descuento_pct ? item.descuento_pct : ''} placeholder="0" />
            </div>

            {tieneIa && (
              <button type="button" className="btn btn-ia btn-sm cat-ia-btn" onClick={autocompletar} disabled={sugiriendo}>
                {sugiriendo ? <Loader2 size={14} strokeWidth={2} className="img-upload-spin" /> : <IaSparkle size={14} />}
                {sugiriendo ? 'Pensando…' : 'Autocompletar con IA'}
              </button>
            )}

            <div className="input-group">
              <label htmlFor="item-descripcion">Descripción</label>
              <textarea id="item-descripcion" name="descripcion" className="input" rows={2}
                value={descripcion ?? ''} onChange={e => setDescripcion(e.target.value)} />
            </div>

            {/* Ingredientes/Alérgenos/Calorías solo tienen sentido en un negocio de
                comida; fuera de ahí ni se piden (una ferretería no tiene alérgenos). */}
            {esComida && (
              <>
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

                <div className="input-group">
                  <label htmlFor="item-calorias">Calorías</label>
                  <input id="item-calorias" name="calorias" type="number" min="0" className="input"
                    value={calorias} onChange={e => setCalorias(e.target.value)} />
                </div>
              </>
            )}

            {/* Se pregunta por «Agotado» (lo que el dueño marca de un vistazo) pero se
                guarda `disponible` invertido. El hidden lleva el valor explícito: un
                checkbox sin marcar no envía nada y dejaría el dato ambiguo. */}
            <input type="hidden" name="disponible" value={agotado ? 'false' : 'true'} />
            <label className="res-switch-wrap">
              <input type="checkbox" checked={agotado} onChange={e => setAgotado(e.target.checked)} />
              <span className="res-switch-text">Agotado (no disponible ahora mismo)</span>
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
