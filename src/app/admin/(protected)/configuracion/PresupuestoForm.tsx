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
import FormHelp from '@/components/portal/FormHelp'
import { importeClaux, MONEDAS_CLAUX, type MonedaClaux } from '@/lib/moneda-claux'

type Escalares = Record<string, string>
type LineaEdit = Pick<LineaParametro,
  'clave' | 'etiqueta' | 'fase' | 'horas_base' | 'incluido' | 'tramo' | 'horas_por_tramo'>

const CLAVES = Object.keys(AJUSTES_PRESUPUESTO) as (keyof typeof AJUSTES_PRESUPUESTO)[]
// Las dos tarifas/hora son dinero, no horas: van arriba y juntas, fuera del bloque de
// «horas que se cobran siempre». La de euros es un precio propio, no la de dólares
// pasada por el cambio del día (mig. 225).
const TARIFA_DE: Record<MonedaClaux, 'tarifaHora' | 'tarifaHoraEur'> = {
  USD: 'tarifaHora',
  EUR: 'tarifaHoraEur',
}
const TARIFAS: string[] = Object.values(TARIFA_DE)

const hs = (n: number) => `${Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 })} h`

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
/** Cabecera de columnas del bloque: se pinta UNA vez y explica qué es cada celda, que es
 *  justo lo que no se entendía. Palabra en negrita + qué significa, en pequeño. */
function CabeceraColumnas() {
  return (
    <div className="pp-fila pp-fila-cab" aria-hidden="true">
      <span />
      <span className="pp-col"><strong>Horas base</strong><em>lo que cuesta de salida</em></span>
      <span className="pp-col"><strong>Incluye</strong><em>cantidad sin coste extra</em></span>
      <span className="pp-col"><strong>Suma</strong><em>horas de cada tramo</em></span>
      <span className="pp-col"><strong>Por cada</strong><em>tamaño del tramo</em></span>
      <span className="pp-col pp-col-ej"><strong>Ejemplo</strong><em>coste real</em></span>
    </div>
  )
}

/**
 * Una línea de precio.
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
  const campo = (
    k: 'horas_base' | 'incluido' | 'horas_por_tramo' | 'tramo',
    etiqueta: string, paso: string, min: string,
  ) => (
    <span className="pp-col">
      {/* La etiqueta se repite en cada fila SOLO para lectores de pantalla: en pantalla la
          dice la cabecera del bloque, y repetirla catorce veces sería ruido. */}
      <input type="number" min={min} step={paso} className="input pp-num"
        aria-label={`${etiqueta} · ${l.etiqueta}`}
        value={l[k]} onChange={e => onCampo(l.clave, k, e.target.value)} />
    </span>
  )
  return (
    <div className="pp-fila">
      <span className="pp-fila-nombre">{l.etiqueta}</span>
      {campo('horas_base', 'Horas base', '0.25', '0')}
      {campo('incluido', 'Incluye', '1', '0')}
      {campo('horas_por_tramo', 'Suma', '0.25', '0')}
      {campo('tramo', 'Por cada', '1', '1')}
      {/* Lo que de verdad quiere saber quien configura: «si un cliente tiene N, ¿cuánto le
          cobro?». Se recalcula mientras se teclea. */}
      <span className="pp-col pp-col-ej pp-fila-ejemplo">
        {ejemplo} → <strong>{hs(horas)}</strong>
        {/* El ejemplo se cuenta con la tarifa en dólares: es una ilustración del
            escalado por volumen, no una cotización. */}
        {tarifa > 0 && <> · {importeClaux(horas * tarifa, 'USD')}</>}
      </span>
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
        <div className="form-label-with-help">
          <label htmlFor="pp-tarifaHora">Tarifa por hora</label>
          <FormHelp text="La instalación se cotiza en horas y esta tarifa las convierte en dinero. Cada moneda tiene su tarifa propia —la de euros no sale de convertir la de dólares— y en cada presupuesto se puede pactar otra para ese cliente." label="Cómo se usa la tarifa por hora" />
        </div>
        {/* La moneda va DELANTE del número, pegada a la casilla, y la unidad detrás:
            el campo se lee «USD [20] / hora». El rótulo de arriba ya dice qué es,
            así que aquí solo hace falta lo que distingue un campo del otro. */}
        <div className="pp-tarifas">
          {MONEDAS_CLAUX.map(moneda => {
            const k = TARIFA_DE[moneda]
            return (
              <div className="pp-tarifa" key={moneda}>
                <span className="pp-tarifa-campo">
                  <span className="pp-tarifa-moneda" aria-hidden="true">{moneda}</span>
                  <input id={`pp-${k}`} type="number" min="0" step="any"
                    className="input pp-tarifa-input"
                    aria-label={AJUSTES_PRESUPUESTO[k].label}
                    value={escalares[k]} onChange={e => setEscalares(p => ({ ...p, [k]: e.target.value }))} />
                </span>
                <span className="pp-tarifa-unidad">/ hora</span>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <p className="mod-list-label">Horas que se cobran siempre</p>
        <div className="grid-cols-2">
          {CLAVES.filter(k => !TARIFAS.includes(k)).map(k => (
            <div key={k} className="input-group">
              <label htmlFor={`pp-${k}`}>{AJUSTES_PRESUPUESTO[k].label}</label>
              <input id={`pp-${k}`} type="number" min="0" step="any" className="input"
                value={escalares[k]} onChange={e => setEscalares(p => ({ ...p, [k]: e.target.value }))} />
            </div>
          ))}
        </div>
      </div>

      {/* La explicación va ARRIBA y con un caso concreto: la regla en abstracto no se entiende
          hasta verla aplicada a un número.
          UN SOLO HIJO dentro del aviso: `.alert` es `display: flex`, así que cada elemento
          suelto —cada `<strong>`, cada `<br>`— se convertía en una columna y la explicación
          salía descuartizada en cinco tiras verticales. */}
      <div className="alert alert-info">
        <div>
          <strong>Empresas: 1 h base, incluye 1, suma 0,5 h por cada 1.</strong>
          <span className="pp-ejemplo-regla">
            Un cliente con 4 empresas paga 1 h + 3 tramos × 0,5 h = 2,5 h. Un tramo empezado
            cuenta entero.
          </span>
        </div>
      </div>

      {([1, 2] as const).map(fase => (
        <div key={fase} className="pp-bloque">
          <p className="mod-list-label">
            {fase === 1 ? 'Configuración inicial' : 'Puesta en marcha'}
          </p>
          <CabeceraColumnas />
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
