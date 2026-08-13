'use client'

// ── La bandeja: qué fue cada salida de la gaveta del TPV ─────────────────────
//
// Cierra la Fase 5 del clasificador. El dependiente saca dinero y escribe un
// motivo libre; aquí el dueño dice, días después, en qué se fue — la MISMA
// pregunta del movimiento manual de Tesorería, con las mismas opciones (por eso
// el agrupador vive en `@/lib/pl/agrupar` y no en ninguna de las dos vistas).
//
// Dos decisiones de esta pantalla que no son cosméticas:
//
//  · **Agrupada por día, y del más viejo al más nuevo.** Lo que el dueño recuerda
//    es «el martes pagué al del hielo», no un uuid. Y lo más viejo primero porque
//    es lo que lleva más tiempo faltando en su informe.
//  · **Se puede resolver en bloque.** Una semana de una cafetería con movimiento
//    son treinta filas; de una en una esto no se hace nunca, y una bandeja que no
//    se vacía es un aviso que se aprende a ignorar.
//
// Vive en `components/portal` y no junto a Tesorería porque se abre desde donde
// esté el dueño —Gastos, informes, el TPV, el dossier—: la abre `GavetaLanzador`.

import { useState, useMemo, useTransition } from 'react'
import { X, Check } from 'lucide-react'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { gruposDeCategorias } from '@/lib/pl/agrupar'
import { ROL_PL_LABEL, ROL_PL_EFECTO, type RolPL } from '@/lib/pl/estado'
import { clasificarGaveta, type DecisionGaveta } from '@/app/actions/portal/caja-gaveta'
import type { GavetaPendiente } from '@/lib/caja/pendientes'
import type { CategoriaGasto } from '@/app/actions/portal/gastos'
import { fechaEnTz, horaEnTz } from '@/lib/fecha-tz'

/** Sin decidir todavía. No es una respuesta: la fila se queda en la bandeja. */
const SIN_DECIDIR = ''
/**
 * «Esto no es un gasto nuevo.» Sí es una respuesta, y se guarda.
 *
 * Cubre DOS casos que acaban igual —no se escribe nada en Gastos—: el dinero solo
 * cambió de sitio (traslado al banco, cambio para la caja) **y** el gasto ya está
 * registrado por su lado, con su factura. El segundo es el que evita el doble
 * conteo: si el dueño pagó al del hielo de la gaveta y además metió la compra en
 * Gastos, clasificar esto como GASTO lo contaría dos veces en su resultado.
 */
const SOLO_MUEVE  = '__solo__'

