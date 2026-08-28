'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarLimitesOverride } from '@/app/actions/clientes'
import type { UsoDimension } from '@/lib/limites'

export interface FilaCapacidad extends UsoDimension {
  /** Excepción de este cliente. `null` = manda el límite del nivel. */
  override: number | null
  motivo: string
}

// El límite que se pinta ya viene con la excepción aplicada (`usoDeLimites`), así
// que la columna «Del nivel» solo tiene sentido cuando hay excepción: si no, sería
// el mismo número dos veces.
export default function CapacidadTabla({
  clientId, nivelNombre, filas,
}: { clientId: string; nivelNombre: string; filas: FilaCapacidad[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editando, setEditando] = useState(false)
  // Como strings: «vacío» tiene que sobrevivir a que lo escriban.
  const [valores, setValores] = useState<Record<string, string>>(
    () => Object.fromEntries(filas.map(f => [f.dimension, f.override != null ? String(f.override) : ''])),
  )
  const [motivos, setMotivos] = useState<Record<string, string>>(
    () => Object.fromEntries(filas.map(f => [f.dimension, f.motivo])),
  )

  const excedidas = filas.filter(f => f.excedido)
  const cercanas  = filas.filter(f => f.cerca)

  function guardar() {
    const overrides = filas.map(f => {
      const v = (valores[f.dimension] ?? '').trim()
      return {
        dimension: f.dimension,
        valor: v === '' ? null : Number(v),
        motivo: (motivos[f.dimension] ?? '').trim(),
      }
    })
    const fd = new FormData()
    fd.append('client_id', clientId)
    fd.append('overrides', JSON.stringify(overrides))

    startTransition(async () => {
      const r = await guardarLimitesOverride(fd)
      if (!r.ok) { toastError(r.error ?? 'No se pudo guardar'); return }
      const n = overrides.filter(o => o.valor !== null).length
      toastSuccess(n ? `${n} excepci${n === 1 ? 'ón' : 'ones'} de límite` : 'Sin excepciones: manda el nivel')
      setEditando(false)
      router.refresh()
    })
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Capacidad del nivel</h2>
        <span className={`badge ${excedidas.length ? 'badge-error' : cercanas.length ? 'badge-warning' : 'badge-neutral'}`}>
          {excedidas.length
            ? `${excedidas.length} por encima`
            : cercanas.length
              ? `${cercanas.length} al límite`
              : 'Con sitio de sobra'}
        </span>
      </div>

      {/* El aire lo pone el párrafo, no la tabla: `.table-wrapper-flush` anula
          `margin-top` con `!important` y cualquier `mt-*` que se le ponga muere ahí. */}
      <p className="text-sm-muted mb-4">
        Lo que cabe en el nivel {nivelNombre}, contando solo lo activo. Una excepción
        deja a este cliente por encima de su nivel sin subirle la factura.
      </p>

      {excedidas.length > 0 && (
        <div className="alert alert-warning">
          <strong className="alert-titulo">Está por encima en {excedidas.length}</strong>
          {excedidas.map(f => `${f.etiqueta} (${f.usado} de ${f.limite})`).join(' · ')}.
          No se le rompe nada: sigue trabajando, pero no puede añadir más de eso.
        </div>
      )}

      <div className="table-wrapper table-wrapper-flush">
        <table className="table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="col-num">En uso</th>
              <th className="col-num">Tope</th>
              <th>{editando ? 'Excepción' : 'Estado'}</th>
              {editando && <th>Motivo</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.dimension}>
                <td data-label="Concepto">
                  {f.etiqueta.charAt(0).toUpperCase() + f.etiqueta.slice(1)}
                  {f.override != null && !editando && <span className="badge badge-neutral cap-badge">Excepción</span>}
                </td>
                <td data-label="En uso" className="col-num">{f.usado.toLocaleString('es-ES')}</td>
                <td data-label="Tope" className="col-num">
                  {f.limite === null ? 'Sin tope' : f.limite.toLocaleString('es-ES')}
                </td>
                {editando ? (
                  <>
                    <td data-label="Excepción">
                      <input
                        type="number" min="1" step="1" className="input cap-input"
                        value={valores[f.dimension] ?? ''}
                        onChange={e => setValores(v => ({ ...v, [f.dimension]: e.target.value }))}
                        placeholder="Del nivel"
                        aria-label={`Excepción de ${f.etiqueta}. Vacío: manda el límite del nivel.`}
                      />
                    </td>
                    <td data-label="Motivo">
                      <input
                        type="text" className="input" maxLength={120}
                        value={motivos[f.dimension] ?? ''}
                        onChange={e => setMotivos(m => ({ ...m, [f.dimension]: e.target.value }))}
                        placeholder="Por qué"
                        aria-label={`Motivo de la excepción de ${f.etiqueta}`}
                      />
                    </td>
                  </>
                ) : (
                  <td data-label="Estado">
                    {f.limite === null
                      ? <span className="table-muted">Ilimitado</span>
                      : f.excedido
                        ? <span className="badge badge-error">Por encima</span>
                        : f.cerca
                          ? <span className="badge badge-warning">Queda {f.limite - f.usado}</span>
                          : <span className="table-muted">Le quedan {f.limite - f.usado}</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs-hint mt-4">
        Las conversaciones de IA van aparte, en la tarjeta «Asistente IA».
      </p>

      <div className="mod-footer">
        {editando ? (
          <>
            <button type="button" className="btn btn-secondary btn-sm" disabled={isPending}
                    onClick={() => setEditando(false)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={isPending} onClick={guardar}>
              {isPending ? <><span className="spinner" /> Guardando...</> : 'Guardar excepciones'}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando(true)}>
            Poner una excepción
          </button>
        )}
      </div>
    </div>
  )
}
