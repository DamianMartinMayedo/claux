'use client'

// ── El asistente de adopción del catálogo (F1.4) ─────────────────────────────
//
// Para el cliente que YA tiene su árbol hecho a mano. La semilla sola no le sirve:
// empareja por nombre exacto, y «Comisión bancaria» no es «Comisiones bancarias»
// para un índice único. Sin esta pantalla, a ese cliente le duplicamos media
// lista el día que Tesorería escriba su primera comisión por clave.
//
// Un paso por decisión, y en cada uno la misma regla: **nada se mueve sin marcar**.
// Ante la duda gana la del cliente — duplicar es visible y se arregla en un toque;
// fundir mal es invisible y permanente.
//
// El paso que más riesgo tiene es «mover hijas»: mover una subcategoría a otra
// raíz ES un cambio de renglón del informe disfrazado de reordenación del árbol,
// porque la hija hereda el papel de su madre. Por eso van en DOS pasarelas —las
// que conservan el papel y las que lo cambian—, sin «marcar todas» en las
// segundas, y con UNA sola previsualización agregada al final: dieciséis avisos
// seguidos no los lee nadie.

import { useState, useEffect } from 'react'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import {
  ensayarSemilla, sembrarPack, analizarAdopcion, aplicarAdopcion, previsualizarImpacto,
  preguntasDeSemilla, guardarRespuestaServicios, guardarLlevaContador,
  marcarDepreciacionComoCoste,
  type ResumenSemilla, type AnalisisAdopcion, type OpAdopcion, type ImpactoPrevio,
  type PropuestaHija,
} from '@/app/actions/portal/clasificador'
import type { OperacionEstructural } from '@/lib/pl/impacto'
import { ROL_PL_LABEL, esRolPL } from '@/lib/pl/estado'
import { X, Check, AlertTriangle } from 'lucide-react'

type Paso = 'semilla' | 'fusiones' | 'raices' | 'conserva' | 'cruza' | 'depreciacion' | 'revision' | 'hecho'

/** Lo que devuelve la acción, derivado de ella: dos verdades del mismo tipo, no. */
type PreguntasSemilla = Awaited<ReturnType<typeof preguntasDeSemilla>>

const ORDEN: Paso[] = ['semilla', 'fusiones', 'raices', 'conserva', 'cruza', 'depreciacion', 'revision']
const TITULO: Record<Paso, string> = {
  semilla:      'Cargar el catálogo',
  fusiones:     'Categorías repetidas',
  raices:       'Emparejar tus categorías',
  conserva:     'Colocar subcategorías',
  cruza:        'Subcategorías que cambian de renglón',
  depreciacion: 'Depreciación',
  revision:     'Lo que va a cambiar en tu informe',
  hecho:        'Listo',
}

function rolLabel(rol: string): string {
  return esRolPL(rol) ? ROL_PL_LABEL[rol] : rol
}

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

