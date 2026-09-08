'use client'

// Modal de moneda: crear y editar. Vive aparte de `MonedasView` porque lo abren DOS
// pantallas —la de Monedas y la guía de puesta en marcha del dashboard—, y el
// dashboard no debe arrastrarse las 800 líneas de la vista para pintar un formulario.

import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition, useEffect } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import FormHelp from '@/components/portal/FormHelp'
import ModalShell from '@/components/portal/ModalShell'
import { CATALOGO_MONEDAS } from '@/lib/monedas-catalogo'
import { puntosVentaConMoneda } from '@/app/actions/portal/caja'
import { guardarMoneda, type Moneda } from '@/app/actions/portal/monedas'

export default function MonedaModal({
  moneda,
  onClose,
  onSaved,
  onPedirEliminar,
  catalogoInicial = 'USD',
}: {
  moneda:  Moneda | null
  onClose: () => void
  onSaved: () => void
  onPedirEliminar: () => void
  /**
   * Moneda preseleccionada al CREAR. La página de Monedas se queda en USD —allí se
   * añade una segunda y el peso ya suele estar—; la guía de puesta en marcha pide
   * CUP, que es la primera moneda de un negocio cubano.
   */
  catalogoInicial?: string
}) {
  const catalogoArr = [...CATALOGO_MONEDAS]
  const [isPending, startTransition] = useTransition()
  const [catalogo,  setCatalogo]     = useState<string>(() => {
    if (!moneda) return catalogoArr.some(c => c.codigo === catalogoInicial) ? catalogoInicial : 'USD'
    const hit = catalogoArr.find(c => c.codigo === moneda.codigo)
    return hit ? hit.codigo : 'OTRA'
  })
  const inicial = catalogoArr.find(c => c.codigo === catalogoInicial) ?? catalogoArr[0]
  const [nombre,  setNombre]  = useState(moneda?.nombre  ?? inicial.nombre)
  const [simbolo, setSimbol]  = useState(moneda?.simbolo ?? inicial.simbolo)
  const [codigo,  setCodigo]  = useState(moneda?.codigo  ?? '')

  const esEdicion = !!moneda

  // Puntos de venta que aceptan esta moneda: si se desactiva, dejan de poder cobrar en
  // ella al sincronizar. Se consulta al abrir la edición (una query) para poder nombrar
  // cuáles en el aviso, en vez de que se entere el cajero en el mostrador.
  const [activa, setActiva]   = useState(moneda?.activa ?? true)
  const [puntos, setPuntos]   = useState<string[]>([])
  useEffect(() => {
    if (!moneda) return
    let vivo = true
    puntosVentaConMoneda(moneda.codigo).then(p => { if (vivo) setPuntos(p) })
    return () => { vivo = false }
  }, [moneda])

  function handleCatalogoChange(val: string) {
    setCatalogo(val)
    if (val !== 'OTRA') {
      const hit = catalogoArr.find(c => c.codigo === val)
      if (hit) { setNombre(hit.nombre); setSimbol(hit.simbolo); setCodigo('') }
    } else {
      setNombre(''); setSimbol(''); setCodigo('')
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const ld = toastLoading(esEdicion ? 'Guardando…' : 'Añadiendo…')
    startTransition(async () => {
      const result = await guardarMoneda(fd)
      await ld.dismiss()
      if (!result.ok) { toastError(result.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <ModalShell title={esEdicion ? 'Editar moneda' : 'Añadir moneda'} onClose={onClose} size="modal-520">
        <form onSubmit={handleSubmit}>
          <div className="modal-body modal-body-wide">
            {esEdicion && <input type="hidden" name="codigo_original" value={moneda.codigo} />}
            {esEdicion && <input type="hidden" name="codigo" value={moneda.codigo} />}

            <div className="mon-form-grid">

              {!esEdicion && (
                <div className="input-group mon-full">
                  <label>Moneda <span className="required">*</span></label>
                  <select
                    className="input"
                    name="catalogo"
                    value={catalogo}
                    onChange={e => handleCatalogoChange(e.target.value)}
                  >
                    {catalogoArr.map(m => (
                      <option key={m.codigo} value={m.codigo}>
                        {m.codigo} — {m.nombre}
                      </option>
                    ))}
                    <option value="OTRA">Otra (personalizada)</option>
                  </select>
                </div>
              )}

              {(!esEdicion && catalogo === 'OTRA') && (
                <div className="input-group mon-full">
                  <div className="form-label-with-help">
                    <label>Código <span className="required">*</span></label>
                    <FormHelp text="Identificador único, sin espacios. Ej: CUPB para tasa oficial bancaria." label="Qué es el código" />
                  </div>
                  <input
                    className="input input-uppercase"
                    name="codigo"
                    value={codigo}
                    onChange={e => setCodigo(e.target.value.toUpperCase())}
                    placeholder="Ej: CUPB"
                    maxLength={10}
                    required
                  />
                </div>
              )}

              <div className="input-group">
                <label>Nombre <span className="required">*</span></label>
                <input
                  className="input"
                  name="nombre"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Ej: Peso cubano bancario"
                  required
                />
              </div>

              <div className="input-group">
                <label>Símbolo</label>
                <input
                  className="input"
                  name="simbolo"
                  value={simbolo}
                  onChange={e => setSimbol(e.target.value)}
                  placeholder="Ej: $"
                  maxLength={5}
                />
              </div>

              {esEdicion && !moneda.es_consolidacion && (
                <div className="input-group mon-full">
                  <label>Estado</label>
                  <select className="input" name="activa" value={activa ? 'true' : 'false'}
                    onChange={e => setActiva(e.target.value === 'true')}>
                    <option value="true">Activa</option>
                    <option value="false">Inactiva</option>
                  </select>
                  {!activa && puntos.length > 0 && (
                    <div className="alert alert-warning mon-aviso-puntos">
                      <AlertTriangle size={16} strokeWidth={2} />
                      <span>
                        {puntos.length === 1
                          ? <>El punto de venta <strong>{puntos[0]}</strong> cobra en {moneda.codigo}.</>
                          : <>Estos puntos de venta cobran en {moneda.codigo}: <strong>{puntos.join(', ')}</strong>.</>}
                        {' '}Al sincronizar dejarán de ofrecerla, y si era la única no podrán cobrar.
                      </span>
                    </div>
                  )}
                </div>
              )}

            </div>

          </div>

          <div className="modal-footer">
            {esEdicion && !moneda.es_consolidacion && (
              <button type="button" className="btn btn-danger-text" onClick={onPedirEliminar} disabled={isPending}>
                <Trash2 size={14} strokeWidth={2} /> Eliminar
              </button>
            )}
            <div className="modal-footer-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={isPending}>
                {isPending
                  ? <><span className="spinner spinner-sm" />{esEdicion ? 'Guardando…' : 'Añadir'}</>
                  : esEdicion ? 'Guardar cambios' : 'Añadir moneda'}
              </button>
            </div>
          </div>
        </form>
    </ModalShell>
  )
}
