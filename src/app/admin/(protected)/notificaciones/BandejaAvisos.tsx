'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck, Archive, BellOff } from 'lucide-react'
import BulkBar from '@/components/portal/BulkBar'
import { avisarNavegacion } from '@/components/portal/TopLoader'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { IconoSeveridad, TiempoRelativo } from '@/components/portal/notificaciones/presentacion'
import { useAvisos } from '@/components/admin/notificaciones/AvisosContext'
import {
  listarAvisos, marcarAvisosLeidosLote, archivarAvisosLote,
  type AvisoAdminFila, type FiltroBandejaAdmin,
} from '@/app/actions/admin/notificaciones'
import {
  CATALOGO_ADMIN, tiposAdminImplementados, ETIQUETA_CATEGORIA_ADMIN,
} from '@/lib/notificaciones/admin/catalogo'

// Bandeja del equipo. Es la misma vista que la del portal (misma lista, mismos
// filtros, mismas acciones en lote) apuntando a las acciones del admin.

// Los filtros salen del catálogo, no de una lista a mano: al enganchar un tipo
// nuevo su categoría aparece sola.
const FILTROS: { id: FiltroBandejaAdmin; label: string }[] = [
  { id: 'todas',     label: 'Todos' },
  { id: 'no_leidas', label: 'Sin leer' },
  ...[...new Set(tiposAdminImplementados().map(t => CATALOGO_ADMIN[t].categoria))]
    .map(c => ({ id: c as FiltroBandejaAdmin, label: ETIQUETA_CATEGORIA_ADMIN[c] })),
]

export default function BandejaAvisos({ inicial }: { inicial: AvisoAdminFila[] }) {
  const { leer, leerTodas, archivar, refrescar, noLeidas } = useAvisos()
  const [filtro, setFiltro] = useState<FiltroBandejaAdmin>('todas')
  const [lista, setLista]   = useState(inicial)
  const [cargando, setCargando] = useState(false)
  const [, startTransition] = useTransition()
  const router = useRouter()

  const sel = useRowSelection(lista.map(a => String(a.id)))

  async function cambiarFiltro(f: FiltroBandejaAdmin) {
    setFiltro(f)
    setCargando(true)
    sel.clear()   // la selección era de la lista anterior
    setLista(await listarAvisos(f, 100))
    setCargando(false)
  }

  // Acciones en lote: se aplican en local y se confirman contra el servidor.
  function enLote(accion: 'leer' | 'archivar') {
    const ids = sel.selectedIds.map(Number)
    if (ids.length === 0) return
    sel.clear()
    if (accion === 'leer') {
      setLista(l => l.map(a => (ids.includes(a.id) ? { ...a, estado: 'leida' as const } : a)))
    } else {
      setLista(l => l.filter(a => !ids.includes(a.id)))
    }
    const ld = toastLoading(accion === 'leer' ? 'Marcando…' : 'Archivando…')
    startTransition(async () => {
      const r = accion === 'leer' ? await marcarAvisosLeidosLote(ids) : await archivarAvisosLote(ids)
      await ld.dismiss()
      if (!r.ok) {
        toastError('No se pudo completar la acción.')
        // Deshacer el optimismo: manda el servidor. Si no, quedarían filas
        // archivadas solo en pantalla.
        setLista(await listarAvisos(filtro, 100))
        return
      }
      toastSuccess(accion === 'leer'
        ? `${ids.length} marcado${ids.length === 1 ? '' : 's'} como leído${ids.length === 1 ? '' : 's'}.`
        : `${ids.length} archivado${ids.length === 1 ? '' : 's'}.`)
      void refrescar()
    })
  }

  async function abrir(a: AvisoAdminFila) {
    // La barra de carga primero: marcar leído es una ida y vuelta al servidor y sin
    // esto el clic se queda mudo hasta que llega la página nueva.
    if (a.enlace) avisarNavegacion()
    if (a.estado === 'nueva') {
      await leer(a.id)
      setLista(l => l.map(x => (x.id === a.id ? { ...x, estado: 'leida' } : x)))
    }
    if (a.enlace) router.push(a.enlace)
  }

  async function quitar(a: AvisoAdminFila) {
    setLista(l => l.filter(x => x.id !== a.id))
    await archivar(a.id)
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
              <CheckCheck size={14} strokeWidth={2} /> Marcar todos como leídos
            </button>
          )}
        </div>
      </div>

      {lista.length === 0 ? (
        <div className="ntf-vacio-bloque">
          <BellOff size={28} strokeWidth={1.5} />
          <p>{filtro === 'no_leidas'
            ? 'No hay avisos sin leer.'
            : 'Aquí aparecerán los avisos del equipo: leads, soporte, cobros y plataforma.'}</p>
        </div>
      ) : (
        <ul className="ntf-lista">
          {lista.map(a => (
            <li
              key={a.id}
              className={`ntf-fila ntf-sev-${a.severidad}${a.estado === 'nueva' ? ' ntf-item-nueva' : ''}`}
            >
              <input
                type="checkbox"
                className="row-check ntf-fila-check"
                checked={sel.isSelected(String(a.id))}
                onChange={() => sel.toggle(String(a.id))}
                aria-label={`Seleccionar: ${a.titulo}`}
              />
              <span className="ntf-item-icono"><IconoSeveridad severidad={a.severidad} size={18} /></span>
              <button type="button" className="ntf-fila-cuerpo" onClick={() => void abrir(a)}>
                <span className="ntf-item-linea">
                  {a.estado === 'nueva' && <span className="ntf-punto" aria-hidden="true" />}
                  <span className="ntf-item-titulo">{a.titulo}</span>
                </span>
                {a.cuerpo && <span className="ntf-fila-texto">{a.cuerpo}</span>}
                <TiempoRelativo iso={a.created_at} />
              </button>
              <button
                type="button"
                className="ntf-fila-archivar"
                onClick={() => void quitar(a)}
                aria-label="Archivar aviso"
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
          <CheckCheck size={14} strokeWidth={2} /> Marcar leídos
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => enLote('archivar')}>
          <Archive size={14} strokeWidth={2} /> Archivar
        </button>
      </BulkBar>
    </div>
  )
}
