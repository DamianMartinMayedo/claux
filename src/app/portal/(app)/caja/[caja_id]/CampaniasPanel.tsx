'use client'

import { useState, useTransition } from 'react'
import { Plus, Pencil, Trash2, X, BadgePercent } from 'lucide-react'
import {
  guardarCampaniaCaja, archivarCampaniaCaja, type CampaniaCaja,
} from '@/app/actions/portal/caja'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { RowActions } from '@/components/portal/RowActions'
import { hoyEnTz } from '@/lib/fecha-tz'
import { useOrden, ThOrden } from '@/components/TableSort'

/** 0 = domingo … 6 = sábado, igual que `getDay()` del dispositivo, que es quien evalúa. */
const DIAS = [
  { n: 1, corto: 'L',  largo: 'lunes' },
  { n: 2, corto: 'M',  largo: 'martes' },
  { n: 3, corto: 'X',  largo: 'miércoles' },
  { n: 4, corto: 'J',  largo: 'jueves' },
  { n: 5, corto: 'V',  largo: 'viernes' },
  { n: 6, corto: 'S',  largo: 'sábado' },
  { n: 0, corto: 'D',  largo: 'domingo' },
]

/** El formulario de alta/edición vive AQUÍ pero lo abre la página: «Nueva campaña» va en
 *  la cabecera de la página, arriba a la derecha, como en el resto del portal. Por eso el
 *  borrador es un prop controlado y no estado interno del panel. */
export type BorradorCampania = {
  descuento_id?: string
  nombre: string; pct: string
  ambito: 'TODO' | 'PRODUCTO'; ambito_id: string
  desde: string; hasta: string
  dias_semana: number[]
}

export const CAMPANIA_VACIA: BorradorCampania = {
  nombre: '', pct: '', ambito: 'TODO', ambito_id: '',
  desde: '', hasta: '', dias_semana: [],
}

/** «15/3» a partir de un `YYYY-MM-DD`, sin pasar por `new Date(iso)` — que interpreta
 *  la fecha suelta como UTC y en Cuba la deja un día antes. */
