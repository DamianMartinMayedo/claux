'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ArrowDown, ArrowUp, ClipboardPaste, Copy, ExternalLink, Eye, FileText,
  Images, RotateCcw, Save, Send, Share2, Trash2,
} from 'lucide-react'
import Tabs from '@/components/Tabs'
import { toastError, toastLoading, toastSuccess, toastWarning } from '@/app/contexts/ToastContext'
import { NIVELES, NOMBRE_NIVEL, precioModulo, type Nivel } from '@/lib/niveles'
import { MONEDAS_CLAUX, importeClaux, type MonedaClaux } from '@/lib/moneda-claux'
import { NO_OCULTABLES, ORDEN_POR_DEFECTO, seccionDe } from '@/lib/propuesta/secciones'
import type { ResumenEditor } from '@/lib/propuesta/editor'
import {
  despublicarPropuesta, guardarPropuesta, publicarPropuesta, revocarEnlacePropuesta,
  type ModuloParaPropuesta, type PresupuestoVinculable, type PropuestaDetalle,
} from '@/app/actions/propuestas'

type Pestana = 'textos' | 'diapositivas' | 'presentar'

// Los textos libres de la diapositiva 2 y de la 4. Se prellenan solos del
// diagnóstico; lo que se escriba aquí gana. El `hueco` es lo que se dice cuando
// el diagnóstico no trae ese dato: la marca de agua de la caja es el prellenado
// de verdad —lo que va a leer el cliente—, así que solo se explica el que falta.
const CAMPOS_ENTENDIMOS = [
  { clave: 'entendimos_1', label: 'Qué negocio es',    hueco: 'El diagnóstico no dice sector ni tamaño' },
  { clave: 'entendimos_2', label: 'Cómo lo lleva hoy', hueco: 'El diagnóstico no dice cómo lo lleva' },
  { clave: 'entendimos_3', label: 'Qué necesita',      hueco: 'El diagnóstico no marcó ninguna necesidad' },
  { clave: 'entendimos_4', label: 'Su mayor reto',     hueco: 'Esto no sale del formulario: se oye en la reunión' },
]
const CAMPOS_HOY = ['hoy_1', 'hoy_2', 'hoy_3']

function fmtFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * La URL de «crear presupuesto con esta selección». El destino ya sabe leer
 * `lead`/`cliente`/`negocio`/`modulos`/`nivel`/`moneda`; aquí solo se decide con
 * qué vínculo se abre, por orden de fuerza: cliente que ya lo es → lead del
 * diagnóstico → nada (alta manual). Los módulos van SIEMPRE explícitos: son lo
 * que se acordó, no lo que sugirió un formulario hace semanas.
 */
function urlPresupuesto(opts: {
  clientId: string | null; diagnosticoId: number | null
  negocio: string; modulos: string[]; nivel: string; moneda: string
}): string {
  const q = new URLSearchParams()
  if (opts.clientId) q.set('cliente', opts.clientId)
  else if (opts.diagnosticoId) q.set('lead', String(opts.diagnosticoId))
  else q.set('negocio', opts.negocio)
  q.set('modulos', opts.modulos.join(','))
  q.set('nivel', opts.nivel)
  q.set('moneda', opts.moneda)
  return `/admin/presupuestos/nuevo?${q.toString()}`
}

/** ¿Las dos listas llevan los mismos módulos, en cualquier orden? */
function mismosModulos(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every(c => b.includes(c))
}

/** Mueve un elemento una posición. Devuelve EL MISMO array si no hay sitio, y
 *  por eso vale para el orden de las secciones y para el de sus bloques: quien
 *  llama comprueba la identidad para saber si algo se movió. */
function mover<T>(lista: T[], i: number, delta: number): T[] {
  const j = i + delta
  if (j < 0 || j >= lista.length) return lista
  const copia = [...lista]
  ;[copia[i], copia[j]] = [copia[j], copia[i]]
  return copia
}

