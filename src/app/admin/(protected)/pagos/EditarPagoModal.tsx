'use client'

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { editarPago } from '@/app/actions/pagos'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import ModalShell from '@/components/portal/ModalShell'
import { useMounted } from '@/lib/use-mounted'
import { MONEDAS_CLAUX, normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'

type Pago = {
  pago_id: string; client_id: string; concepto: string | null
  monto: number; metodo: string
  /** La del cobro. Se puede corregir aquí porque también se puede equivocar al
   *  registrarlo; lo que no se hace nunca es convertirla sola (mig. 225). */
  moneda: string | null
  fecha_inicio_periodo: string | null; fecha_fin_periodo: string | null
  notas: string | null
}

function toYMD(s: string | null): string {
  if (!s) return ''
  return s.split('T')[0]
}

function formatDateES(dateStr: string): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

/**
 * Editar un pago. Lo abre y lo cierra QUIEN LO USA (`onClose`), no él mismo: el
 * disparador ya no es un botón-icono suelto en la celda sino una entrada del menú
 * `<RowActions>` de la fila, y un componente que se pinta a sí mismo el botón no
 * cabe dentro de ese menú. El estado inicial sale del `pago` que recibe, así que
 * montarlo YA es abrirlo con los valores puestos — el `handleOpen` que reseteaba
 * los campos a mano sobraba.
 */
export default function EditarPagoModal({
  pago,
  clienteNombre,
  onClose,
}: {
  pago: Pago
  clienteNombre: string
  onClose: () => void
}) {
  const esConfiguracion = pago.concepto === 'configuracion'

  const [loading, setLoading] = useState(false)
  const mounted = useMounted()

  const [monto, setMonto]         = useState(String(pago.monto))
  const [moneda, setMoneda]       = useState<MonedaClaux>(normalizarMonedaClaux(pago.moneda))
  const [metodo, setMetodo]       = useState(pago.metodo)
  const [fechaInicio, setFechaInicio] = useState(toYMD(pago.fecha_inicio_periodo))
  const [fechaFin, setFechaFin]   = useState(toYMD(pago.fecha_fin_periodo))
  const [notas, setNotas]         = useState(pago.notas ?? '')

  const formRef = useRef<HTMLFormElement>(null)
  const router  = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await editarPago(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'No se ha podido guardar'); return }
    toastSuccess(res.esUltimo
      ? 'Pago actualizado · Expiración sincronizada'
      : 'Pago actualizado')
    // Se cierra al instante. Antes había un `setTimeout` de 1,4 s antes de cerrar y
    // recargar: en una conexión lenta eso es un modal que no responde al guardar, y
    // el aviso de que salió bien ya lo da el toast.
    onClose()
    router.refresh()
  }

  const modal = (
    <ModalShell
      size="modal-520"
      onClose={onClose}
      title="Editar pago"
      subtitle={`${pago.pago_id} · ${clienteNombre}`}
    >
      <form ref={formRef} onSubmit={handleSubmit}>
        <div className="modal-body">
          <input type="hidden" name="pago_id" value={pago.pago_id} />

          {/* Concepto + Método */}
          <div className="grid-cols-2">
            <div className="input-group">
              <label>Concepto</label>
              <div className="input input-display">
                {esConfiguracion ? 'Configuración (pago único)' : 'Suscripción'}
              </div>
            </div>
            <div className="input-group">
              <label>Método <span className="required">*</span></label>
              <select
                name="metodo"
                className="input"
                required
                value={metodo}
                onChange={e => setMetodo(e.target.value)}
              >
                <option value="tropipay">TropiPay</option>
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
              </select>
            </div>
          </div>

          {/* Monto y moneda: el importe sin su moneda no dice cuánto se cobró */}
          <div className="grid-cols-2">
            <div className="input-group">
              <label>Monto <span className="required">*</span></label>
              <input
                name="monto"
                type="number"
                step="any"
                min="0.01"
                className="input"
                required
                value={monto}
                onChange={e => setMonto(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="input-group">
              <label>Moneda <span className="required">*</span></label>
              <select name="moneda" className="input" required value={moneda}
                onChange={e => setMoneda(e.target.value as MonedaClaux)}>
                {MONEDAS_CLAUX.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Período (solo suscripción) */}
          {!esConfiguracion && (
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Inicio período <span className="required">*</span></label>
                <input
                  name="fecha_inicio_periodo"
                  type="date"
                  lang="es-ES"
                  className="input"
                  required
                  value={fechaInicio}
                  onChange={e => setFechaInicio(e.target.value)}
                />
                {fechaInicio && (
                  <span className="text-xs-muted">
                    {formatDateES(fechaInicio)}
                  </span>
                )}
              </div>
              <div className="input-group">
                <label>Fin período <span className="required">*</span></label>
                <input
                  name="fecha_fin_periodo"
                  type="date"
                  lang="es-ES"
                  className="input"
                  required
                  value={fechaFin}
                  onChange={e => setFechaFin(e.target.value)}
                />
                {fechaFin && (
                  <span className="text-xs-muted">
                    {formatDateES(fechaFin)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Notas */}
          <div className="input-group">
            <label>Notas</label>
            <textarea
              name="notas"
              className="input"
              rows={2}
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Referencia de pago, observaciones..."
            />
          </div>

        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <><span className="spinner" /> Guardando…</> : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </ModalShell>
  )

  return mounted ? createPortal(modal, document.body) : null
}
