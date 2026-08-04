'use client'

// ── Los precios del presupuesto de instalación ──
//
// Estaban quemados en `src/lib/presupuesto/config.ts`: cambiar el precio de una hora exigía
// tocar código y desplegar. Y el volumen no movía el precio, así que declarar 20 productos o
// 5.000 costaba lo mismo.
//
// ── POR QUÉ ESTO NO ES UNA TABLA ─────────────────────────────────────────────
// La primera versión era una tabla de cuatro columnas —«horas base · incluye hasta · tramo ·
// horas/tramo»—, y no había forma de entenderla sin tener la fórmula delante: son los nombres
// del modelo de datos, no lo que significan. Aquí cada línea se lee como la regla que de
// verdad codifica («1 h cubre hasta 1 empresa; luego +0,5 h por cada 1 más») y enseña al lado
// lo que costaría un cliente concreto, en horas y en dinero. El cálculo de detrás es el mismo:
// lo que cambia es que ahora se puede leer en voz alta.

import { useState } from 'react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarParametrosPresupuesto } from '@/app/actions/presupuesto-parametros'
import { horasDeLinea } from '@/lib/presupuesto/calculo'
import { AJUSTES_PRESUPUESTO, type LineaParametro } from '@/lib/presupuesto/config'

type Escalares = Record<string, string>
type LineaEdit = Pick<LineaParametro,
  'clave' | 'etiqueta' | 'fase' | 'horas_base' | 'incluido' | 'tramo' | 'horas_por_tramo'>

const CLAVES = Object.keys(AJUSTES_PRESUPUESTO) as (keyof typeof AJUSTES_PRESUPUESTO)[]

const hs = (n: number) => `${Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 })} h`
const usd = (n: number) => `$${Number(n ?? 0).toFixed(2)}`

/** Un cliente de ejemplo para esta línea: tres tramos por encima de lo incluido. Es el
 *  volumen que hace visible el escalado — con el volumen justo incluido no se vería. */
function volumenEjemplo(l: LineaEdit): number {
  return Math.max(1, l.incluido + l.tramo * 3)
}

/**
 * Una línea de precio, leída como la frase que codifica.
 *
 * DEFINIDA FUERA del formulario a propósito: dentro, React crea un tipo de componente nuevo en
 * cada render, desmonta el subárbol y el input pierde el foco a la primera tecla — con cuatro
 * campos numéricos por línea, imposible de usar.
 */
function LineaPrecio({
  l, tarifa, onCampo,
}: {
  l: LineaEdit
  tarifa: number
  onCampo: (clave: string, campo: keyof LineaEdit, valor: string) => void
}) {
  const ejemplo = volumenEjemplo(l)
  // La misma función que usa el presupuesto de verdad: la vista previa no puede desviarse de
  // lo que luego se le cobra al cliente.
  const { horas } = horasDeLinea(l, ejemplo)
  return (
    <div className="pp-linea">
      <div className="pp-linea-cab">
        <span className="pp-linea-nombre">{l.etiqueta}</span>
        {/* Lo que de verdad quiere saber quien configura: «si un cliente tiene N, ¿cuánto le
            cobro?». Se recalcula mientras se teclea. */}
        <span className="pp-linea-ejemplo">
          Con <strong>{ejemplo}</strong> → <strong>{hs(horas)}</strong>
          {tarifa > 0 && <> · {usd(horas * tarifa)}</>}
        </span>
      </div>

      <p className="pp-linea-frase">
        <input type="number" min="0" step="0.25" className="input pp-num"
          aria-label={`Horas mínimas de ${l.etiqueta}`}
          value={l.horas_base} onChange={e => onCampo(l.clave, 'horas_base', e.target.value)} />
        <span>horas cubren hasta</span>
        <input type="number" min="0" step="1" className="input pp-num"
          aria-label={`Cantidad incluida en ${l.etiqueta}`}
          value={l.incluido} onChange={e => onCampo(l.clave, 'incluido', e.target.value)} />
        <span>. Después, sumar</span>
        <input type="number" min="0" step="0.25" className="input pp-num"
          aria-label={`Horas por tramo de ${l.etiqueta}`}
          value={l.horas_por_tramo} onChange={e => onCampo(l.clave, 'horas_por_tramo', e.target.value)} />
        <span>horas por cada</span>
        <input type="number" min="1" step="1" className="input pp-num"
          aria-label={`Tamaño de tramo de ${l.etiqueta}`}
          value={l.tramo} onChange={e => onCampo(l.clave, 'tramo', e.target.value)} />
        <span>más.</span>
      </p>
    </div>
  )
}

