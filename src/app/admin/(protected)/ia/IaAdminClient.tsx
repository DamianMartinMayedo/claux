'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2, Activity, Loader2, X } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import BarraGuardar from '@/components/BarraGuardar'
import Tabs from '@/components/Tabs'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { RowActions } from '@/components/portal/RowActions'
import FormHelp from '@/components/portal/FormHelp'
import { guardarConfigIaGlobal, guardarInterruptoresIa, toggleModeloIa, eliminarModeloIa } from '@/app/actions/ia-admin'
import IaSparkle from '@/components/ia/IaSparkle'
import { FUNCIONES_IA, ETIQUETA_ORIGEN, type FnIa } from '@/lib/ia/funciones'
import { costeUsd, formatearUsd, type Tarifa } from '@/lib/ia/coste'
import { PRUEBA_LENTA_MS, type EstadoPrueba, type PruebaModeloUI, type PruebaModeloResp } from '@/lib/ia/prueba-tipos'
import NuevoModeloIaModal from './NuevoModeloIaModal'
import EditarModeloIaModal from './EditarModeloIaModal'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import DocumentoIaModal from './DocumentoIaModal'

export interface ModeloIa {
  id: string; nombre: string; gratis: boolean; activo: boolean
  api_base: string | null; api_key_env: string | null; key_hint: string | null; orden: number
  /** Tarifa en USD por millón de tokens. null = sin tarifa (no se estima coste). */
  precio_in: number | null; precio_out: number | null
}
export interface ConsumoCliente {
  client_id: string; nombre: string; conversaciones: number; tokens: number
  cupo: number; cupoPropio: boolean; modeloActual: string
}
export interface DocumentoUi {
  key: string; label: string; descripcion: string; valor: string; esPersonalidad: boolean
}
export interface UsoInterno {
  periodo: string; conversaciones: number; tokensIn: number; tokensOut: number
  cupo: number; cercaDelTope: boolean; agotado: boolean
  porOrigen: { origen: string; conversaciones: number; tokensIn: number; tokensOut: number }[]
}

interface Props {
  modelos: ModeloIa[]
  principal: string
  fallbackGratis: string
  cupoGlobal: number
  nombreAgente: string
  tono: string
  documentos: DocumentoUi[]
  periodo: string
  consumo: ConsumoCliente[]
  modeloInterno: string
  interno: UsoInterno
  /** El interruptor general de la IA interna. */
  iaActiva: boolean
  /** Las funciones apagadas una a una. */
  funcionesOff: FnIa[]
  /** La tarifa del modelo que usa el equipo, para poner el gasto en dinero. */
  tarifaInterna: Tarifa
  /** El nombre del modelo con el que se estima ese coste. */
  modeloInternoNombre: string
}

// Resultado del health-check en la fila. «Lento» es su propio estado a propósito: un
// modelo que responde en 40 s sirve, pero no para producción — pintarlo verde miente
// y pintarlo rojo también.
const TONO_PRUEBA: Record<EstadoPrueba, string> = {
  vivo: 'badge-success', lento: 'badge-warning', mudo: 'badge-warning', caido: 'badge-error',
}

function rotuloPrueba(pr: PruebaModeloUI): string {
  if (pr.estado === 'vivo')  return `✓ ${pr.ms} ms`
  if (pr.estado === 'lento') return `Demasiado lento`
  if (pr.estado === 'mudo')  return 'Vivo, sin texto'
  return '✗ Caído'
}

type PestanaIa = 'config' | 'equipo' | 'documentos' | 'modelos' | 'consumo'

/** Las funciones agrupadas por el área donde aparecen, en el orden del catálogo. */
const AREAS_FUNCIONES = [...new Set(FUNCIONES_IA.map(f => f.area))]

/** Se ordena por lo que se mira: quién se está pasando de cupo y quién gasta. */
const COLS_CONSUMO: ColumnasOrden<ConsumoCliente> = {
  nombre:         { label: 'Cliente',        valor: c => c.nombre },
  // El porcentaje, no el número: 400 conversaciones con cupo 5.000 no son un problema
  // y 60 con cupo 50 sí. Sin cupo no hay porcentaje, y va al final como cualquier vacío.
  conversaciones: { label: 'Conversaciones', valor: c => (c.cupo > 0 ? c.conversaciones / c.cupo : null) },
  tokens:         { label: 'Tokens',         valor: c => c.tokens },
  modelo:         { label: 'Modelo en uso',  valor: c => c.modeloActual },
}

