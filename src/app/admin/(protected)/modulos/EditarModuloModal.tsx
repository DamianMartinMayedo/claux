'use client'

import { Sparkles, X } from 'lucide-react'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { editarModulo, previsualizarPrecio, sugerirTextosModuloIa } from '@/app/actions/modulos'
import FormHelp from '@/components/portal/FormHelp'
import ModalShell from '@/components/portal/ModalShell'
import { useToast } from '@/app/contexts/ToastContext'
import { NIVELES, CAMPO_PRECIO, precioModulo, type Nivel } from '@/lib/niveles'
import { MONEDAS_CLAUX } from '@/lib/moneda-claux'
import ImpactoPrecios, { type ImpactoFila } from './ImpactoPrecios'

function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function ensurePages(paginas: unknown): Pagina[] {
  if (Array.isArray(paginas)) return paginas
  if (typeof paginas === 'string') {
    try { const p = JSON.parse(paginas); return Array.isArray(p) ? p : [] }
    catch { return [] }
  }
  return []
}

interface Pagina {
  ruta: string
  label: string
  orden: number
}

type Modulo = {
  clave: string
  nombre: string
  descripcion: string | null
  beneficio: string | null
  resumen: string | null
  precio_inicial_usd: number
  precio_empresa_usd: number
  precio_pro_usd: number
  precio_inicial_eur: number
  precio_empresa_eur: number
  precio_pro_eur: number
  tipo: string
  activo: boolean
  orden: number
  paginas?: Pagina[] | null
}

