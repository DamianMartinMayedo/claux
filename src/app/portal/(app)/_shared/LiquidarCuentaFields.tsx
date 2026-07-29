'use client'

// Campos reutilizables para liquidar un documento (factura / gasto / cobro) desde una caja.
// La caja de la MISMA moneda del documento aparece primero, pero se puede elegir cualquiera:
// si la caja es de otra moneda se aplica una tasa (misma lógica que las transferencias),
// el importe se introduce en la moneda del documento y se muestra lo que se moverá en la caja.
// El componente NO envía por sí solo: reporta su estado con onChange y el modal padre inyecta
// cuenta_id / monto / tasa_cambio en el FormData al enviar.

import { useEffect, useMemo, useRef, useState } from 'react'
import { obtenerTasaTransferencia } from '@/app/actions/portal/tesoreria'

export interface CuentaOpcion {
  cuenta_id: string
  nombre:    string
  moneda:    string
  /** Empresa de la caja. Cobrar/pagar desde otra empresa está PERMITIDO (el dueño
   *  suele tener una sola cartera), pero el movimiento se sella con la empresa de la
   *  CAJA: si no se dice, el ingreso de una empresa acaba en la caja de otra sin que
   *  nada lo indique, y el resultado por empresa deja de cuadrar con su flujo. */
  empresa_id?:     string
  empresa_nombre?: string
}

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
  cuentas, docMoneda, saldo, docEmpresaId, docEmpresaNombre, onChange,
}: {
  cuentas:   CuentaOpcion[]
  docMoneda: string
  saldo:     number
  /** Empresa del documento que se liquida, para avisar si la caja es de otra. */
  docEmpresaId?:     string
  docEmpresaNombre?: string
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
  /** Tasa traída del servidor o escrita a mano. Solo se usa si la moneda cambia. */
  const [tasaCargada, setTasaCargada]   = useState(1)
  /** Par de monedas cuya tasa ya llegó. «Cargando» se DERIVA de comparar con el par
   *  actual, en vez de encender y apagar un flag desde el efecto: así no puede quedarse
   *  encendido si la petición muere, y el efecto solo escribe en su callback. */
  const [parResuelto, setParResuelto]   = useState<string | null>(null)

  const cuentaSel   = ordenadas.find(c => c.cuenta_id === cuentaId)
  const cajaMoneda  = cuentaSel?.moneda ?? docMoneda
  const cambiaMoneda = cajaMoneda !== docMoneda

  /** Solo se puede saber si hay empresa en los dos lados; si falta, no se inventa aviso. */
  const esDeOtraEmpresa = (c: CuentaOpcion) =>
    !!docEmpresaId && !!c.empresa_id && c.empresa_id !== docEmpresaId

  // Cargar la tasa vigente al cambiar de caja, solo si la moneda difiere.
  //
  // La rama de «misma moneda» ya NO escribe estado (era un `setState` síncrono dentro
  // del efecto, con su cascada de repintados): `tasaCompleta` se lee derivada más abajo
  // y vale 1 cuando no hay cambio de moneda, así que no había nada que resetear. Lo
  // único que el efecto escribe ahora es el resultado de una petición, que es
  // asíncrono por naturaleza y para eso está el efecto.
  const parTasa = cambiaMoneda ? `${docMoneda}>${cajaMoneda}` : ''
  const cargandoTasa = !!parTasa && parResuelto !== parTasa

  useEffect(() => {
    if (!parTasa) return
    let vivo = true
    obtenerTasaTransferencia(docMoneda, cajaMoneda)
      .then(r => {
        if (!vivo) return
        if (r.ok && r.tasa) { setTasaCargada(r.tasa); setTasaInput(truncar4(r.tasa)) }
        else                { setTasaCargada(0); setTasaInput('') }
      })
      .catch(() => { if (vivo) { setTasaCargada(0); setTasaInput('') } })
      .finally(() => { if (vivo) setParResuelto(parTasa) })
    return () => { vivo = false }
  }, [parTasa, cajaMoneda, docMoneda])

  // Con la misma moneda la tasa es 1 por definición: se DERIVA en vez de guardarse, que
  // es lo que obligaba a resetear estado desde el efecto de arriba.
  const tasaCompleta = cambiaMoneda ? tasaCargada : 1

  const montoNum  = parseFloat(monto) || 0
  // El importe en la caja es DERIVADO (importe × tasa) salvo que se haya escrito a mano.
  // Antes se derivaba dos veces: aquí para el cálculo y en un efecto para el input, con
  // un `setState` síncrono que disparaba una cascada de repintados por cada tecla. Ahora
  // el input lee esta misma cifra, así que no hay dos verdades ni efecto que sincronizar.
  const impCajaCalc = Math.round(montoNum * tasaCompleta * 100) / 100
  const impCajaNum = editandoCaja ? (parseFloat(impCaja) || 0) : impCajaCalc
  const impCajaVista = editandoCaja ? impCaja : (impCajaCalc > 0 ? String(impCajaCalc) : '')
  const cajaMonto = cambiaMoneda ? impCajaNum : montoNum
  const excedeSaldo = montoNum > saldo + 0.005 // margen de 0.005 para redondeos
  const valido    = !!cuentaId && montoNum > 0 && !excedeSaldo && (!cambiaMoneda || tasaCompleta > 0)

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
    setTasaCargada(parseFloat(v) || 0)
    setEditandoCaja(false)
    setImpCaja('')
  }

  function handleImpCaja(v: string) {
    setImpCaja(v)
    setEditandoCaja(true)
    const caja = parseFloat(v) || 0
    if (caja > 0 && montoNum > 0) {
      const nueva = caja / montoNum
      setTasaCargada(nueva)
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
              {esDeOtraEmpresa(c) ? ` · ${c.empresa_nombre ?? 'otra empresa'}` : ''}
            </option>
          ))}
        </select>
        {cuentaSel && esDeOtraEmpresa(cuentaSel) && (
          <span className="input-hint-warning">
            Esta caja es de {cuentaSel.empresa_nombre ?? 'otra empresa'}
            {docEmpresaNombre ? ` y el documento es de ${docEmpresaNombre}` : ''}: el dinero
            entrará en la caja de la otra empresa.
          </span>
        )}
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
              value={impCajaVista} onChange={e => handleImpCaja(e.target.value)} placeholder="0.00" />
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
