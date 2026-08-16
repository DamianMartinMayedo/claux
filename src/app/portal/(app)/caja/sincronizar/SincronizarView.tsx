'use client'

import { useState, useTransition, useRef, type ChangeEvent } from 'react'
import { AlertTriangle, CheckCircle2, FileJson, Upload } from 'lucide-react'
import { ingestarLoteArchivo } from '@/app/actions/portal/caja'
import type { IngestaResultado, LotePayload } from '@/lib/caja/ingesta'
import { fechaEnTz } from '@/lib/fecha-tz'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'

interface Props { cajas: { caja_id: string; nombre: string }[]; puedeEditar: boolean }
// El tipo se IMPORTA. Estaba copiado a mano aquí con cuatro campos, y por eso esta pantalla
// no se enteró de que la ingesta empezó a devolver `rechazados`: enseñaba un tick verde
// sobre ventas que el servidor había tirado. Una lista paralela se queda corta en silencio.
type Resultado = IngestaResultado

/** Lo que se va a registrar, leído del propio archivo antes de tocar nada. */
interface Previo {
  destino:    string
  /** El punto de venta venía DENTRO del archivo (lo normal) o lo eligió el desplegable. */
  delArchivo: boolean
  payload:    LotePayload
  ventas:     number
  anuladas:   number
  cierres:    number
  abiertos:   number
  movimientos:number
  totales:    [string, number][]
  desde:      string | null
  hasta:      string | null
}

const money = (n: number) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dia   = (f: string) => { const [y, m, d] = f.split('-'); return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) }

/**
 * Resumen del lote SIN tocar la base de datos: todo sale del JSON que acaba de leer el
 * navegador. Las anuladas se descuentan de los totales igual que las descuenta la ingesta
 * (mig. 091), para que la cifra de la confirmación sea la que va a acabar en la contabilidad
 * y no una suma bruta que después no cuadra con nada.
 */
function resumir(payload: LotePayload, destino: string, delArchivo: boolean): Previo {
  const tickets = Array.isArray(payload.tickets) ? payload.tickets : []
  const cierres = Array.isArray(payload.cierres) ? payload.cierres : []
  const movs    = Array.isArray(payload.movimientos) ? payload.movimientos : []

  const porMoneda = new Map<string, number>()
  let anuladas = 0
  let desde: string | null = null
  let hasta: string | null = null
  for (const t of tickets) {
    if ((t.estado ?? 'VIGENTE') === 'ANULADO') { anuladas += 1 }
    else porMoneda.set(t.moneda, (porMoneda.get(t.moneda) ?? 0) + Number(t.total || 0))
    if (t.fecha) {
      const f = fechaEnTz(t.fecha)
      if (!desde || f < desde) desde = f
      if (!hasta || f > hasta) hasta = f
    }
  }

  return {
    destino, delArchivo, payload,
    ventas: tickets.length,
    anuladas,
    cierres:  cierres.filter(c => (c.estado ?? 'CERRADA') === 'CERRADA').length,
    abiertos: cierres.filter(c => (c.estado ?? 'CERRADA') !== 'CERRADA').length,
    movimientos: movs.length,
    totales: [...porMoneda.entries()].sort((a, b) => b[1] - a[1]),
    desde, hasta,
  }
}

