'use client'

// ── «Comprar lo que falta» ──
//
// Antes era un botón que creaba borradores a ciegas: elegía «el primer almacén activo»
// —con seis almacenes, una lotería—, se saltaba en silencio todo producto sin proveedor
// y, como en un catálogo real casi ninguno lo tiene puesto, acababa en un toast de error
// y ninguna compra. Parecía que no hacía nada, y en la práctica no lo hacía.
//
// Ahora es lo que tenía que ser: se ELIGE el almacén (con cuántas referencias le faltan
// a cada uno), se ve la lista con lo que hay, el mínimo y a quién se le compra, se
// desmarca lo que no se quiera y entonces se crean los borradores. Regla de UI: acción
// con consecuencias ⇒ resumen y confirmación explícita.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { X, ShoppingCart } from 'lucide-react'
import { toastError, toastSuccess, toastLoading, toastWarning } from '@/app/contexts/ToastContext'
import {
  previsualizarReposicion, crearComprasDeReposicion,
  type PreviewReposicion,
} from '@/app/actions/portal/compras'

export function ReposicionModal({
  onCerrar, onCreadas,
}: {
  onCerrar:  () => void
  onCreadas: (compra_id?: string) => void
}) {
  const [cargando, setCargando] = useState(true)
  const [data, setData]         = useState<PreviewReposicion | null>(null)
  const [almacenId, setAlmacenId] = useState('')
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()

  // La primera carga trae SOLO la lista de almacenes con cuántas referencias le faltan
  // a cada uno; la tabla no aparece hasta que se elige. No se preselecciona ninguno a
  // propósito: el candidato «obvio» (el que más falta) es el almacén VACÍO, así que la
  // pantalla se abría proponiendo comprar el catálogo entero para algo que no se usa.
  useEffect(() => {
    let vivo = true
    setCargando(true)
    previsualizarReposicion(almacenId || undefined).then(r => {
      if (!vivo) return
      setData(r)
      setExcluidos(new Set())
      setCargando(false)
    })
    return () => { vivo = false }
  }, [almacenId])

  const faltas = data?.faltas ?? []
  const elegidos = useMemo(
    () => faltas.filter(f => !excluidos.has(f.producto_id)),
    [faltas, excluidos],
  )
  const porProveedor = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of elegidos) m.set(f.proveedor, (m.get(f.proveedor) ?? 0) + 1)
    return m
  }, [elegidos])

  function alternar(producto_id: string) {
    setExcluidos(prev => {
      const s = new Set(prev)
      if (s.has(producto_id)) s.delete(producto_id); else s.add(producto_id)
      return s
    })
  }

  function crear() {
    if (elegidos.length === 0) { toastWarning('No has marcado ningún producto.'); return }
    const ld = toastLoading('Creando los borradores…')
    startTransition(async () => {
      const r = await crearComprasDeReposicion(almacenId, elegidos.map(f => f.producto_id))
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo preparar la reposición.'); return }
      toastSuccess(`${r.creadas} ${r.creadas === 1 ? 'borrador creado' : 'borradores creados'} por proveedor`)
      onCreadas(r.compra_id)
    })
  }

  return (
    <div className="modal-backdrop open" onClick={onCerrar}>
      {/* `modal-fixed-actions` como el selector del catálogo: cabecera y botones fijos,
          la lista scrollea dentro. Sin eso, un almacén con 40 faltantes deja el botón de
          crear al final de un scroll larguísimo. `modal-xl` porque son seis columnas de
          cifras y en 600px se apelotonan. */}
      <div className="modal modal-xl modal-fixed-actions" role="dialog" aria-modal
        onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Comprar lo que falta</h2>
          <button type="button" className="modal-close" onClick={onCerrar}><X size={16} strokeWidth={2} /></button>
        </div>

        <div className="modal-body">
          <div className="input-group">
            <label htmlFor="rep-alm">Almacén que hay que reponer</label>
            <select id="rep-alm" className="input" value={almacenId}
              onChange={e => setAlmacenId(e.target.value)} disabled={isPending}>
              <option value="">Elige el almacén…</option>
              {(data?.almacenes ?? []).map(a => (
                <option key={a.almacen_id} value={a.almacen_id}>
                  {a.nombre}{a.faltan > 0 ? ` — le faltan ${a.faltan}` : ' — está completo'}
                </option>
              ))}
            </select>
            <span className="input-hint">
              La cantidad sugerida es la que falta para llegar al mínimo de ESE almacén.
            </span>
          </div>

          {cargando ? (
            <div className="ven-empty-mini">
              <span className="spinner spinner-sm" />{' '}
              {almacenId ? 'Mirando qué falta…' : 'Cargando tus almacenes…'}
            </div>
          ) : !almacenId ? (
            <div className="ven-empty-mini">
              Elige arriba el almacén que quieres reponer y aquí sale lo que le falta.
            </div>
          ) : faltas.length === 0 ? (
            <div className="ven-empty-mini">
              Aquí no falta nada: todo está por encima de su mínimo. Prueba con otro almacén.
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="col-center">Comprar</th>
                      <th>Producto</th>
                      <th className="col-num">Hay</th>
                      <th className="col-num">Mínimo</th>
                      <th className="col-num">Falta</th>
                      <th>Se le compra a</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faltas.map(f => (
                      <tr key={f.producto_id}>
                        <td data-label="Comprar" className="col-center">
                          <input type="checkbox" className="row-check"
                            checked={!excluidos.has(f.producto_id)}
                            aria-label={`Incluir ${f.nombre} en la compra`}
                            onChange={() => alternar(f.producto_id)} />
                        </td>
                        <td data-label="Producto">
                          <strong className="cell-clamp">{f.nombre}</strong>
                          {f.unidad && <div className="table-cell-secondary">{f.unidad}</div>}
                        </td>
                        <td data-label="Hay" className={`col-num${f.actual < 0 ? ' mov-cant-neg' : ''}`}>
                          {f.actual.toLocaleString('es-ES')}
                        </td>
                        <td data-label="Mínimo" className="col-num">{f.minimo.toLocaleString('es-ES')}</td>
                        <td data-label="Falta" className="col-num"><strong>{f.falta.toLocaleString('es-ES')}</strong></td>
                        <td data-label="Se le compra a">
                          {f.proveedor_id
                            ? f.proveedor
                            : <span className="text-sm-muted">Sin proveedor — irá en una compra aparte</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Lo que va a pasar, en una línea: un borrador por proveedor. */}
              <p className="input-hint mt-2">
                Se crearán <strong>{porProveedor.size}</strong>{' '}
                {porProveedor.size === 1 ? 'borrador' : 'borradores'} con {elegidos.length}{' '}
                {elegidos.length === 1 ? 'línea' : 'líneas'} en total. Nada se confirma: los
                revisas y los confirmas tú.
              </p>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={crear}
            disabled={isPending || cargando || elegidos.length === 0}>
            {isPending
              ? <><span className="spinner spinner-sm" /> Creando…</>
              : <><ShoppingCart size={14} strokeWidth={2} /> Crear los borradores</>}
          </button>
        </div>
      </div>
    </div>
  )
}
