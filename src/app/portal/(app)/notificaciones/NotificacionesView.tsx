'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck, Archive, BellOff, ArrowLeft, ChevronDown } from 'lucide-react'
import Tabs from '@/components/Tabs'
import BulkBar from '@/components/portal/BulkBar'
import { avisarNavegacion } from '@/components/portal/TopLoader'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { IconoSeveridad, TiempoRelativo } from '@/components/portal/notificaciones/presentacion'
import { useNotificaciones } from '@/components/portal/notificaciones/NotificacionesContext'
import {
  listarNotificaciones, guardarPreferencia, guardarPreferenciasLote,
  marcarLeidasLote, archivarLote,
  type NotificacionFila, type PreferenciaFila, type FiltroBandeja,
} from '@/app/actions/portal/notificaciones'
import {
  CATALOGO, tiposImplementados, ETIQUETA_CATEGORIA, ETIQUETA_SEVERIDAD,
  type Categoria, type Severidad, type TipoClave,
} from '@/lib/notificaciones/catalogo'

type Pestana = 'bandeja' | 'preferencias'

const SEVERIDADES: Severidad[] = ['info', 'aviso', 'urgente']

export default function NotificacionesView({
  inicial, preferencias,
}: {
  inicial: NotificacionFila[]
  preferencias: PreferenciaFila[]
}) {
  const [pestana, setPestana] = useState<Pestana>('bandeja')
  const { noLeidas } = useNotificaciones()
  const router = useRouter()

  // Aquí se entra desde CUALQUIER página (la campana está en la cabecera, y hay
  // acceso desde el menú de cuenta), así que "volver" es el historial, no un
  // padre fijo. Si se llegó por URL directa no hay historial: al panel.
  function volver() {
    if (window.history.length > 1) router.back()
    else router.push('/portal/dashboard')
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <button type="button" className="volver-link" onClick={volver}>
            <ArrowLeft size={16} strokeWidth={2} /> Volver
          </button>
          <h1 className="page-title">Notificaciones</h1>
          <p className="page-subtitle">
            Avisos de tu negocio. La bandeja es compartida: si la marcas leída, la ven leída todos los administradores.
          </p>
        </div>
      </div>

      <Tabs<Pestana>
        tabs={[
          // Sin `countTone`: el conteo se queda con el tono por defecto, que en la
          // pestaña activa ya es primary. Mismo criterio que el badge de la
          // campana — el número dice cuántas hay, no que sean una alarma.
          { id: 'bandeja', label: 'Bandeja', count: noLeidas || undefined },
          { id: 'preferencias', label: 'Preferencias' },
        ]}
        active={pestana}
        onChange={setPestana}
        ariaLabel="Secciones de notificaciones"
      />

      {pestana === 'bandeja'
        ? <Bandeja inicial={inicial} />
        : <Preferencias inicial={preferencias} />}
    </div>
  )
}

// ── Bandeja ───────────────────────────────────────────────────────────────────

// Las categorías salen del catálogo, no de una lista a mano: al implementar un
// generador nuevo su filtro aparece solo, sin que nadie se acuerde de tocar esto.
const FILTROS: { id: FiltroBandeja; label: string }[] = [
  { id: 'todas',     label: 'Todas' },
  { id: 'no_leidas', label: 'Sin leer' },
  ...[...new Set(tiposImplementados().map(t => CATALOGO[t].categoria))]
    .map(c => ({ id: c as FiltroBandeja, label: ETIQUETA_CATEGORIA[c] })),
]