export default function SincronizarView({ cajas, puedeEditar }: Props) {
  // Solo se usa como respaldo para archivos viejos, que no traen el identificador.
  const [cajaId, setCajaId] = useState(cajas[0]?.caja_id ?? '')
  const [previo, setPrevio] = useState<Previo | null>(null)
  const [isPending, startTransition] = useTransition()
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const nombreDe = (id: string) => cajas.find(c => c.caja_id === id)?.nombre ?? id

  function limpiarInput() { if (fileRef.current) fileRef.current.value = '' }

  function cancelar() { setPrevio(null); limpiarInput() }

  /**
   * Elegir el archivo YA NO SINCRONIZA.
   *
   * Antes bastaba con abrir el explorador y pulsar un `.json` para que las ventas entraran
   * en la contabilidad: una acción irreversible (los ingresos y las salidas de stock que
   * escribe un cierre no tienen «deshacer») disparada por el gesto de elegir un fichero, sin
   * enseñar antes qué llevaba dentro ni a qué punto de venta iba. Ahora se lee, se resume y
   * se confirma — que es la regla del portal para cualquier acción crítica.
   */
  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResultado(null)
    setPrevio(null)
    const reader = new FileReader()
    reader.onload = () => {
      let payload: LotePayload
      try { payload = JSON.parse(String(reader.result)) }
      catch { toastError('El archivo no es un JSON válido.'); limpiarInput(); return }

      // El archivo exportado lleva dentro de qué punto de venta salió. Se usa ESE y no
      // el desplegable: elegir mal metía las ventas en otra empresa, descontaba de otro
      // almacén y posteaba a otra cuenta, sin vuelta atrás. El desplegable queda solo
      // para archivos viejos, exportados antes de que se escribiera el identificador.
      const delArchivo: string | null = typeof payload?.caja === 'string' && payload.caja ? payload.caja : null

      if (delArchivo && !cajas.some(c => c.caja_id === delArchivo)) {
        toastError('El archivo es de un punto de venta que no existe o no es tuyo.')
        limpiarInput()
        return
      }

      const destino = delArchivo ?? cajaId
      if (!destino) { toastError('No hay ningún punto de venta al que asignar el archivo.'); limpiarInput(); return }

      const resumen = resumir(payload, destino, !!delArchivo)
      if (resumen.ventas + resumen.cierres + resumen.abiertos + resumen.movimientos === 0) {
        toastError('El archivo no trae ninguna venta ni ningún cierre.')
        limpiarInput()
        return
      }
      setPrevio(resumen)
    }
    reader.readAsText(file)
  }

  function confirmar() {
    if (!previo) return
    const ld = toastLoading('Sincronizando…')
    startTransition(async () => {
      const r = await ingestarLoteArchivo(previo.destino, previo.payload)
      await ld.dismiss()
      if (!r.ok || !r.resultado) { toastError(r.error ?? 'No se pudo procesar el archivo.'); return }
      setResultado(r.resultado)
      setPrevio(null)
      toastSuccess(`Archivo sincronizado en ${nombreDe(previo.destino)}.`)
      limpiarInput()
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sincronizar</h1>
          <p className="page-subtitle">
            Sube el archivo exportado por un punto de venta sin conexión. Se registra por fecha, sin duplicar.
          </p>
        </div>
      </div>

      <div className="card caja-config-section">
        {cajas.length === 0 ? (
          <p className="caja-install-hint">Primero crea un punto de venta en la sección Puntos de venta.</p>
        ) : !puedeEditar ? (
          <p className="caja-install-hint">Solo consulta: no tienes permiso para sincronizar archivos en este módulo.</p>
        ) : (
          <div className="caja-install">
            <div className="input-group">
              <label htmlFor="sync-file">Archivo del punto de venta (.json)</label>
              <input id="sync-file" ref={fileRef} type="file" accept="application/json,.json"
                className="input" onChange={onFile} disabled={isPending} />
              <p className="caja-install-hint">Nada se registra hasta que lo confirmes.</p>
            </div>

            {/* Respaldo para archivos exportados antes de que el export escribiera el
                identificador. Con uno actual no se llega a usar. */}
            {cajas.length > 1 && !previo && (
              <details className="caja-sync-manual">
                <summary>Elegir el punto de venta a mano</summary>
                <div className="input-group">
                  <label htmlFor="sync-caja">Punto de venta</label>
                  <select id="sync-caja" className="input" value={cajaId} onChange={e => setCajaId(e.target.value)}>
                    {cajas.map(c => <option key={c.caja_id} value={c.caja_id}>{c.nombre}</option>)}
                  </select>
                  <p className="caja-install-hint">Solo para archivos de versiones antiguas.</p>
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {/* LA CONFIRMACIÓN. Qué trae el archivo y a dónde va, antes de escribir nada. */}
      {previo && (
        <div className="card caja-previo">
          <h2 className="mon-section-title">Esto es lo que se va a registrar</h2>

          <div className={`alert ${previo.delArchivo ? 'alert-info' : 'alert-warning'} alert-intro`}>
            <FileJson size={16} strokeWidth={2} />
            <span>
              {previo.delArchivo
                ? <>Archivo de <strong>{nombreDe(previo.destino)}</strong>.</>
                : <>El archivo no dice de qué punto de venta salió. Se registrará en{' '}
                    <strong>{nombreDe(previo.destino)}</strong>, el que has elegido a mano.</>}
              {previo.desde && (
                <> Ventas del {dia(previo.desde)}{previo.hasta !== previo.desde ? ` al ${dia(previo.hasta!)}` : ''}.</>
              )}
            </span>
          </div>

          <ul className="caja-previo-lista">
            <li>
              <span>{previo.ventas} {previo.ventas === 1 ? 'venta' : 'ventas'}</span>
              {previo.anuladas > 0 && (
                <span className="caja-previo-nota">
                  {previo.anuladas === 1 ? 'incluye 1 anulada, que no suma' : `incluyen ${previo.anuladas} anuladas, que no suman`}
                </span>
              )}
            </li>
            <li>
              <span>{previo.cierres} {previo.cierres === 1 ? 'cierre de turno' : 'cierres de turno'}</span>
              <span className="caja-previo-nota">es lo que lleva el dinero a tu contabilidad</span>
            </li>
            {previo.abiertos > 0 && (
              <li>
                <span>{previo.abiertos} {previo.abiertos === 1 ? 'turno sin cerrar' : 'turnos sin cerrar'}</span>
                <span className="caja-previo-nota">sus ventas entran; el dinero llega cuando se cierre</span>
              </li>
            )}
            {previo.movimientos > 0 && (
              <li>
                <span>{previo.movimientos} {previo.movimientos === 1 ? 'entrada o salida de efectivo' : 'entradas y salidas de efectivo'}</span>
              </li>
            )}
          </ul>

          {previo.totales.length > 0 && (
            <div className="caja-totales">
              {previo.totales.map(([m, v]) => (
                <span key={m} className="caja-total-chip">
                  <span className="caja-total-cod">{m}</span>
                  <strong>{money(v)}</strong>
                </span>
              ))}
            </div>
          )}

          <p className="caja-install-hint">
            Lo que ya esté registrado no se duplica: cada venta y cada cierre se reconocen por
            su identificador. Si vuelves a subir el mismo archivo, se queda todo como está.
          </p>

          <div className="caja-actions">
            <button type="button" className="btn btn-primary" onClick={confirmar} disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Registrando…</>
                : <><Upload size={14} strokeWidth={2} /> Registrar en {nombreDe(previo.destino)}</>}
            </button>
            <button type="button" className="btn btn-secondary" onClick={cancelar} disabled={isPending}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* El titular sigue al RESULTADO, no al hecho de que el archivo se procesara. Antes
          era siempre un tick verde: con los 20 tickets rechazados, la pantalla daba el
          visto bueno y dejaba el motivo en letra pequeña debajo. */}
      {resultado && (() => {
        const rechazados = resultado.rechazados?.length ?? 0
        return (
          <div className="card">
            <div className={`alert ${rechazados > 0 ? 'alert-warning' : 'alert-success'} alert-intro`}>
              {rechazados > 0
                ? <AlertTriangle size={16} strokeWidth={2} />
                : <CheckCircle2 size={16} strokeWidth={2} />}
              <span>
                {rechazados > 0 && (
                  <><strong>{rechazados} {rechazados === 1 ? 'venta no se registró' : 'ventas no se registraron'}</strong>. </>
                )}
                {resultado.tickets_nuevos} ventas nuevas · {resultado.cierres_posteados} cierres registrados · {resultado.duplicados} ya existentes
                {rechazados > 0 && '. Lo rechazado sigue en el dispositivo: corrige lo de abajo y vuelve a sincronizar.'}
              </span>
            </div>
            {resultado.errores.length > 0 && (
              <ul className="caja-install-hint">
                {resultado.errores.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )
      })()}
    </div>
  )
}
