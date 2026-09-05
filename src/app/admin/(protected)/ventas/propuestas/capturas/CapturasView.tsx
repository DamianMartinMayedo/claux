'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toastError, toastLoading, toastSuccess, toastWarning } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import BulkBar from '@/components/portal/BulkBar'
import HeaderCheck from '@/components/portal/HeaderCheck'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { ConfirmDialog } from '@/components/portal/Dialog'
import VentasTabs from '@/components/admin/VentasTabs'
import PropuestasTabs from '@/components/admin/PropuestasTabs'
import { DIAS_CADUCA_CAPTURA } from '@/lib/propuesta/secciones'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import {
  activarCapturas, eliminarCaptura, eliminarCapturas, guardarCaptura, moverCaptura,
  reemplazarCaptura, subirCaptura,
  type CapturaRow,
} from '@/app/actions/capturas'


type Modulo  = { clave: string; nombre: string }
type Sector  = { sector: string; nombre: string }

function diasDesde(fecha: string): number {
  const d = new Date(`${fecha}T00:00:00Z`).getTime()
  if (Number.isNaN(d)) return 0
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000))
}

/** «hace 3 días» / «hace 4 meses»: la edad se lee mejor que la fecha. */
function edad(dias: number): string {
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 60) return `hace ${dias} días`
  return `hace ${Math.round(dias / 30)} meses`
}

/**
 * La biblioteca, en tabla.
 *
 * Era una rejilla de fichas grandes agrupada por módulo: con veinte capturas
 * había que bajar cuatro pantallas para saber qué hay, y cada operación iba de
 * una en una por el menú de su ficha. En tabla se barre entera de un vistazo y
 * —lo que faltaba— admite acciones en lote como el resto de la plataforma:
 * retirar, devolver y eliminar varias a la vez.
 *
 * La miniatura no se queda en decoración: se pulsa y se ve la captura entera.
 * Es una biblioteca de imágenes, y lo que se juzga aquí es si la pantalla sigue
 * valiendo; con una miniatura de 90 px eso no se decide.
 */