function importe(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Solo la fecha, en el día del negocio: `horaEnTz`/`fechaEnTz` evitan el desfase de hidratación. */
function diaLargo(iso: string): string {
  const [y, m, d] = fechaEnTz(iso).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

export default function BandejaGaveta({
  pendientes, categorias, puedeEditar, onClose, onSaved,
}: {
  pendientes:  GavetaPendiente[]
  categorias:  CategoriaGasto[]
  puedeEditar: boolean
  onClose:     () => void
  onSaved:     () => void
}) {
  const [decisiones, setDecisiones] = useState<Record<string, string>>({})
  const [lote, setLote] = useState<string>(SIN_DECIDIR)
  const [isPending, startTransition] = useTransition()

  const gruposEgreso  = useMemo(() => gruposDeCategorias(categorias, true),  [categorias])
  const gruposIngreso = useMemo(() => gruposDeCategorias(categorias, false), [categorias])

  // Por día, del más viejo al primero. `listarGavetaPendiente` ya los devuelve
  // ordenados, así que agrupar conserva el orden sin volver a ordenar nada.
  const porDia = useMemo(() => {
    const mapa = new Map<string, GavetaPendiente[]>()
    for (const p of pendientes) {
      const dia = fechaEnTz(p.fecha)
      const ya  = mapa.get(dia)
      if (ya) ya.push(p); else mapa.set(dia, [p])
    }
    return [...mapa.entries()]
  }, [pendientes])

  const marcadas = Object.values(decisiones).filter(v => v !== SIN_DECIDIR).length

  function poner(uuid: string, valor: string) {
    setDecisiones(d => ({ ...d, [uuid]: valor }))
  }

  // ── El lote ─────────────────────────────────────────────────────────────────
  // Una semana de salidas suele ser LO MISMO repetido: cuatro compras de hielo, tres
  // traslados al banco. Sin esto, el dueño abre treinta desplegables y elige la misma
  // opción treinta veces — y a la tercera vez que le pasa deja de abrir la bandeja.
  //
  // Solo pisa lo que sigue SIN DECIDIR: lo que ya contestó a mano manda sobre el
  // lote, nunca al revés. Y no guarda nada: rellena los desplegables y el dueño ve
  // exactamente qué va a mandar antes de pulsar «Clasificar».
  //
  // La dirección importa: una categoría de gasto no puede caer sobre una ENTRADA. El
  // lote ofrece las opciones de lo que hay (salidas si las hay, que es lo normal) y
  // solo toca esas filas; «solo mueve dinero» sí vale para las dos.
  const hayPendienteSalida = pendientes.some(p => p.tipo === 'SALIDA')
  const gruposLote = hayPendienteSalida ? gruposEgreso : gruposIngreso

  function aplicarLote() {
    if (lote === SIN_DECIDIR) return
    setDecisiones(d => {
      const nuevo = { ...d }
      for (const p of pendientes) {
        if (nuevo[p.movimiento_uuid]) continue
        const mismaDireccion = (p.tipo === 'SALIDA') === hayPendienteSalida
        if (lote !== SOLO_MUEVE && !mismaDireccion) continue
        nuevo[p.movimiento_uuid] = lote
      }
      return nuevo
    })
    setLote(SIN_DECIDIR)
  }

  function guardar() {
    const ops: DecisionGaveta[] = []
    for (const [uuid, valor] of Object.entries(decisiones)) {
      if (valor === SIN_DECIDIR) continue
      ops.push(valor === SOLO_MUEVE
        ? { movimiento_uuid: uuid, decision: 'SOLO_MUEVE' }
        : { movimiento_uuid: uuid, decision: 'GASTO', categoria_id: valor })
    }
    if (!ops.length) return
    const ld = toastLoading('Clasificando…')
    startTransition(async () => {
      const res = await clasificarGaveta(ops)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      const omit = res.omitidos
        ? ` ${res.omitidos} ya estaban clasificadas.`
        : ''
      toastSuccess(`${res.hechos} ${res.hechos === 1 ? 'operación clasificada' : 'operaciones clasificadas'}.${omit}`)
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-xl" role="dialog" aria-modal>
        {/* Título y aspa, nada más: `.modal-header` centra verticalmente sus hijos,
            así que un párrafo de tres líneas aquí dentro deja el aspa flotando a
            media altura en vez de en su esquina. La explicación va abajo, que es
            además donde se lee: pegada a lo que hay que hacer. */}
        <div className="modal-header">
          <h2 className="modal-title">Dinero que se movió en la caja</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
        </div>

        <div className="modal-body modal-body-wide">
          <p className="gav-intro">
            Tu punto de venta registró estas operaciones. Dinos qué fue cada una para que
            aparezcan donde tienen que aparecer — y si alguna ya la anotaste con su
            factura, márcala como «no es un gasto nuevo» para no contarla dos veces.
          </p>

          {puedeEditar && pendientes.length > 2 && (
            <div className="gav-lote">
              <span className="gav-lote-txt">
                ¿Casi todas fueron lo mismo? Rellena las que falten de una vez y luego
                corrige las que no encajen.
              </span>
              <div className="gav-lote-accion">
                <label className="sr-only" htmlFor="gav-lote">Aplicar a las que faltan</label>
                <select id="gav-lote" className="input gav-lote-select"
                  value={lote} onChange={e => setLote(e.target.value)}>
                  <option value={SIN_DECIDIR}>Elige qué fueron…</option>
                  <option value={SOLO_MUEVE}>No es un gasto nuevo (traslado, cambio o ya lo registré)</option>
                  {gruposLote.map(g => (
                    <optgroup key={g.rol} label={ROL_PL_LABEL[g.rol]}>
                      {g.opciones.map(o => (
                        <option key={o.id} value={o.id}>{o.nombre}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary btn-sm"
                  onClick={aplicarLote} disabled={lote === SIN_DECIDIR}>
                  Aplicar a las que faltan
                </button>
              </div>
            </div>
          )}

          {porDia.map(([dia, movs]) => (
            <div key={dia} className="gav-dia">
              <h3 className="gav-dia-titulo">{diaLargo(movs[0].fecha)}</h3>
              <ul className="gav-lista">
                {movs.map(m => {
                  const esSalida = m.tipo === 'SALIDA'
                  const grupos   = esSalida ? gruposEgreso : gruposIngreso
                  const valor    = decisiones[m.movimiento_uuid] ?? SIN_DECIDIR
                  const rol      = valor && valor !== SOLO_MUEVE
                    ? grupos.find(g => g.opciones.some(o => o.id === valor))?.rol
                    : undefined
                  return (
                    <li key={m.movimiento_uuid} className="gav-fila">
                      <span className={esSalida ? 'gav-importe gav-importe-sale' : 'gav-importe'}>
                        {esSalida ? '−' : '+'}{importe(m.importe)} {m.moneda}
                      </span>
                      <span className="gav-fila-que">
                        <span className="gav-fila-motivo">{m.motivo || 'Sin motivo anotado'}</span>
                        <span className="gav-fila-detalle">
                          {m.caja_nombre} · {horaEnTz(m.fecha)}
                        </span>
                      </span>
                      <span className="gav-fila-destino">
                        <label className="sr-only" htmlFor={`gav-${m.movimiento_uuid}`}>
                          {esSalida ? 'En qué se fue' : 'De dónde viene'}
                        </label>
                        <select id={`gav-${m.movimiento_uuid}`} className="input"
                          value={valor} disabled={!puedeEditar}
                          onChange={e => poner(m.movimiento_uuid, e.target.value)}>
                          <option value={SIN_DECIDIR}>
                            {esSalida ? '¿En qué se fue?' : '¿De dónde viene?'}
                          </option>
                          <option value={SOLO_MUEVE}>No es un gasto nuevo (traslado, cambio o ya lo registré)</option>
                          {grupos.map(g => (
                            <optgroup key={g.rol} label={ROL_PL_LABEL[g.rol]}>
                              {g.opciones.map(o => (
                                <option key={o.id} value={o.id}>{o.nombre}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {rol && <span className="input-hint">{ROL_PL_EFECTO[rol as RolPL]}</span>}
                        {valor === SOLO_MUEVE && (
                          <span className="input-hint">
                            No entra en el informe: o el dinero solo cambió de sitio, o ese gasto ya está registrado.
                          </span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {puedeEditar ? 'Ahora no' : 'Cerrar'}
          </button>
          {puedeEditar && (
            <button type="button" className="btn btn-primary" onClick={guardar}
              disabled={isPending || marcadas === 0}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Clasificando…</>
                : <><Check size={14} strokeWidth={2.5} /> Clasificar {marcadas || ''}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