export default function AsistenteCatalogo({ onClose, onCambios }: {
  onClose:   () => void
  /** Se llama cuando algo se ha escrito de verdad: la vista tiene que recargarse. */
  onCambios: () => void
}) {
  const [paso, setPaso]         = useState<Paso>('semilla')
  const [cargando, setCargando] = useState(false)

  const [ensayo,   setEnsayo]   = useState<ResumenSemilla | null>(null)
  const [analisis, setAnalisis] = useState<AnalisisAdopcion | null>(null)
  const [impacto,  setImpacto]  = useState<ImpactoPrevio | null>(null)
  const [resumenFinal, setResumenFinal] = useState<string | null>(null)

  // Lo marcado. Un mapa por tipo de decisión: el destino de una hija es un id, el
  // ancla de una raíz es una clave, y una fusión es sí o no.
  const [fusionesOk, setFusionesOk] = useState<Set<string>>(new Set())
  const [anclas,     setAnclas]     = useState<Map<string, string>>(new Map())
  const [destinos,   setDestinos]   = useState<Map<string, string>>(new Map())
  // Los apuntes de depreciación nacen SIN marcar y sin excepción. Son gastos ya
  // registrados por el dueño, no propuestas nuestras: aquí lo que se ofrece es
  // quitarles una deuda que no existe, y esa decisión es suya.
  const [depOk, setDepOk] = useState<Set<string>>(new Set())

  // ── Arranque: las preguntas previas y el ensayo de la semilla ──
  // El ensayo previo es obligatorio: una semilla no se deshace sola, y enseñar
  // antes lo que va a pasar es la única marcha atrás que hay.
  //
  // Las dos preguntas van ANTES del ensayo en la pantalla porque las dos cambian
  // lo que se va a crear: el sector `servicios` es la ruta de 4 de 6 clientes
  // reales y decide entre dos packs, y el contador enciende el complemento C1.
  // Contestarlas después de sembrar no sirve de nada.
  const [preguntas, setPreguntas] = useState<PreguntasSemilla | null>(null)

  const correrEnsayo = () =>
    ensayarSemilla().then(r => {
      setEnsayo(r)
      if (!r.ok) toastError(r.error ?? 'No se pudo preparar el catálogo.')
    })

  useEffect(() => {
    let vivo = true
    setCargando(true)
    Promise.all([
      preguntasDeSemilla().then(p => { if (vivo) setPreguntas(p) }),
      ensayarSemilla().then(r => {
        if (!vivo) return
        setEnsayo(r)
        if (!r.ok) toastError(r.error ?? 'No se pudo preparar el catálogo.')
      }),
    ]).finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [])

  // Cambiar una respuesta reescribe el ensayo: enseñar «se crearán 24» y sembrar
  // otras 34 porque entre medias dijo que sí tiene contador es exactamente lo que
  // el ensayo previo existe para que no pase.
  const responder = (guardar: Promise<{ ok: boolean; error?: string }>, aplicar: () => void) => {
    setCargando(true)
    guardar
      .then(r => {
        if (!r.ok) { toastError(r.error ?? 'No se pudo guardar tu respuesta.'); return }
        aplicar()
        return correrEnsayo()
      })
      .finally(() => setCargando(false))
  }

  const cargarAnalisis = (): Promise<AnalisisAdopcion | null> => {
    setCargando(true)
    return analizarAdopcion()
      .then(a => {
        setAnalisis(a)
        if (!a.ok) { toastError(a.error ?? 'No se pudo leer tu catálogo.'); return null }
        // Pre-marcado: lo idéntico y que conserva el papel nace marcado; lo demás,
        // visible y sin marcar. Una sugerencia plausible pre-marcada se acepta sin
        // mirar, y eso es exactamente lo que no puede pasar aquí.
        setAnclas(new Map((a.raices ?? []).filter(r => r.marcada)
          .map(r => [r.categoria_id, r.candidatas[0].clave])))
        setDestinos(new Map((a.hijas ?? []).filter(h => h.marcada)
          .map(h => [h.categoria_id, h.propuesto])))
        setFusionesOk(new Set((a.fusiones ?? []).filter(f => !f.cambiaRol)
          .map(f => f.absorbe.categoria_id)))
        setDepOk(new Set())
        return a
      })
      .finally(() => setCargando(false))
  }

  const sembrar = () => {
    const cargando = toastLoading('Cargando tu catálogo…')
    setCargando(true)
    sembrarPack().then(r => {
      cargando.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo cargar el catálogo.'); setCargando(false); return }
      toastSuccess(`Catálogo cargado — ${plural(r.creadas?.length ?? 0, 'categoría nueva', 'categorías nuevas')}`)
      onCambios()
      cargarAnalisis().then(a => avanzar('semilla', a))
    })
  }

  // ── Navegación: los pasos sin nada que decidir no se enseñan ──
  const hayEnPaso = (p: Paso, a: AnalisisAdopcion | null): boolean => {
    if (!a) return false
    if (p === 'fusiones') return (a.fusiones ?? []).length > 0
    if (p === 'raices')   return (a.raices ?? []).length > 0
    if (p === 'conserva') return (a.hijas ?? []).some(h => h.conservaRol)
    if (p === 'cruza')    return (a.hijas ?? []).some(h => !h.conservaRol)
    // Los apartados por un pago DE VERDAD también abren el paso, aunque no haya
    // nada que marcar: un pago a alguien por la depreciación es una anomalía que
    // el dueño tiene que ver. Los que saldó la migración, no: ahí no hay nada que
    // hacer y el paso sería una pantalla que solo se puede cerrar.
    if (p === 'depreciacion') {
      return (a.depreciacion ?? []).length > 0 || (a.depreciacionConPagos ?? 0) > 0
    }
    return true
  }

  const avanzar = (desde: Paso, a: AnalisisAdopcion | null = analisis) => {
    const i = ORDEN.indexOf(desde)
    for (let j = i + 1; j < ORDEN.length; j++) {
      if (ORDEN[j] === 'revision') { irARevision(a); return }
      if (hayEnPaso(ORDEN[j], a)) { setPaso(ORDEN[j]); return }
    }
    irARevision(a)
  }

  // ── Operaciones marcadas, en el orden en que tienen que aplicarse ──
  const opsMarcadas = (a: AnalisisAdopcion | null): OpAdopcion[] => {
    if (!a) return []
    const ops: OpAdopcion[] = []
    // Fundir primero: si una hija va a moverse a la categoría que sobrevive, el
    // destino tiene que existir ya cuando le toque el turno.
    for (const f of a.fusiones ?? []) {
      if (fusionesOk.has(f.absorbe.categoria_id)) {
        ops.push({ tipo: 'fundir', id: f.absorbe.categoria_id, en: f.queda.categoria_id })
      }
    }
    for (const [id, clave] of anclas) ops.push({ tipo: 'anclar', id, clave })
    for (const [id, padre] of destinos) if (padre) ops.push({ tipo: 'mover', id, padre })
    return ops
  }

  /**
   * Las mismas decisiones, traducidas a lo que el motor del informe entiende.
   *
   * Fundir dos raíces con papeles distintos NO es un `parent_id`: los apuntes de
   * la absorbida pasan a contarse con el papel de la que queda, que es exactamente
   * lo que hace un cambio de rol. Anclar no aparece porque no mueve ni un importe.
   */
  const opsImpacto = (a: AnalisisAdopcion | null): OperacionEstructural[] => {
    if (!a) return []
    const ops: OperacionEstructural[] = []
    for (const f of a.fusiones ?? []) {
      if (fusionesOk.has(f.absorbe.categoria_id) && f.cambiaRol && esRolPL(f.rolQueda)) {
        ops.push({ tipo: 'rol', categoria_id: f.absorbe.categoria_id, rol: f.rolQueda })
      }
    }
    for (const [id, padre] of destinos) {
      if (padre) ops.push({ tipo: 'mover', categoria_id: id, parent_id: padre })
    }
    return ops
  }

  const irARevision = (a: AnalisisAdopcion | null = analisis) => {
    setPaso('revision')
    const ops = opsImpacto(a)
    if (!ops.length) { setImpacto(null); return }
    setCargando(true)
    previsualizarImpacto(ops)
      .then(setImpacto)
      .finally(() => setCargando(false))
  }

  // El árbol primero y los apuntes después, y en ese orden por una razón: mover
  // una hija puede cambiar la raíz de un gasto de depreciación, así que la lista
  // que el servidor vuelve a validar tiene que ser la de después de mover.
  const aplicar = async () => {
    const ops = opsMarcadas(analisis)
    if (!ops.length && !depOk.size) { onClose(); return }
    const aplicando = toastLoading('Aplicando los cambios…')
    setCargando(true)
    try {
      const partes: string[] = []

      if (ops.length) {
        const r = await aplicarAdopcion(ops, false)
        if (!r.ok) { toastError(r.error ?? 'No se pudieron aplicar los cambios.'); return }
        const hechas   = r.hechas?.length   ?? 0
        const omitidas = r.omitidas?.length ?? 0
        partes.push(plural(hechas, 'cambio aplicado', 'cambios aplicados')
          + (omitidas ? ` · ${plural(omitidas, 'no se pudo aplicar', 'no se pudieron aplicar')}` : ''))
      }

      if (depOk.size) {
        const d = await marcarDepreciacionComoCoste([...depOk])
        if (!d.ok) toastError(d.error ?? 'No se pudo reclasificar la depreciación.')
        else partes.push(`${plural(d.hechos ?? 0, 'apunte de depreciación ya no genera deuda', 'apuntes de depreciación ya no generan deuda')}`)
      }

      if (!partes.length) return
      setResumenFinal(partes.join(' · '))
      toastSuccess(partes[0])
      onCambios()
      setPaso('hecho')
    } finally {
      aplicando.dismiss()
      setCargando(false)
    }
  }

  const hijasConserva = (analisis?.hijas ?? []).filter(h => h.conservaRol)
  const hijasCruzan   = (analisis?.hijas ?? []).filter(h => !h.conservaRol)
  const totalMarcado  = opsMarcadas(analisis).length + depOk.size

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-xl modal-fixed-actions" role="dialog" aria-modal
           aria-labelledby="ado-titulo">
        <div className="modal-header">
          <h2 className="modal-title" id="ado-titulo">{TITULO[paso]}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar el asistente">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="modal-body modal-body-wide">
          <div className="ado-pasos" aria-hidden="true">
            {ORDEN.filter(p => p === 'semilla' || p === 'revision' || hayEnPaso(p, analisis)).map(p => (
              <span key={p} className="ado-pasos-item" data-activo={p === paso ? 'si' : 'no'}>
                {TITULO[p]}
              </span>
            ))}
          </div>

          <div className="ado-paso">
            {paso === 'semilla'  && (
              <PasoSemilla
                ensayo={ensayo} cargando={cargando} preguntas={preguntas}
                onServicios={v => responder(
                  guardarRespuestaServicios(v),
                  () => setPreguntas(p => p && ({ ...p, servicios: { ...p.servicios, respuesta: v } })),
                )}
                onContador={v => responder(
                  guardarLlevaContador(v),
                  () => setPreguntas(p => p && ({ ...p, contador: { ...p.contador, respuesta: v } })),
                )}
              />
            )}
            {paso === 'fusiones' && (
              <PasoFusiones a={analisis!} marcadas={fusionesOk} setMarcadas={setFusionesOk} />
            )}
            {paso === 'raices' && (
              <PasoRaices a={analisis!} anclas={anclas} setAnclas={setAnclas} />
            )}
            {paso === 'conserva' && (
              <PasoHijas hijas={hijasConserva} a={analisis!} destinos={destinos}
                setDestinos={setDestinos} permiteTodas />
            )}
            {paso === 'cruza' && (
              <PasoHijas hijas={hijasCruzan} a={analisis!} destinos={destinos}
                setDestinos={setDestinos} permiteTodas={false} />
            )}
            {paso === 'depreciacion' && (
              <PasoDepreciacion a={analisis!} marcados={depOk} setMarcados={setDepOk} />
            )}
            {paso === 'revision' && (
              <PasoRevision impacto={impacto} cargando={cargando} total={totalMarcado}
                depreciacion={depOk.size} />
            )}
            {paso === 'hecho' && (
              <p className="ado-intro">{resumenFinal}. Tu catálogo ya está al día.</p>
            )}
          </div>
        </div>

        <div className="modal-footer">
          {paso === 'hecho' ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>Cerrar</button>
          ) : paso === 'semilla' ? (<>
            <button type="button" className="btn btn-secondary" onClick={() => cargarAnalisis().then(a => avanzar('semilla', a))}
              disabled={cargando}>
              Ya tengo mis categorías, saltar
            </button>
            <button type="button" className="btn btn-primary" onClick={sembrar}
              disabled={cargando || !ensayo?.ok || !(ensayo.creadas?.length)}>
              {cargando ? <><span className="spinner spinner-sm" /> Cargando…</> : 'Cargar el catálogo'}
            </button>
          </>) : paso === 'revision' ? (
            <button type="button" className="btn btn-primary" onClick={aplicar} disabled={cargando || !totalMarcado}>
              {cargando
                ? <><span className="spinner spinner-sm" /> Aplicando…</>
                : `Aplicar ${plural(totalMarcado, 'cambio', 'cambios')}`}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => avanzar(paso)} disabled={cargando}>
              Continuar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Paso 1 · la semilla ──────────────────────────────────────────────────────

function PasoSemilla({ ensayo, cargando, preguntas, onServicios, onContador }: {
  ensayo: ResumenSemilla | null
  cargando: boolean
  preguntas: PreguntasSemilla | null
  onServicios: (valor: string) => void
  onContador:  (valor: boolean) => void
}) {
  // Las preguntas se pintan aunque el ensayo esté recalculándose: si desaparecieran
  // al contestarlas, el dueño se quedaría mirando «Mirando qué te falta…» sin ver
  // lo que acaba de elegir, y volvería a pulsar.
  const bloquePreguntas = preguntas && (
    <div className="ado-preguntas">
      {preguntas.servicios.aplica && (
        <div className="input-group">
          <label htmlFor="ado-servicios">{preguntas.servicios.texto}</label>
          <select
            id="ado-servicios" className="input" disabled={cargando}
            value={preguntas.servicios.respuesta ?? ''}
            onChange={e => onServicios(e.target.value)}
          >
            <option value="" disabled>— Elige una —</option>
            {preguntas.servicios.opciones.map(o => (
              <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
            ))}
          </select>
          <span className="input-hint">Decide qué catálogo te cargamos. Se puede cambiar después.</span>
        </div>
      )}
      <div className="input-group">
        <label htmlFor="ado-contador">{preguntas.contador.texto}</label>
        <select
          id="ado-contador" className="input" disabled={cargando}
          value={preguntas.contador.respuesta == null ? '' : String(preguntas.contador.respuesta)}
          onChange={e => onContador(e.target.value === 'true')}
        >
          <option value="" disabled>— Elige una —</option>
          {preguntas.contador.opciones.map(o => (
            <option key={String(o.valor)} value={String(o.valor)}>{o.etiqueta}</option>
          ))}
        </select>
        <span className="input-hint">{preguntas.contador.ejemplo}</span>
      </div>
    </div>
  )

  if (cargando || !ensayo) return (<>{bloquePreguntas}<p className="ado-intro">Mirando qué te falta…</p></>)
  if (!ensayo.ok) return (<>{bloquePreguntas}<p className="ado-intro">{ensayo.error}</p></>)

  const creadas   = ensayo.creadas   ?? []
  const ancladas  = ensayo.ancladas  ?? []
  const yaTenia   = ensayo.yaTenia   ?? []
  const ocupadas  = ensayo.ocupadas  ?? []
  const retiradas = ensayo.retiradas ?? []

  return (<>
    {bloquePreguntas}
    <p className="ado-intro">
      Vamos a cargar el catálogo de <strong>{ensayo.pack}</strong>. Esto es exactamente
      lo que va a pasar — nada más, y nada de lo que ya tienes se toca.
    </p>
    <ul className="ado-lista">
      <li className="ado-fila">
        <Check size={16} strokeWidth={2.5} />
        <span>
          <span className="ado-fila-nombre">Se crearán {plural(creadas.length, 'categoría', 'categorías')}</span>
          {creadas.length > 0 && <span className="ado-fila-detalle">{creadas.join(' · ')}</span>}
        </span>
        <span />
      </li>
      {ancladas.length > 0 && (
        <li className="ado-fila">
          <Check size={16} strokeWidth={2.5} />
          <span>
            <span className="ado-fila-nombre">{plural(ancladas.length, 'categoría tuya se reconoce', 'categorías tuyas se reconocen')} como del catálogo</span>
            <span className="ado-fila-detalle">Se quedan igual: solo pasamos a saber cuál es cuál. {ancladas.join(' · ')}</span>
          </span>
          <span />
        </li>
      )}
      {yaTenia.length > 0 && (
        <li className="ado-fila">
          <Check size={16} strokeWidth={2.5} />
          <span>
            <span className="ado-fila-nombre">{plural(yaTenia.length, 'ya la tenías', 'ya las tenías')}</span>
            <span className="ado-fila-detalle">No se tocan.</span>
          </span>
          <span />
        </li>
      )}
      {ocupadas.length > 0 && (
        <li className="ado-fila">
          <AlertTriangle size={16} strokeWidth={2.5} />
          <span>
            <span className="ado-fila-nombre">{plural(ocupadas.length, 'no se carga', 'no se cargan')}: ya usas ese nombre</span>
            <span className="ado-fila-detalle">
              Tu categoría manda. En el paso siguiente decides si es la misma cuenta. {ocupadas.join(' · ')}
            </span>
          </span>
          <span />
        </li>
      )}
      {retiradas.length > 0 && (
        <li className="ado-fila">
          <Check size={16} strokeWidth={2.5} />
          <span>
            <span className="ado-fila-nombre">{plural(retiradas.length, 'la borraste', 'las borraste')} y no vuelve{retiradas.length === 1 ? '' : 'n'}</span>
            <span className="ado-fila-detalle">{retiradas.join(' · ')}</span>
          </span>
          <span />
        </li>
      )}
    </ul>
  </>)
}

// ── Paso 2 · categorías repetidas ────────────────────────────────────────────

function PasoFusiones({ a, marcadas, setMarcadas }: {
  a: AnalisisAdopcion
  marcadas: Set<string>
  setMarcadas: (s: Set<string>) => void
}) {
  const alternar = (id: string) => {
    const s = new Set(marcadas)
    if (s.has(id)) s.delete(id); else s.add(id)
    setMarcadas(s)
  }
  return (<>
    <p className="ado-intro">
      Estas dos son la misma cuenta escrita de dos maneras. Al juntarlas, los gastos
      de una pasan a la otra y no se pierde ninguno.
    </p>
    <ul className="ado-lista">
      {(a.fusiones ?? []).map(f => (
        <li key={f.absorbe.categoria_id} className={`ado-fila${f.cambiaRol ? ' ado-cruza' : ''}`}>
          <input type="checkbox" className="row-check"
            id={`fus-${f.absorbe.categoria_id}`}
            checked={marcadas.has(f.absorbe.categoria_id)}
            onChange={() => alternar(f.absorbe.categoria_id)} />
          <label htmlFor={`fus-${f.absorbe.categoria_id}`}>
            <span className="ado-fila-nombre">
              «{f.absorbe.nombre}» pasa a «{f.queda.nombre}»
            </span>
            <span className="ado-fila-detalle">
              {plural(f.absorbe.usos, 'registro se mueve', 'registros se mueven')}.
              {' '}«{f.queda.nombre}» ya tiene {plural(f.queda.usos, 'registro', 'registros')}.
              {f.cambiaRol && (
                <> <strong>Ojo:</strong> hoy cuentan en renglones distintos
                  ({rolLabel(f.rolAbsorbe)} y {rolLabel(f.rolQueda)}). Al juntarlas, todo
                  pasa a {rolLabel(f.rolQueda)} — también lo de meses cerrados.</>
              )}
            </span>
          </label>
          <span />
        </li>
      ))}
    </ul>
  </>)
}

// ── Paso 3 · emparejar raíces ────────────────────────────────────────────────

function PasoRaices({ a, anclas, setAnclas }: {
  a: AnalisisAdopcion
  anclas: Map<string, string>
  setAnclas: (m: Map<string, string>) => void
}) {
  const elegir = (id: string, clave: string) => {
    const m = new Map(anclas)
    if (clave) m.set(id, clave); else m.delete(id)
    setAnclas(m)
  }
  return (<>
    <p className="ado-intro">
      Estas categorías tuyas se parecen a una del catálogo. Emparejarlas no cambia
      su nombre ni su renglón: sirve para que CLAUX no te cree una repetida cuando
      registre un gasto por su cuenta.
    </p>
    <ul className="ado-lista">
      {(a.raices ?? []).map(r => (
        <li key={r.categoria_id} className="ado-fila">
          <span />
          <span>
            <span className="ado-fila-nombre">{r.nombre}</span>
            <span className="ado-fila-detalle">
              {rolLabel(r.rol_pl)} · {plural(r.usos, 'registro', 'registros')}
              {r.hijas > 0 && ` · ${plural(r.hijas, 'subcategoría', 'subcategorías')}`}
            </span>
          </span>
          <span className="ado-fila-destino">
            <select id={`anc-${r.categoria_id}`} className="input"
              aria-label={`Emparejar «${r.nombre}» con`}
              value={anclas.get(r.categoria_id) ?? ''}
              onChange={e => elegir(r.categoria_id, e.target.value)}>
              <option value="">No emparejar</option>
              {r.candidatas.map(c => (
                <option key={c.clave} value={c.clave}>
                  {c.nombre}{c.confianza === 'identico' ? '' : ' (parecida)'}
                </option>
              ))}
            </select>
          </span>
        </li>
      ))}
    </ul>
  </>)
}

// ── Pasos 4 y 5 · mover subcategorías ────────────────────────────────────────

function PasoHijas({ hijas, a, destinos, setDestinos, permiteTodas }: {
  hijas: PropuestaHija[]
  a: AnalisisAdopcion
  destinos: Map<string, string>
  setDestinos: (m: Map<string, string>) => void
  permiteTodas: boolean
}) {
  const elegir = (id: string, destino: string) => {
    const m = new Map(destinos)
    if (destino) m.set(id, destino); else m.delete(id)
    setDestinos(m)
  }
  const marcarTodas = () => {
    const m = new Map(destinos)
    for (const h of hijas) if (h.destinos[0]) m.set(h.categoria_id, h.destinos[0].categoria_id)
    setDestinos(m)
  }

  // Lo que la raíz CONSERVA después de mover: sin esta línea el dueño cree que
  // queda vacía e intenta borrarla — y no lo está, porque una raíz también tiene
  // gastos propios.
  const madres = [...new Set(hijas.map(h => h.padre_id))]

  return (<>
    <p className="ado-intro">
      {permiteTodas
        ? <>Estas subcategorías encajan mejor bajo otra principal. Moverlas no cambia
            el renglón en el que cuentan, así que tu informe queda igual.</>
        : <><strong>Aquí sí cambia tu informe.</strong> Una subcategoría cuenta en el
            renglón de su categoría principal, así que moverla cambia dónde suma —
            también en los meses ya cerrados. Van una a una a propósito.</>}
    </p>

    {permiteTodas && hijas.length > 1 && (
      <button type="button" className="btn btn-secondary btn-sm" onClick={marcarTodas}>
        Aceptar las {hijas.length} propuestas
      </button>
    )}

    <ul className={`ado-lista${permiteTodas ? '' : ' ado-cruza'}`}>
      {hijas.map(h => (
        <li key={h.categoria_id} className="ado-fila">
          <span />
          <span>
            <span className="ado-fila-nombre">{h.nombre}</span>
            <span className="ado-fila-detalle">
              Hoy en «{h.padreNombre}» · {rolLabel(h.rolActual)}
              {' · '}{plural(h.usos, 'registro', 'registros')}
              {!h.conservaRol && h.destinos[0] && (
                <> · pasaría a contar en <strong>{rolLabel(h.destinos[0].rol)}</strong></>
              )}
            </span>
          </span>
          <span className="ado-fila-destino">
            <select id={`mov-${h.categoria_id}`} className="input"
              aria-label={`Mover «${h.nombre}» a`}
              value={destinos.get(h.categoria_id) ?? ''}
              onChange={e => elegir(h.categoria_id, e.target.value)}>
              <option value="">Dejarla donde está</option>
              {h.destinos.map(d => (
                <option key={d.categoria_id} value={d.categoria_id}>
                  {d.nombre}{d.confianza === 'identico' ? '' : ' (parecida)'}
                </option>
              ))}
            </select>
          </span>
        </li>
      ))}
    </ul>

    <ul className="ado-lista">
      {madres.map(id => {
        const nombre  = hijas.find(h => h.padre_id === id)?.padreNombre ?? ''
        const propios = a.gastosPropios?.[id] ?? 0
        const cuantas = hijas.filter(h => h.padre_id === id && destinos.get(h.categoria_id)).length
        if (!cuantas) return null
        return (
          <li key={id} className="ado-intro">
            {propios > 0
              ? <>«{nombre}» se queda con sus {plural(propios, 'registro propio', 'registros propios')} después de mover {plural(cuantas, 'subcategoría', 'subcategorías')}.</>
              : <>«{nombre}» se queda sin subcategorías y sin registros propios: podrás archivarla si ya no la usas.</>}
          </li>
        )
      })}
    </ul>
  </>)
}

// ── Paso 6 · la depreciación que genera deuda ────────────────────────────────
//
// La depreciación es el único gasto del catálogo que no se le paga a nadie: no
// hay factura ni proveedor esperando. Registrada como los demás, aparece en
// Cuentas por pagar y descuadra el saldo contra lo que hay en la caja.
//
// Todo nace sin marcar. Son apuntes que el dueño escribió, no propuestas
// nuestras, y los que ya tienen un pago aplicado ni siquiera llegan aquí: el
// servidor los aparta y los cuenta, porque ese caso se mira de uno en uno.

function PasoDepreciacion({ a, marcados, setMarcados }: {
  a: AnalisisAdopcion
  marcados: Set<string>
  setMarcados: (s: Set<string>) => void
}) {
  const apuntes = a.depreciacion ?? []
  const alternar = (id: string) => {
    const s = new Set(marcados)
    if (s.has(id)) s.delete(id); else s.add(id)
    setMarcados(s)
  }
  const conPagos = a.depreciacionConPagos ?? 0

  return (<>
    {apuntes.length > 0 ? (
      <p className="ado-intro">
        Estos gastos de depreciación figuran hoy como <strong>pendientes de pago</strong>,
        y la depreciación no se le paga a nadie: es el desgaste de lo que ya compraste.
        Al marcarlos salen de lo que debes y del saldo, pero siguen contando como gasto
        en tu informe — el resultado no cambia.
      </p>
    ) : (
      <p className="ado-intro">
        No hay depreciación pendiente que arreglar desde aquí. Lo que sí hay que mirar
        es esto:
      </p>
    )}

    {apuntes.length > 1 && (
      <button type="button" className="btn btn-secondary btn-sm"
        onClick={() => setMarcados(new Set(apuntes.map(d => d.registro_id)))}>
        Marcar los {apuntes.length}
      </button>
    )}

    <ul className="ado-lista">
      {apuntes.map(d => (
        <li key={d.registro_id} className="ado-fila">
          <input type="checkbox" className="row-check"
            id={`dep-${d.registro_id}`}
            checked={marcados.has(d.registro_id)}
            onChange={() => alternar(d.registro_id)} />
          <label htmlFor={`dep-${d.registro_id}`}>
            <span className="ado-fila-nombre">
              {d.descripcion || d.categoria} — {formatMonto(d.monto)} {d.moneda}
            </span>
            <span className="ado-fila-detalle">{d.fecha} · {d.categoria}</span>
          </label>
          <span />
        </li>
      ))}
    </ul>

    {conPagos > 0 && (
      <p className="ado-intro">
        Hay {plural(conPagos, 'apunte de depreciación con un pago hecho',
          'apuntes de depreciación con un pago hecho')} desde una cuenta tuya. Eso no
        encaja: por la depreciación no sale dinero. No se tocan desde aquí —quitarles
        la deuda dejaría ese pago colgando—; míralos en Gastos uno a uno.
      </p>
    )}

    {(a.depreciacionSaldadaEnMigracion ?? 0) > 0 && (
      <p className="ado-intro">
        Otros {plural(a.depreciacionSaldadaEnMigracion ?? 0,
          'apunte de depreciación quedó saldado', 'apuntes de depreciación quedaron saldados')}
        {' '}en la migración de tus datos, contra la cuenta técnica de Apertura. Ahí no
        debes nada a nadie ni falta dinero: no hay que hacer nada.
      </p>
    )}
  </>)
}

// ── Paso 7 · la previsualización agregada ────────────────────────────────────

function PasoRevision({ impacto, cargando, total, depreciacion }: {
  impacto: ImpactoPrevio | null; cargando: boolean; total: number; depreciacion: number
}) {
  if (!total) return <p className="ado-intro">No has marcado ningún cambio. Puedes cerrar el asistente.</p>
  if (cargando) return <p className="ado-intro">Calculando cómo queda tu informe…</p>

  // Reclasificar depreciación no mueve el informe (sigue siendo gasto), mueve lo
  // que debes. Si no se dice aquí, el dueño ve «tu informe no se mueve» y cree
  // que no marcó nada.
  const lineaDep = depreciacion > 0 && (
    <p className="ado-intro">
      Además, {plural(depreciacion, 'apunte de depreciación deja', 'apuntes de depreciación dejan')}
      {' '}de contar como deuda pendiente.
    </p>
  )

  const imp = impacto?.impacto
  if (!imp || !imp.cambia) {
    return (<>
      <p className="ado-intro">
        {plural(total, 'cambio marcado', 'cambios marcados')}. Tu informe de resultados
        no se mueve: lo que cambia es cómo está organizado el árbol.
      </p>
      {lineaDep}
    </>)
  }

  return (<>
    {lineaDep}
    <div className={`alert ${imp.irreversible ? 'alert-warning' : 'alert-info'}`}>
      <AlertTriangle size={16} strokeWidth={2.2} />
      <span>
        {imp.irreversible ? (
          <><span className="alert-titulo">Esto reescribe tu informe hacia atrás</span>
          Los meses ya cerrados se recalculan con el árbol nuevo, y no hay marcha atrás
          automática. Míralo antes de aplicar.</>
        ) : (
          <><span className="alert-titulo">Tu informe se reorganiza</span>
          Se recoloca lo que ya tenías; el resultado neto no cambia.</>
        )}
      </span>
    </div>

    <p className="ado-intro">
      Comparación sobre lo registrado entre {impacto?.desde} y {impacto?.hasta}.
    </p>

    {imp.monedas.map(m => (
      <div key={m.moneda} className="ado-impacto-moneda">
        <h3 className="ado-impacto-titulo">{m.moneda}</h3>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Renglón</th>
                <th className="col-num">Ahora</th>
                <th className="col-num">Después</th>
                <th className="col-num">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {m.renglones.map(r => (
                <tr key={r.renglon}>
                  <td data-label="Renglón">{r.renglon}</td>
                  <td data-label="Ahora"   className="col-num">
                    {r.antes === null ? <span className="ado-nuevo">sin datos</span> : formatMonto(r.antes)}
                  </td>
                  <td data-label="Después" className="col-num">
                    {r.despues === null ? <span className="ado-nuevo">sin datos</span> : formatMonto(r.despues)}
                  </td>
                  <td data-label="Diferencia" className="col-num">
                    {r.delta === null
                      ? <span className="ado-nuevo">renglón nuevo</span>
                      : <span className={r.delta > 0 ? 'ado-delta-sube' : 'ado-delta-baja'}>
                          {r.delta > 0 ? '+' : ''}{formatMonto(r.delta)}
                        </span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ))}
  </>)
}
