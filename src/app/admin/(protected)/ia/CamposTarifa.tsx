'use client'

import FormHelp from '@/components/portal/FormHelp'

// La tarifa del modelo, en USD por millón de tokens. Es lo único que le falta a la
// plataforma para poner en dinero lo que ya mide en tokens (pestaña Equipo). No se
// rellena sola ni se adivina: las tarifas cambian, y un coste inventado se lee una
// vez, se cree, y se decide con él. Vacío = «sin tarifa», y el panel lo dice así.
//
// Los dos campos van separados porque los dos precios NO son iguales: la salida
// cuesta varias veces la entrada, y en un modelo de razonamiento es donde se va el
// gasto de verdad (los tokens de pensar cuentan como salida).
export default function CamposTarifa({ precioIn, precioOut }: { precioIn?: number | null; precioOut?: number | null }) {
  return (
    <div className="grid-cols-2">
      <div className="input-group">
        <div className="form-label-with-help">
          <label htmlFor="mod-precio-in">Precio entrada (USD / millón)</label>
          <FormHelp text="Lo que cobra el proveedor por millón de tokens enviados. Puede quedar en blanco: sin tarifa no se estima el coste." label="Qué es el precio de entrada" />
        </div>
        <input id="mod-precio-in" name="precio_in" type="number" min="0" step="0.0001"
               className="input" defaultValue={precioIn ?? ''} placeholder="p. ej. 0,30" />
      </div>
      <div className="input-group">
        <div className="form-label-with-help">
          <label htmlFor="mod-precio-out">Precio salida (USD / millón)</label>
          <FormHelp text="Lo que cobra por millón de tokens generados. Aquí entran también los tokens de razonamiento, que en estos modelos son la mayor parte." label="Qué es el precio de salida" />
        </div>
        <input id="mod-precio-out" name="precio_out" type="number" min="0" step="0.0001"
               className="input" defaultValue={precioOut ?? ''} placeholder="p. ej. 2,50" />
      </div>
    </div>
  )
}
