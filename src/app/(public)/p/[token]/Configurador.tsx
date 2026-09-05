'use client'

import { useMemo, useState, useTransition } from 'react'
import { importeClaux } from '@/lib/moneda-claux'
import type { MonedaClaux } from '@/lib/moneda-claux'
import type { OpcionModulo } from '@/lib/propuesta/tipos'
import { guardarSeleccionBorrador } from '@/app/actions/propuesta-seleccion'

// ── La tabla de precios, que es una selección viva ──────────────────────────
//
// Quien lo maneja es el comercial, delante del cliente: «¿y si además quiero el
// menú digital?» se contesta marcando la casilla, no con «te lo miro y te digo».
// Cada módulo que se marca sube la cuota recurrente delante de él, que es donde
// está el negocio.
//
// LO QUE SE MUEVE ES LA CUOTA. La puesta en marcha NO, y no por pereza: sus
// horas salen de los volúmenes (cuántos productos, cuántos trabajadores), no de
// qué módulos se marquen. Calcularla aquí daría las horas base con volumen cero
// —una cifra sistemáticamente por debajo de la real—, y anclar al cliente en un
// precio de instalación que luego hay que subir es la peor forma de empezar.
//
// Y la cuota simulada NUNCA se llama «total» ni se suma con la instalación: son
// dos pagos distintos, y el presupuesto ya los separa por ese mismo motivo.
//
// EL BOTÓN GUARDA, y guarda una sola vez: al pulsarlo, no en cada clic. Es el
// resultado de la reunión —lo que precarga el presupuesto— y una fila por
// decisión vale más que cien por indecisión. Dos puertas, según dónde se esté:
// con token, la ruta pública; sin él (la vista previa del comercial), la acción
// con permiso. La cuota se recalcula en el servidor en las dos.
//
// Y NO ABRE NADA MÁS. Guardar la selección es todo lo que hace: lo marcado se
// ve en la columna «Qué marcó» del listado de propuestas, y de ahí sale el
// presupuesto. No sale ningún aviso —hay que ir a mirar, y así está dicho en el
// manual—. Sacar al cliente a WhatsApp con un mensaje escrito por nosotros era
// meterle en la mano un canal que quizá no quiere usar, y encima delante del
// comercial en la reunión. Si falla, se dice y se reintenta —callarlo pierde la
// selección—.

export default function Configurador({
  opciones, moneda, cuotaPropuesta, diasPrueba, descuentoAnualPct,
  propuestaId, token,
}: {
  opciones: OpcionModulo[]
  moneda: MonedaClaux
  cuotaPropuesta: number
  diasPrueba: number
  descuentoAnualPct: number
  propuestaId: number
  /** Null en la vista previa del borrador. */
  token: string | null
}) {
  const [marcados, setMarcados] = useState<string[]>(() => opciones.filter(o => o.propuesto).map(o => o.clave))
  const [enviado, setEnviado] = useState(false)
  const [fallo, setFallo] = useState(false)
  const [enviando, empezar] = useTransition()

  const cuota = useMemo(
    () => opciones.filter(o => marcados.includes(o.clave)).reduce((t, o) => t + o.precio, 0),
    [opciones, marcados],
  )
  // Arranca en lo propuesto, así que al abrirlo las dos cifras coinciden. Solo se
  // enseñan las dos cuando difieren, y nunca una sustituyendo a la otra.
  const difiere = Math.abs(cuota - cuotaPropuesta) > 0.005

  function alternar(clave: string) {
    setMarcados(m => (m.includes(clave) ? m.filter(c => c !== clave) : [...m, clave]))
    // Cambiar la selección después de mandarla vuelve a habilitar el botón: lo
    // guardado ya no es lo que hay en pantalla.
    setEnviado(false)
    setFallo(false)
  }

  function enviar() {
    if (marcados.length === 0 || enviando) return
    empezar(async () => {
      const ok = token
        ? await fetch(`/p/${token}/seleccion`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modulos: marcados }),
          }).then(r => r.json()).then(r => !!r?.ok).catch(() => false)
        : await guardarSeleccionBorrador(propuestaId, marcados).then(r => r.ok).catch(() => false)

      // Lo mismo por el enlace que en la vista previa: si falla y decimos
      // «Anotado», la selección se da por recogida y no está en ninguna parte.
      // No hay red debajo que la salve, así que se ofrece reintentar.
      setEnviado(ok)
      setFallo(!ok)
    })
  }

  return (
    <div className="pp-precios">
      {/* Fichas, no filas. Once módulos con su descripción en una tabla eran una
          lista de la compra que había que leer entera, y en el PDF se comían
          página y media. En rejilla se barren de un vistazo, la marcada se ve
          desde el otro lado de la mesa y el catálogo entero cabe en una página. */}
      <div className="pp-catalogo">
        {opciones.map(o => {
          const on = marcados.includes(o.clave)
          return (
            <button
              key={o.clave} type="button" className="pp-modulo-op"
              data-on={on ? 'si' : undefined} aria-pressed={on}
              onClick={() => alternar(o.clave)}
            >
              <span className="pp-modulo-marca" aria-hidden="true" />
              <span className="pp-modulo-nombre">{o.nombre}</span>
              <span className="pp-modulo-precio">
                {importeClaux(o.precio, moneda)}<small>/mes</small>
              </span>
              {o.descripcion && <span className="pp-modulo-desc">{o.descripcion}</span>}
            </button>
          )
        })}
      </div>

      {/* El pie va en UNA fila: la cifra a la izquierda, el botón a la derecha.
          Apilados, la cuota quedaba en una caja enorme medio vacía y el botón
          cruzaba la diapositiva de lado a lado como si fuera una franja. */}
      <div className="pp-pie-precios">
        <div className="pp-resumen">
          {difiere && (
            <div className="pp-resumen-bloque">
              <span className="pp-resumen-label">Con lo propuesto</span>
              <span className="pp-resumen-cifra">{importeClaux(cuotaPropuesta, moneda)}<small>/mes</small></span>
            </div>
          )}
          <div className="pp-resumen-bloque">
            <span className="pp-resumen-label">{difiere ? 'Con tu selección' : 'Cuota mensual'}</span>
            <span className="pp-resumen-cifra">{importeClaux(cuota, moneda)}<small>/mes</small></span>
          </div>
        </div>

        <button
          type="button" className="pp-cta" data-hecho={enviado ? 'si' : undefined}
          disabled={marcados.length === 0 || enviando || enviado}
          onClick={enviar}
        >
          {enviado ? 'Anotado' : fallo ? 'Reintentar' : enviando ? 'Anotando…' : 'Me interesa así'}
        </button>
      </div>

      {/* De esta nota el cliente solo hace dos cosas: saber cuándo empieza a
          pagar y qué se ahorra si paga el año. El porqué de que la puesta en
          marcha vaya aparte —«según el volumen de datos del negocio»— es cocina
          nuestra, y su cifra está en la diapositiva siguiente. */}
      <p className="pp-nota">
        {diasPrueba} días de prueba antes de pagar nada.
        {descuentoAnualPct > 0 && ` Pagando el año por adelantado, un ${descuentoAnualPct} % menos.`}
        {' '}La puesta en marcha se presupuesta aparte.
      </p>
    </div>
  )
}