export default function CapturasView({
  capturas, modulos, sectores, rol, permisos,
}: {
  capturas: CapturaRow[]
  modulos:  Modulo[]
  sectores: Sector[]
  rol: RolAdmin
  permisos: SeccionKey[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [subiendo, setSubiendo] = useState(false)
  const [editando, setEditando] = useState<CapturaRow | null>(null)
  const [mirando, setMirando] = useState<CapturaRow | null>(null)
  const [porBorrar, setPorBorrar] = useState<CapturaRow | null>(null)
  const [borrarLote, setBorrarLote] = useState(false)
  // Un input suelto y escondido: reemplazar la imagen es un clic en el menú de
  // la fila, no un formulario aparte.
  const reemplazoRef = useRef<HTMLInputElement>(null)
  const [porReemplazar, setPorReemplazar] = useState<CapturaRow | null>(null)

  const nombreSector = useMemo(
    () => new Map(sectores.map(s => [s.sector, s.nombre])),
    [sectores],
  )

  // Subir y bajar mueven la captura DENTRO de su módulo, así que los botones se
  // apagan en el borde de su módulo, no en el de la tabla.
  const bordes = useMemo(() => {
    const primera = new Set<number>()
    const ultima  = new Set<number>()
    const vistos  = new Map<string, number>()
    for (const c of capturas) {
      if (!vistos.has(c.modulo)) primera.add(c.id)
      vistos.set(c.modulo, c.id)
    }
    for (const id of vistos.values()) ultima.add(id)
    return { primera, ultima }
  }, [capturas])

  const sel = useRowSelection(useMemo(() => capturas.map(c => String(c.id)), [capturas]))
  const marcadas   = capturas.filter(c => sel.isSelected(String(c.id)))
  const nEnUso     = marcadas.filter(c => c.activa).length
  const nRetiradas = marcadas.length - nEnUso

  const viejas = capturas.filter(c => c.activa && diasDesde(c.capturada_at) > DIAS_CADUCA_CAPTURA).length

  /** El final de toda acción: aviso, refresco y el «ya lo enseña» si lo hay. */
  function tras(
    r: { ok: boolean; error?: string; aviso?: string }, exito: string,
  ) {
    if (!r.ok) { toastError(r.error ?? 'No se pudo guardar'); return false }
    if (r.aviso) toastWarning(`${exito} — ${r.aviso}`)
    else toastSuccess(exito)
    router.refresh()
    return true
  }

  function guardar(id: number, campos: Parameters<typeof guardarCaptura>[1], exito: string) {
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const r = await guardarCaptura(id, campos)
      await ld.dismiss()
      tras(r, exito)
    })
  }

  function borrar() {
    if (!porBorrar) return
    const c = porBorrar
    setPorBorrar(null)
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await eliminarCaptura(c.id)
      await ld.dismiss()
      tras(r, `Captura «${c.vista}» eliminada`)
    })
  }

  function activarLote(activa: boolean) {
    // Solo las que cambian de verdad: marcar seis y retirar las dos que estaban
    // en uso no puede contar seis, ni tocar las otras cuatro.
    const ids = marcadas.filter(c => c.activa !== activa).map(c => c.id)
    if (ids.length === 0) return
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const r = await activarCapturas(ids, activa)
      await ld.dismiss()
      if (tras(r, activa
        ? `${r.hechas} captura${r.hechas === 1 ? '' : 's'} de vuelta en las propuestas`
        : `${r.hechas} captura${r.hechas === 1 ? '' : 's'} retirada${r.hechas === 1 ? '' : 's'}`,
      )) sel.clear()
    })
  }

  function borrarLoteAhora() {
    const ids = marcadas.map(c => c.id)
    setBorrarLote(false)
    if (ids.length === 0) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await eliminarCapturas(ids)
      await ld.dismiss()
      if (tras(r, `${r.hechas} captura${r.hechas === 1 ? '' : 's'} eliminada${r.hechas === 1 ? '' : 's'}`)) sel.clear()
    })
  }

  function mover(c: CapturaRow, dir: 'arriba' | 'abajo') {
    startTransition(async () => {
      const r = await moverCaptura(c.id, dir)
      if (!r.ok) { toastError(r.error ?? 'No se pudo mover'); return }
      router.refresh()
    })
  }

  function pedirReemplazo(c: CapturaRow) {
    setPorReemplazar(c)
    reemplazoRef.current?.click()
  }

  function reemplazar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const c = porReemplazar
    e.target.value = ''
    setPorReemplazar(null)
    if (!file || !c) return
    const fd = new FormData()
    fd.set('id', String(c.id))
    fd.set('imagen', file)
    const ld = toastLoading('Optimizando…')
    startTransition(async () => {
      const r = await reemplazarCaptura(fd)
      await ld.dismiss()
      tras(r, `Imagen de «${c.vista}» reemplazada`)
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Capturas de producto</h1>
          <p className="page-subtitle">
            {capturas.length} en la biblioteca
            {viejas > 0 && ` · ${viejas} por revisar`}.
            Se suben una vez y las usan todas las propuestas. Siempre del negocio de
            demostración, nunca de un cliente.
          </p>
        </div>
        <button className="btn btn-primary" disabled={pending} onClick={() => setSubiendo(true)}>
          <Plus size={16} strokeWidth={2} /> Subir captura
        </button>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />
      <PropuestasTabs rol={rol} permisos={permisos} />

      {viejas > 0 && (
        <div className="alert alert-warning">
          {viejas === 1 ? 'Una captura pasa' : `${viejas} capturas pasan`} de {DIAS_CADUCA_CAPTURA} días.
          La interfaz cambia cada semana: enseñar una pantalla que ya no existe es peor
          que no enseñar ninguna.
        </div>
      )}

      {capturas.length === 0 ? (
        <div className="card">
          <p className="text-sm-muted">
            No hay ninguna captura todavía. Sin ellas, la propuesta se salta las
            diapositivas de producto: no se pinta un hueco.
          </p>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            {/* Sin columnas ordenables a propósito: el orden ES el de la
                presentación y lo fija el dueño con subir/bajar. Una flecha en la
                cabecera lo tiraría sin decir que lo estaba tirando. */}
            <table className="table">
              <thead>
                <tr>
                  <th className="col-check">
                    <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                  </th>
                  <th className="cap-col-img">Imagen</th>
                  <th>Pantalla</th>
                  <th>Módulo</th>
                  <th>Sectores</th>
                  <th>Actualizada</th>
                  <th className="col-center">Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {capturas.map(c => {
                  const dias = diasDesde(c.capturada_at)
                  return (
                    <tr key={c.id} className={c.activa ? undefined : 'cap-fila-retirada'}>
                      <td className="col-check">
                        <input type="checkbox" className="row-check"
                          checked={sel.isSelected(String(c.id))}
                          onChange={() => sel.toggle(String(c.id))}
                          aria-label={`Seleccionar «${c.vista}»`} />
                      </td>
                      <td data-label="Imagen" className="cap-col-img">
                        <button type="button" className="cap-thumb" onClick={() => setMirando(c)}>
                          {/* Sin `next/image`: la ruta pública de la propuesta va
                              aislada y estas son las mismas URL que se pintan allí. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.url} alt={c.alt} loading="lazy" />
                        </button>
                      </td>
                      <td data-label="Pantalla">
                        <span className="text-sm-bold cap-vista">{c.vista}</span>
                        <span className="cap-alt cell-clamp" title={c.alt}>{c.alt}</span>
                      </td>
                      <td data-label="Módulo">{c.modulo_nombre}</td>
                      <td data-label="Sectores">
                        {c.sector.length === 0
                          ? <span className="text-xs-muted">Todos</span>
                          : (
                            <span className="cap-sectores">
                              {c.sector.map(x => (
                                <span key={x} className="badge badge-purple">{nombreSector.get(x) ?? x}</span>
                              ))}
                            </span>
                          )}
                      </td>
                      <td data-label="Actualizada">
                        {dias > DIAS_CADUCA_CAPTURA
                          ? <span className="badge badge-warning">{edad(dias)}</span>
                          : <span className="text-xs-muted">{edad(dias)}</span>}
                      </td>
                      <td data-label="Estado" className="col-center">
                        {c.activa
                          ? <span className="badge badge-dot badge-success">En uso</span>
                          : <span className="badge badge-neutral">Retirada</span>}
                      </td>
                      <td className="col-actions">
                        <RowActions>
                          <button className="row-actions-item" onClick={() => setEditando(c)}>
                            <Pencil size={15} strokeWidth={2} /> Editar
                          </button>
                          <button className="row-actions-item" onClick={() => pedirReemplazo(c)}>
                            <RefreshCw size={15} strokeWidth={2} /> Reemplazar imagen
                          </button>
                          <button
                            className="row-actions-item" disabled={pending || bordes.primera.has(c.id)}
                            onClick={() => mover(c, 'arriba')}
                          >
                            <ArrowUp size={15} strokeWidth={2} /> Subir
                          </button>
                          <button
                            className="row-actions-item" disabled={pending || bordes.ultima.has(c.id)}
                            onClick={() => mover(c, 'abajo')}
                          >
                            <ArrowDown size={15} strokeWidth={2} /> Bajar
                          </button>
                          <button
                            className="row-actions-item" disabled={pending}
                            onClick={() => guardar(
                              c.id, { activa: !c.activa },
                              c.activa ? `«${c.vista}» retirada de las propuestas` : `«${c.vista}» vuelve a las propuestas`,
                            )}
                          >
                            {c.activa
                              ? <><EyeOff size={15} strokeWidth={2} /> Retirar</>
                              : <><Eye size={15} strokeWidth={2} /> Volver a usar</>}
                          </button>
                          <button
                            className="row-actions-item row-actions-item-danger"
                            disabled={pending} onClick={() => setPorBorrar(c)}
                          >
                            <Trash2 size={15} strokeWidth={2} /> Eliminar
                          </button>
                        </RowActions>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Solo las acciones que pueden hacer algo con lo marcado: con seis
          retiradas seleccionadas, «Retirar» no pinta nada. */}
      <BulkBar count={sel.count} onClear={sel.clear}>
        {nEnUso > 0 && (
          <button className="btn btn-secondary btn-sm" disabled={pending} onClick={() => activarLote(false)}>
            <EyeOff size={14} strokeWidth={2} /> Retirar{nRetiradas > 0 ? ` (${nEnUso})` : ''}
          </button>
        )}
        {nRetiradas > 0 && (
          <button className="btn btn-secondary btn-sm" disabled={pending} onClick={() => activarLote(true)}>
            <Eye size={14} strokeWidth={2} /> Volver a usar{nEnUso > 0 ? ` (${nRetiradas})` : ''}
          </button>
        )}
        <button className="btn btn-danger btn-sm" disabled={pending} onClick={() => setBorrarLote(true)}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      </BulkBar>

      <input
        ref={reemplazoRef} type="file" accept="image/*"
        className="img-upload-input" onChange={reemplazar}
        aria-label="Elegir la imagen de reemplazo"
      />

      {mirando && (
        /* El fondo SÍ cierra: aquí no hay nada escrito que perder. */
        <div className="modal-backdrop open" onClick={() => setMirando(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{mirando.modulo_nombre} · {mirando.vista}</h2>
            </div>
            <div className="modal-body">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="cap-previo" src={mirando.url} alt={mirando.alt} />
              <p className="text-xs-muted">{mirando.alt}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setMirando(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {subiendo && (
        <ModalCaptura
          modulos={modulos} sectores={sectores} capturas={capturas}
          onCancel={() => setSubiendo(false)}
          onSubmit={(fd, cerrar) => {
            const ld = toastLoading('Optimizando…')
            startTransition(async () => {
              const r = await subirCaptura(fd)
              await ld.dismiss()
              if (tras(r, 'Captura subida')) cerrar()
            })
          }}
          pending={pending}
        />
      )}

      {editando && (
        <ModalEditar
          captura={editando} sectores={sectores}
          onCancel={() => setEditando(null)}
          onSubmit={(campos) => {
            guardar(editando.id, campos, 'Captura guardada')
            setEditando(null)
          }}
          pending={pending}
        />
      )}

      {porBorrar && (
        <ConfirmDialog
          danger
          title="Eliminar la captura"
          body={`Se elimina «${porBorrar.vista}» de la biblioteca y desaparece de las propuestas que la enseñan. No se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={borrar}
          onCancel={() => setPorBorrar(null)}
        />
      )}

      {borrarLote && (
        <ConfirmDialog
          danger
          title={`Eliminar ${marcadas.length} captura${marcadas.length === 1 ? '' : 's'}`}
          body="Desaparecen de la biblioteca y de las propuestas que las enseñan. No se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={borrarLoteAhora}
          onCancel={() => setBorrarLote(false)}
        />
      )}
    </div>
  )
}

/** Los sectores, como casillas. Vacío = la captura vale para cualquier negocio. */
function Sectores({ sectores, marcados, onToggle }: {
  sectores: Sector[]; marcados: string[]; onToggle: (s: string) => void
}) {
  return (
    <div className="input-group">
      <label>Solo para estos sectores</label>
      <p className="text-xs-muted">
        Sin marcar ninguno, la captura vale para cualquier negocio. Marca uno solo
        cuando la pantalla cambie de verdad con el giro.
      </p>
      <div className="cap-sector-lista">
        {sectores.map(s => (
          <label key={s.sector} className="cap-sector-check">
            <input
              type="checkbox" checked={marcados.includes(s.sector)}
              onChange={() => onToggle(s.sector)}
            />
            {s.nombre}
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * Subir una captura. Lo que aquí se pide no es un formulario cualquiera: el
 * NOMBRE DE LA PANTALLA es lo que empareja las variantes por sector (misma
 * pantalla, dos imágenes), así que teclearlo a mano —como estaba— significaba
 * que una errata creaba una pantalla nueva en silencio y la variante no
 * emparejaba con nada. Por eso se elige de las que ya hay, y escribir uno nuevo
 * es un paso aparte y consciente.
 */
function ModalCaptura({ modulos, sectores, capturas, onCancel, onSubmit, pending }: {
  modulos: Modulo[]; sectores: Sector[]; capturas: CapturaRow[]
  onCancel: () => void
  onSubmit: (fd: FormData, cerrar: () => void) => void
  pending: boolean
}) {
  const [modulo, setModulo] = useState(modulos[0]?.clave ?? '')
  const [vista, setVista] = useState('')
  const [otra, setOtra] = useState(false)
  const [alt, setAlt] = useState('')
  const [altTocado, setAltTocado] = useState(false)
  const [sector, setSector] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [previo, setPrevio] = useState<string | null>(null)

  // La vista previa es un objeto del navegador: hay que soltarlo o se queda en
  // memoria por cada imagen que se pruebe.
  useEffect(() => () => { if (previo) URL.revokeObjectURL(previo) }, [previo])

  const nombreModulo = modulos.find(m => m.clave === modulo)?.nombre ?? modulo
  const vistas = useMemo(
    () => [...new Set(capturas.filter(c => c.modulo === modulo).map(c => c.vista))],
    [capturas, modulo],
  )

  function cambiarModulo(clave: string) {
    setModulo(clave)
    setVista('')
    setOtra(false)
  }
  function elegirImagen(f: File | null) {
    setFile(f)
    setPrevio(f ? URL.createObjectURL(f) : null)
  }

  // El alt se propone del módulo y la pantalla, y se puede reescribir. No se
  // autogenera en el servidor a propósito: es lo único que se lee cuando la
  // imagen no carga. Pero llegar a un campo obligatorio en blanco, con el botón
  // apagado y sin decir por qué, es lo que había antes.
  const altSugerido = vista.trim() ? `${nombreModulo}: ${vista.trim()}` : ''
  const altFinal = (altTocado ? alt : altSugerido).trim()

  const falta = [
    !vista.trim() && 'la pantalla',
    !altFinal && 'el texto alternativo',
    !file && 'la imagen',
  ].filter((x): x is string => typeof x === 'string')

  function enviar() {
    if (!modulo || falta.length > 0) return
    const fd = new FormData()
    fd.set('modulo', modulo)
    fd.set('vista', vista.trim())
    fd.set('alt', altFinal)
    fd.set('sector', sector.join(','))
    fd.set('imagen', file!)
    onSubmit(fd, onCancel)
  }

  return (
    /* El fondo NO cierra: aquí hay un formulario a medio escribir y una imagen
       elegida, y un clic de más lo tiraba todo sin preguntar. */
    <div className="modal-backdrop open">
      <div className="modal modal-lg">
        <div className="modal-header"><h2 className="modal-title">Subir captura</h2></div>
        <div className="modal-body">
          <div className="input-group">
            <label htmlFor="cap-modulo">Módulo</label>
            <select
              id="cap-modulo" className="input" value={modulo}
              onChange={e => cambiarModulo(e.target.value)}
            >
              {modulos.map(m => <option key={m.clave} value={m.clave}>{m.nombre}</option>)}
            </select>
          </div>

          <div className="input-group">
            <label htmlFor="cap-vista">Pantalla<span className="required">*</span></label>
            {vistas.length > 0 && !otra ? (
              <>
                <select
                  id="cap-vista" className="input" value={vista}
                  onChange={e => {
                    if (e.target.value === '__otra') { setOtra(true); setVista('') } else setVista(e.target.value)
                  }}
                >
                  <option value="">Elige la pantalla</option>
                  {vistas.map(v => <option key={v} value={v}>{v}</option>)}
                  <option value="__otra">Otra pantalla…</option>
                </select>
                <p className="text-xs-muted">
                  Elegir una que ya está crea la variante de otro sector de esa misma pantalla.
                </p>
              </>
            ) : (
              <>
                <input
                  id="cap-vista" className="input" value={vista} placeholder="Reportes financieros"
                  onChange={e => setVista(e.target.value)}
                />
                <p className="text-xs-muted">
                  {vistas.length > 0
                    ? 'Nombre nuevo: será una pantalla más de este módulo.'
                    : `${nombreModulo} no tiene ninguna captura todavía.`}
                </p>
                {vistas.length > 0 && (
                  <button
                    className="btn btn-secondary btn-sm cap-otra"
                    onClick={() => { setOtra(false); setVista('') }}
                  >
                    Elegir una de las que hay
                  </button>
                )}
              </>
            )}
          </div>

          <div className="input-group">
            <label htmlFor="cap-alt">Texto alternativo<span className="required">*</span></label>
            <input
              id="cap-alt" className="input" value={altTocado ? alt : altSugerido}
              placeholder="Estado de resultados con el margen del mes"
              onChange={e => { setAltTocado(true); setAlt(e.target.value) }}
            />
            <p className="text-xs-muted">
              Es lo que se lee si la imagen no carga, que en una conexión lenta pasa.
              Se propone del módulo y la pantalla; mejor si dice qué se ve.
            </p>
          </div>

          <Sectores
            sectores={sectores} marcados={sector}
            onToggle={s => setSector(v => v.includes(s) ? v.filter(x => x !== s) : [...v, s])}
          />

          <div className="input-group">
            <label htmlFor="cap-file">Imagen<span className="required">*</span></label>
            <input
              id="cap-file" type="file" accept="image/*" className="input input-file"
              onChange={e => elegirImagen(e.target.files?.[0] ?? null)}
            />
            {previo && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="cap-previo" src={previo} alt="La captura elegida" />
            )}
            <p className="text-xs-muted">
              Se recodifica a WebP de 1200 px y por debajo de 180 KB. Si no baja de ahí,
              se rechaza: quien la abre suele estar con datos móviles y son ocho seguidas.
            </p>
          </div>
        </div>
        <div className="modal-footer">
          {falta.length > 0 && <p className="cap-falta">Falta {falta.join(', ')}.</p>}
          <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
          <button
            className="btn btn-primary" disabled={pending || !modulo || falta.length > 0}
            onClick={enviar}
          >
            Subir
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalEditar({ captura, sectores, onCancel, onSubmit, pending }: {
  captura: CapturaRow; sectores: Sector[]
  onCancel: () => void
  onSubmit: (campos: { vista: string; alt: string; sector: string[] }) => void
  pending: boolean
}) {
  const [vista, setVista] = useState(captura.vista)
  const [alt, setAlt] = useState(captura.alt)
  const [sector, setSector] = useState<string[]>(captura.sector)

  return (
    /* Igual que al subir: el fondo no tira lo escrito. */
    <div className="modal-backdrop open">
      <div className="modal">
        <div className="modal-header"><h2 className="modal-title">Editar la captura</h2></div>
        <div className="modal-body">
          <div className="input-group">
            <label htmlFor="cape-vista">Pantalla</label>
            <input
              id="cape-vista" className="input" value={vista}
              onChange={e => setVista(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label htmlFor="cape-alt">Texto alternativo</label>
            <input
              id="cape-alt" className="input" value={alt}
              onChange={e => setAlt(e.target.value)}
            />
          </div>
          <Sectores
            sectores={sectores} marcados={sector}
            onToggle={s => setSector(v => v.includes(s) ? v.filter(x => x !== s) : [...v, s])}
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
          <button
            className="btn btn-primary"
            disabled={pending || !vista.trim() || !alt.trim()}
            onClick={() => onSubmit({ vista: vista.trim(), alt: alt.trim(), sector })}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
