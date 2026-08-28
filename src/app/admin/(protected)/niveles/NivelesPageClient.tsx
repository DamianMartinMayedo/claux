'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import CatalogoTabs from '@/components/admin/CatalogoTabs'
import { useToast } from '@/app/contexts/ToastContext'
import { guardarNivel, guardarLimites } from '@/app/actions/niveles'
import { NIVELES, type Nivel } from '@/lib/niveles'
import type { Dimension } from '@/lib/limites'

export type NivelFila = {
  clave:       Nivel
  nombre:      string
  descripcion: string | null
  orden:       number
  activo:      boolean
}

export type LimiteFila = {
  dimension: Dimension
  etiqueta:  string
  /** `null` = ilimitado. */
  base:      Record<Nivel, number | null>
}

/** Celda vacía = ilimitado; cualquier otra cosa, el número tal cual. */
function aTexto(v: number | null): string {
  return v === null || v === undefined ? '' : String(v)
}

export default function NivelesPageClient(
  { niveles: inicial, matriz: matrizInicial }: { niveles: NivelFila[]; matriz: LimiteFila[] },
) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError, loading: toastLoading } = useToast()

  const [niveles, setNiveles] = useState(inicial)
  // La matriz se edita como texto: el vacío tiene que sobrevivir al tecleo (un
  // número no sabe estar vacío) y es justo el valor que significa «ilimitado».
  const [celdas, setCeldas] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const f of matrizInicial) for (const n of NIVELES) m[`${n}|${f.dimension}`] = aTexto(f.base[n])
    return m
  })
  const [guardandoNiveles, empezarNiveles] = useTransition()
  const [guardandoLimites, empezarLimites] = useTransition()

  function editarNivel(clave: Nivel, campo: 'nombre' | 'descripcion' | 'activo', valor: string | boolean) {
    setNiveles(prev => prev.map(n => n.clave === clave ? { ...n, [campo]: valor } : n))
  }

  function handleGuardarNiveles() {
    const ld = toastLoading('Guardando niveles…')
    empezarNiveles(async () => {
      for (const n of niveles) {
        const fd = new FormData()
        fd.append('clave', n.clave)
        fd.append('nombre', n.nombre)
        fd.append('descripcion', n.descripcion ?? '')
        fd.append('activo', String(n.activo))
        const res = await guardarNivel(fd)
        if (!res.ok) { await ld.dismiss(); toastError(res.error ?? 'No se pudo guardar'); return }
      }
      await ld.dismiss()
      toastSuccess('Niveles guardados')
      router.refresh()
    })
  }

  function handleGuardarLimites() {
    const filas = matrizInicial.flatMap(f => NIVELES.map(n => {
      const txt = (celdas[`${n}|${f.dimension}`] ?? '').trim()
      return { nivel: n, dimension: f.dimension, base: txt === '' ? null : Number(txt) }
    }))
    if (filas.some(f => f.base !== null && !(f.base > 0))) {
      toastError('Un límite es un número mayor que cero. Déjalo vacío para «ilimitado».')
      return
    }
    const ld = toastLoading('Guardando límites…')
    empezarLimites(async () => {
      const fd = new FormData()
      fd.append('limites', JSON.stringify(filas))
      const res = await guardarLimites(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'No se pudo guardar'); return }
      toastSuccess('Límites guardados')
      router.refresh()
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Niveles y límites</h1>
          <p className="page-subtitle">
            Cómo se llama cada nivel de cara al cliente y cuánto cabe dentro.
            Se aplica a todos los clientes de ese nivel; para una excepción de uno solo, su ficha.
          </p>
        </div>
      </div>

      <CatalogoTabs />

      {/* ── Los tres niveles ── */}
      <div className="card mb-5">
        <div className="card-header">
          <h2 className="card-title">Los tres niveles</h2>
          <span className="text-xs-muted">La clave interna no cambia nunca; el nombre sí.</span>
        </div>

        <div className="niv-grid">
          {niveles.map(n => (
            <div className="niv-col" key={n.clave}>
              <span className="badge badge-neutral">{n.clave}</span>
              <div className="input-group">
                <label htmlFor={`niv-nombre-${n.clave}`}>Nombre</label>
                <input
                  id={`niv-nombre-${n.clave}`} className="input" value={n.nombre}
                  onChange={e => editarNivel(n.clave, 'nombre', e.target.value)}
                />
              </div>
              <div className="input-group">
                <label htmlFor={`niv-desc-${n.clave}`}>Descripción</label>
                <textarea
                  id={`niv-desc-${n.clave}`} className="input niv-desc" rows={3}
                  value={n.descripcion ?? ''}
                  onChange={e => editarNivel(n.clave, 'descripcion', e.target.value)}
                />
              </div>
              <label className="module-check">
                <input
                  type="checkbox" checked={n.activo}
                  onChange={e => editarNivel(n.clave, 'activo', e.target.checked)}
                />
                A la venta
              </label>
            </div>
          ))}
        </div>

        <div className="mod-footer">
          <button className="btn btn-primary btn-sm" onClick={handleGuardarNiveles} disabled={guardandoNiveles}>
            {guardandoNiveles ? <><span className="spinner" /> Guardando…</> : 'Guardar niveles'}
          </button>
        </div>
      </div>

      {/* ── La matriz ── */}
      <div className="card card-table">
        <div className="card-header">
          <h2 className="card-title">Cuánto cabe en cada nivel</h2>
          <span className="text-xs-muted">
            El botón ∞ quita el tope. Solo cuenta lo activo, y desarchivar cuenta como crear.
          </span>
        </div>

        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Dimensión</th>
                {niveles.map(n => <th className="col-num" key={n.clave}>{n.nombre}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrizInicial.map(f => (
                <tr key={f.dimension}>
                  <td data-label="Dimensión">
                    <span className="table-empresa cell-clamp">{f.etiqueta}</span>
                  </td>
                  {niveles.map(n => {
                    const id = `lim-${n.clave}-${f.dimension}`
                    const valor = celdas[`${n.clave}|${f.dimension}`] ?? ''
                    return (
                      <td className="col-num" data-label={n.nombre} key={n.clave}>
                        {/* El vacío es un valor con significado (ilimitado), así que
                            se dice con el marcador de posición en vez de dejarlo mudo.
                            Y con un botón al lado: «sin tope» se pone borrando el
                            número, que es un gesto que nadie adivina —sobre todo
                            para VOLVER a él después de haber tecleado una cifra por
                            error—. El botón sigue ahí, deshabilitado, cuando ya no
                            hay tope: si apareciera y desapareciera, la columna
                            entera bailaría a cada tecla. */}
                        <span className="niv-celda">
                          <input
                            id={id} className="input niv-limite-input" type="number" min="1" step="1"
                            value={valor} placeholder="∞"
                            aria-label={`${f.etiqueta} en ${n.nombre} — vacío es sin límite`}
                            onChange={e => setCeldas(prev => ({ ...prev, [`${n.clave}|${f.dimension}`]: e.target.value }))}
                          />
                          <button
                            type="button" className="niv-sin-tope" disabled={valor === ''}
                            title="Sin límite"
                            aria-label={`Quitar el tope de ${f.etiqueta} en ${n.nombre}`}
                            onClick={() => setCeldas(prev => ({ ...prev, [`${n.clave}|${f.dimension}`]: '' }))}
                          >
                            ∞
                          </button>
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mod-footer">
          <button className="btn btn-primary btn-sm" onClick={handleGuardarLimites} disabled={guardandoLimites}>
            {guardandoLimites ? <><span className="spinner" /> Guardando…</> : 'Guardar límites'}
          </button>
        </div>
      </div>
    </div>
  )
}