export default function PresupuestoForm({
  escalares: escalaresIniciales,
  lineas: lineasIniciales,
}: {
  escalares: Record<string, number>
  lineas: LineaEdit[]
}) {
  const [escalares, setEscalares] = useState<Escalares>(
    Object.fromEntries(CLAVES.map(k => [k, String(escalaresIniciales[k] ?? 0)])),
  )
  const [lineas, setLineas] = useState<LineaEdit[]>(lineasIniciales)
  const [loading, setLoading] = useState(false)

  const tarifa = Number(escalares.tarifaHora) || 0

  function setLinea(clave: string, campo: keyof LineaEdit, valor: string) {
    setLineas(prev => prev.map(l => l.clave === clave ? { ...l, [campo]: Number(valor) || 0 } : l))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await guardarParametrosPresupuesto({
      escalares: Object.fromEntries(CLAVES.map(k => [k, Number(escalares[k]) || 0])),
      lineas: lineas.map(({ clave, horas_base, incluido, tramo, horas_por_tramo }) =>
        ({ clave, horas_base, incluido, tramo, horas_por_tramo })),
    })
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'No se pudieron guardar los precios.'); return }
    toastSuccess('Precios del presupuesto guardados')
  }

  return (
    <form onSubmit={handleSubmit} className="config-form">
      <div className="input-group">
        <label htmlFor="pp-tarifa">{AJUSTES_PRESUPUESTO.tarifaHora.label}</label>
        <input id="pp-tarifa" type="number" min="0" step="any" className="input"
          value={escalares.tarifaHora} onChange={e => setEscalares(p => ({ ...p, tarifaHora: e.target.value }))} />
        <span className="input-hint">
          Todo se cotiza en horas y esta tarifa las convierte en dinero. En cada presupuesto se
          puede pactar otra para ese cliente.
        </span>
      </div>

      <div>
        <p className="mod-list-label">Horas que se cobran siempre</p>
        <div className="grid-cols-2">
          {CLAVES.filter(k => k !== 'tarifaHora').map(k => (
            <div key={k} className="input-group">
              <label htmlFor={`pp-${k}`}>{AJUSTES_PRESUPUESTO[k].label}</label>
              <input id={`pp-${k}`} type="number" min="0" step="any" className="input"
                value={escalares[k]} onChange={e => setEscalares(p => ({ ...p, [k]: e.target.value }))} />
            </div>
          ))}
        </div>
      </div>

      {/* La explicación va ARRIBA y con un caso concreto: la regla en abstracto no se entiende
          hasta que se ve aplicada a un número. */}
      <div className="alert alert-info">
        <strong>Cómo se cobra cada línea.</strong> Unas horas mínimas cubren cierta cantidad, y
        a partir de ahí se suman horas por cada tanto más. Un tramo empezado cuenta entero, que
        es como se factura el trabajo.
        <br />
        Ejemplo: si «Empresas» son <strong>1 h hasta 1</strong> y <strong>+0,5 h por cada 1</strong>,
        un cliente con 4 empresas paga 1 + 3 × 0,5 = <strong>2,5 h</strong>.
      </div>

      {([1, 2] as const).map(fase => (
        <div key={fase} className="pp-bloque">
          <p className="mod-list-label">
            {fase === 1 ? 'Configuración inicial' : 'Migración de datos'}
          </p>
          {lineas.filter(l => l.fase === fase).map(l => (
            <LineaPrecio key={l.clave} l={l} tarifa={tarifa} onCampo={setLinea} />
          ))}
        </div>
      ))}

      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar precios'}
      </button>
    </form>
  )
}
