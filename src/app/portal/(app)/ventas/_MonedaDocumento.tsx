'use client'

// ────────────────────────────────────────────────────────────────────────────
// Selector de moneda de un documento de venta (oferta / factura).
//
// Existe porque el `<select>` pelado que había antes solo cambiaba la ETIQUETA:
// un documento de 3.500 CUP pasaba a decir 3.500 USD sin tocar los importes, y el
// PDF salía impecable con un total ~120 veces mayor del que se quiso cobrar. No es
// que no convirtiera: es que reetiquetaba, en silencio.
//
// Criterio (el mismo que el salario en `rrhh/PersonalView`): el cambio se OFRECE y
// se confirma, nunca se impone. Después los importes quedan editables. La prioridad
// entre tarifa del catálogo, tasa e intacto vive en `planificarCambioMoneda`.
// ────────────────────────────────────────────────────────────────────────────

import { useState }      from 'react'
import { ConfirmDialog } from '@/components/portal/Dialog'
import {
  planificarCambioMoneda,
  tieneImportes,
  type AjusteInput,
  type LineaInput,
  type PrecioCatalogo,
} from './_ventas-helpers'

// Una tasa no se formatea como un importe: a 2 decimales, 1 CUP = 0,00833 USD se
// enseñaría como "0,01" y el dueño no podría comprobar si es la tasa que espera.
function formatearTasa(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

interface Props {
  moneda:   string
  monedas:  string[]
  /** "ORIGEN__DESTINO" → factor. Un par ausente significa que no cotiza. */
  tasas:    Record<string, number>
  /** Tarifas por moneda de los artículos. Vacío si no hay módulo que las aporte. */
  productos: PrecioCatalogo[]
  lineas:   LineaInput[]
  ajustes:  AjusteInput[]
  /** Recibe la moneda nueva y los importes ya reexpresados (o tal cual, si no hay
   *  nada que reexpresar). El padre aplica los tres cambios de una vez. */
  onChange: (moneda: string, lineas: LineaInput[], ajustes: AjusteInput[]) => void
}

export function MonedaDocumento({
  moneda, monedas, tasas, productos, lineas, ajustes, onChange,
}: Props) {
  const [pendiente, setPendiente] = useState<string | null>(null)

  const factor = pendiente ? tasas[`${moneda}__${pendiente}`] : undefined
  const plan   = pendiente
    ? planificarCambioMoneda(lineas, ajustes, pendiente, factor, productos)
    : null

  function pedirCambio(nueva: string) {
    // Sin importes que reexpresar, cambiar de moneda no tiene consecuencias.
    if (!nueva || nueva === moneda || !tieneImportes(lineas, ajustes)) {
      onChange(nueva, lineas, ajustes)
      return
    }
    setPendiente(nueva)
  }

  function confirmar() {
    if (!pendiente || !plan) return
    onChange(pendiente, plan.lineas, plan.ajustes)
    setPendiente(null)
  }

  // Solo es un aviso serio si queda algún importe que nadie ha podido reexpresar.
  const hayHuerfanos = !!plan && plan.nIntactos > 0
  const pctIntacto   = ajustes.some(a => a.modo === 'PORCENTAJE')

  return (
    <>
      <div className="input-group">
        <label htmlFor="doc-moneda">Moneda <span className="required">*</span></label>
        <select className="input" id="doc-moneda" value={moneda} required
          onChange={e => pedirCambio(e.target.value)}>
          {monedas.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {pendiente && plan && (
        <ConfirmDialog
          title={`Cambiar el documento a ${pendiente}`}
          confirmLabel={hayHuerfanos ? 'Cambiar de todos modos' : 'Aplicar'}
          danger={hayHuerfanos}
          onCancel={() => setPendiente(null)}
          onConfirm={confirmar}
          body={
            <>
              <ul className="dialog-lista">
                {plan.nCatalogo > 0 && (
                  <li>
                    {plan.nCatalogo} línea{plan.nCatalogo !== 1 ? 's' : ''} toma
                    {plan.nCatalogo !== 1 ? 'n' : ''} su <strong>precio configurado
                    en {pendiente}</strong>.
                  </li>
                )}
                {plan.nTasa > 0 && factor && (
                  <li>
                    {plan.nTasa} importe{plan.nTasa !== 1 ? 's' : ''} sin precio propio
                    en {pendiente} se convierte{plan.nTasa !== 1 ? 'n' : ''} con la tasa
                    vigente: 1 {moneda} = {formatearTasa(factor)} {pendiente}.
                  </li>
                )}
                {plan.nIntactos > 0 && (
                  <li>
                    {plan.nIntactos} importe{plan.nIntactos !== 1 ? 's' : ''} se
                    queda{plan.nIntactos !== 1 ? 'n' : ''} <strong>tal cual</strong>: no
                    tiene{plan.nIntactos !== 1 ? 'n' : ''} precio en {pendiente} y no hay
                    tasa {moneda} → {pendiente} configurada. Tendrás que rehacerlos a mano.
                  </li>
                )}
                {pctIntacto && (
                  <li>Los ajustes en porcentaje no cambian: son relativos al subtotal.</li>
                )}
              </ul>
              <p>Después podrás corregir cualquier importe a mano.</p>
            </>
          }
        />
      )}
    </>
  )
}
