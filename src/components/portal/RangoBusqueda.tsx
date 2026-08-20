'use client'

// ────────────────────────────────────────────────────────────────────────────
// Rango de fechas + buscador de un listado, con el estado EN LA URL.
//
// Los listados de Contabilidad comparten este control (Ventas, Gastos y cobros, Tesorería),
// más Compras, Movimientos de inventario y Suscripciones.
//
// El estado vive en la URL y no en `useState` porque el filtro se aplica EN EL SERVIDOR:
// cambiarlo es navegar. De paso, volver del detalle de un documento —o refrescar en una
// conexión que se cae— no pierde lo que estabas mirando.
//
// ── EL PRESET VIAJA EN LA URL (`?rango=`), no se deduce de las fechas ──────────
// Antes se deducía comparando `desde`/`hasta` con cada preset, y de ahí salían tres
// mentiras: (1) el 1 de enero «Este mes» y «Este año» dan el mismo rango, así que pulsar
// «Este año» encendía «Este mes»; (2) un rango personalizado que coincidía con un preset se
// reinterpretaba como el preset, borrando lo que el dueño había escrito a mano; (3) el chip
// del menú de descarga se equivocaba igual, porque usa la misma deducción. Con el preset
// explícito, lo que el dueño eligió es lo que se enseña. Se sigue deduciendo como respaldo
// para los enlaces viejos y para el rango por defecto que calcula el servidor.
//
// ── UN BOTÓN, NO NUEVE PÍLDORAS ───────────────────────────────────────────────
// El rango se ofrecía como una fila de píldoras: Hoy · Ayer · Esta semana · Este mes · Mes
// pasado · Últimos 3 meses · Este año · Todo · Personalizado. En un cliente con tres empresas
// eran NUEVE de los trece controles de la barra — dos tercios del espacio para el filtro que
// menos se toca, porque tiene defecto de 3 meses y la mayoría de las sesiones no lo cambia.
//
// Ahora es UN botón que **dice el rango aplicado** y abre un panel con los presets, las dos
// fechas y «Aplicar». Se gana espacio, pero lo que más se gana es lectura: antes había que
// buscar cuál de las nueve píldoras estaba encendida, y en móvil envolvían a tres líneas
// siempre. Cuesta un clic más al cambiar de rango; se paga con gusto por lo anterior.
//
// «Personalizado» deja de ser una píldora rara que además abría un panel: las fechas viven
// DENTRO del panel, donde se esperan. Escribirlas no navega hasta «Aplicar» — navegar en cada
// `change` de un `input[type=date]` es una consulta por tecla, con la fecha a medio escribir.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { CalendarRange, Check, ChevronDown, Search, X } from 'lucide-react'
import {
  PRESETS_RANGO, PRESETS_HISTORICO, fechasDePreset, presetDeFechas, type PresetRango,
} from '@/lib/listados'

/** Espera antes de buscar mientras se teclea. Suficiente para no lanzar una consulta por
 *  letra, corta para que no parezca que el buscador no hace nada. */
const ESPERA_BUSQUEDA = 600

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * El rango en la etiqueta del botón. Con un preset, su nombre; con fechas a mano, las fechas
 * —«12 mar – 30 abr»—, que es más útil que la palabra «Personalizado».
 *
 * Se formatea a mano desde `'YYYY-MM-DD'` y NO con `new Date(iso)`: eso interpreta la cadena
 * como UTC y en La Habana (UTC−4/−5) devuelve el día anterior.
 */
function etiquetaRango(preset: PresetRango, desde: string, hasta: string): string {
  if (preset !== 'personalizado') {
    return PRESETS_RANGO.find(p => p.id === preset)?.label ?? 'Todo'
  }
  const corto = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return { txt: `${d} ${MES_CORTO[m - 1]}`, anio: y }
  }
  if (desde && hasta) {
    const a = corto(desde), b = corto(hasta)
    // El año solo cuando aporta: si los dos caen en el mismo, sobra decirlo dos veces.
    return a.anio === b.anio
      ? `${a.txt} – ${b.txt}`
      : `${a.txt} ${a.anio} – ${b.txt} ${b.anio}`
  }
  if (desde) return `Desde ${corto(desde).txt}`
  if (hasta) return `Hasta ${corto(hasta).txt}`
  return 'Todo'
}

