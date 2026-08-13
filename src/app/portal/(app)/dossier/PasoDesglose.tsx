'use client'

import { useMemo, useState, useTransition } from 'react'
import { Loader2, Save, Plus, Trash2, Wand2 } from 'lucide-react'
import { toastError, toastSuccess, toastWarning, toastLoading } from '@/app/contexts/ToastContext'
import { guardarDesglose, type DossierBasico } from '@/app/actions/portal/dossier'
import type { LineaDesglose } from '@/lib/dossier/base'
import type { FilaSerie } from '@/lib/dossier/snapshot'
import { GRUPOS_PL, LABEL_GRUPO_PL, type ConceptosSector, type GrupoPL } from '@/lib/sector'
import AvisoContabilidad from './AvisoContabilidad'

// ── Paso «El desglose» ───────────────────────────────────────────────────────
//
// El hueco que cierra: la rejilla de «Los números» da totales y márgenes por mes,
// pero NUNCA dice en qué se va el dinero — que es justo la pregunta del inversor.
// Sin `base`, las tres secciones de desglose del estado de resultados salían
// siempre vacías.
//
// TRES DECISIONES DE DISEÑO, y las tres importan:
//
// 1. Grano de PERÍODO, no de mes. `dossier_lineas` no tiene columna `mes` (la DDL
//    de la mig. 098 lo dice: «grano distinto a la serie»). Son ~5-8 filas en total
//    en vez de 12 meses × N conceptos: decisivo en móvil y 3G.
//
// 2. CONCILIACIÓN EN VIVO contra los totales de la rejilla. «Has desglosado 45.000
//    de 60.000 · faltan 15.000», con un botón que crea «Otros» por la diferencia.
//    Es lo que desactiva la objeción original a guardar un desglose tecleado: si no
//    puede descuadrar, no hay motivo para descartarlo al editar una celda.
//
// 3. Es OPCIONAL. El dossier sigue siendo válido sin él; el wizard deja saltarlo.

const nf = new Intl.NumberFormat('es', { maximumFractionDigits: 2 })
const fmt = (n: number) => nf.format(n)
const num = (s: string) => Number(s) || 0

interface Fila { id: string; concepto: string; monto: string; grupo: LineaDesglose['grupo'] }

// El grupo se conserva POR FILA: la sección de entrada es una de tres (Ingresos,
// Coste, Gastos operativos), pero una línea operativa traída de la base puede ser
// Personal, Depreciación u Otros, y reguardarla como GASTO_OPERATIVO perdería esa
// clasificación (que es la que enseña el waterfall detallado). Nueva línea manual
// → GASTO_OPERATIVO.
const nuevaFila = (concepto = '', monto = '', grupo: LineaDesglose['grupo'] = 'GASTO_OPERATIVO'): Fila => ({
  id: `L-${Math.random().toString(36).slice(2, 9)}`, concepto, monto, grupo,
})

// Las tres secciones de entrada = los tres cubos de la serie. Personal,
// Depreciación y Otros caen en «Gastos operativos» pero recuerdan su grupo fino.
const seccionDe = (g: LineaDesglose['grupo']): GrupoPL =>
  g === 'INGRESO' ? 'INGRESO' : g === 'COSTO_VENTAS' ? 'COSTO_VENTAS' : 'GASTO_OPERATIVO'

