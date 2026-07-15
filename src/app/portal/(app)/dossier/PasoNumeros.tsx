'use client'

import { useMemo, useState, useTransition } from 'react'
import { Loader2, Save, Download, X, AlertTriangle, Sparkles } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import {
  guardarSerie, previsualizarActualizacion, aplicarActualizacion,
  type DossierBasico, type PreviewActualizacion,
} from '@/app/actions/portal/dossier'
import { etiquetaMes, type FilaSerie } from '@/lib/dossier/snapshot'

// Lista de meses 'YYYY-MM' del período (inclusive).
function mesesDe(desde: string | null, hasta: string | null): string[] {
  if (!desde || !hasta) return []
  const [dy, dm] = desde.split('-').map(Number)
  const [hy, hm] = hasta.split('-').map(Number)
  const ini = dy * 12 + (dm - 1)
  const fin = hy * 12 + (hm - 1)
  const out: string[] = []
  for (let i = ini; i <= fin && out.length < 60; i++) out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)
  return out
}
const nf = new Intl.NumberFormat('es', { maximumFractionDigits: 2 })
const fmt = (n: number) => nf.format(n)
const num = (s: string) => Number(s) || 0

interface Fila { ingresos: string; costo_ventas: string; gastos_operativos: string; origen: 'MANUAL' | 'BASE' }
type Campo = 'ingresos' | 'costo_ventas' | 'gastos_operativos'