function Bandeja({ inicial }: { inicial: NotificacionFila[] }) {
  const { leer, leerTodas, archivar, refrescar, noLeidas } = useNotificaciones()
  const [filtro, setFiltro] = useState<FiltroBandeja>('todas')
  const [lista, setLista]   = useState(inicial)
  const [cargando, setCargando] = useState(false)
  const [, startTransition] = useTransition()
  const router = useRouter()

  const sel = useRowSelection(lista.map(n => String(n.id)))

  async function cambiarFiltro(f: FiltroBandeja) {
    setFiltro(f)
    setCargando(true)
    sel.clear()   // la selección era de la lista anterior
    setLista(await listarNotificaciones(f, 100))
    setCargando(false)
  }

  // Acciones en lote. Se aplican en local y se confirman contra el servidor:
  // en una conexión lenta, esperar el ida y vuelta para ver el cambio se siente
  // roto (CONTEXTO §7).
  function enLote(accion: 'leer' | 'archivar') {
    const ids = sel.selectedIds.map(Number)
    if (ids.length === 0) return
    sel.clear()
    if (accion === 'leer') {
      setLista(l => l.map(n => (ids.includes(n.id) ? { ...n, estado: 'leida' as const } : n)))
    } else {
      setLista(l => l.filter(n => !ids.includes(n.id)))
    }
    const ld = toastLoading(accion === 'leer' ? 'Marcando…' : 'Archivando…')
    startTransition(async () => {
      const r = accion === 'leer' ? await marcarLeidasLote(ids) : await archivarLote(ids)
      await ld.dismiss()
      if (!r.ok) {
        toastError('No se pudo completar la acción.')
        // Deshacer el optimismo: la lista se recarga del servidor, que es quien
        // tiene razón. Si no, quedarían filas archivadas solo en pantalla.
        setLista(await listarNotificaciones(filtro, 100))
        return
      }
      toastSuccess(accion === 'leer'
        ? `${ids.length} marcada${ids.length === 1 ? '' : 's'} como leída${ids.length === 1 ? '' : 's'}.`
        : `${ids.length} archivada${ids.length === 1 ? '' : 's'}.`)
      void refrescar()
    })
  }

  async function abrir(n: NotificacionFila) {
    // La barra de carga primero: marcar leída es una ida y vuelta al servidor y
    // sin esto el clic se queda mudo hasta que llega la página nueva.
    if (n.enlace) avisarNavegacion()
    if (n.estado === 'nueva') {
      await leer(n.id)
      setLista(l => l.map(x => (x.id === n.id ? { ...x, estado: 'leida' } : x)))
    }
    if (n.enlace) router.push(n.enlace)
  }

  async function quitar(n: NotificacionFila) {
    setLista(l => l.filter(x => x.id !== n.id))
    await archivar(n.id)
  }

  return (
    <div className="card">
      <div className="ntf-filtros">
        <div className="ntf-filtros-grupo">
          {FILTROS.map(f => (
            <button
              key={f.id}
              type="button"
              className={`ntf-filtro${filtro === f.id ? ' active' : ''}`}
              onClick={() => void cambiarFiltro(f.id)}
              disabled={cargando}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ntf-filtros-acciones">
          {lista.length > 0 && (
            <label className="filtro-toggle">
              <input
                type="checkbox"
                className="row-check"
                checked={sel.allSelected}
                ref={el => { if (el) el.indeterminate = sel.someSelected }}
                onChange={sel.toggleAll}
              />
              Seleccionar todo
            </label>
          )}
          {noLeidas > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
              void leerTodas()
              setLista(l => l.map(x => ({ ...x, estado: 'leida' as const })))
            }}>
              <CheckCheck size={14} strokeWidth={2} /> Marcar todas como leídas
            </button>
          )}
        </div>
      </div>

      {lista.length === 0 ? (
        <div className="ntf-vacio-bloque">
          <BellOff size={28} strokeWidth={1.5} />
          <p>{filtro === 'no_leidas' ? 'No tienes notificaciones sin leer.' : 'Aquí aparecerán los avisos de tu negocio.'}</p>
        </div>
      ) : (
        <ul className="ntf-lista">
          {lista.map(n => (
            <li
              key={n.id}
              className={`ntf-fila ntf-sev-${n.severidad}${n.estado === 'nueva' ? ' ntf-item-nueva' : ''}`}
            >
              <input
                type="checkbox"
                className="row-check ntf-fila-check"
                checked={sel.isSelected(String(n.id))}
                onChange={() => sel.toggle(String(n.id))}
                aria-label={`Seleccionar: ${n.titulo}`}
              />
              <span className="ntf-item-icono"><IconoSeveridad severidad={n.severidad} size={18} /></span>
              <button type="button" className="ntf-fila-cuerpo" onClick={() => void abrir(n)}>
                <span className="ntf-item-linea">
                  {n.estado === 'nueva' && <span className="ntf-punto" aria-hidden="true" />}
                  <span className="ntf-item-titulo">{n.titulo}</span>
                </span>
                {n.cuerpo && <span className="ntf-fila-texto">{n.cuerpo}</span>}
                <TiempoRelativo iso={n.created_at} />
              </button>
              <button
                type="button"
                className="ntf-fila-archivar"
                onClick={() => void quitar(n)}
                aria-label="Archivar notificación"
                title="Archivar"
              >
                <Archive size={15} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <BulkBar count={sel.count} onClear={sel.clear}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => enLote('leer')}>
          <CheckCheck size={14} strokeWidth={2} /> Marcar leídas
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => enLote('archivar')}>
          <Archive size={14} strokeWidth={2} /> Archivar
        </button>
      </BulkBar>
    </div>
  )
}

// ── Preferencias ──────────────────────────────────────────────────────────────

function Preferencias({ inicial }: { inicial: PreferenciaFila[] }) {
  const [filas, setFilas] = useState(inicial)
  const [isPending, startTransition] = useTransition()

  function guardar(tipo: TipoClave, activa: boolean, severidad: Severidad) {
    const previas = filas
    setFilas(fs => fs.map(f => (f.tipo === tipo ? { ...f, activa, severidad } : f)))
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const r = await guardarPreferencia(tipo, activa, severidad)
      await ld.dismiss()
      if (!r.ok) {
        setFilas(previas)
        toastError('No se pudo guardar la preferencia.')
        return
      }
      toastSuccess('Preferencia guardada.')
    })
  }

  function guardarGrupo(categoria: Categoria, activa: boolean) {
    const tipos = filas.filter(f => f.categoria === categoria).map(f => f.tipo)
    const previas = filas
    setFilas(fs => fs.map(f => (f.categoria === categoria ? { ...f, activa } : f)))
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const r = await guardarPreferenciasLote(tipos, activa)
      await ld.dismiss()
      if (!r.ok) {
        setFilas(previas)
        toastError('No se pudo guardar el grupo.')
        return
      }
      toastSuccess(activa
        ? `Avisos de ${ETIQUETA_CATEGORIA[categoria].toLowerCase()} activados.`
        : `Avisos de ${ETIQUETA_CATEGORIA[categoria].toLowerCase()} desactivados.`)
    })
  }

  return (
    <div className="card">
      <p className="ntf-prefs-intro">
        Elige de qué te avisamos y con cuánta insistencia. <strong>Solo en la campana</strong> no interrumpe;
        <strong> Aviso flotante</strong> aparece un momento en pantalla; <strong>Urgente</strong> se queda hasta que lo atiendas.
      </p>

      {agrupar(filas).map(([categoria, delGrupo]) => (
        <GrupoPrefs
          key={categoria}
          categoria={categoria}
          filas={delGrupo}
          isPending={isPending}
          onGuardar={guardar}
          onGuardarGrupo={guardarGrupo}
        />
      ))}
    </div>
  )
}

