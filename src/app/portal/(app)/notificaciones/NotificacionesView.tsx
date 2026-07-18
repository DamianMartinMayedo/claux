'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck, Archive, BellOff } from 'lucide-react'
import Tabs from '@/components/Tabs'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { IconoSeveridad, TiempoRelativo } from '@/components/portal/notificaciones/presentacion'
import { useNotificaciones } from '@/components/portal/notificaciones/NotificacionesContext'
import {
  listarNotificaciones, guardarPreferencia,
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

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notificaciones</h1>
          <p className="page-subtitle">
            Avisos de tu negocio. La bandeja es compartida: si la marcas leída, la ven leída todos los administradores.
          </p>
        </div>
      </div>

      <Tabs<Pestana>
        tabs={[
          { id: 'bandeja', label: 'Bandeja', count: noLeidas || undefined, countTone: 'warning' },
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
  const { leer, leerTodas, archivar, noLeidas } = useNotificaciones()
  const [filtro, setFiltro] = useState<FiltroBandeja>('todas')
  const [lista, setLista]   = useState(inicial)
  const [cargando, setCargando] = useState(false)
  const router = useRouter()

  async function cambiarFiltro(f: FiltroBandeja) {
    setFiltro(f)
    setCargando(true)
    setLista(await listarNotificaciones(f, 100))
    setCargando(false)
  }

  async function abrir(n: NotificacionFila) {
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
        {noLeidas > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
            void leerTodas()
            setLista(l => l.map(x => ({ ...x, estado: 'leida' as const })))
          }}>
            <CheckCheck size={14} strokeWidth={2} /> Marcar todas como leídas
          </button>
        )}
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
              <span className="ntf-item-icono"><IconoSeveridad severidad={n.severidad} size={18} /></span>
              <button type="button" className="ntf-fila-cuerpo" onClick={() => void abrir(n)}>
                <span className="ntf-item-titulo">{n.titulo}</span>
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
    startTransition(async () => {
      const r = await guardarPreferencia(tipo, activa, severidad)
      if (!r.ok) {
        setFilas(previas)
        toastError('No se pudo guardar la preferencia.')
        return
      }
      toastSuccess('Preferencia guardada.')
    })
  }

  return (
    <div className="card">
      <p className="ntf-prefs-intro">
        Elige de qué te avisamos y con cuánta insistencia. <strong>Solo en la campana</strong> no interrumpe;
        <strong> Aviso flotante</strong> aparece un momento en pantalla; <strong>Urgente</strong> se queda hasta que lo atiendas.
      </p>

      {agrupar(filas).map(([categoria, delGrupo]) => (
        <section key={categoria} className="ntf-prefs-grupo">
          <h2 className="ntf-prefs-titulo">{ETIQUETA_CATEGORIA[categoria]}</h2>
          <ul className="ntf-prefs">
            {delGrupo.map(f => (
              <PrefFila key={f.tipo} f={f} isPending={isPending} onGuardar={guardar} />
            ))}
          </ul>
        </section>
      ))}
    </div>
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
