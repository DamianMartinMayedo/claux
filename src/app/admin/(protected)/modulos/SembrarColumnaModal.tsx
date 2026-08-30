'use client'

import { X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { useToast } from '@/app/contexts/ToastContext'
import { previsualizarSiembra, aplicarSiembra, type FilaSiembra } from '@/app/actions/modulos'
import ImpactoPrecios, { type ImpactoFila } from './ImpactoPrecios'
import { NIVELES, type Nivel } from '@/lib/niveles'
import { MONEDAS_CLAUX, importeClaux, type MonedaClaux } from '@/lib/moneda-claux'

/**
 * Sembrar una casilla de precios desde otra. Una casilla es MONEDA × NIVEL: seis
 * en total desde la mig. 225, y por eso el origen y el destino se eligen con dos
 * desplegables cada uno. Con eso, «Empresa = Inicial ×2» y «el euro parte del
 * dólar» son la misma operación y no hacen falta dos herramientas.
 *
 * La regla del plan (D2) es Empresa = Inicial ×2 y Pro = Inicial ×2,5 al alza al
 * múltiplo de 5, y por eso elegir destino ya rellena multiplicador y redondeo:
 * lo normal no debería costar tres campos. Pero **siembra, no manda** — después
 * cada celda se edita a mano en su módulo. Ahí está el sentido de todo esto: el
 * precio en euros queda TECLEADO, no recalculado por una tasa que cambia a diario.
 *
 * Nunca escribe sin enseñar antes qué queda y a quién le cambia la cuota.
 */
const SUGERENCIA: Record<Nivel, { mult: number; redondeo: number }> = {
  inicial: { mult: 1,   redondeo: 0 },
  empresa: { mult: 2,   redondeo: 0 },
  pro:     { mult: 2.5, redondeo: 5 },
}

/**
 * Cambiar SOLO de moneda parte de la paridad: la columna de euros nació 1:1 con
 * la de dólares (mig. 225) porque no es una conversión. Proponer aquí un ×0,92
 * sería colar la tasa del día por la puerta de atrás.
 */
function sugerir(desde: Nivel, hasta: Nivel) {
  return desde === hasta ? { mult: 1, redondeo: 0 } : SUGERENCIA[hasta]
}

export default function SembrarColumnaModal({ nombresNivel }: { nombresNivel: Record<Nivel, string> }) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  const mounted = useMounted()

  const [open, setOpen] = useState(false)
  const [origen, setOrigen]   = useState<Nivel>('inicial')
  const [destino, setDestino] = useState<Nivel>('empresa')
  const [origenMoneda, setOrigenMoneda]   = useState<MonedaClaux>('USD')
  const [destinoMoneda, setDestinoMoneda] = useState<MonedaClaux>('USD')
  const [mult, setMult]         = useState('2')
  const [redondeo, setRedondeo] = useState('0')
  const [cargando, setCargando] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [filas, setFilas]     = useState<FilaSiembra[] | null>(null)
  const [impacto, setImpacto] = useState<ImpactoFila[]>([])

  function reset() {
    setFilas(null); setImpacto([])
  }

  function handleClose() {
    setOpen(false)
    reset()
  }

  useModalKeyboard(open, handleClose)

  function cambiarOrigen(n: Nivel) {
    setOrigen(n)
    const s = sugerir(n, destino)
    setMult(String(s.mult))
    setRedondeo(String(s.redondeo))
    reset()
  }

  function cambiarDestino(n: Nivel) {
    setDestino(n)
    const s = sugerir(origen, n)
    setMult(String(s.mult))
    setRedondeo(String(s.redondeo))
    reset()
  }

  async function handlePrevisualizar() {
    setCargando(true)
    const res = await previsualizarSiembra(
      origenMoneda, origen, destinoMoneda, destino, Number(mult), Number(redondeo))
    setCargando(false)
    if (!res.ok) { toastError(res.error ?? 'No se pudo calcular'); return }
    setFilas(res.filas)
    setImpacto(res.impacto)
  }

  async function handleAplicar() {
    setAplicando(true)
    const res = await aplicarSiembra(
      origenMoneda, origen, destinoMoneda, destino, Number(mult), Number(redondeo))
    setAplicando(false)
    if (!res.ok) { toastError(res.error ?? 'No se pudo aplicar'); return }
    toastSuccess(
      res.escritos === 0
        ? 'La casilla ya estaba así: nada que cambiar'
        : `Casilla sembrada · ${res.escritos} módulo(s) · ${res.clientesRecalculados} cliente(s) recalculado(s)`,
    )
    handleClose()
    router.refresh()
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2 className="modal-title">Sembrar una casilla de precios</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="text-xs-muted">
            Rellena una casilla entera a partir de otra. Es el punto de partida: después
            cada precio se ajusta a mano en su módulo.
          </p>

          <div className="grid-cols-2">
            <div className="input-group">
              <label htmlFor="sem-origen">Nivel de origen</label>
              <select id="sem-origen" className="input" value={origen}
                      onChange={e => cambiarOrigen(e.target.value as Nivel)}>
                {NIVELES.map(n => <option key={n} value={n}>{nombresNivel[n]}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="sem-origen-moneda">Moneda de origen</label>
              <select id="sem-origen-moneda" className="input" value={origenMoneda}
                      onChange={e => { setOrigenMoneda(e.target.value as MonedaClaux); reset() }}>
                {MONEDAS_CLAUX.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="grid-cols-2">
            <div className="input-group">
              <label htmlFor="sem-destino">Nivel de destino</label>
              <select id="sem-destino" className="input" value={destino}
                      onChange={e => cambiarDestino(e.target.value as Nivel)}>
                {NIVELES.map(n => <option key={n} value={n}>{nombresNivel[n]}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="sem-destino-moneda">Moneda de destino</label>
              <select id="sem-destino-moneda" className="input" value={destinoMoneda}
                      onChange={e => { setDestinoMoneda(e.target.value as MonedaClaux); reset() }}>
                {MONEDAS_CLAUX.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="grid-cols-2">
            <div className="input-group">
              <label htmlFor="sem-mult">Multiplicar por</label>
              <input id="sem-mult" className="input" type="number" min="0" step="any"
                     value={mult} onChange={e => { setMult(e.target.value); reset() }} />
            </div>
            <div className="input-group">
              <label htmlFor="sem-redondeo">Redondear al alza</label>
              <select id="sem-redondeo" className="input" value={redondeo}
                      onChange={e => { setRedondeo(e.target.value); reset() }}>
                <option value="0">Sin redondear</option>
                <option value="1">A la unidad</option>
                <option value="5">A múltiplos de 5</option>
                <option value="10">A múltiplos de 10</option>
              </select>
            </div>
          </div>

          {filas !== null && (
            <>
              <h3 className="mod-paginas-title">
                {filas.length === 0
                  ? 'La casilla ya está así: no cambia ningún precio.'
                  : `Cambian ${filas.length} precio${filas.length !== 1 ? 's' : ''}`}
              </h3>

              {filas.length > 0 && (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Módulo</th>
                        <th className="col-num">Ahora</th>
                        <th className="col-num">Quedaría</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map(f => (
                        <tr key={f.clave}>
                          <td data-label="Módulo"><span className="cell-clamp">{f.nombre}</span></td>
                          <td data-label="Ahora" className="col-num table-price">
                            {importeClaux(f.actual, destinoMoneda)}
                          </td>
                          <td data-label="Quedaría" className="col-num table-price">
                            {importeClaux(f.nuevo, destinoMoneda)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <ImpactoPrecios impacto={impacto} nombresNivel={nombresNivel} />
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
          {filas === null ? (
            <button type="button" className="btn btn-primary" onClick={handlePrevisualizar} disabled={cargando}>
              {cargando ? <><span className="spinner" /> Calculando…</> : 'Previsualizar'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={handleAplicar}
                    disabled={aplicando || filas.length === 0}>
              {aplicando ? <><span className="spinner" /> Aplicando…</> : 'Aplicar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>Sembrar precios</button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
