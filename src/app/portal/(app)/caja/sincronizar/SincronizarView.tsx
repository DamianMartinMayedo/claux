'use client'

import { useState, useTransition, useRef, type ChangeEvent } from 'react'
import { AlertTriangle, CheckCircle2, FileJson } from 'lucide-react'
import { ingestarLoteArchivo } from '@/app/actions/portal/caja'
import type { IngestaResultado } from '@/lib/caja/ingesta'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'

interface Props { cajas: { caja_id: string; nombre: string }[] }
// El tipo se IMPORTA. Estaba copiado a mano aquí con cuatro campos, y por eso esta pantalla
// no se enteró de que la ingesta empezó a devolver `rechazados`: enseñaba un tick verde
// sobre ventas que el servidor había tirado. Una lista paralela se queda corta en silencio.
type Resultado = IngestaResultado

export default function SincronizarView({ cajas }: Props) {
  // Solo se usa como respaldo para archivos viejos, que no traen el identificador.
  const [cajaId, setCajaId] = useState(cajas[0]?.caja_id ?? '')
  const [detectada, setDetectada] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const nombreDe = (id: string) => cajas.find(c => c.caja_id === id)?.nombre ?? id

  function limpiarInput() { if (fileRef.current) fileRef.current.value = '' }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResultado(null)
    setDetectada(null)
    const reader = new FileReader()
    reader.onload = () => {
      let payload
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
      setDetectada(delArchivo)

      const ld = toastLoading('Sincronizando…')
      startTransition(async () => {
        const r = await ingestarLoteArchivo(destino, payload)
        await ld.dismiss()
        if (!r.ok || !r.resultado) { toastError(r.error ?? 'No se pudo procesar el archivo.'); limpiarInput(); return }
        setResultado(r.resultado)
        toastSuccess(`Archivo sincronizado en ${nombreDe(destino)}.`)
        limpiarInput()
      })
    }
    reader.readAsText(file)
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
        ) : (
          <div className="caja-install">
            <div className="input-group">
              <label htmlFor="sync-file">Archivo del punto de venta (.json)</label>
              <input id="sync-file" ref={fileRef} type="file" accept="application/json,.json"
                className="input" onChange={onFile} disabled={isPending} />
            </div>

            {detectada && (
              <div className="alert alert-info">
                <FileJson size={16} strokeWidth={2} />
                <span>Archivo de <strong>{nombreDe(detectada)}</strong>.</span>
              </div>
            )}

            {/* Respaldo para archivos exportados antes de que el export escribiera el
                identificador. Con uno actual no se llega a usar. */}
            {cajas.length > 1 && (
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

            {isPending && <p className="caja-install-hint"><span className="spinner spinner-sm" /> Procesando…</p>}
          </div>
        )}
      </div>

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