function tituloPrueba(pr: PruebaModeloUI): string | undefined {
  if (pr.estado === 'lento') {
    return `No contestó en ${PRUEBA_LENTA_MS / 1000} s. Puede que acabe respondiendo, `
         + `pero el cliente no va a esperar: con este modelo de principal se tira del respaldo.`
  }
  if (pr.estado === 'mudo') return 'Respondió 200 pero sin texto'
  return pr.detalle
}

export default function IaAdminClient({
  modelos, principal, fallbackGratis, cupoGlobal, nombreAgente, tono, documentos, periodo,
  consumo, modeloInterno, interno, iaActiva, funcionesOff, tarifaInterna, modeloInternoNombre,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<PestanaIa>('config')

  // Config global
  const [nombre, setNombre] = useState(nombreAgente)
  const [ton, setTon]       = useState(tono)
  const [prin, setPrin]   = useState(principal)
  const [fb, setFb]       = useState(fallbackGratis)
  const [cupo, setCupo]   = useState(String(cupoGlobal))
  const [mInt, setMInt]   = useState(modeloInterno)
  const [cInt, setCInt]   = useState(String(interno.cupo))
  // Los interruptores NO van al pie de guardar: se aplican al pulsarlos (ver
  // `guardarInterruptoresIa`). El estado local es solo para que la pantalla
  // responda al instante mientras la acción viaja.
  const [activa, setActiva] = useState(iaActiva)
  const [off, setOff]       = useState<FnIa[]>(funcionesOff)
  const [confirmarBorrado, setConfirmarBorrado] = useState<ModeloIa | null>(null)
  const [editando, setEditando] = useState<ModeloIa | null>(null)
  const [pruebas, setPruebas] = useState<Record<string, PruebaModeloUI | 'cargando'>>({})
  const [segundos, setSegundos] = useState<Record<string, number>>({})
  const abortarPrueba = useRef<Record<string, AbortController>>({})

  // Health-check de un modelo: llamada mínima real al proveedor.
  //
  // Va por `fetch` a un ROUTE HANDLER, no por server action. Next despacha las server
  // actions de una en una por cliente, así que probar un modelo lento dejaba en cola
  // el activar/desactivar y el guardar de esta misma pantalla: parecía que se colgaba
  // el admin entero. Por route handler sí se prueban varios a la vez de verdad.
  //
  // Un modelo recién salido puede tardar de forma legítima más de 20 s, así que no se
  // corta a la brava: se enseña el tiempo que lleva y se puede cancelar (regla UX de
  // no dejar nunca una pantalla congelada sin salida).
  async function probar(id: string) {
    const ctrl = new AbortController()
    abortarPrueba.current[id] = ctrl
    setPruebas(p => ({ ...p, [id]: 'cargando' }))
    setSegundos(s => ({ ...s, [id]: 0 }))
    const tic = setInterval(() => setSegundos(s => ({ ...s, [id]: (s[id] ?? 0) + 1 })), 1000)
    try {
      const res = await fetch(`/api/admin/ia/probar?id=${encodeURIComponent(id)}`, { signal: ctrl.signal })
      const r = await res.json() as PruebaModeloResp
      if (!r.ok) { toastError(r.error); olvidarPrueba(id); return }
      setPruebas(p => ({ ...p, [id]: r.prueba }))
    } catch (e) {
      // Cancelar es una decisión del usuario, no un error: la fila vuelve a su sitio.
      if ((e as Error).name !== 'AbortError') toastError('No se pudo probar el modelo.')
      olvidarPrueba(id)
    } finally {
      clearInterval(tic)
      delete abortarPrueba.current[id]
    }
  }

  function olvidarPrueba(id: string) {
    setPruebas(p => { const n = { ...p }; delete n[id]; return n })
    setSegundos(s => { const n = { ...s }; delete n[id]; return n })
  }

  function cancelarPrueba(id: string) { abortarPrueba.current[id]?.abort() }

  const activos = modelos.filter(m => m.activo)
  const activosGratis = activos.filter(m => m.gratis)
  // null = no hay tarifa del modelo interno, y entonces no se enseña un número.
  const costeTotal = costeUsd(interno.tokensIn, interno.tokensOut, tarifaInterna)
  const totalConv = consumo.reduce((s, c) => s + c.conversaciones, 0)
  const totalTok  = consumo.reduce((s, c) => s + c.tokens, 0)
  const ordConsumo = useOrden(consumo, COLS_CONSUMO)
  const { pageItems: consumoItems, ...consumoPag } = usePagination(ordConsumo.filas)

  // Lo que está sin guardar de la configuración global. Se cuenta contra lo que vino del
  // servidor, no contra un `sucio` de un solo bit: con la pantalla en pestañas, el pie
  // tiene que poder decir cuántos campos quedan pendientes en una pestaña que no miras.
  const cambiosConfig = ([
    [nombre, nombreAgente], [ton, tono], [prin, principal],
    [fb, fallbackGratis], [cupo, String(cupoGlobal)],
    [mInt, modeloInterno], [cInt, String(interno.cupo)],
  ] as const).filter(([ahora, antes]) => ahora !== antes).length

  function guardarGlobal(e?: React.FormEvent) {
    e?.preventDefault()
    startTransition(async () => {
      const r = await guardarConfigIaGlobal({
        nombre, tono: ton, principal: prin, fallbackGratis: fb,
        cupo: parseInt(cupo, 10) || 0,
        modeloInterno: mInt,
        cupoInterno: parseInt(cInt, 10) || 0,
      })
      if (!r.ok) { toastError(r.error); return }
      toastSuccess('Configuración de IA guardada')
      router.refresh()
    })
  }

  // Un interruptor se guarda al pulsarlo. La pantalla se mueve ya y, si la acción
  // falla, vuelve a donde estaba y lo dice: dejarla movida con el ajuste sin
  // guardar sería mentir sobre si la IA está encendida.
  function guardarSwitches(nuevaActiva: boolean, nuevasOff: FnIa[]) {
    const antesActiva = activa, antesOff = off
    setActiva(nuevaActiva); setOff(nuevasOff)
    startTransition(async () => {
      const r = await guardarInterruptoresIa({ activa: nuevaActiva, apagadas: nuevasOff })
      if (!r.ok) { setActiva(antesActiva); setOff(antesOff); toastError(r.error); return }
      router.refresh()
    })
  }

  function toggleFuncion(clave: FnIa, encender: boolean) {
    guardarSwitches(activa, encender ? off.filter(f => f !== clave) : [...off, clave])
  }

  function toggle(id: string, activo: boolean) {
    startTransition(async () => {
      const r = await toggleModeloIa(id, activo)
      if (!r.ok) { toastError(r.error); return }
      router.refresh()
    })
  }

  // Confirmación in-app (ConfirmDialog, patrón de la plataforma) antes de un
  // borrado que no se puede deshacer.
  function doEliminar(m: ModeloIa) {
    setConfirmarBorrado(null)
    startTransition(async () => {
      const r = await eliminarModeloIa(m.id)
      if (!r.ok) { toastError(r.error); return }
      toastSuccess('Modelo eliminado')
      router.refresh()
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Asistente IA</h1>
          <p className="page-subtitle">Controla los modelos que usan los clientes, los límites y el consumo.</p>
        </div>
      </div>

      {/* Cinco asuntos distintos, cada uno por su cuenta: seguidos eran un scroll de
          pantalla y media para llegar a una tabla. «Equipo» es la IA que pagamos
          nosotros —interruptores, modelo, tope y lo que llevamos gastado—; el resto
          de la pantalla es la IA que contrata el cliente. */}
      <Tabs
        tabs={[
          { id: 'config',     label: 'Configuración' },
          { id: 'equipo',     label: 'Equipo' },
          { id: 'documentos', label: 'Documentos', count: documentos.length },
          { id: 'modelos',    label: 'Modelos',    count: activos.length },
          { id: 'consumo',    label: 'Consumo',    count: consumo.length },
        ]}
        active={tab} onChange={setTab} ariaLabel="Secciones del asistente"
      />

      {tab === 'config' && (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Configuración global</h2>
        </div>
        <form onSubmit={guardarGlobal} className="config-form">
          <div className="grid-cols-2">
            <div className="input-group">
              <div className="form-label-with-help">
                <label htmlFor="ia-nombre">Nombre del agente</label>
                <FormHelp text="Lo ven todos los clientes. El cliente no puede cambiarlo." label="Quién ve el nombre del agente" />
              </div>
              <input id="ia-nombre" className="input" value={nombre} onChange={e => setNombre(e.target.value)}
                     placeholder="Claux" maxLength={40} />
            </div>
            <div className="input-group">
              <div className="form-label-with-help">
                <label htmlFor="ia-tono">Tono</label>
                <FormHelp text="Cómo se comunica el agente en las respuestas." label="Qué es el tono" />
              </div>
              <input id="ia-tono" className="input" value={ton} onChange={e => setTon(e.target.value)}
                     placeholder="cercano y directo, como un asesor de confianza" maxLength={80} />
            </div>
          </div>
          <div className="grid-cols-2">
            <div className="input-group">
              <div className="form-label-with-help">
                <label htmlFor="ia-prin">Modelo principal</label>
                <FormHelp text="El que usan los clientes por defecto." label="Qué es el modelo principal" />
              </div>
              <select id="ia-prin" className="input" value={prin} onChange={e => setPrin(e.target.value)}>
                {activos.map(m => <option key={m.id} value={m.id}>{m.nombre}{m.gratis ? '' : ' · pago'}</option>)}
              </select>
            </div>
            <div className="input-group">
              <div className="form-label-with-help">
                <label htmlFor="ia-fb">Respaldo gratis (al superar el cupo)</label>
                <FormHelp text="Si el principal es de pago, los clientes que superen su cupo del mes pasan a este." label="Cuándo se usa el respaldo" />
              </div>
              <select id="ia-fb" className="input" value={fb} onChange={e => setFb(e.target.value)}>
                {activosGratis.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>
          </div>
          <div className="input-group">
            <div className="form-label-with-help">
              <label htmlFor="ia-cupo">Cupo de reserva (conversaciones/mes)</label>
              <FormHelp text="El cupo de cada cliente lo fija su nivel (Ajustes → Niveles), y se puede subir cliente a cliente en su ficha. Este número solo entra si un nivel se quedara sin cupo definido." label="Cuándo se usa este cupo" />
            </div>
            <input id="ia-cupo" type="number" min="1" step="1" className="input"
                   value={cupo} onChange={e => setCupo(e.target.value)} />
          </div>

          {/* La IA que pagamos nosotros tiene su propia pestaña («Equipo»): es otro
              dinero, otro tope y otras reglas, y mezclada aquí se leía como un
              apéndice de la del cliente. */}
          {/* El botón vive en el pie pegado (`<BarraGuardar>`, abajo). El submit se queda
              para que Enter siga guardando desde cualquier campo. */}
        </form>
      </div>
      )}

      {/* ── Equipo: la IA que pagamos nosotros ── */}
      {tab === 'equipo' && (
      <>
      <div className="card mb-5">
        <div className="card-header">
          <h2 className="card-title">IA del equipo</h2>
          <span className={`badge ${activa ? 'badge-success' : 'badge-neutral'}`}>{activa ? 'Encendida' : 'Apagada'}</span>
        </div>
        <p className="config-field-hint mb-4">
          La que usamos nosotros desde el panel. La paga CLAUX, no sale del cupo de ningún
          cliente, y a diferencia de la del cliente aquí puede escribir: siempre enseñando
          antes qué va a cambiar, y siempre aplicándolo alguien.
        </p>

        <div className={activa ? 'ia-master' : 'ia-master ia-master--off'}>
          <span className="ia-master-info">
            <span className="ia-master-label"><IaSparkle size={15} strokeWidth={2} /> IA interna</span>
            <span className="ia-master-desc">
              {activa
                ? 'Las funciones de abajo pueden llamar al proveedor.'
                : 'Ninguna función llama al proveedor. Los botones lo dicen y no gastan.'}
            </span>
          </span>
          <label className="switch" title="Encender o apagar toda la IA interna">
            <input type="checkbox" checked={activa} disabled={isPending}
                   aria-label="Encender o apagar toda la IA interna"
                   onChange={e => guardarSwitches(e.target.checked, off)} />
            <span className="switch-track" aria-hidden="true" />
          </label>
        </div>

        <div className="grid-cols-2 mt-4">
          <div className="input-group">
            <div className="form-label-with-help">
              <label htmlFor="ia-int-model">Modelo del equipo</label>
              <FormHelp text="Aquí cabe el caro: lo usamos nosotros, no miles de clientes." label="Qué modelo usa el equipo" />
            </div>
            <select id="ia-int-model" className="input" value={mInt} onChange={e => setMInt(e.target.value)}>
              <option value="">El mismo que el principal</option>
              {activos.map(m => <option key={m.id} value={m.id}>{m.nombre}{m.gratis ? '' : ' · pago'}</option>)}
            </select>
          </div>
          <div className="input-group">
            <div className="form-label-with-help">
              <label htmlFor="ia-int-cupo">Tope del mes (conversaciones)</label>
              <FormHelp text="Un techo contra un bucle nuestro, no un ahorro: al llegar, las funciones con IA del panel se cortan hasta el mes que viene. Al cliente no se le corta nunca: baja al modelo gratis. Para apagarla, usa el interruptor de arriba." label="Qué pasa al llegar al tope" />
            </div>
            <input id="ia-int-cupo" type="number" min="0" step="10" className="input"
                   value={cInt} onChange={e => setCInt(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── Función por función ── */}
      <div className="card mb-5">
        <div className="card-header">
          <h2 className="card-title">Funciones</h2>
          <span className="badge badge-neutral">{FUNCIONES_IA.length - off.length} de {FUNCIONES_IA.length} encendidas</span>
        </div>
        <p className="config-field-hint">
          Apagar una función no es esconder su botón: la puerta se niega a llamar al
          proveedor, así que tampoco gasta por otro camino. Las marcadas como «escribe»
          pueden cambiar datos, siempre tras enseñar qué y con un clic de una persona.
        </p>

        {AREAS_FUNCIONES.map(area => (
          <div key={area} className="ia-fn-grupo">
            <span className="ia-fn-grupo-title">{area}</span>
            {FUNCIONES_IA.filter(f => f.area === area).map(f => {
              const encendida = !off.includes(f.clave)
              return (
                <div key={f.clave} className={activa ? 'ia-doc-row' : 'ia-doc-row ia-fn-row--inerte'}>
                  <div className="ia-doc-info">
                    <span className="ia-doc-label ia-cell-badges">
                      {f.label}
                      {f.escribe && <span className="badge badge-warning">escribe</span>}
                    </span>
                    <span className="ia-doc-desc">{f.descripcion}</span>
                  </div>
                  <label className="switch" title={`Encender o apagar: ${f.label}`}>
                    <input type="checkbox" checked={encendida} disabled={isPending}
                           aria-label={`Encender o apagar: ${f.label}`}
                           onChange={e => toggleFuncion(f.clave, e.target.checked)} />
                    <span className="switch-track" aria-hidden="true" />
                  </label>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── Lo que llevamos gastado ── */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Gasto del mes ({interno.periodo})</h2>
          <span className={`badge ${interno.agotado ? 'badge-error' : interno.cercaDelTope ? 'badge-warning' : 'badge-neutral'}`}>
            {interno.conversaciones.toLocaleString('es-ES')} / {interno.cupo.toLocaleString('es-ES')} conversaciones
          </span>
        </div>

        <div className="ia-uso-grid">
          <div className="ia-uso-item">
            <div className={`ia-uso-num ${interno.cercaDelTope ? 'ia-uso-warn' : ''}`}>{interno.conversaciones.toLocaleString('es-ES')}</div>
            <div className="ia-uso-lbl">Conversaciones</div>
          </div>
          <div className="ia-uso-item">
            <div className="ia-uso-num">{(interno.tokensIn + interno.tokensOut).toLocaleString('es-ES')}</div>
            <div className="ia-uso-lbl">Tokens</div>
          </div>
          <div className="ia-uso-item">
            <div className="ia-uso-num">{costeTotal == null ? '—' : formatearUsd(costeTotal)}</div>
            {/* Estimado, y dicho: la tarifa la tecleamos nosotros y el gasto se
                calcula con el modelo de HOY, aunque parte del mes fuera otro. */}
            <div className="ia-uso-lbl">
              {costeTotal == null ? `Sin tarifa (${modeloInternoNombre})` : `Coste estimado · ${modeloInternoNombre}`}
            </div>
          </div>
        </div>

        {interno.porOrigen.length === 0 ? (
          <div className="table-empty table-empty-sm">
            <p>{!activa
              ? 'La IA interna está apagada.'
              : interno.cupo === 0
                ? 'La IA interna no tiene tope asignado.'
                : 'El equipo no ha gastado IA este mes.'}</p>
          </div>
        ) : (
          <div className="table-wrapper table-wrapper-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>En qué se fue</th>
                  <th className="col-num">Conversaciones</th>
                  <th className="col-num">Tokens</th>
                  <th className="col-num">Coste</th>
                </tr>
              </thead>
              <tbody>
                {interno.porOrigen.map(o => {
                  const c = costeUsd(o.tokensIn, o.tokensOut, tarifaInterna)
                  return (
                    <tr key={o.origen}>
                      <td data-label="En qué se fue">{ETIQUETA_ORIGEN[o.origen as keyof typeof ETIQUETA_ORIGEN] ?? o.origen}</td>
                      <td data-label="Conversaciones" className="col-num">{o.conversaciones.toLocaleString('es-ES')}</td>
                      <td data-label="Tokens" className="col-num">{(o.tokensIn + o.tokensOut).toLocaleString('es-ES')}</td>
                      <td data-label="Coste" className="col-num">{c == null ? '—' : formatearUsd(c)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="col-num">{interno.conversaciones.toLocaleString('es-ES')}</td>
                  <td className="col-num">{(interno.tokensIn + interno.tokensOut).toLocaleString('es-ES')}</td>
                  <td className="col-num">{costeTotal == null ? '—' : formatearUsd(costeTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      {/* ── Documentos de Claux (personalidad + prompts por sección) ── */}
      {tab === 'documentos' && (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Documentos de {nombre || 'Claux'}</h2>
          <span className="badge badge-neutral">{documentos.length}</span>
        </div>
        <p className="config-field-hint mb-4">Textos que gobiernan cómo responde el asistente: su personalidad general y qué analiza en cada sección. Se editan en su propia ventana.</p>
        <div className="ia-doc-list">
          {documentos.map(d => (
            <div key={d.key} className="ia-doc-row">
              <div className="ia-doc-info">
                <span className="ia-doc-label">{d.label}</span>
                <span className="ia-doc-desc">{d.descripcion}</span>
              </div>
              <DocumentoIaModal docKey={d.key} label={d.label} descripcion={d.descripcion}
                                valor={d.valor} esPersonalidad={d.esPersonalidad} />
            </div>
          ))}
        </div>
      </div>
      )}

      {/* ── Catálogo de modelos ── */}
      {tab === 'modelos' && (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Modelos disponibles</h2>
          <div className="ia-cell-badges">
            <span className="badge badge-neutral">{activos.length} activos</span>
            <NuevoModeloIaModal />
          </div>
        </div>

        <div className="table-wrapper table-wrapper-flush">
          <table className="table">
            <thead>
              <tr><th>Modelo</th><th className="ia-col-id">ID</th><th>Tipo</th><th className="col-center">Activo</th><th>Estado</th><th className="col-actions" /></tr>
            </thead>
            <tbody>
              {modelos.map(m => { const pr = pruebas[m.id]; return (
                <tr key={m.id}>
                  <td data-label="Modelo"><span className="ia-cell-badges">{m.nombre}{m.id === principal && <span className="badge badge-info">principal</span>}</span></td>
                  <td data-label="ID" className="table-muted ia-col-id">{m.id}</td>
                  <td data-label="Tipo"><span className={`badge ${m.gratis ? 'badge-success' : 'badge-warning'}`}>{m.gratis ? 'Gratis' : 'Pago'}</span></td>
                  <td data-label="Activo" className="col-center">
                    <span className="switch">
                      <input type="checkbox" checked={m.activo} onChange={() => toggle(m.id, !m.activo)}
                             aria-label={`Activar ${m.nombre}`} disabled={isPending} />
                      <span className="switch-track" aria-hidden="true" />
                    </span>
                  </td>
                  <td data-label="Estado">
                    <span className="ia-cell-badges">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => probar(m.id)} disabled={pr === 'cargando'}>
                        {pr === 'cargando'
                          ? <Loader2 size={13} strokeWidth={2} className="img-upload-spin" />
                          : <Activity size={13} strokeWidth={2} />}
                        Probar
                      </button>
                      {pr === 'cargando' && (
                        <>
                          <span className="table-muted">
                            {(segundos[m.id] ?? 0) >= 15
                              ? `Tarda más de lo normal · ${segundos[m.id] ?? 0} s`
                              : `${segundos[m.id] ?? 0} s`}
                          </span>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => cancelarPrueba(m.id)}>
                            <X size={13} strokeWidth={2} />
                            Cancelar
                          </button>
                        </>
                      )}
                      {pr && pr !== 'cargando' && (
                        <span className={`badge ${TONO_PRUEBA[pr.estado]}`} title={tituloPrueba(pr)}>
                          {rotuloPrueba(pr)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="col-actions">
                    <RowActions label={`Acciones de ${m.nombre}`}>
                      <button type="button" className="row-actions-item" onClick={() => setEditando(m)}>
                        <Pencil size={15} strokeWidth={2} /> Editar
                      </button>
                      {m.id !== principal && m.id !== fallbackGratis && (
                        <button type="button" className="row-actions-item row-actions-item-danger"
                                onClick={() => setConfirmarBorrado(m)} disabled={isPending}>
                          <Trash2 size={14} strokeWidth={2} /> Eliminar
                        </button>
                      )}
                    </RowActions>
                  </td>
                </tr>
              ) })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ── Consumo del mes ── */}
      {tab === 'consumo' && (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Consumo del mes ({periodo})</h2>
          <span className="badge badge-neutral">{consumo.length} clientes con IA</span>
        </div>

        {consumo.length === 0 ? (
          <div className="table-empty table-empty-sm"><p>Ningún cliente con IA tiene consumo este mes.</p></div>
        ) : (
          <div className="table-wrapper table-wrapper-flush">
            <table className="table">
              <thead>
                <tr>
                  <ThOrden orden={ordConsumo} clave="nombre">Cliente</ThOrden>
                  <ThOrden orden={ordConsumo} clave="conversaciones" className="col-num">Conversaciones</ThOrden>
                  <ThOrden orden={ordConsumo} clave="tokens" className="col-num">Tokens</ThOrden>
                  <ThOrden orden={ordConsumo} clave="modelo">Modelo en uso</ThOrden>
                </tr>
              </thead>
              <tbody>
                {consumoItems.map(c => {
                  const pct = c.cupo > 0 ? Math.round((c.conversaciones / c.cupo) * 100) : 0
                  return (
                    <tr key={c.client_id}>
                      <td data-label="Cliente"><span className="cell-clamp">{c.nombre}</span></td>
                      <td data-label="Conversaciones" className="col-num">
                        <span className="ia-cell-badges">
                          <span>{c.conversaciones.toLocaleString('es-ES')} / {c.cupo.toLocaleString('es-ES')}</span>
                          <span className={`badge ${pct >= 100 ? 'badge-error' : pct >= 90 ? 'badge-warning' : 'badge-neutral'}`}>{pct}%</span>
                          {c.cupoPropio && <span className="badge badge-info">cupo propio</span>}
                        </span>
                      </td>
                      <td data-label="Tokens" className="col-num">{c.tokens.toLocaleString('es-ES')}</td>
                      <td data-label="Modelo en uso" className="table-muted">{c.modeloActual}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="col-num">{totalConv.toLocaleString('es-ES')}</td>
                  <td className="col-num">{totalTok.toLocaleString('es-ES')}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <TablePagination {...consumoPag} label="cliente" />
      </div>
      )}

      {/* En las dos pestañas que guardan campos siempre, y en las otras SOLO si dejaste
          algo sin guardar: si no, el pie sería una barra apagada bajo pestañas que no
          guardan nada. Lo pendiente te sigue; lo demás no estorba. Los interruptores no
          cuentan aquí: se guardan solos al pulsarlos. */}
      {(tab === 'config' || tab === 'equipo' || cambiosConfig > 0) && (
        <BarraGuardar
          cambios={cambiosConfig} guardando={isPending}
          onGuardar={() => guardarGlobal()} textoGuardar="Guardar configuración"
        />
      )}

      {editando && (
        <EditarModeloIaModal modelo={editando} onClose={() => setEditando(null)} />
      )}

      {confirmarBorrado && (
        <ConfirmDialog
          title={`¿Eliminar "${confirmarBorrado.nombre}"?`}
          body="Dejará de estar disponible para los clientes. Esta acción no se puede deshacer."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmarBorrado(null)}
          onConfirm={() => doEliminar(confirmarBorrado)}
        />
      )}
    </div>
  )
}