/**
 * Categoría plegable. Empieza cerrada: son ~20 tipos y desplegados de golpe la
 * pestaña es un muro. El interruptor de la cabecera enciende o apaga el grupo
 * entero — es lo que de verdad quiere quien entra aquí ("no me avises de nada
 * de inventario"), sin tener que tocar cinco switches.
 */
function GrupoPrefs({ categoria, filas, isPending, onGuardar, onGuardarGrupo }: {
  categoria: Categoria
  filas: PreferenciaFila[]
  isPending: boolean
  onGuardar: (tipo: TipoClave, activa: boolean, severidad: Severidad) => void
  onGuardarGrupo: (categoria: Categoria, activa: boolean) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const activas = filas.filter(f => f.activa).length
  const todas   = activas === filas.length
  const ninguna = activas === 0

  return (
    <section className="ntf-prefs-grupo">
      <div className="ntf-prefs-cabecera">
        <button
          type="button"
          className="ntf-prefs-toggle"
          onClick={() => setAbierto(a => !a)}
          aria-expanded={abierto}
        >
          <ChevronDown size={16} strokeWidth={2} className={abierto ? 'ntf-chevron abierto' : 'ntf-chevron'} />
          <span className="ntf-prefs-titulo">{ETIQUETA_CATEGORIA[categoria]}</span>
          <span className="ntf-prefs-conteo">
            {ninguna ? 'Ninguna activa' : todas ? `${filas.length} activas` : `${activas} de ${filas.length}`}
          </span>
        </button>

        <label className="switch" title={`Activar o desactivar todo: ${ETIQUETA_CATEGORIA[categoria]}`}>
          <input
            type="checkbox"
            checked={!ninguna}
            disabled={isPending}
            aria-label={`Activar todo el grupo: ${ETIQUETA_CATEGORIA[categoria]}`}
            onChange={e => onGuardarGrupo(categoria, e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
        </label>
      </div>

      {abierto && (
        <ul className="ntf-prefs">
          {filas.map(f => (
            <PrefFila key={f.tipo} f={f} isPending={isPending} onGuardar={onGuardar} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** Agrupa las preferencias por categoría, en el orden en que salen del catálogo. */
function agrupar(filas: PreferenciaFila[]): [Categoria, PreferenciaFila[]][] {
  const mapa = new Map<Categoria, PreferenciaFila[]>()
  for (const f of filas) {
    if (!mapa.has(f.categoria)) mapa.set(f.categoria, [])
    mapa.get(f.categoria)!.push(f)
  }
  return [...mapa.entries()]
}

function PrefFila({ f, isPending, onGuardar }: {
  f: PreferenciaFila
  isPending: boolean
  onGuardar: (tipo: TipoClave, activa: boolean, severidad: Severidad) => void
}) {
  return (
    <li className="ntf-pref">
      <div className="ntf-pref-texto">
        <span className="ntf-pref-etiqueta">{f.etiqueta}</span>
        <span className="ntf-pref-desc">{f.descripcion}</span>
      </div>

      <div className="ntf-pref-controles">
        <select
          className="input ntf-pref-select"
          value={f.severidad}
          disabled={!f.activa || isPending}
          aria-label={`Nivel de aviso para: ${f.etiqueta}`}
          onChange={e => onGuardar(f.tipo, f.activa, e.target.value as Severidad)}
        >
          {SEVERIDADES.map(s => (
            <option key={s} value={s}>{ETIQUETA_SEVERIDAD[s]}</option>
          ))}
        </select>

        <label className="switch">
          <input
            type="checkbox"
            checked={f.activa}
            disabled={isPending}
            aria-label={`Activar: ${f.etiqueta}`}
            onChange={e => onGuardar(f.tipo, e.target.checked, f.severidad)}
          />
          <span className="switch-track" aria-hidden="true" />
        </label>
      </div>
    </li>
  )
}
