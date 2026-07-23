'use client'

import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import type { MonedaOpcion } from '@/app/actions/portal/monedas'
import { textoTasa }        from './form-helpers'

export interface EmpresaDestinoOpcion {
  empresa_id:       string
  nombre:           string
  moneda_funcional: string | null
}

/** Importe de la ficha que hay que revisar al cambiar de moneda. */
export interface ImporteCopia {
  label: string
  valor: number
  /**
   * ¿El importe es el mismo dinero dicho en otra moneda? El límite de crédito de
   * un cliente sí lo es (un tope de riesgo): se convierte con la tasa. Un salario
   * NO: en la otra empresa se pacta aparte y casi nunca es la conversión — quien
   * cobra 65.000 CUP aquí puede cobrar 300 USD allá, no los 98 de la tasa —, así
   * que el campo se pide en blanco y la tasa queda como atajo.
   */
  seConvierte: boolean
}

function fmt(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Modal genérico para copiar un registro (cliente/proveedor o empleado) a otra
// empresa. El registro copiado es INDEPENDIENTE: cada empresa lleva su propia
// relación (moneda, CxC, contrato). La moneda se propone desde la funcional de
// la empresa destino en vez de arrastrar la de origen, que dejaba la ficha con
// una moneda que no era la de su empresa. `onCopiar` ejecuta la server action.
export default function CopiarAEmpresaModal({
  titulo, descripcion, empresas, monedas, monedaOrigen, empresaOrigen, importe, tasas,
  onCopiar, onClose, onCopiado,
}: {
  titulo:       string
  descripcion:  string
  /** Empresas destino (sin la de origen). */
  empresas:     EmpresaDestinoOpcion[]
  monedas:      MonedaOpcion[]
  monedaOrigen: string | null
  /** Nombre de la empresa de la ficha original, para situar sus importes. */
  empresaOrigen: string
  /** Importe de la ficha; se reescribe con la tasa al cambiar de moneda. */
  importe?:     ImporteCopia
  /** Factores origen→destino, clave "ORIGEN__DESTINO". */
  tasas?:       Record<string, number>
  onCopiar:     (empresaId: string, moneda: string | null, importe: number | null) => Promise<{ ok: boolean; error?: string }>
  onClose:      () => void
  onCopiado:    () => void
}) {
  const monedaDe = (id: string) => empresas.find(e => e.empresa_id === id)?.moneda_funcional ?? null

  // Moneda inicial: la de la empresa destino que sale seleccionada.
  const monedaIni = monedaDe(empresas[0]?.empresa_id ?? '') ?? monedaOrigen ?? ''
  const valorIni  = importe?.valor ?? 0

  // Importe con la tasa vigente. Siempre parte del valor original: ir y volver
  // de moneda no debe erosionarlo con redondeos. '' si no hay tasa.
  function conTasa(destino: string): string {
    const f = valorIni && monedaOrigen && destino ? tasas?.[`${monedaOrigen}__${destino}`] : undefined
    return f ? (valorIni * f).toFixed(2) : ''
  }

  // Con qué valor arranca el campo al elegir `destino`.
  //  · Misma moneda      → el de la ficha: es el mismo dinero.
  //  · Otra, convertible → la conversión (límite de crédito).
  //  · Otra, pactable    → en blanco: el salario de la otra empresa lo pone el
  //    dueño. Un número plausible pero inventado se acepta sin mirar; un campo
  //    vacío se ve.
  function valorPara(destino: string): string {
    if (!valorIni) return ''
    if (!monedaOrigen || !destino || destino === monedaOrigen) return valorIni.toString()
    if (!importe?.seConvierte) return ''
    return conTasa(destino) || valorIni.toString()
  }

  const [empresaId, setEmpresaId] = useState(empresas[0]?.empresa_id ?? '')
  const [moneda,    setMoneda]    = useState<string>(monedaIni)
  const [valor,     setValor]     = useState<string>(() => valorPara(monedaIni))
  const [isPending, startTransition] = useTransition()

  const empresa   = empresas.find(e => e.empresa_id === empresaId)
  const funcional = empresa?.moneda_funcional ?? null

  // Cambiar de empresa reajusta la moneda a la suya: es el motivo de la copia.
  function handleEmpresa(id: string) {
    const m = monedaDe(id) ?? monedaOrigen ?? ''
    setEmpresaId(id)
    setMoneda(m)
    setValor(valorPara(m))
  }
  function handleMoneda(m: string) {
    setMoneda(m)
    setValor(valorPara(m))
  }

  const cambiaMoneda = !!monedaOrigen && !!moneda && moneda !== monedaOrigen
  const factor       = cambiaMoneda ? tasas?.[`${monedaOrigen}__${moneda}`] : undefined
  // Solo alarma si el importe DEBÍA convertirse solo y no se pudo. Cuando se
  // pide en blanco, no tener tasa no es un problema: no hay atajo, y ya está.
  const avisoSinTasa = cambiaMoneda && !factor && valorIni > 0 && !!importe?.seConvierte

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    // Sin campo de importe se manda null y la copia conserva el de la ficha;
    // con campo, se manda lo que se vea — vaciarlo significa cero, no "el de antes".
    let importeFinal: number | null = null
    if (importe) {
      const n = valor.trim() === '' ? 0 : parseFloat(valor)
      importeFinal = isNaN(n) ? null : n
    }
    const ld = toastLoading('Copiando…')
    startTransition(async () => {
      const r = await onCopiar(empresaId, moneda || null, importeFinal)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo copiar.'); return }
      toastSuccess('Copiado a la otra empresa.')
      onCopiado()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{titulo}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="input-group">
              <label htmlFor="copiar-empresa">Empresa destino</label>
              <select id="copiar-empresa" className="input" value={empresaId}
                onChange={e => handleEmpresa(e.target.value)}>
                {empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
              </select>
              <span className="input-hint">{descripcion}</span>
            </div>

            <div className="input-group">
              <label htmlFor="copiar-moneda">Moneda</label>
              <select id="copiar-moneda" className="input" value={moneda}
                onChange={e => handleMoneda(e.target.value)}>
                <option value="">— Sin especificar —</option>
                {monedas.map(m => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.nombre ? `${m.codigo} — ${m.nombre}` : m.codigo}
                  </option>
                ))}
              </select>
              <span className="input-hint">
                {funcional && moneda === funcional
                  ? `Moneda de ${empresa?.nombre}.`
                  : funcional
                    ? `${empresa?.nombre} opera en ${funcional}.`
                    : `${empresa?.nombre} no tiene moneda definida. Puedes elegirla aquí.`}
              </span>
            </div>

            {importe && (
              <div className="input-group">
                <label htmlFor="copiar-importe">
                  {importe.label}{moneda && ` en ${moneda}`}
                </label>
                <input id="copiar-importe" className="input" type="number" min="0" step="0.01"
                  value={valor} onChange={e => setValor(e.target.value)} placeholder="0.00" />
                <span className={`input-hint${avisoSinTasa ? ' input-hint-warning' : ''}`}>
                  {!cambiaMoneda || valorIni === 0 ? (
                    `En ${moneda || 'la moneda de la ficha'}.`
                  ) : importe.seConvierte ? (
                    factor
                      ? `Convertido de ${fmt(valorIni)} ${monedaOrigen} con la tasa vigente (${textoTasa(monedaOrigen!, moneda, factor)}). Corrígelo si no coincide.`
                      : `No hay tasa ${monedaOrigen} → ${moneda}: este importe sigue en ${monedaOrigen}. Escríbelo en ${moneda}.`
                  ) : (
                    <>
                      En {empresaOrigen} es {fmt(valorIni)} {monedaOrigen}. Escribe el de esta empresa
                      {factor && <> o <button type="button" className="aplicar-tasa-btn"
                        onClick={() => setValor(conTasa(moneda))}>usa la tasa ({fmt(valorIni * factor)} {moneda})</button></>}.
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || !empresaId}>
              {isPending ? <><span className="spinner spinner-sm" /> Copiando…</> : 'Copiar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