interface Props {
  /** Rango realmente aplicado por el servidor (no lo que pide la URL). */
  desde: string
  hasta: string
  q?:    string
  /** Placeholder del buscador: cada listado busca por cosas distintas. */
  placeholder?: string
  /**
   * Presets a ofrecer, EN SU ORDEN. Por defecto los históricos (`PRESETS_HISTORICO`); un
   * listado de cobros futuros pasa `PRESETS_FUTURO`. Un listado sin rango pasa `[]` y solo
   * queda el buscador.
   */
  presets?: PresetRango[]
  /**
   * Solo el rango, sin buscador. El simétrico de `presets={[]}`: un listado que
   * filtra por fechas pero cuyo servidor no busca por texto (Compras, Movimientos)
   * no puede enseñar una caja de búsqueda que no hace nada.
   */
  sinBuscador?: boolean
  /** Se llama con el pendiente de la navegación (buscar / cambiar rango) para que la
   *  lista pinte el velo de «cargando» sobre su tabla. */
  onPendiente?: (v: boolean) => void
}

export default function RangoBusqueda({
  desde, hasta, q = '', placeholder = 'Buscar…', presets, sinBuscador, onPendiente,
}: Props) {
  const router  = useRouter()
  const params  = useSearchParams()
  const ruta    = usePathname()
  const [pendiente, startTransition] = useTransition()

  useEffect(() => { onPendiente?.(pendiente) }, [pendiente])  // eslint-disable-line react-hooks/exhaustive-deps

  // El preset que pidió la URL; si no hay (enlace viejo, rango por defecto del servidor),
  // se deduce de las fechas como antes.
  const pedido   = params.get('rango') as PresetRango | null
  const aplicado = pedido ?? presetDeFechas(desde, hasta)

  // ── Estado local, que existe por UNA razón: que el clic se vea AL INSTANTE ──
  // El control se pintaba desde las props, o sea desde la respuesta del servidor: en 3G eran
  // varios segundos en los que pulsar no hacía nada visible y el dueño volvía a pulsar. La
  // etiqueta del botón cambia YA y se reconcilia cuando llega el servidor.
  const [preset, setPreset] = useState<PresetRango>(aplicado)
  // Las fechas del rango personalizado se escriben AQUÍ y solo viajan al pulsar «Aplicar».
  // Navegar en cada `change` de un `input[type=date]` es una consulta por cada tecla —el
  // navegador dispara el evento con la fecha a medio escribir, «0002-01-01» incluido—.
  const [borrador, setBorrador] = useState({ desde, hasta })
  const [texto, setTexto] = useState(q)
  const [abierto, setAbierto] = useState(false)

  // Reconciliación DURANTE EL RENDER, no en un efecto: con efecto se pinta un fotograma con
  // el estado viejo y luego salta.
  const [visto, setVisto] = useState({ desde, hasta, pedido, q })
  if (visto.desde !== desde || visto.hasta !== hasta || visto.pedido !== pedido || visto.q !== q) {
    // El texto también se pone al día, que no lo hacía: entrar en el módulo desde la barra
    // lateral estando en `?q=cerveza` dejaba la caja con «cerveza» y la lista sin filtrar.
    //
    // Pero solo si la caja seguía DONDE LA DEJÓ el servidor. Si el dueño ha escrito algo
    // desde entonces —lo normal: la respuesta de una búsqueda llega mientras él sigue
    // tecleando la siguiente— pisarle el texto sería borrarle las letras a media palabra.
    const seguiaEnSync = texto === visto.q
    setVisto({ desde, hasta, pedido, q })
    setPreset(aplicado)
    setBorrador({ desde, hasta })
    if (seguiaEnSync) setTexto(q)
  }

  const sinAplicar = borrador.desde !== desde || borrador.hasta !== hasta
  // El orden lo manda quien pasa `presets`, no el del catálogo: en Suscripciones «Vencidos»
  // va primero y en un listado histórico va «Este mes».
  const pedidos = presets ?? PRESETS_HISTORICO
  const lista   = pedidos
    .map(id => PRESETS_RANGO.find(p => p.id === id))
    .filter((p): p is { id: PresetRango; label: string } => !!p)
  const etiqueta = etiquetaRango(preset, borrador.desde, borrador.hasta)

  function navegar(cambios: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) next.delete(k)
      else            next.set(k, v)
    }
    // El techo vuelve al de su filtro. `limite` lo sube «Traer más» y se quedaba pegado en la
    // URL: después de usarlo una vez, «Todo» ya no traía hasta 5.000 filas sino las que
    // hubiera pedido «Traer más» — o sea que «Todo» dejaba de significar todo.
    next.delete('limite')
    startTransition(() => router.replace(`${ruta}?${next.toString()}`, { scroll: false }))
  }

  function elegirPreset(p: PresetRango) {
    setPreset(p)        // primero la etiqueta del botón, luego el viaje
    setAbierto(false)   // elegir es terminar: el panel no se queda abierto tapando la tabla
    const f = fechasDePreset(p)
    setBorrador(f)
    // «Todo» se escribe como cadena vacía, no borrando el parámetro: el servidor
    // distingue «sin rango» (vacío) de «no me has dicho nada» (ausente → 3 meses).
    navegar({ rango: p, desde: f.desde, hasta: f.hasta })
  }

  function aplicarBorrador() {
    if (!borrador.desde && !borrador.hasta) return
    setPreset('personalizado')
    setAbierto(false)
    navegar({ rango: 'personalizado', desde: borrador.desde, hasta: borrador.hasta })
  }

  // Buscar AL TECLEAR, con espera. Antes hacía falta pulsar Enter, y la misma caja en
  // Productos o Terceros filtraba sola: mismo aspecto, dos comportamientos, y el que
  // esperaba creía que el buscador estaba roto. Enter sigue funcionando (busca ya).
  useEffect(() => {
    if (sinBuscador) return
    if (texto.trim() === q.trim()) return
    const t = setTimeout(() => navegar({ q: texto.trim() || null }), ESPERA_BUSQUEDA)
    return () => clearTimeout(t)
  }, [texto])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // Sin buscador NO ocupa la fila entera: si la sigue reclamando, el filtro que la
    // vista pone a su lado (el estado, en Compras) cae a una segunda línea suelto y
    // parece de otro sitio. Con buscador sí la ocupa, que la caja necesita el ancho.
    <div className={`rango-busqueda${sinBuscador ? ' rango-busqueda-compacto' : ''}`}>
      {lista.length > 0 && (
        <div className="rango-wrap">
          {/* La etiqueta ES el rango aplicado. Antes había que localizar la píldora
              encendida entre nueve, y en móvil envolvían a tres líneas. */}
          <button
            type="button"
            className="rango-boton"
            aria-expanded={abierto}
            aria-label={`Rango de fechas: ${etiqueta}`}
            onClick={() => setAbierto(v => !v)}
          >
            <CalendarRange size={14} strokeWidth={2} />
            <span className="rango-boton-txt">{etiqueta}</span>
            <ChevronDown size={13} strokeWidth={2.5} />
          </button>

          {abierto && (
            <>
              <div className="rango-panel-overlay" onClick={() => setAbierto(false)} />
              <div className="rango-panel" role="group" aria-label="Rango de fechas">
                <div className="rango-opciones">
                  {lista.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className={`rango-opcion${preset === p.id ? ' active' : ''}`}
                      aria-pressed={preset === p.id}
                      onClick={() => elegirPreset(p.id)}
                    >
                      <span>{p.label}</span>
                      {preset === p.id && <Check size={13} strokeWidth={2.5} />}
                    </button>
                  ))}
                </div>

                {/* Las fechas a mano viven AQUÍ, no en una píldora aparte que además abría un
                    panel. Escribirlas no navega: solo «Aplicar» (o Enter). */}
                <form className="rango-fechas" onSubmit={e => { e.preventDefault(); aplicarBorrador() }}>
                  <div className="rango-fecha-campo">
                    <label htmlFor="rango-desde">Desde</label>
                    <input
                      id="rango-desde" className="input input-sm" type="date" value={borrador.desde}
                      max={borrador.hasta || undefined}
                      onChange={e => setBorrador(b => ({ ...b, desde: e.target.value }))}
                    />
                  </div>
                  <div className="rango-fecha-campo">
                    <label htmlFor="rango-hasta">Hasta</label>
                    <input
                      id="rango-hasta" className="input input-sm" type="date" value={borrador.hasta}
                      min={borrador.desde || undefined}
                      onChange={e => setBorrador(b => ({ ...b, hasta: e.target.value }))}
                    />
                  </div>
                  {/* Aparece siempre, deshabilitado hasta que hay algo que aplicar: es el
                      único control que confirma el rango escrito a mano, y esconderlo dejaba
                      el panel sin salida aparente. */}
                  <button type="submit" className={`btn btn-sm ${sinAplicar ? 'btn-primary' : 'btn-secondary'}`}
                    disabled={!sinAplicar}>
                    <Check size={13} strokeWidth={2.5} /> Aplicar
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      )}

      {!sinBuscador && (
        <form className="ter-search-wrap" onSubmit={e => { e.preventDefault(); navegar({ q: texto.trim() || null }) }}>
          <Search size={14} strokeWidth={2} />
          <input
            className="ter-search"
            type="search"
            value={texto}
            aria-label={placeholder}
            placeholder={placeholder}
            onChange={e => setTexto(e.target.value)}
          />
          {texto && (
            <button
              type="button"
              className="rango-limpiar"
              onClick={() => { setTexto(''); navegar({ q: null }) }}
              aria-label="Quitar la búsqueda"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          )}
        </form>
      )}
    </div>
  )
}