export default function PropuestaEditor({
  detalle, catalogo, presupuestos, resumen,
}: {
  detalle: PropuestaDetalle
  catalogo: ModuloParaPropuesta[]
  presupuestos: PresupuestoVinculable[]
  /** La propuesta ya armada, resumida: lo que va a decir cada caja si se deja
   *  en blanco y lo que lleva dentro cada sección. Del servidor y del mismo
   *  motor que imprime, así que es lo que va a leer el cliente. */
  resumen: ResumenEditor
}) {
  const router = useRouter()
  const p = detalle.fila

  const [tab, setTab] = useState<Pestana>('textos')
  const [pending, startTransition] = useTransition()

  const [titulo, setTitulo] = useState(p.titulo)
  const [nombre, setNombre] = useState(p.nombre_negocio)
  const [nivel, setNivel] = useState<Nivel>(p.nivel as Nivel)
  const [moneda, setMoneda] = useState<MonedaClaux>(p.moneda)
  const [presupuestoId, setPresupuestoId] = useState<number | null>(p.presupuesto_id)
  const [modulos, setModulos] = useState<string[]>(p.modulos)
  const [textos, setTextos] = useState<Record<string, string>>(detalle.textos)
  const [firma, setFirma] = useState({
    nombre: p.comercial_nombre ?? '', email: p.comercial_email ?? '', tel: p.comercial_tel ?? '',
  })
  const [ocultas, setOcultas] = useState<string[]>(detalle.secciones_ocultas)
  const [orden, setOrden] = useState<string[]>(
    detalle.secciones_orden.length > 0 ? detalle.secciones_orden : ORDEN_POR_DEFECTO,
  )
  const [sucio, setSucio] = useState(false)

  // Estado + marca de sucio en un solo sitio: cada campo que se olvidase de
  // levantarla dejaría un cambio que el botón de guardar no ve.
  function cambiar<T>(set: (v: T) => void) {
    return (v: T) => { set(v); setSucio(true) }
  }
  const setTexto = (clave: string, valor: string) => {
    setTextos(t => ({ ...t, [clave]: valor }))
    setSucio(true)
  }
  const alternarModulo = (clave: string) => {
    setModulos(m => (m.includes(clave) ? m.filter(x => x !== clave) : [...m, clave]))
    setSucio(true)
  }
  const cambiarFirma = (campo: 'nombre' | 'email' | 'tel') => (v: string) => {
    setFirma(f => ({ ...f, [campo]: v }))
    setSucio(true)
  }
  const alternarOculta = (clave: string) => {
    setOcultas(o => (o.includes(clave) ? o.filter(x => x !== clave) : [...o, clave]))
    setSucio(true)
  }

  // Traer lo prellenado a las cajas para poder retocarlo. Solo rellena las
  // vacías: lo que ya está escrito no se pisa nunca.
  const pre = resumen.prefill
  const traer = (pares: [string, string | null][]) => {
    const nuevos: Record<string, string> = {}
    for (const [clave, valor] of pares) {
      if (valor && !(textos[clave] ?? '').trim()) nuevos[clave] = valor
    }
    if (Object.keys(nuevos).length === 0) return
    setTextos(t => ({ ...t, ...nuevos }))
    setSucio(true)
  }
  const paresEntendimos = CAMPOS_ENTENDIMOS.map(
    (c, i) => [c.clave, pre.entendimos[i] ?? null] as [string, string | null],
  )
  const paresHoy = CAMPOS_HOY.map((c, i) => [c, pre.hoy[i] ?? null] as [string, string | null])
  const hayQueTraer = (pares: [string, string | null][]) =>
    pares.some(([clave, valor]) => valor && !(textos[clave] ?? '').trim())

  const activos = useMemo(() => catalogo.filter(m => m.activo), [catalogo])
  // Un módulo retirado del catálogo que sigue en la propuesta se enseña igual: si
  // no, desaparecería de la pantalla sin desaparecer del documento.
  const presentados = useMemo(
    () => catalogo.filter(m => m.activo || modulos.includes(m.clave)),
    [catalogo, modulos],
  )
  const cuota = useMemo(
    () => activos.filter(m => modulos.includes(m.clave))
      .reduce((s, m) => s + precioModulo(m, nivel, moneda), 0),
    [activos, modulos, nivel, moneda],
  )

  // El orden, por BLOQUES. Las capturas cuentan como un solo elemento aunque el
  // orden nombre cada imagen: si no, la flecha de la sección movería el rótulo
  // y dejaría una captura suelta entre los precios y las fases.
  const bloques = useMemo(() => {
    const salida: string[][] = []
    let capturas: string[] | null = null
    for (const clave of orden) {
      if (seccionDe(clave) === 'capturas') {
        if (capturas) { capturas.push(clave); continue }
        capturas = [clave]
        salida.push(capturas)
      } else salida.push([clave])
    }
    return salida
  }, [orden])

  /** Una fila por sección, con el bloque al que pertenece. */
  const filas = useMemo(() => {
    const vistas = new Set<string>()
    const salida: { bloque: number; clave: string }[] = []
    bloques.forEach((b, i) => {
      const clave = seccionDe(b[0])
      if (vistas.has(clave)) return
      vistas.add(clave)
      salida.push({ bloque: i, clave })
    })
    return salida
  }, [bloques])

  const moverBloque = (i: number, delta: number) => {
    const movidos = mover(bloques, i, delta)
    if (movidos === bloques) return
    cambiar<string[]>(setOrden)(movidos.flat())
  }

  // Las capturas, en el orden en que van a salir. El orden guardado nombra la
  // SECCIÓN; en cuanto se mueve una imagen se materializan las claves de todas
  // y `capturas` se queda detrás, para que la que se suba mañana entre ahí y no
  // al final de la presentación.
  const ordenCapturas = useMemo(() => {
    const vivas = resumen.capturas.map(c => `captura:${c.id}`)
    const nombradas = orden.filter(c => vivas.includes(c))
    return [...nombradas, ...vivas.filter(c => !nombradas.includes(c))]
  }, [orden, resumen.capturas])

  function moverCaptura(i: number, delta: number) {
    const nuevas = mover(ordenCapturas, i, delta)
    if (nuevas === ordenCapturas) return
    const corte = orden.findIndex(c => seccionDe(c) === 'capturas')
    const antes = orden.slice(0, corte === -1 ? orden.length : corte)
      .filter(c => seccionDe(c) !== 'capturas')
    const resto = orden.filter(c => seccionDe(c) !== 'capturas').slice(antes.length)
    cambiar<string[]>(setOrden)([...antes, ...nuevas, 'capturas', ...resto])
  }

  const capturasQuitadas = ocultas.includes('capturas')

  const presupuesto = presupuestos.find(x => x.id === presupuestoId) ?? null
  // La moneda del presupuesto MANDA al renderizar (`armar.ts`). Si aquí dice otra
  // cosa, lo que se enseñará no es lo que pone esta pantalla.
  const chocaMoneda = presupuesto !== null && presupuesto.moneda !== moneda

  // Lo que marcó el cliente frente a lo que está cotizado. Si coincide, crear
  // un presupuesto «con esta selección» dejaría al cliente con dos presupuestos
  // idénticos y con dos números: lo que hay que hacer es abrir el que ya está.
  const seleccion = p.seleccion
  const cotizaLoMarcado = seleccion !== null && presupuesto !== null
    && mismosModulos(presupuesto.modulos, seleccion.modulos)
  const nombreModulo = (c: string) => catalogo.find(m => m.clave === c)?.nombre ?? c
  const cambios = seleccion !== null && presupuesto !== null
    ? {
        anade: seleccion.modulos.filter(c => !presupuesto.modulos.includes(c)).map(nombreModulo),
        quita: presupuesto.modulos.filter(c => !seleccion.modulos.includes(c)).map(nombreModulo),
      }
    : null

  function guardar() {
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const r = await guardarPropuesta(p.id, {
        titulo, nombreNegocio: nombre, nivel, moneda, modulos,
        comercialNombre: firma.nombre, comercialEmail: firma.email, comercialTel: firma.tel,
        presupuestoId, textos,
        seccionesOcultas: ocultas, seccionesOrden: orden,
      })
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo guardar'); return }
      setSucio(false)
      toastSuccess('Propuesta guardada')
      router.refresh()
    })
  }

  function publicar() {
    const ld = toastLoading('Publicando…')
    startTransition(async () => {
      const r = await publicarPropuesta(p.id)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo publicar'); return }
      toastSuccess('Propuesta publicada')
      router.refresh()
    })
  }

  function despublicar() {
    const ld = toastLoading('Despublicando…')
    startTransition(async () => {
      const r = await despublicarPropuesta(p.id)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo despublicar'); return }
      toastWarning('El enlace ya no abre')
      router.refresh()
    })
  }

  function revocar() {
    const ld = toastLoading('Revocando…')
    startTransition(async () => {
      const r = await revocarEnlacePropuesta(p.id)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo revocar'); return }
      toastWarning('Enlace nuevo. El anterior ya no abre.')
      router.refresh()
    })
  }

  async function copiarEnlace() {
    if (!p.token) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${p.token}`)
      toastSuccess('Enlace copiado')
    } catch {
      toastError('No se pudo copiar')
    }
  }

  function compartirWhatsApp() {
    if (!p.token) return
    const texto = `${titulo}\n${window.location.origin}/p/${p.token}`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <Link href="/admin/ventas/propuestas" className="volver-link">
            <ArrowLeft size={14} strokeWidth={2.5} /> Propuestas
          </Link>
          <h1 className="page-title">{nombre}</h1>
          <p className="page-subtitle">
            {p.estado === 'PUBLICADA' ? 'Publicada' : 'Borrador'}
            {p.publicada_at && p.estado === 'PUBLICADA' && ` el ${fmtFechaHora(p.publicada_at)}`}
            {' · '}{modulos.length} módulo{modulos.length === 1 ? '' : 's'} · {importeClaux(cuota, moneda)}/mes
            {' · '}{resumen.total} diapositivas
          </p>
        </div>
        <div className="page-header-acciones">
          <Link href={`/p/preview/${p.id}`} target="_blank" className="btn btn-secondary">
            <Eye size={16} strokeWidth={2} /> Presentar
          </Link>
          <button className="btn btn-primary" disabled={pending || !sucio} onClick={guardar}>
            <Save size={16} strokeWidth={2} /> {sucio ? 'Guardar' : 'Guardado'}
          </button>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'textos', label: 'Textos' },
          { id: 'diapositivas', label: 'Diapositivas' },
          { id: 'presentar', label: 'Presentar' },
        ]}
        active={tab} onChange={setTab} ariaLabel="Secciones de la propuesta"
      />

      {tab === 'textos' && (
        <div className="prp-panel">
          <div className="card">
            <h2 className="card-title card-title-sm">Lo básico</h2>
            <div className="prp-grid">
              <div className="input-group">
                <label htmlFor="prp-titulo">Título</label>
                <input id="prp-titulo" className="input" value={titulo}
                  onChange={e => cambiar(setTitulo)(e.target.value)} />
              </div>
              <div className="input-group">
                <label htmlFor="prp-negocio">Nombre del negocio</label>
                <input id="prp-negocio" className="input" value={nombre}
                  onChange={e => cambiar(setNombre)(e.target.value)} />
              </div>
              <div className="input-group">
                <label htmlFor="prp-nivel">Nivel de precios</label>
                <select id="prp-nivel" className="input" value={nivel}
                  onChange={e => cambiar<Nivel>(setNivel)(e.target.value as Nivel)}>
                  {NIVELES.map(n => <option key={n} value={n}>{NOMBRE_NIVEL[n]}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label htmlFor="prp-moneda">Moneda</label>
                <select id="prp-moneda" className="input" value={moneda}
                  onChange={e => cambiar<MonedaClaux>(setMoneda)(e.target.value as MonedaClaux)}>
                  {MONEDAS_CLAUX.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="input-group prp-ancho">
                <label htmlFor="prp-presupuesto">Presupuesto vinculado</label>
                <select
                  id="prp-presupuesto" className="input" value={presupuestoId ?? ''}
                  onChange={e => cambiar<number | null>(setPresupuestoId)(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Sin presupuesto — no se enseña el importe</option>
                  {presupuestos.map(x => (
                    <option key={x.id} value={x.id}>
                      #{x.id} · {x.nombre_negocio} · {importeClaux(x.total_final, x.moneda)} + {importeClaux(x.cuota_mensual, x.moneda)}/mes
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!presupuesto && (
              <div className="alert alert-info">
                Sin presupuesto no se enseñan «Tu propuesta» ni las horas: la presentación
                se queda en el relato, el catálogo y el configurador.
              </div>
            )}
            {chocaMoneda && (
              <div className="alert alert-warning">
                El presupuesto está en {presupuesto.moneda} y aquí pone {moneda}. Manda la del
                presupuesto: los importes saldrán en {presupuesto.moneda}.
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="card-title card-title-sm">Quién la firma</h2>
            <p className="text-sm-muted">
              Sale en la portada y en el cierre. Lo que dejes en blanco no se pinta.
            </p>
            <div className="prp-grid">
              <div className="input-group">
                <label htmlFor="prp-firma-nombre">Nombre</label>
                <input id="prp-firma-nombre" className="input" value={firma.nombre}
                  onChange={e => cambiarFirma('nombre')(e.target.value)} />
              </div>
              <div className="input-group">
                <label htmlFor="prp-firma-tel">WhatsApp</label>
                <input id="prp-firma-tel" className="input" type="tel" value={firma.tel}
                  onChange={e => cambiarFirma('tel')(e.target.value)} />
              </div>
              <div className="input-group">
                <label htmlFor="prp-firma-email">Correo</label>
                <input id="prp-firma-email" className="input" type="email" value={firma.email}
                  onChange={e => cambiarFirma('email')(e.target.value)} />
              </div>
            </div>
            {!firma.nombre.trim() && (
              <div className="alert alert-warning">
                Sin nombre no se pinta el contacto en ninguna diapositiva.
              </div>
            )}
          </div>

          <div className="card">
            <div className="prp-card-head">
              <h2 className="card-title card-title-sm">Lo que entendimos</h2>
              <button
                className="btn btn-secondary btn-sm" disabled={!hayQueTraer(paresEntendimos)}
                onClick={() => traer(paresEntendimos)}
              >
                <ClipboardPaste size={15} strokeWidth={2} /> Traer lo del diagnóstico
              </button>
            </div>
            <p className="text-sm-muted">
              En gris, lo que va a salir si dejas la caja en blanco. Tráelo para retocarlo.
            </p>
            <div className="prp-grid">
              {CAMPOS_ENTENDIMOS.map((c, i) => (
                <div key={c.clave} className="input-group">
                  <label htmlFor={`prp-${c.clave}`}>{c.label}</label>
                  <input
                    id={`prp-${c.clave}`} className="input" placeholder={pre.entendimos[i] ?? ''}
                    value={textos[c.clave] ?? ''} onChange={e => setTexto(c.clave, e.target.value)}
                  />
                  {!pre.entendimos[i] && <p className="form-hint">{c.hueco}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="prp-card-head">
              <h2 className="card-title card-title-sm">Cómo lo lleva hoy</h2>
              <button
                className="btn btn-secondary btn-sm" disabled={!hayQueTraer(paresHoy)}
                onClick={() => traer(paresHoy)}
              >
                <ClipboardPaste size={15} strokeWidth={2} /> Traer lo prellenado
              </button>
            </div>
            <p className="text-sm-muted">
              La columna va entera: si escribes una línea, salen solo las que escribas.
            </p>
            <div className="prp-lineas">
              {CAMPOS_HOY.map((clave, i) => (
                <div key={clave} className="input-group">
                  <label htmlFor={`prp-${clave}`}>Hoy · {i + 1}</label>
                  <input
                    id={`prp-${clave}`} className="input" placeholder={pre.hoy[i] ?? ''}
                    value={textos[clave] ?? ''} onChange={e => setTexto(clave, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 className="card-title card-title-sm">Por qué le sirve cada módulo</h2>
            <p className="text-sm-muted">
              En gris, el texto del catálogo. Escribe solo los que quieras contar a su medida.
            </p>
            {modulos.length === 0 ? (
              <p className="text-sm-muted">Marca algún módulo arriba.</p>
            ) : (
              <div className="prp-textos">
                {catalogo.filter(m => modulos.includes(m.clave)).map(m => (
                  <div key={m.clave} className="input-group">
                    <label htmlFor={`prp-mod-${m.clave}`}>
                      {m.nombre}{' '}
                      {resumen.modulos[m.clave]?.aMedida
                        ? <span className="badge badge-info">A medida</span>
                        : !resumen.modulos[m.clave] && <span className="badge badge-warning">Sin texto: no sale</span>}
                    </label>
                    <textarea
                      id={`prp-mod-${m.clave}`} className="input" rows={2}
                      placeholder={pre.modulos[m.clave] ?? ''}
                      value={textos[`modulo:${m.clave}`] ?? ''}
                      onChange={e => setTexto(`modulo:${m.clave}`, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="card-title card-title-sm">Condiciones de pago</h2>
            <div className="input-group">
              <label htmlFor="prp-pago">Cómo se paga la puesta en marcha</label>
              <input id="prp-pago" className="input" placeholder={pre.pago}
                value={textos.pago ?? ''} onChange={e => setTexto('pago', e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {tab === 'diapositivas' && (
        <div className="prp-panel">
          <div className="card">
            <h2 className="card-title card-title-sm">Módulos que se presentan</h2>
            <p className="text-sm-muted">
              Pueden ser más que los cotizados: cada uno sale con su ventaja y su captura.
            </p>
            <div className="prp-modulos">
              {presentados.map(m => (
                <label key={m.clave} className="prp-modulo-check">
                  <input type="checkbox" checked={modulos.includes(m.clave)}
                    onChange={() => alternarModulo(m.clave)} />
                  <span className="prp-modulo-nombre">{m.nombre}</span>
                  <span className="prp-modulo-precio">{importeClaux(precioModulo(m, nivel, moneda), moneda)}</span>
                  {!m.activo && <span className="badge badge-warning">Retirado</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="prp-card-head">
              <h2 className="card-title card-title-sm">Las capturas que va a ver</h2>
              <Link
                href="/admin/ventas/propuestas/capturas" target="_blank"
                className="btn btn-secondary btn-sm"
              >
                <Images size={15} strokeWidth={2} /> Biblioteca
              </Link>
            </div>
            <p className="text-sm-muted">
              Salen de la biblioteca por los módulos marcados y el sector del negocio.
              Su sitio es el de la última vez que guardaste.
            </p>
            {resumen.capturas.length === 0 ? (
              <p className="text-sm-muted">
                Ninguna: los módulos marcados no tienen captura en la biblioteca.
              </p>
            ) : (
              <ul className="prp-capturas">
                {ordenCapturas.map((clave, i) => {
                  const c = resumen.capturas.find(x => `captura:${x.id}` === clave)
                  if (!c) return null
                  const fuera = capturasQuitadas || ocultas.includes(clave)
                  return (
                    <li key={clave} className={`prp-captura${fuera ? ' prp-captura-oculta' : ''}`}>
                      <input
                        type="checkbox" checked={!fuera} disabled={capturasQuitadas}
                        onChange={() => alternarOculta(clave)}
                        aria-label={`Mostrar ${c.vista}`}
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="prp-captura-img" src={c.url} alt={c.alt} loading="lazy" />
                      <span className="prp-captura-cuerpo">
                        <span className="prp-captura-nombre">{c.vista}</span>
                        <span className="prp-captura-donde">
                          {fuera || c.numero === null
                            ? 'No sale'
                            : `Diapositiva ${c.numero} de ${resumen.total}`}
                          {' · '}{c.modulo}
                        </span>
                      </span>
                      <div className="prp-seccion-flechas">
                        <button
                          className="ter-action-btn" disabled={i === 0}
                          aria-label={`Subir ${c.vista}`} onClick={() => moverCaptura(i, -1)}
                        >
                          <ArrowUp size={15} strokeWidth={2} />
                        </button>
                        <button
                          className="ter-action-btn" disabled={i === ordenCapturas.length - 1}
                          aria-label={`Bajar ${c.vista}`} onClick={() => moverCaptura(i, 1)}
                        >
                          <ArrowDown size={15} strokeWidth={2} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {capturasQuitadas && (
              <div className="alert alert-info">
                La sección está quitada más abajo: hoy no sale ninguna captura.
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="card-title card-title-sm">Secciones</h2>
            <p className="text-sm-muted">
              Quita las que no vengan a cuento y ponlas en el orden en que las vas a contar.
              Debajo de cada una, lo que lleva dentro tal como quedó al guardar.
            </p>
            <ul className="prp-secciones">
              {filas.map(({ bloque, clave }) => {
                const s = resumen.secciones.find(x => x.clave === clave)
                if (!s) return null
                const fija = NO_OCULTABLES.includes(clave)
                const oculta = ocultas.includes(clave)
                const muestra = s.muestra.slice(0, 3)
                const resto = s.muestra.length - muestra.length
                // «Tu propuesta» no se edita en ningún sitio: sale del presupuesto,
                // así que el enlace es el presupuesto de esta propuesta.
                const enlace = clave === 'tu_propuesta' && presupuestoId
                  ? { href: `/admin/presupuestos/${presupuestoId}`, texto: `Presupuesto #${presupuestoId}` }
                  : s.enlace
                return (
                  <li key={clave} className={`prp-seccion${oculta ? ' prp-seccion-oculta' : ''}`}>
                    <input
                      type="checkbox" checked={!oculta} disabled={fija}
                      onChange={() => alternarOculta(clave)}
                      aria-label={`Mostrar ${s.etiqueta}`}
                      title={fija ? 'La portada y el cierre no se quitan' : undefined}
                    />
                    <div className="prp-seccion-cuerpo">
                      <div className="prp-seccion-linea">
                        <span className="prp-seccion-nombre">{s.etiqueta}</span>
                        {oculta ? (
                          <span className="badge badge-neutral">Quitada</span>
                        ) : s.diapositivas === 0 ? (
                          <span className="badge badge-warning">Sin datos: no sale</span>
                        ) : (
                          <span className="badge badge-neutral">
                            {s.desde === s.hasta
                              ? `Diapositiva ${s.desde}`
                              : `Diapositivas ${s.desde}–${s.hasta}`}
                          </span>
                        )}
                      </div>
                      {!oculta && muestra.length > 0 && (
                        <ul className="prp-muestra">
                          {muestra.map((t, k) => <li key={k}>{t}</li>)}
                          {resto > 0 && <li>…y {resto} más</li>}
                        </ul>
                      )}
                      <p className="prp-seccion-origen">
                        {s.origen}
                        {enlace && (
                          <>
                            {' '}
                            <Link href={enlace.href} target="_blank">
                              {enlace.texto} <ExternalLink size={11} strokeWidth={2} />
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="prp-seccion-flechas">
                      <button className="ter-action-btn" disabled={bloque === 0}
                        aria-label={`Subir ${s.etiqueta}`} onClick={() => moverBloque(bloque, -1)}>
                        <ArrowUp size={15} strokeWidth={2} />
                      </button>
                      <button className="ter-action-btn" disabled={bloque === bloques.length - 1}
                        aria-label={`Bajar ${s.etiqueta}`} onClick={() => moverBloque(bloque, 1)}>
                        <ArrowDown size={15} strokeWidth={2} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <button className="btn btn-secondary btn-sm"
              onClick={() => { setOrden([...ORDEN_POR_DEFECTO]); setOcultas([]); setSucio(true) }}>
              <RotateCcw size={15} strokeWidth={2} /> Volver al orden de la plantilla
            </button>
          </div>
        </div>
      )}

      {tab === 'presentar' && (
        <div className="prp-panel">
          <div className="card">
            <h2 className="card-title card-title-sm">Presentar</h2>
            <p className="text-sm-muted">
              La reunión se lleva desde aquí: la misma presentación que verá el cliente,
              con el configurador en vivo. Para el PDF, el botón de descarga de la propia
              presentación.
            </p>
            <Link href={`/p/preview/${p.id}`} target="_blank" className="btn btn-primary">
              <Eye size={16} strokeWidth={2} /> Abrir la presentación
            </Link>
          </div>

          <div className="card">
            <h2 className="card-title card-title-sm">Compartir el enlace</h2>
            {p.estado === 'PUBLICADA' && p.token ? (
              <>
                <p className="text-sm-muted">Quien tenga el enlace la ve. Revócalo y deja de abrir.</p>
                <code className="prp-enlace">/p/{p.token}</code>
                <div className="prp-acciones">
                  <button className="btn btn-primary" onClick={compartirWhatsApp}>
                    <Send size={16} strokeWidth={2} /> Enviar por WhatsApp
                  </button>
                  <button className="btn btn-secondary" onClick={copiarEnlace}>
                    <Copy size={16} strokeWidth={2} /> Copiar enlace
                  </button>
                  <button className="btn btn-secondary" disabled={pending} onClick={revocar}>
                    <RotateCcw size={16} strokeWidth={2} /> Revocar y generar otro
                  </button>
                  <button className="btn btn-danger-text" disabled={pending} onClick={despublicar}>
                    <Trash2 size={16} strokeWidth={2} /> Despublicar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm-muted">
                  Publicar solo hace falta para mandar el enlace. Para presentarla o mandar
                  el PDF no se publica nada.
                </p>
                <button className="btn btn-primary" disabled={pending} onClick={publicar}>
                  <Share2 size={16} strokeWidth={2} /> Publicar y obtener el enlace
                </button>
              </>
            )}
          </div>

          <div className="card">
            <h2 className="card-title card-title-sm">Acuse de lectura</h2>
            {p.aperturas === 0 ? (
              <p className="text-sm-muted">Todavía no la ha abierto nadie.</p>
            ) : (
              <p className="text-sm">
                Abierta <strong>{p.aperturas}</strong> {p.aperturas === 1 ? 'vez' : 'veces'}
                {p.ultima_apertura && `. La última, el ${fmtFechaHora(p.ultima_apertura)}`}.
              </p>
            )}
          </div>

          <div className="card">
            <h2 className="card-title card-title-sm">Lo que marcó el cliente</h2>
            {seleccion ? (
              <>
                <p className="text-sm">
                  <strong>{importeClaux(seleccion.cuota, seleccion.moneda)}/mes</strong> —{' '}
                  {seleccion.modulos.map(nombreModulo).join(' · ')}
                </p>
                <p className="text-xs-muted">{fmtFechaHora(seleccion.enviada_at)}</p>
                {/* Lo que se acordó en la reunión entra en el presupuesto sin
                    volver a teclearlo: era el último sitio donde la lista de
                    módulos se copiaba a mano de una pantalla a otra.
                    Pero cuando el cliente no cambia nada —el caso normal—, ese
                    botón creaba un presupuesto gemelo del que ya estaba
                    vinculado, con otro número y con la misma cotización. Así
                    que si coincide, lo que se ofrece es abrir el que hay. */}
                {cotizaLoMarcado && presupuesto ? (
                  <>
                    <div className="alert alert-info">
                      El presupuesto #{presupuesto.id} ya cotiza justo eso.
                    </div>
                    <Link href={`/admin/presupuestos/${presupuesto.id}`} className="btn btn-secondary">
                      <FileText size={16} strokeWidth={2} /> Abrir el presupuesto #{presupuesto.id}
                    </Link>
                  </>
                ) : (
                  <>
                    {presupuesto && cambios && (
                      <div className="alert alert-warning">
                        Frente al presupuesto #{presupuesto.id}:
                        {cambios.anade.length > 0 && ` añade ${cambios.anade.join(', ')}`}
                        {cambios.anade.length > 0 && cambios.quita.length > 0 && ' y'}
                        {cambios.quita.length > 0 && ` quita ${cambios.quita.join(', ')}`}.
                      </div>
                    )}
                    <Link
                      href={urlPresupuesto({
                        clientId: p.client_id, diagnosticoId: p.diagnostico_id,
                        negocio: nombre, modulos: seleccion.modulos,
                        nivel, moneda: seleccion.moneda,
                      })}
                      className="btn btn-primary"
                    >
                      <FileText size={16} strokeWidth={2} /> Crear presupuesto con esta selección
                    </Link>
                  </>
                )}
              </>
            ) : (
              <p className="text-sm-muted">No ha mandado ninguna selección.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