export default function PasoNumeros({
  dossier, serie, tieneBase, simbolo, onCambio,
}: {
  dossier: DossierBasico
  serie: FilaSerie[]
  tieneBase: boolean
  simbolo: string
  onCambio?: () => void
}) {
  const meses = useMemo(() => mesesDe(dossier.periodo_desde, dossier.periodo_hasta), [dossier.periodo_desde, dossier.periodo_hasta])

  const [filas, setFilas] = useState<Record<string, Fila>>(() => {
    const byMes = new Map(serie.map(s => [s.mes, s]))
    const o: Record<string, Fila> = {}
    for (const m of meses) {
      const s = byMes.get(m)
      o[m] = s
        ? { ingresos: String(s.ingresos), costo_ventas: String(s.costo_ventas), gastos_operativos: String(s.gastos_operativos), origen: s.origen }
        : { ingresos: '', costo_ventas: '', gastos_operativos: '', origen: 'MANUAL' }
    }
    return o
  })

  const [pending, startTransition] = useTransition()
  const [previewLoading, startPreview] = useTransition()
  const [preview, setPreview] = useState<PreviewActualizacion | null>(null)
  const [aceptados, setAceptados] = useState<Set<string>>(new Set())

  // Editar una celda: la fila pasa a MANUAL (deja de ser un espejo de la base).
  function editar(mes: string, campo: Campo, valor: string) {
    setFilas(prev => ({ ...prev, [mes]: { ...prev[mes], [campo]: valor, origen: 'MANUAL' } }))
  }

  const tot = useMemo(() => {
    let ing = 0, cv = 0, go = 0
    for (const m of meses) {
      const f = filas[m]; if (!f) continue
      ing += num(f.ingresos); cv += num(f.costo_ventas); go += num(f.gastos_operativos)
    }
    return { ing, cv, go, margenBruto: ing - cv, margenPct: ing > 0 ? ((ing - cv) / ing) * 100 : 0, neto: ing - cv - go }
  }, [filas, meses])

  function guardar() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      fd.set('serie', JSON.stringify(meses.map(m => ({
        mes: m, ingresos: num(filas[m].ingresos), costo_ventas: num(filas[m].costo_ventas),
        gastos_operativos: num(filas[m].gastos_operativos), origen: filas[m].origen,
      }))))
      const res = await guardarSerie(fd)
      if (res.ok) { toastSuccess('Números guardados'); onCambio?.() }
      else toastError(res.error || 'No se pudo guardar')
    })
  }

  function abrirPreview() {
    startPreview(async () => {
      const res = await previsualizarActualizacion(dossier.dossier_id)
      if ('error' in res) { toastError(res.error); return }
      setAceptados(new Set())
      setPreview(res)
    })
  }

  function confirmarActualizacion() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      fd.set('conflictos_aceptados', JSON.stringify([...aceptados]))
      const res = await aplicarActualizacion(fd)
      if (res.ok) { toastSuccess('Números actualizados desde tu Contabilidad'); setPreview(null); onCambio?.() }
      else toastError(res.error || 'No se pudo actualizar')
    })
  }

  const yaHayDatos = serie.length > 0
  const sinCambios = preview && !preview.nuevos.length && !preview.cambian.length && !preview.conflictos.length

  // "Ahora tienes Contabilidad": tiene `base` pero TODO lo suyo está tecleado a
  // mano. Contratar un módulo después no debe cambiar nada de lo que ya escribió
  // —eso es la regla de independencia— pero si no se lo decimos, nunca se entera
  // de que ya no hace falta teclear. Derivado del estado: en cuanto trae algo, la
  // fila pasa a BASE y el aviso desaparece solo. Sin flag de "visto" que mantener.
  const nuncaTrajo = tieneBase && yaHayDatos && serie.every(f => f.origen === 'MANUAL')

  return (
    <section className="card dos-numeros-card">
      <div className="card-body">
        <div className="dos-numeros-head">
          <div>
            <h2 className="dos-section-title">Los números</h2>
            <p className="dos-section-hint">
              {tieneBase
                ? 'Revísalos. Puedes traerlos de tu Contabilidad y ajustar lo que haga falta a mano.'
                : 'Escribe tus ingresos, coste de ventas y gastos de cada mes. El margen se calcula solo.'}
            </p>
          </div>
          {tieneBase && (
            <button className="btn btn-secondary" onClick={abrirPreview} disabled={previewLoading || pending}>
              {previewLoading ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Download size={14} strokeWidth={2.5} />}
              {yaHayDatos ? 'Actualizar desde mis datos' : 'Traer mis números'}
            </button>
          )}
        </div>

        {nuncaTrajo && (
          <div className="dos-novedad" role="status">
            <Sparkles size={15} strokeWidth={2} />
            <p className="dos-novedad-texto">
              <strong>Ahora tienes Contabilidad:</strong> puedes traer estos números automáticamente en vez de teclearlos.
              Lo que ya escribiste a mano se conserva — te enseñamos qué cambia antes de tocar nada.
            </p>
          </div>
        )}

        <div className="dos-grid">
          <div className="dos-grid-head">
            <span>Mes</span>
            <span className="dos-num">Ingresos</span>
            <span className="dos-num">Coste de ventas</span>
            <span className="dos-num">Gastos operativos</span>
            <span className="dos-num">Margen bruto</span>
          </div>

          {meses.map(m => {
            const f = filas[m]
            const margen = num(f.ingresos) - num(f.costo_ventas)
            return (
              <div key={m} className="dos-grid-row">
                <span className="dos-grid-mes">
                  {etiquetaMes(m)}
                  {f.origen === 'BASE' && <span className="dos-origen" title="Traído de tu Contabilidad">auto</span>}
                </span>
                <label className="dos-grid-cell" data-label="Ingresos">
                  <span className="dos-cell-simbolo">{simbolo}</span>
                  <input type="number" inputMode="decimal" className="input dos-input" value={f.ingresos}
                    onChange={e => editar(m, 'ingresos', e.target.value)} placeholder="0" />
                </label>
                <label className="dos-grid-cell" data-label="Coste de ventas">
                  <span className="dos-cell-simbolo">{simbolo}</span>
                  <input type="number" inputMode="decimal" className="input dos-input" value={f.costo_ventas}
                    onChange={e => editar(m, 'costo_ventas', e.target.value)} placeholder="0" />
                </label>
                <label className="dos-grid-cell" data-label="Gastos operativos">
                  <span className="dos-cell-simbolo">{simbolo}</span>
                  <input type="number" inputMode="decimal" className="input dos-input" value={f.gastos_operativos}
                    onChange={e => editar(m, 'gastos_operativos', e.target.value)} placeholder="0" />
                </label>
                <span className="dos-grid-neto dos-num" data-label="Margen bruto">{fmt(margen)}</span>
              </div>
            )
          })}

          <div className="dos-grid-foot">
            <span>Total</span>
            <span className="dos-num">{fmt(tot.ing)}</span>
            <span className="dos-num">{fmt(tot.cv)}</span>
            <span className="dos-num">{fmt(tot.go)}</span>
            <span className="dos-num">{fmt(tot.margenBruto)}</span>
          </div>
        </div>

        <div className="dos-resumen">
          <div className="dos-resumen-item">
            <span className="dos-resumen-label">Margen bruto</span>
            <span className="dos-resumen-valor">{fmt(tot.margenBruto)} {simbolo} · {tot.margenPct.toFixed(1)}%</span>
          </div>
          <div className="dos-resumen-item">
            <span className="dos-resumen-label">Resultado neto</span>
            <span className="dos-resumen-valor">{fmt(tot.neto)} {simbolo}</span>
          </div>
        </div>

        <div className="dos-acciones">
          <button className="btn btn-primary" onClick={guardar} disabled={pending}>
            {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Save size={14} strokeWidth={2.5} />}
            Guardar números
          </button>
        </div>
      </div>

      {preview && (
        <div className="modal-backdrop open dialog-top" role="dialog" aria-modal>
          <div className="modal modal-lg dos-preview">
            <div className="modal-header">
              <h2 className="modal-title">Cambios al actualizar</h2>
              <button className="modal-close" onClick={() => setPreview(null)} aria-label="Cerrar"><X size={18} strokeWidth={2} /></button>
            </div>

            <div className="modal-body">
              {sinCambios ? (
                <p className="dos-preview-vacio">Tus números ya están al día con tu Contabilidad.</p>
              ) : (
                <>
                  {preview.nuevos.length > 0 && (
                    <div className="dos-preview-grupo">
                      <h3 className="dos-preview-titulo dos-t-nuevo">{preview.nuevos.length} {preview.nuevos.length === 1 ? 'mes nuevo' : 'meses nuevos'}</h3>
                      <p className="dos-preview-detalle">Se añadirán: {preview.nuevos.map(f => etiquetaMes(f.mes)).join(' · ')}</p>
                    </div>
                  )}
                  {preview.cambian.length > 0 && (
                    <div className="dos-preview-grupo">
                      <h3 className="dos-preview-titulo dos-t-cambia">{preview.cambian.length} {preview.cambian.length === 1 ? 'mes cambia' : 'meses cambian'}</h3>
                      <ul className="dos-preview-lista">
                        {preview.cambian.map(c => (
                          <li key={c.mes}>{etiquetaMes(c.mes)}: {fmt(c.antes.ingresos)} → {fmt(c.despues.ingresos)} {simbolo}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {preview.conservados.length > 0 && (
                    <div className="dos-preview-grupo">
                      <h3 className="dos-preview-titulo dos-t-conserva">{preview.conservados.length} {preview.conservados.length === 1 ? 'mes escrito a mano se conserva' : 'meses escritos a mano se conservan'}</h3>
                      <p className="dos-preview-detalle">Tu Contabilidad no tiene datos de: {preview.conservados.map(f => etiquetaMes(f.mes)).join(' · ')}</p>
                    </div>
                  )}
                  {preview.conflictos.length > 0 && (
                    <div className="dos-preview-grupo">
                      <h3 className="dos-preview-titulo dos-t-conflicto">{preview.conflictos.length} {preview.conflictos.length === 1 ? 'mes en conflicto' : 'meses en conflicto'}</h3>
                      <p className="dos-preview-detalle">Escribiste estos meses a mano y tu Contabilidad ahora tiene datos distintos. Marca los que quieras reemplazar; el resto se conserva.</p>
                      <ul className="dos-preview-lista">
                        {preview.conflictos.map(c => (
                          <li key={c.mes} className="dos-conflicto">
                            <label className="dos-costo-label">
                              <input type="checkbox" checked={aceptados.has(c.mes)}
                                onChange={e => setAceptados(prev => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(c.mes); else next.delete(c.mes)
                                  return next
                                })} />
                              <span>{etiquetaMes(c.mes)}: tuyo {fmt(c.antes.ingresos)} → Contabilidad {fmt(c.despues.ingresos)} {simbolo}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {preview.monedasFaltantes.length > 0 && (
                    <p className="dos-preview-aviso"><AlertTriangle size={14} strokeWidth={2} /> No se incluyen importes en {preview.monedasFaltantes.join(', ')} (sin tasa hacia {dossier.moneda_presentacion}).</p>
                  )}
                  {dossier.estado === 'PUBLICADO' && (
                    <p className="dos-preview-aviso dos-preview-aviso-warn"><AlertTriangle size={14} strokeWidth={2} /> Este dossier está publicado: los números del enlace cambiarán al confirmar.</p>
                  )}
                </>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPreview(null)}>Cancelar</button>
              {!sinCambios && (
                <button className="btn btn-primary" onClick={confirmarActualizacion} disabled={pending}>
                  {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : null}
                  Aplicar cambios
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