function fechaCorta(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}`
}

export default function CampaniasPanel({
  cajaId, campanias: inicial, productos, puedeEditar, borrador, onBorrador,
}: {
  cajaId: string
  campanias: CampaniaCaja[]
  productos: { producto_id: string; nombre: string }[]
  puedeEditar: boolean
  borrador: BorradorCampania | null
  onBorrador: (b: BorradorCampania | null) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [campanias, setCampanias] = useState<CampaniaCaja[]>(inicial)
  const [detalle, setDetalle]     = useState<CampaniaCaja | null>(null)
  const [confirmarRetirar, setConfirmarRetirar] = useState<CampaniaCaja | null>(null)

  const hoy = hoyEnTz()
  const nombreProducto = (id: string | null) =>
    productos.find(p => p.producto_id === id)?.nombre ?? 'Producto retirado'

  /** Lo que hace la campaña, en una frase: es la columna que el dueño lee de verdad. */
  function cuando(c: CampaniaCaja): string {
    const ventana = c.desde && c.hasta ? `del ${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}`
      : c.desde ? `desde el ${fechaCorta(c.desde)}`
      : c.hasta ? `hasta el ${fechaCorta(c.hasta)}`
      : 'siempre'
    if (c.dias_semana.length === 0) return ventana
    // En el orden de la semana, no en el que se marcaron las casillas: «martes y jueves»,
    // nunca «jueves y martes».
    const dias  = DIAS.filter(d => c.dias_semana.includes(d.n)).map(d => d.largo)
    const lista = dias.length === 1 ? dias[0] : `${dias.slice(0, -1).join(', ')} y ${dias[dias.length - 1]}`
    return ventana === 'siempre' ? `los ${lista}` : `${ventana}, los ${lista}`
  }

  const ord = useOrden(campanias, {
    campania:  { label: 'Campaña',      valor: c => c.nombre },
    descuento: { label: 'Descuento',    valor: c => c.pct },
    aplica:    { label: 'Se aplica a',  valor: c => c.ambito === 'TODO' ? 'Todo lo que se venda' : nombreProducto(c.ambito_id) },
    cuando:    { label: 'Cuándo',       valor: c => cuando(c) },
  })

  /** Caducada = la ventana ya pasó. No se archiva sola: el dueño decide si la repite
   *  el mes que viene o la retira, y una lista que se vacía sola no deja decidir. */
  const caducada = (c: CampaniaCaja) => Boolean(c.hasta && c.hasta < hoy)
  const futura   = (c: CampaniaCaja) => Boolean(c.desde && c.desde > hoy)
  const marcada  = (c: CampaniaCaja) => caducada(c) || futura(c) || c.caja_id === null

  /** Los badges de estado, en la tabla y en la ficha: la misma campaña no puede estar
   *  «Terminada» en un sitio y muda en el otro. */
  function badges(c: CampaniaCaja) {
    return (
      <>
        {/* La ventana ya pasó (o no ha llegado). Se dice porque la fila sigue en la
            lista: sin esto, «¿por qué no se aplica?» solo se contesta comparando
            fechas a mano. */}
        {caducada(c) && <span className="badge badge-neutral">Terminada</span>}
        {futura(c)   && <span className="badge badge-info">Aún no empieza</span>}
        {/* Campaña de antes de que fueran de cada punto: sigue viva en todos los puntos
            de venta de la empresa. Se dice, porque si no la misma rebaja aparece en
            cuatro pantallas sin que nada lo explique. */}
        {c.caja_id === null && <span className="badge badge-amber">En todos los puntos</span>}
      </>
    )
  }

  function editar(c: CampaniaCaja) {
    setDetalle(null)
    onBorrador({
      descuento_id: c.descuento_id,
      nombre: c.nombre, pct: String(c.pct),
      ambito: c.ambito, ambito_id: c.ambito_id ?? '',
      desde: c.desde ?? '', hasta: c.hasta ?? '',
      dias_semana: c.dias_semana,
    })
  }

  function toggleDia(n: number) {
    if (!borrador) return
    onBorrador({
      ...borrador,
      dias_semana: borrador.dias_semana.includes(n)
        ? borrador.dias_semana.filter(x => x !== n)
        : [...borrador.dias_semana, n],
    })
  }

  function guardar() {
    if (!borrador) return
    // El toast de carga se crea ANTES de entrar en la transición: dentro no llega a
    // pintarse, y en Cuba una espera sin señal de vida se lee como que no funcionó.
    const t = toastLoading('Guardando la campaña…')
    startTransition(async () => {
      const r = await guardarCampaniaCaja(cajaId, {
        descuento_id: borrador.descuento_id,
        nombre: borrador.nombre,
        pct: parseFloat(borrador.pct.replace(',', '.')) || 0,
        ambito: borrador.ambito,
        ambito_id: borrador.ambito === 'PRODUCTO' ? (borrador.ambito_id || null) : null,
        desde: borrador.desde || null,
        hasta: borrador.hasta || null,
        dias_semana: borrador.dias_semana,
      })
      await t.dismiss()
      // El modal NO se cierra si falla: cerrarlo tiraría los siete campos y el aviso
      // («la fecha de fin no puede ser anterior…») quedaría sin nada que corregir.
      if (!r.ok || !r.campanias) { toastError(r.error ?? 'No se pudo guardar.'); return }
      setCampanias(r.campanias)
      onBorrador(null)
      toastSuccess('Campaña guardada.')
    })
  }

  function retirar(c: CampaniaCaja) {
    setConfirmarRetirar(null)
    setDetalle(null)
    const t = toastLoading('Retirando la campaña…')
    startTransition(async () => {
      const r = await archivarCampaniaCaja(cajaId, c.descuento_id)
      await t.dismiss()
      if (!r.ok || !r.campanias) { toastError(r.error ?? 'No se pudo retirar.'); return }
      setCampanias(r.campanias)
      toastSuccess('Campaña retirada.')
    })
  }

  const esEdicion = Boolean(borrador?.descuento_id)
  // Lo que la acción va a rechazar de todas formas, dicho antes de gastar un viaje: con
  // la conexión de aquí, enterarse de que falta el nombre después de esperar es peor que
  // ver el botón apagado.
  const listoParaGuardar = Boolean(
    borrador && borrador.nombre.trim() && borrador.pct.trim() &&
    (borrador.ambito === 'TODO' || borrador.ambito_id),
  )

  return (
    <div className="card caja-config-section">
      {/* «Nueva campaña» NO va aquí: vive en la cabecera de la página, arriba a la
          derecha, como en el resto de la plataforma. Lo que queda en la tarjeta es el
          título y una sola frase — el aviso de la sincronización estaba repetido al pie,
          descolgado bajo la tabla. */}
      <h2 className="mon-section-title">Campañas de descuento</h2>
      <p className="caja-section-sub">
        Descuentos que este punto de venta aplica por su cuenta, sin que quien cobra tenga que
        acordarse. El precio que se cambie a mano en el dispositivo prevalece sobre la campaña,
        y los cambios de aquí llegan con la próxima sincronización.
      </p>

      {campanias.length === 0 ? (
        /* Vista propia de «no hay nada», como en el resto de los módulos: dice qué pasa
           mientras no haya campañas y ofrece la única acción que cabe aquí. */
        <div className="mon-empty">
          <BadgePercent size={40} strokeWidth={1} opacity={0.2} />
          <p className="table-empty-title">Sin campañas en este punto de venta</p>
          <p>
            Mientras no haya ninguna, el descuento es el que aplique quien cobra, venta a venta.
          </p>
          {puedeEditar && (
            <button type="button" className="btn btn-primary" onClick={() => onBorrador({ ...CAMPANIA_VACIA })}>
              <Plus size={15} strokeWidth={2} /> Crear la primera campaña
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <ThOrden orden={ord} clave="campania" />
                <ThOrden orden={ord} clave="descuento" className="col-num" />
                <ThOrden orden={ord} clave="aplica" />
                <ThOrden orden={ord} clave="cuando" />
                {puedeEditar && <th className="col-actions"></th>}
              </tr>
            </thead>
            <tbody>
              {ord.filas.map(c => (
                /* La fila entera abre la ficha. Una campaña tiene siete datos y la tabla
                   enseña cuatro: los días concretos, las fechas exactas y el estado se
                   leían solo entrando a editar, o sea arriesgando un cambio para mirar. */
                <tr key={c.descuento_id} className="table-row-clickable" onClick={() => setDetalle(c)}>
                  <td data-label="Campaña">
                    {c.nombre}
                    {/* Debajo del nombre y no pegadas a él: dentro de una tabla el badge
                        pierde el fondo (regla de `03-components`), así que en la misma
                        línea se leía como parte del nombre. */}
                    {marcada(c) && <div className="badge-row mb-0 mt-1">{badges(c)}</div>}
                  </td>
                  <td data-label="Descuento" className="col-num">−{String(c.pct).replace('.', ',')} %</td>
                  <td data-label="Se aplica a">
                    {c.ambito === 'TODO' ? 'Todo lo que se venda' : nombreProducto(c.ambito_id)}
                  </td>
                  <td data-label="Cuándo">{cuando(c)}</td>
                  {puedeEditar && (
                    <td className="col-actions">
                      <RowActions label={`Acciones de ${c.nombre}`}>
                        <button className="row-actions-item" onClick={() => editar(c)}>
                          <Pencil size={15} strokeWidth={2} /> Editar
                        </button>
                        <button className="row-actions-item row-actions-item-danger"
                          onClick={() => setConfirmarRetirar(c)}>
                          <Trash2 size={14} strokeWidth={2} /> Retirar
                        </button>
                      </RowActions>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Ficha de la campaña (clic en la fila) ── */}
      {detalle && (
        <div className="modal-backdrop open">
          <div className="modal modal-md" role="dialog" aria-modal aria-label={`Campaña ${detalle.nombre}`}>
            <div className="modal-header">
              <h2 className="modal-title">{detalle.nombre}</h2>
              <button type="button" className="modal-close" onClick={() => setDetalle(null)} aria-label="Cerrar">
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="modal-body">
              {marcada(detalle) && <div className="badge-row mb-3">{badges(detalle)}</div>}
              <dl className="caja-camp-ficha">
                <div>
                  <dt>Descuento</dt>
                  <dd className="caja-camp-pct">−{String(detalle.pct).replace('.', ',')} %</dd>
                </div>
                <div>
                  <dt>Se aplica a</dt>
                  <dd>{detalle.ambito === 'TODO' ? 'Todo lo que se venda' : nombreProducto(detalle.ambito_id)}</dd>
                </div>
                <div>
                  <dt>Cuándo</dt>
                  <dd>{cuando(detalle)}</dd>
                </div>
                <div>
                  <dt>Días de la semana</dt>
                  <dd>
                    {detalle.dias_semana.length === 0
                      ? 'Todos los días'
                      : DIAS.filter(d => detalle.dias_semana.includes(d.n)).map(d => d.largo).join(', ')}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
              {puedeEditar && (
                <button type="button" className="btn btn-primary" onClick={() => editar(detalle)}>
                  <Pencil size={15} strokeWidth={2} /> Editar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Alta y edición: el MISMO modal ── */}
      {puedeEditar && borrador && (
        <div className="modal-backdrop open">
          <div className="modal modal-lg" role="dialog" aria-modal
            aria-label={esEdicion ? 'Editar campaña' : 'Nueva campaña'}>
            <form onSubmit={e => { e.preventDefault(); guardar() }}>
              <div className="modal-header">
                <h2 className="modal-title">{esEdicion ? 'Editar campaña' : 'Nueva campaña'}</h2>
                <button type="button" className="modal-close" onClick={() => onBorrador(null)}
                  disabled={isPending} aria-label="Cerrar">
                  <X size={16} strokeWidth={2} />
                </button>
              </div>

              <div className="modal-body caja-campania-form">
                <div className="input-group">
                  <label htmlFor="camp-nombre">Nombre <span className="required">*</span></label>
                  <input id="camp-nombre" className="input" value={borrador.nombre}
                    placeholder="Semana del libro" autoFocus
                    onChange={e => onBorrador({ ...borrador, nombre: e.target.value })} />
                  <p className="input-hint">Aparece en el dispositivo, bajo el producto rebajado.</p>
                </div>

                <div className="input-group">
                  <label htmlFor="camp-pct">Descuento (%) <span className="required">*</span></label>
                  <input id="camp-pct" className="input" type="text" inputMode="decimal" value={borrador.pct}
                    placeholder="10"
                    onChange={e => onBorrador({ ...borrador, pct: e.target.value })} />
                </div>

                <div className="input-group">
                  <label htmlFor="camp-ambito">Se aplica a</label>
                  <select id="camp-ambito" className="input" value={borrador.ambito}
                    onChange={e => onBorrador({ ...borrador, ambito: e.target.value as 'TODO' | 'PRODUCTO', ambito_id: '' })}>
                    <option value="TODO">Todo lo que se venda</option>
                    <option value="PRODUCTO">Un producto</option>
                  </select>
                </div>

                {borrador.ambito === 'PRODUCTO' && (
                  <div className="input-group">
                    <label htmlFor="camp-prod">Producto <span className="required">*</span></label>
                    <select id="camp-prod" className="input" value={borrador.ambito_id}
                      onChange={e => onBorrador({ ...borrador, ambito_id: e.target.value })}>
                      <option value="">— Elige el producto —</option>
                      {productos.map(p => (
                        <option key={p.producto_id} value={p.producto_id}>{p.nombre}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="caja-campania-fechas">
                  <div className="input-group">
                    <label htmlFor="camp-desde">Desde <span className="label-hint">(en blanco: desde hoy)</span></label>
                    <input id="camp-desde" className="input" type="date" value={borrador.desde}
                      onChange={e => onBorrador({ ...borrador, desde: e.target.value })} />
                  </div>
                  <div className="input-group">
                    <label htmlFor="camp-hasta">Hasta <span className="label-hint">(en blanco: sin fin)</span></label>
                    <input id="camp-hasta" className="input" type="date" value={borrador.hasta}
                      onChange={e => onBorrador({ ...borrador, hasta: e.target.value })} />
                  </div>
                </div>

                {/* «Todos los martes» sin tabla de calendario. Ninguno marcado = todos los
                    días: es lo normal, así que no obliga a marcar siete casillas para no
                    filtrar nada. */}
                <div className="input-group">
                  <label>Días de la semana <span className="label-hint">(ninguno: todos los días)</span></label>
                  <div className="caja-campania-dias">
                    {DIAS.map(d => (
                      <label key={d.n} className="caja-moneda-check">
                        <input type="checkbox" checked={borrador.dias_semana.includes(d.n)}
                          onChange={() => toggleDia(d.n)} aria-label={d.largo} />
                        {' '}{d.corto}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Cancelar primero y con borde (`btn-secondary`), Guardar a la derecha: el
                  mismo orden que el resto de los modales del portal. Iba al revés y con
                  `btn-ghost`, o sea sin borde: parecía texto, no un botón. */}
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" disabled={isPending}
                  onClick={() => onBorrador(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={isPending || !listoParaGuardar}>
                  {isPending
                    ? <><span className="spinner spinner-sm" /> Guardando…</>
                    : esEdicion ? 'Guardar cambios' : 'Crear campaña'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmarRetirar && (
        <ConfirmDialog
          title={`Retirar «${confirmarRetirar.nombre}»`}
          body="Deja de aplicarse en cuanto el dispositivo sincronice. Las ventas ya cobradas con ella no cambian."
          confirmLabel="Retirar"
          danger
          onCancel={() => setConfirmarRetirar(null)}
          onConfirm={() => retirar(confirmarRetirar)}
        />
      )}
    </div>
  )
}
