'use client'

// Campos reutilizables para liquidar un documento (factura / gasto / cobro) desde una caja.
// La caja de la MISMA moneda del documento aparece primero, pero se puede elegir cualquiera:
// si la caja es de otra moneda se aplica una tasa (misma lógica que las transferencias),
// el importe se introduce en la moneda del documento y se muestra lo que se moverá en la caja.
// El componente NO envía por sí solo: reporta su estado con onChange y el modal padre inyecta
// cuenta_id / monto / tasa_cambio en el FormData al enviar.

import { useEffect, useMemo, useRef, useState } from 'react'
import { obtenerTasaTransferencia } from '@/app/actions/portal/tesoreria'

export interface CuentaOpcion { cuenta_id: string; nombre: string; moneda: string }

export interface LiquidarState {
  cuentaId:     string
  monto:        string   // importe en la moneda del documento
  tasa:         number   // caja/doc (1 si misma moneda)
  cajaMoneda:   string
  cajaMonto:    number   // lo que entra/sale de la caja
  cambiaMoneda: boolean
  valido:       boolean
}

function truncar4(n: number): string {
  return String(Math.trunc(n * 10000) / 10000)
}
function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function LiquidarCuentaFields({
  cuentas, docMoneda, saldo, onChange,
}: {
  cuentas:   CuentaOpcion[]
  docMoneda: string
  saldo:     number
  onChange:  (s: LiquidarState) => void
}) {
  // Misma moneda primero, luego alfabético
  const ordenadas = useMemo(
    () => [...cuentas].sort((a, b) =>
      (a.moneda === docMoneda ? 0 : 1) - (b.moneda === docMoneda ? 0 : 1) ||
      a.nombre.localeCompare(b.nombre)),
    [cuentas, docMoneda],
  )

  const [cuentaId, setCuentaId]         = useState(ordenadas[0]?.cuenta_id ?? '')
  const [monto, setMonto]               = useState(saldo > 0 ? saldo.toFixed(2) : '')
  const [impCaja, setImpCaja]           = useState('')
  const [editandoCaja, setEditandoCaja] = useState(false)
  const [tasaInput, setTasaInput]       = useState('')
  const [tasaCompleta, setTasaCompleta] = useState(1)
  const [cargandoTasa, setCargandoTasa] = useState(false)

  const cuentaSel   = ordenadas.find(c => c.cuenta_id === cuentaId)
  const cajaMoneda  = cuentaSel?.moneda ?? docMoneda
  const cambiaMoneda = cajaMoneda !== docMoneda

  // Cargar tasa vigente al cambiar de caja (solo si la moneda difiere)
  useEffect(() => {
    if (!cambiaMoneda) { setTasaCompleta(1); setTasaInput(''); setCargandoTasa(false); return }
    let vivo = true
    setCargandoTasa(true)
    obtenerTasaTransferencia(docMoneda, cajaMoneda)
      .then(r => {
        if (!vivo) return
        if (r.ok && r.tasa) { setTasaCompleta(r.tasa); setTasaInput(truncar4(r.tasa)) }
        else                { setTasaCompleta(0); setTasaInput('') }
      })
      .catch(() => { if (vivo) { setTasaCompleta(0); setTasaInput('') } })
      .finally(() => { if (vivo) setCargandoTasa(false) })
    return () => { vivo = false }
  }, [cuentaId, cambiaMoneda, cajaMoneda, docMoneda])

  const montoNum  = parseFloat(monto) || 0
  const impCajaNum = editandoCaja ? (parseFloat(impCaja) || 0) : Math.round(montoNum * tasaCompleta * 100) / 100
  const cajaMonto = cambiaMoneda ? impCajaNum : montoNum
  const excedeSaldo = montoNum > saldo + 0.005 // margen de 0.005 para redondeos
  const valido    = !!cuentaId && montoNum > 0 && !excedeSaldo && (!cambiaMoneda || tasaCompleta > 0)

  // Derivar el importe en la caja desde el importe del documento × tasa (salvo edición manual)
  useEffect(() => {
    if (cambiaMoneda && !editandoCaja && montoNum > 0 && tasaCompleta > 0) {
      setImpCaja(String(Math.round(montoNum * tasaCompleta * 100) / 100))
    }
  }, [monto, tasaCompleta, cambiaMoneda, editandoCaja, montoNum])

  // Reportar estado al padre sin re-suscribir al cambiar la referencia de onChange.
  // La asignación va en su propio efecto (no en el render) para no escribir en un
  // ref durante el render: bajo render concurrente eso daría valores inestables.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })
  useEffect(() => {
    onChangeRef.current({
      cuentaId, monto, tasa: cambiaMoneda ? tasaCompleta : 1,
      cajaMoneda, cajaMonto, cambiaMoneda, valido,
    })
  }, [cuentaId, monto, tasaCompleta, cambiaMoneda, cajaMoneda, cajaMonto, valido])

  function handleTasa(v: string) {
    setTasaInput(v)
    setTasaCompleta(parseFloat(v) || 0)
    setEditandoCaja(false)
    setImpCaja('')
  }

  function handleImpCaja(v: string) {
    setImpCaja(v)
    setEditandoCaja(true)
    const caja = parseFloat(v) || 0
    if (caja > 0 && montoNum > 0) {
      const nueva = caja / montoNum
      setTasaCompleta(nueva)
      setTasaInput(truncar4(nueva))
    }
  }

  return (
    <>
      <div className="input-group ter-col-full">
        <label>Caja <span className="required">*</span></label>
        <select className="input" value={cuentaId} onChange={e => setCuentaId(e.target.value)} required>
          {ordenadas.map(c => (
            <option key={c.cuenta_id} value={c.cuenta_id}>
              {c.nombre} · {c.moneda}{c.moneda === docMoneda ? '' : ' (otra moneda)'}
            </option>
          ))}
        </select>
      </div>

      <div className="input-group ter-col-span-3">
        <label>Importe ({docMoneda}) <span className="required">*</span></label>
        <input className="input" type="number" min="0" step="any" required
          value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" />
        <span className="input-hint">Saldo pendiente: {formatMonto(saldo)} {docMoneda}</span>
        {excedeSaldo && (
          <span className="input-hint-warning">El monto supera el saldo pendiente</span>
        )}
      </div>

      {cambiaMoneda && (
        <>
          <div className="input-group ter-col-span-3">
            <label>Tasa ({cajaMoneda}/{docMoneda}) <span className="required">*</span></label>
            <input className="input" type="number" min="0" step="any"
              value={tasaInput} onChange={e => handleTasa(e.target.value)}
              placeholder={cargandoTasa ? 'Cargando…' : '0.0000'} />
            {tasaCompleta <= 0 && !cargandoTasa && (
              <span className="input-hint-warning">No hay tasa para {docMoneda} → {cajaMoneda}. Escríbela.</span>
            )}
          </div>
          <div className="input-group ter-col-span-3">
            <label>Se moverá en la caja ({cajaMoneda})</label>
            <input className="input" type="number" min="0" step="any"
              value={impCaja} onChange={e => handleImpCaja(e.target.value)} placeholder="0.00" />
            <span className="input-hint">
              {montoNum > 0 && tasaCompleta > 0
                ? `Saldas ${formatMonto(montoNum)} ${docMoneda}; en la caja ${formatMonto(impCajaNum)} ${cajaMoneda}.`
                : 'Ajusta el importe o la tasa.'}
            </span>
          </div>
        </>
      )}
    </>
  )
}