export default function EditarModuloModal({
  modulo,
  nombresNivel,
  open: openProp,
  onClose: onCloseProp,
}: {
  modulo: Modulo
  nombresNivel: Record<Nivel, string>
  /** Modo controlado: si se pasa, el padre gobierna la apertura y no se
   *  renderiza el botón disparador (se usa desde el menú RowActions). */
  open?: boolean
  onClose?: () => void
}) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  const isControlled = openProp !== undefined
  const [openState, setOpen] = useState(false)
  const open = isControlled ? openProp : openState
  const [loading, setLoading] = useState(false)
  const [paginas, setPaginas] = useState<Pagina[]>(() => ensurePages(modulo.paginas))
  const [nuevaRuta, setNuevaRuta]   = useState('')
  const [nuevoLabel, setNuevoLabel] = useState('')
  const [addError, setAddError]     = useState('')
  const [editTipo, setEditTipo]     = useState(modulo.tipo)
  /* Los tres textos van en estado y no en `defaultValue` porque la IA los
     rellena desde fuera; el `name` sigue puesto y viajan igual en el FormData. */
  const [textos, setTextos] = useState({
    descripcion: modulo.descripcion ?? '',
    beneficio:   modulo.beneficio ?? '',
    resumen:     modulo.resumen ?? '',
  })
  const [iaPensando, setIaPensando] = useState(false)
  const [routeEdited, setRouteEdited] = useState(false)
  // Impacto pendiente de confirmar: mientras no sea null, el modal está
  // preguntando «esto le cambia la cuota a esta gente, ¿seguimos?».
  const [porConfirmar, setPorConfirmar] = useState<ImpactoFila[] | null>(null)
  const formRef               = useRef<HTMLFormElement>(null)

  // Reset intencional del formulario cuando cambia el módulo editado (p.ej. tras guardar + refresh).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPaginas(ensurePages(modulo.paginas))
    setEditTipo(modulo.tipo)
    setTextos({
      descripcion: modulo.descripcion ?? '',
      beneficio:   modulo.beneficio ?? '',
      resumen:     modulo.resumen ?? '',
    })
    setNuevaRuta(''); setNuevoLabel(''); setRouteEdited(false)
    setPorConfirmar(null)
  }, [modulo])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleClose = useCallback(() => {
    if (isControlled) onCloseProp?.()
    else setOpen(false)
    setAddError('')
    setNuevaRuta(''); setNuevoLabel(''); setRouteEdited(false)
    setPaginas(ensurePages(modulo.paginas))
    setEditTipo(modulo.tipo)
    setTextos({
      descripcion: modulo.descripcion ?? '',
      beneficio:   modulo.beneficio ?? '',
      resumen:     modulo.resumen ?? '',
    })
    setPorConfirmar(null)
  }, [isControlled, onCloseProp, modulo])

  /**
   * Pide los tres textos a la IA interna y los deja en las casillas. No guarda:
   * hasta que no se pulse Guardar, el catálogo sigue como estaba, y Cancelar lo
   * deshace. Lo que la IA no devuelva se queda como estaba escrito.
   */
  async function sugerirConIa() {
    setIaPensando(true)
    const res = await sugerirTextosModuloIa(modulo.clave)
    setIaPensando(false)
    if (!res.ok || !res.textos) { toastError(res.error ?? 'No se pudo redactar.'); return }
    const t = res.textos
    setTextos(prev => ({
      descripcion: t.descripcion ?? prev.descripcion,
      beneficio:   t.beneficio   ?? prev.beneficio,
      resumen:     t.resumen     ?? prev.resumen,
    }))
    toastSuccess('Textos sugeridos. Revísalos y guarda.')
  }

  function handleLabelChange(val: string) {
    setNuevoLabel(val)
    if (!routeEdited) {
      setNuevaRuta('/portal/' + slugify(val))
    }
  }

  function handleRouteChange(val: string) {
    setNuevaRuta(val)
    setRouteEdited(true)
    setAddError('')
  }

  function addPagina() {
    setAddError('')
    const ruta  = nuevaRuta.trim()
    const label = nuevoLabel.trim()
    if (!ruta || !label) { setAddError('Ruta y label son obligatorios.'); return }
    if (!ruta.startsWith('/portal/')) { setAddError('La ruta debe empezar por /portal/'); return }
    if (paginas.some(p => p.ruta === ruta)) { setAddError('Esa ruta ya existe en este módulo.'); return }
    setPaginas(prev => [...prev, { ruta, label, orden: prev.length }])
    setNuevaRuta(''); setNuevoLabel('')
  }

  function removePagina(index: number) {
    setPaginas(prev => prev.filter((_, i) => i !== index).map((p, i) => ({ ...p, orden: i })))
  }

  // Drag-and-drop: reordenar páginas
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  function handlePageDragStart(index: number) { setDragIndex(index) }
  function handlePageDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    const reordered = [...paginas]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(index, 0, moved)
    const final = reordered.map((p, i) => ({ ...p, orden: i }))
    setPaginas(final)
    setDragIndex(index)
  }
  function handlePageDragEnd() { setDragIndex(null) }

  /** Los seis precios tal como están escritos AHORA en el formulario. */
  function preciosDelFormulario(): Record<string, Record<string, number>> {
    const fd = new FormData(formRef.current!)
    return Object.fromEntries(MONEDAS_CLAUX.map(moneda => [
      moneda,
      Object.fromEntries(
        NIVELES.map(n => [n, Number(fd.get(CAMPO_PRECIO[moneda][n]) ?? 0) || 0]),
      ),
    ]))
  }

  async function guardar() {
    setLoading(true)
    const fd = new FormData(formRef.current!)
    fd.set('paginas', JSON.stringify(paginas))
    fd.set('tipo', editTipo)
    const res = await editarModulo(fd)
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al guardar'); return }
    const n = res.clientesRecalculados ?? 0
    toastSuccess(n > 0 ? `Módulo guardado · ${n} cuota(s) recalculada(s)` : 'Módulo guardado')
    setTimeout(() => { handleClose(); router.refresh() }, 600)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Si los precios no se han tocado, no hay nada que avisar: se guarda directo.
    const precios = preciosDelFormulario()
    const cambian = MONEDAS_CLAUX.some(moneda =>
      NIVELES.some(n => precios[moneda][n] !== precioModulo(modulo, n, moneda)))
    if (!cambian) { await guardar(); return }

    // Cambiar un precio del catálogo mueve la cuota de todo el que tenga este
    // módulo. No se guarda sin enseñar a quién y cuánto (plan §8.2).
    setLoading(true)
    const prev = await previsualizarPrecio(modulo.clave, precios)
    setLoading(false)
    if (!prev.ok) { toastError('No se pudo calcular el impacto'); return }
    if (!prev.impacto.length) { await guardar(); return }
    setPorConfirmar(prev.impacto)
  }

  const modal = (
    <ModalShell title={<>Editar — {modulo.clave}</>} size="modal-lg" onClose={handleClose}>
      <form ref={formRef} onSubmit={handleSubmit}>
        <input type="hidden" name="clave" value={modulo.clave} />
        <div className="modal-body">
          {/* ── Datos básicos ── */}
          <div className="grid-cols-2">
            <div className="input-group">
              <label>Nombre <span className="required">*</span></label>
              <input name="nombre" className="input" required defaultValue={modulo.nombre} />
            </div>
            <div className="input-group">
              <div className="form-label-with-help">
                <label>Tipo</label>
                {modulo.tipo === 'addon' && <FormHelp text="Los addons no pueden cambiar de tipo." label="Por qué no se puede cambiar el tipo" />}
              </div>
              <select
                className="input"
                value={editTipo}
                onChange={e => setEditTipo(e.target.value)}
                disabled={modulo.tipo === 'addon'}
              >
                <option value="modulo">Módulo</option>
                <option value="funcionalidad">Funcionalidad</option>
                {modulo.tipo === 'addon' && <option value="addon">Addon</option>}
              </select>
            </div>
          </div>
          {/* Los tres textos, juntos y con su destino escrito. Separados no hay
              forma de ver que uno repite al otro, y son distintos a propósito:
              uno describe, otro vende y el tercero cabe.

              Aquí NO está el orden. Era una casilla muerta: el formulario lo
              mandaba dos veces —un `hidden` y esta— y `FormData.get` devuelve
              el primero, así que lo tecleado no llegaba nunca al servidor y no
              lo decía. Y no se arregla dejando la casilla: el orden es la
              POSICIÓN en la lista, se cambia arrastrando la fila y `reordenar
              Modulos` renumera el catálogo entero; un número a mano solo puede
              empatar con el de otro módulo. */}
          <div className="mod-textos">
            <div className="input-group-head">
              <span className="modal-section-label">Textos del catálogo</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={iaPensando}
                onClick={sugerirConIa}
              >
                {iaPensando
                  ? <><span className="spinner spinner-sm" /> Redactando…</>
                  : <><Sparkles size={14} strokeWidth={2} /> Sugerir con IA</>}
              </button>
            </div>
            <div className="input-group">
              <label htmlFor="mod-descripcion">Descripción</label>
              <input
                id="mod-descripcion" name="descripcion" className="input"
                value={textos.descripcion}
                onChange={e => setTextos(t => ({ ...t, descripcion: e.target.value }))}
              />
              <span className="input-hint">Qué es. Landing y factura.</span>
            </div>
            <div className="input-group">
              <label htmlFor="mod-beneficio">Beneficio</label>
              <textarea
                id="mod-beneficio" name="beneficio" className="input" rows={2}
                value={textos.beneficio}
                onChange={e => setTextos(t => ({ ...t, beneficio: e.target.value }))}
              />
              <span className="input-hint">Por qué le sirve al negocio. Diapositiva «Pensado para tu negocio» de la propuesta.</span>
            </div>
            <div className="input-group">
              <label htmlFor="mod-resumen">Resumen</label>
              <input
                id="mod-resumen" name="resumen" className="input" maxLength={80}
                value={textos.resumen}
                onChange={e => setTextos(t => ({ ...t, resumen: e.target.value }))}
              />
              <span className="input-hint">Dos líneas, unos 55 caracteres. Ficha de precios de la propuesta, cuatro por página: más largo y la ficha crece.</span>
            </div>
          </div>
          {/* Un precio por nivel Y POR MONEDA: seis casillas, las seis a mano. El
              de euros no es el de dólares al cambio del día —ese era justo el
              problema— sino un precio propio que se teclea aquí. Los rótulos de
              nivel salen de /admin/niveles: si el dueño renombra uno, este
              formulario lo dice sin tocar código. */}
          {MONEDAS_CLAUX.map(moneda => (
            <div className="grid-cols-3" key={moneda}>
              {NIVELES.map(n => (
                <div className="input-group" key={n}>
                  <label htmlFor={`mod-${moneda}-${n}`}>Precio {nombresNivel[n]} ({moneda})</label>
                  <input id={`mod-${moneda}-${n}`} name={CAMPO_PRECIO[moneda][n]} className="input"
                         type="number" min="0" step="any" required
                         defaultValue={precioModulo(modulo, n, moneda)}
                         onChange={() => setPorConfirmar(null)} />
                </div>
              ))}
            </div>
          ))}
          <label className="module-check">
            <input type="checkbox" name="activo" value="true" defaultChecked={modulo.activo} />
            Activo (visible en los toggles de cliente)
          </label>

          {/* Paso de confirmación: solo aparece cuando el precio nuevo le mueve
              la cuota a alguien. Los campos siguen editables a propósito —
              tocar uno vuelve a dejarlo en «Guardar» y a recalcular el aviso. */}
          {porConfirmar && (
            <ImpactoPrecios impacto={porConfirmar} nombresNivel={nombresNivel} />
          )}

          {/* ── Páginas internas (solo para módulos) ── */}
          {editTipo === 'modulo' && (
            <div className="mod-paginas-section">
              <div className="mod-paginas-header">
                <h3 className="mod-paginas-title">Páginas internas</h3>
                <span className="text-xs-muted">{paginas.length} página{paginas.length !== 1 ? 's' : ''}</span>
              </div>

              {paginas.length > 0 && (
                <div className="mod-paginas-list">
                  {paginas.map((p, i) => (
                    <div
                      key={p.ruta}
                      className={`mod-pagina-row${dragIndex === i ? ' mod-pagina-dragging' : ''}`}
                      draggable
                      onDragStart={() => handlePageDragStart(i)}
                      onDragOver={(e) => handlePageDragOver(e, i)}
                      onDragEnd={handlePageDragEnd}
                    >
                      <span className="mod-pagina-drag">⠿</span>
                      <div className="mod-pagina-info">
                        <code className="mod-pagina-ruta">{p.ruta}</code>
                        <span className="mod-pagina-label">{p.label}</span>
                      </div>
                      <button
                        type="button"
                        className="mod-pagina-remove"
                        onClick={() => removePagina(i)}
                        title="Quitar página"
                        aria-label="Quitar página"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mod-paginas-add">
                <div className="mod-paginas-add-fields">
                  <input
                    type="text"
                    className="input"
                    placeholder="Nombre visible"
                    value={nuevoLabel}
                    onChange={e => handleLabelChange(e.target.value)}
                  />
                  <input
                    type="text"
                    className="input mod-pagina-ruta-input"
                    placeholder="/portal/nombre-continua"
                    value={nuevaRuta}
                    onChange={e => handleRouteChange(e.target.value)}
                  />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addPagina}>
                    + Añadir
                  </button>
                </div>
                {addError && <span className="input-hint text-error">{addError}</span>}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {porConfirmar ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setPorConfirmar(null)}>
                Volver a editar
              </button>
              <button type="button" className="btn btn-primary" onClick={guardar} disabled={loading}>
                {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar y recalcular'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar'}
              </button>
            </>
          )}
        </div>
      </form>
    </ModalShell>
  )

  return (
    <>
      {!isControlled && (
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>Editar</button>
      )}
      {open && modal}
    </>
  )
}