export default function PasoDesglose({
  dossier, serie, lineas, conceptos, tieneBase, simbolo, onGuardado,
}: {
  dossier: DossierBasico
  serie: FilaSerie[]
  lineas: LineaDesglose[]
  conceptos: ConceptosSector
  tieneBase: boolean
  simbolo: string
  onGuardado?: () => void
}) {
  // Totales del período contra los que se concilia. Salen de la MISMA serie que ve
  // «Los números»: si se calcularan aparte, los dos pasos podrían discrepar.
  const totales = useMemo(() => {
    let ing = 0, cv = 0, go = 0
    for (const f of serie) { ing += f.ingresos; cv += f.costo_ventas; go += f.gastos_operativos }
    return { INGRESO: ing, COSTO_VENTAS: cv, GASTO_OPERATIVO: go } as Record<GrupoPL, number>
  }, [serie])

  // Estado inicial: lo ya guardado (traído de Contabilidad o tecleado antes). Si un
  // grupo está vacío, se PRECARGAN LAS FILAS del sector con el importe en blanco —
  // nunca un importe sugerido: sería un número inventado en un documento que el
  // dueño le enseña a un inversor.
  const [filas, setFilas] = useState<Record<GrupoPL, Fila[]>>(() => {
    const out = {} as Record<GrupoPL, Fila[]>
    for (const g of GRUPOS_PL) {
      const guardadas = lineas.filter(l => seccionDe(l.grupo) === g).sort((a, b) => a.orden - b.orden)
      out[g] = guardadas.length
        ? guardadas.map(l => nuevaFila(l.concepto, String(l.monto), l.grupo))
        : conceptos[g].map(c => nuevaFila(c, '', g))
    }
    return out
  })

  const [pending, startTransition] = useTransition()

  const editar = (g: GrupoPL, id: string, campo: 'concepto' | 'monto', valor: string) =>
    setFilas(prev => ({ ...prev, [g]: prev[g].map(f => (f.id === id ? { ...f, [campo]: valor } : f)) }))

  const anadir = (g: GrupoPL) =>
    setFilas(prev => ({ ...prev, [g]: [...prev[g], nuevaFila('', '', g)] }))

  const quitar = (g: GrupoPL, id: string) =>
    setFilas(prev => ({ ...prev, [g]: prev[g].filter(f => f.id !== id) }))

  const sumaDe = (g: GrupoPL) => filas[g].reduce((s, f) => s + num(f.monto), 0)

  /** Cuadra el grupo con una fila «Otros» por la diferencia. */
  function cuadrar(g: GrupoPL) {
    const resto = Math.round((totales[g] - sumaDe(g)) * 100) / 100
    if (Math.abs(resto) <= 0.005) return
    setFilas(prev => {
      const existente = prev[g].find(f => f.concepto.trim().toLowerCase() === 'otros')
      if (existente) {
        return { ...prev, [g]: prev[g].map(f => (f.id === existente.id ? { ...f, monto: String(Math.round((num(f.monto) + resto) * 100) / 100) } : f)) }
      }
      return { ...prev, [g]: [...prev[g], nuevaFila('Otros', String(resto), g)] }
    })
  }

  // Un grupo con importes escritos que NO suman su total (P3): el documento
  // enseñaría conceptos que no cuadran. No bloquea —«si es a mano, es lo que
  // tiene»—, pero se avisa al guardar. Un grupo en blanco (suma 0) no cuenta: es
  // «sin desglose por concepto», no un descuadre.
  const descuadra = GRUPOS_PL.some(g => {
    const s = sumaDe(g)
    return s > 0.005 && Math.abs(totales[g] - s) > 0.005
  })

  function guardar() {
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const payload: Omit<LineaDesglose, 'orden'>[] = []
      for (const g of GRUPOS_PL) {
        for (const f of filas[g]) {
          if (!f.concepto.trim()) continue
          payload.push({ grupo: f.grupo, concepto: f.concepto.trim(), monto: num(f.monto) })
        }
      }
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      fd.set('lineas', JSON.stringify(payload))
      const res = await guardarDesglose(fd)
      await ld.dismiss()
      if (res.ok) {
        if (descuadra) toastWarning('Guardado. Ojo: algún grupo no cuadra con tus totales; en el documento saldrían conceptos que no suman.')
        else toastSuccess('Desglose guardado')
        onGuardado?.()
      }
      else toastError(res.error || 'No se pudo guardar')
    })
  }

  const sinNumeros = serie.length === 0

  return (
    <section className="card dos-desglose-card">
      <div className="dos-body">
        <h2 className="dos-section-title">El desglose</h2>
        <p className="dos-section-hint">
          Tus totales ya están; esto dice <strong>en qué</strong> se va el dinero, que es lo primero
          que pregunta quien lee tu dossier. Es del <strong>período entero</strong>, no de cada mes:
          unas pocas líneas y listo.
        </p>

        {!tieneBase && (
          <AvisoContabilidad
            texto="Con Contabilidad, CLAUX saca este desglose de tus gastos reales y rellena estas líneas solo — y lo que ya escribiste se conserva."
          />
        )}

        {sinNumeros ? (
          <p className="dos-vacio">Primero escribe tus números en el paso anterior: el desglose se cuadra contra ellos.</p>
        ) : (
          <>
            {GRUPOS_PL.map(g => {
              const suma  = sumaDe(g)
              const total = totales[g]
              const resto = Math.round((total - suma) * 100) / 100
              const cuadrado = Math.abs(resto) <= 0.005
              return (
                <div key={g} className="dos-desg-grupo">
                  <div className="dos-desg-head">
                    <h3 className="dos-desg-titulo">{LABEL_GRUPO_PL[g]}</h3>
                    <span className="dos-desg-total">{fmt(total)} {simbolo}</span>
                  </div>

                  <div className="dos-desg-filas">
                    {filas[g].map(f => (
                      <div key={f.id} className="dos-desg-fila">
                        <input
                          className="input dos-desg-concepto" type="text" value={f.concepto}
                          onChange={e => editar(g, f.id, 'concepto', e.target.value)}
                          placeholder="Concepto" aria-label={`Concepto de ${LABEL_GRUPO_PL[g]}`}
                        />
                        <label className="dos-grid-cell" data-label="Importe">
                          <span className="dos-cell-simbolo">{simbolo}</span>
                          <input
                            className="input dos-input" type="number" inputMode="decimal" value={f.monto}
                            onChange={e => editar(g, f.id, 'monto', e.target.value)}
                            placeholder="0" aria-label={`Importe de ${f.concepto || 'la línea'}`}
                          />
                        </label>
                        <button
                          type="button" className="dos-desg-quitar" onClick={() => quitar(g, f.id)}
                          aria-label={`Quitar ${f.concepto || 'línea'}`}
                        >
                          <Trash2 size={14} strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="dos-desg-pie">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => anadir(g)}>
                      <Plus size={13} strokeWidth={2.5} /> Añadir línea
                    </button>
                    {/* Conciliación en vivo: sin esto, un desglose tecleado podría
                        contradecir los totales del propio documento. */}
                    {cuadrado ? (
                      <span className="dos-desg-ok">Cuadra con tus números</span>
                    ) : (
                      <span className="dos-desg-resto">
                        Has desglosado {fmt(suma)} de {fmt(total)} ·
                        {resto > 0 ? ` faltan ${fmt(resto)}` : ` te pasas en ${fmt(-resto)}`}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => cuadrar(g)}>
                          <Wand2 size={13} strokeWidth={2.5} /> {resto > 0 ? 'Poner el resto en «Otros»' : 'Ajustar «Otros»'}
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            <div className="dos-acciones">
              <button className="btn btn-primary" onClick={guardar} disabled={pending}>
                {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Save size={14} strokeWidth={2.5} />}
                Guardar desglose
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
