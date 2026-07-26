'use client'

import { useState, useTransition } from 'react'
import { ChevronDown } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import {
  guardarPreferenciaAviso, guardarPreferenciasAvisosLote,
  type PreferenciaAvisoFila,
} from '@/app/actions/admin/notificaciones'
import { ETIQUETA_CATEGORIA_ADMIN, type CategoriaAdmin, type TipoAvisoClave } from '@/lib/notificaciones/admin/catalogo'
import { ETIQUETA_SEVERIDAD, type Severidad } from '@/lib/notificaciones/catalogo'

// Preferencias de la bandeja del equipo. Mismo patrón que en el portal: categorías
// plegables (son ~13 tipos y desplegados de golpe la pestaña es un muro) con un
// interruptor de grupo, que es lo que de verdad quiere quien entra aquí.
//
// Son del EQUIPO, no de cada persona: solo super_admin llega a esta pestaña.

const SEVERIDADES: Severidad[] = ['info', 'aviso', 'urgente']

export default function PreferenciasAvisos({ inicial }: { inicial: PreferenciaAvisoFila[] }) {
  const [filas, setFilas] = useState(inicial)
  const [isPending, startTransition] = useTransition()

  function guardar(tipo: TipoAvisoClave, activa: boolean, severidad: Severidad) {
    const previas = filas
    setFilas(fs => fs.map(f => (f.tipo === tipo ? { ...f, activa, severidad } : f)))
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const r = await guardarPreferenciaAviso(tipo, activa, severidad)
      await ld.dismiss()
      if (!r.ok) {
        setFilas(previas)
        toastError('No se pudo guardar la preferencia.')
        return
      }
      toastSuccess('Preferencia guardada.')
    })
  }

  function guardarGrupo(categoria: CategoriaAdmin, activa: boolean) {
    const tipos = filas.filter(f => f.categoria === categoria).map(f => f.tipo)
    const previas = filas
    setFilas(fs => fs.map(f => (f.categoria === categoria ? { ...f, activa } : f)))
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const r = await guardarPreferenciasAvisosLote(tipos, activa)
      await ld.dismiss()
      if (!r.ok) {
        setFilas(previas)
        toastError('No se pudo guardar el grupo.')
        return
      }
      toastSuccess(activa
        ? `Avisos de ${ETIQUETA_CATEGORIA_ADMIN[categoria].toLowerCase()} activados.`
        : `Avisos de ${ETIQUETA_CATEGORIA_ADMIN[categoria].toLowerCase()} desactivados.`)
    })
  }

  return (
    <div className="card">
      <p className="ntf-prefs-intro">
        Elige de qué avisamos al equipo y con cuánta insistencia. <strong>Solo en la campana</strong> no interrumpe;
        <strong> Aviso flotante</strong> aparece un momento en pantalla; <strong>Urgente</strong> se queda hasta que
        alguien lo atienda. Afecta a todo el equipo, no solo a ti.
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

function GrupoPrefs({ categoria, filas, isPending, onGuardar, onGuardarGrupo }: {
  categoria: CategoriaAdmin
  filas: PreferenciaAvisoFila[]
  isPending: boolean
  onGuardar: (tipo: TipoAvisoClave, activa: boolean, severidad: Severidad) => void
  onGuardarGrupo: (categoria: CategoriaAdmin, activa: boolean) => void
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
          <span className="ntf-prefs-titulo">{ETIQUETA_CATEGORIA_ADMIN[categoria]}</span>
          <span className="ntf-prefs-conteo">
            {ninguna ? 'Ninguno activo' : todas ? `${filas.length} activos` : `${activas} de ${filas.length}`}
          </span>
        </button>

        <label className="switch" title={`Activar o desactivar todo: ${ETIQUETA_CATEGORIA_ADMIN[categoria]}`}>
          <input
            type="checkbox"
            checked={!ninguna}
            disabled={isPending}
            aria-label={`Activar todo el grupo: ${ETIQUETA_CATEGORIA_ADMIN[categoria]}`}
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

/** Agrupa por categoría, en el orden en que salen del catálogo. */
function agrupar(filas: PreferenciaAvisoFila[]): [CategoriaAdmin, PreferenciaAvisoFila[]][] {
  const mapa = new Map<CategoriaAdmin, PreferenciaAvisoFila[]>()
  for (const f of filas) {
    if (!mapa.has(f.categoria)) mapa.set(f.categoria, [])
    mapa.get(f.categoria)!.push(f)
  }
  return [...mapa.entries()]
}

function PrefFila({ f, isPending, onGuardar }: {
  f: PreferenciaAvisoFila
  isPending: boolean
  onGuardar: (tipo: TipoAvisoClave, activa: boolean, severidad: Severidad) => void
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
