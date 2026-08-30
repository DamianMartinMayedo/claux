'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarCondicionesCliente } from '@/app/actions/clientes'
import { descuentoVigente, esSocioHoy } from '@/lib/billing'
import FormHelp from '@/components/portal/FormHelp'
import { importeClaux, type MonedaClaux } from '@/lib/moneda-claux'

interface Props {
  clientId:        string
  /** Suma de catálogo del nivel EN SU MONEDA: lo que costaría sin nada pactado. */
  precioCatalogo:  number
  /** En la que se le factura. El descuento se aplica dentro de ella, no cruza. */
  moneda:          MonedaClaux
  descuentoPct:    number
  descuentoDesde:  string | null
  descuentoHasta:  string | null
  descuentoMotivo: string | null
  esSocio:         boolean
  socioHasta:      string | null
  socioMotivo:     string | null
}

// Lo pactado con este cliente. Son DOS cosas independientes y por eso van en dos
// columnas: un descuento del 20 % y ser Socio CLAUX no se suman ni se pisan —
// socio gana, porque a un socio no se le cobra nada.
//
// Ninguna de las dos toca las cachés `precio_mensual_usd`/`_eur`: esas siguen
// siendo el precio de catálogo. Lo que se cobra se resuelve al leer
// (`precioMensualEfectivo`), porque esto caduca y un número guardado no caduca solo.
export default function CondicionesCard(props: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [pct,    setPct]    = useState(props.descuentoPct ? String(props.descuentoPct) : '')
  const [desde,  setDesde]  = useState(props.descuentoDesde ?? '')
  const [hasta,  setHasta]  = useState(props.descuentoHasta ?? '')
  const [motivo, setMotivo] = useState(props.descuentoMotivo ?? '')

  const [socio,       setSocio]       = useState(props.esSocio)
  const [socioHasta,  setSocioHasta]  = useState(props.socioHasta ?? '')
  const [socioMotivo, setSocioMotivo] = useState(props.socioMotivo ?? '')

  // Previsualización con los valores del formulario, no con los guardados: el
  // admin ve el número antes de decidir si guarda.
  const borrador = {
    descuento_pct:      Number(pct) || 0,
    descuento_desde:    desde || null,
    descuento_hasta:    hasta || null,
    es_socio:           socio,
    socio_hasta:        socioHasta || null,
  }
  const socioHoy  = esSocioHoy(borrador)
  const pctHoy    = descuentoVigente(borrador)
  const cobrado   = socioHoy ? 0 : Math.round(props.precioCatalogo * (1 - pctHoy / 100) * 100) / 100
  const rebaja    = Math.round((props.precioCatalogo - cobrado) * 100) / 100
  // Un descuento escrito pero fuera de sus fechas: hoy no rebaja nada. Se
  // enseña igual, o se vuelve a escribir pensando que se perdió.
  const programado = !socioHoy && Number(pct) > 0 && pctHoy === 0

  function guardar(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.append('client_id', props.clientId)
    fd.append('descuento_pct',    pct.trim() || '0')
    fd.append('descuento_desde',  desde)
    fd.append('descuento_hasta',  hasta)
    fd.append('descuento_motivo', motivo)
    fd.append('es_socio',     socio ? 'true' : 'false')
    fd.append('socio_hasta',  socioHasta)
    fd.append('socio_motivo', socioMotivo)

    startTransition(async () => {
      const r = await guardarCondicionesCliente(fd)
      if (!r.ok) { toastError(r.error ?? 'No se pudo guardar'); return }
      toastSuccess(socioHoy ? 'Socio CLAUX: no se le genera cobro' : `Cuota: ${importeClaux(cobrado, props.moneda)}/mes`)
      router.refresh()
    })
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Condiciones comerciales</h2>
        {/* El ESTADO, no la cifra: la cifra está dos líneas más abajo, en grande, y
            repetirla aquí solo llenaba la cabecera de un número que ya se lee. */}
        <span className={`badge ${socioHoy ? 'badge-success' : pctHoy > 0 ? 'badge-warning' : 'badge-neutral'}`}>
          {socioHoy ? 'Socio CLAUX' : pctHoy > 0 ? `Descuento ${pctHoy}%` : 'Precio de catálogo'}
        </span>
      </div>

      {/* De dónde sale lo que se cobra, en tres líneas. Antes era un párrafo con
          tres redacciones según el caso: había que leerlo entero para saber si
          ese cliente pagaba, y la cifra —lo único que se busca al abrir esta
          tarjeta— estaba dentro de una frase. Un recibo se barre con la vista. */}
      <div className="cond-cuota">
        <div>
          <span className="cond-cuota-label">Catálogo de su nivel</span>
          <span className="cond-cuota-valor">{importeClaux(props.precioCatalogo, props.moneda)}</span>
        </div>

        {socioHoy ? (
          <>
            <div className="cond-cuota-resta">
              <span className="cond-cuota-label">Socio CLAUX — no se le factura</span>
              <span className="cond-cuota-valor">−{importeClaux(props.precioCatalogo, props.moneda)}</span>
            </div>
            {Number(pct) > 0 && (
              <div className="cond-cuota-inerte">
                <span className="cond-cuota-label">
                  Su {Number(pct)}% de descuento queda en pausa: a un socio no se le cobra nada.
                </span>
              </div>
            )}
          </>
        ) : pctHoy > 0 ? (
          <div className="cond-cuota-resta">
            <span className="cond-cuota-label">Descuento pactado ({pctHoy}%)</span>
            <span className="cond-cuota-valor">−{importeClaux(rebaja, props.moneda)}</span>
          </div>
        ) : programado ? (
          <div className="cond-cuota-inerte">
            <span className="cond-cuota-label">
              El {Number(pct)}% está guardado pero hoy no se aplica: queda fuera de las fechas.
            </span>
          </div>
        ) : null}

        <div className={`cond-cuota-total${socioHoy ? ' cond-cuota-total-cero' : ''}`}>
          <span className="cond-cuota-label">Se le cobra cada mes</span>
          <span className="cond-cuota-valor">{importeClaux(cobrado, props.moneda)}</span>
        </div>
      </div>

      <form onSubmit={guardar} className="config-form mt-4">
        <div className="grid-cols-2">
          {/* Descuento sobre la cuota */}
          <div className="cond-bloque">
            <h3 className="detail-subsection-title">Descuento sobre la cuota</h3>

            <div className="input-group">
              <div className="form-label-with-help">
                <label htmlFor="cond-pct">Porcentaje</label>
                <FormHelp
                  label="Cómo se aplica el descuento"
                  text="Se descuenta de la cuota mensual, no del presupuesto de instalación: ese lleva su propio descuento. Fuera de las fechas no se aplica, aunque el porcentaje siga escrito."
                />
              </div>
              <input id="cond-pct" type="number" min="0" max="100" step="1" className="input"
                     value={pct} onChange={e => setPct(e.target.value)} placeholder="0" />
            </div>

            <div className="grid-cols-2">
              <div className="input-group">
                <label htmlFor="cond-desde">Desde</label>
                <input id="cond-desde" type="date" className="input"
                       value={desde} onChange={e => setDesde(e.target.value)} />
              </div>
              <div className="input-group">
                <label htmlFor="cond-hasta">Hasta</label>
                <input id="cond-hasta" type="date" className="input"
                       value={hasta} onChange={e => setHasta(e.target.value)} />
              </div>
            </div>
            <p className="form-hint">Vacías: empieza ya y no termina.</p>

            <div className="input-group">
              <label htmlFor="cond-motivo">Motivo del descuento</label>
              <input id="cond-motivo" type="text" className="input" maxLength={120}
                     value={motivo} onChange={e => setMotivo(e.target.value)}
                     placeholder="Ej.: lanzamiento, referido, acuerdo de migración" />
            </div>

          </div>

          {/* Socio CLAUX. Las etiquetas dicen «socio» aunque el bloque ya se titule
              así: las dos columnas tienen un «Hasta» y un «Motivo» cada una, y a
              media tarjeta de distancia dejan de distinguirse. */}
          <div className="cond-bloque">
            <h3 className="detail-subsection-title">Socio CLAUX</h3>

            <label className="module-check">
              <input type="checkbox" checked={socio} onChange={e => setSocio(e.target.checked)} />
              <span>Es Socio CLAUX</span>
            </label>
            <p className="form-hint">
              No se le genera cobro. Conserva su nivel, sus módulos y su portal
              intactos: lo único que cambia es que no se le factura.
            </p>

            <div className="input-group">
              <label htmlFor="cond-socio-hasta">Socio hasta</label>
              <input id="cond-socio-hasta" type="date" className="input" disabled={!socio}
                     value={socioHasta} onChange={e => setSocioHasta(e.target.value)} />
              <p className="form-hint">
                Vacío: indefinido. Si adelantas esta fecha, al guardar le llega un
                correo diciéndole hasta cuándo sigue.
              </p>
            </div>

            <div className="input-group">
              <label htmlFor="cond-socio-motivo">Por qué es socio</label>
              <input id="cond-socio-motivo" type="text" className="input" maxLength={120} disabled={!socio}
                     value={socioMotivo} onChange={e => setSocioMotivo(e.target.value)}
                     placeholder="Ej.: aporta al producto, caso de referencia" />
            </div>
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-sm" disabled={isPending}>
          {isPending ? <><span className="spinner" /> Guardando...</> : 'Guardar condiciones'}
        </button>
      </form>
    </div>
  )
}
