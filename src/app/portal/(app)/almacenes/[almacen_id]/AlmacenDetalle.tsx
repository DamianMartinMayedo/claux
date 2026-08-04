'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClipboardList, Layers, Package, Warehouse } from 'lucide-react'
import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import type { AlmacenDetalleData } from '@/app/actions/portal/almacenes'
import { abrirConteo, empezarConteoNuevo, type ListadoConteos } from '@/app/actions/portal/conteos'
import AvisoTope from '@/components/portal/AvisoTope'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { RowActions } from '@/components/portal/RowActions'
import ExportarMenu from '@/components/portal/ExportarMenu'
import Tabs from '@/components/Tabs'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { StockAjusteModal } from '../../productos/_StockAjusteModal'
import { estadoStock, ESTADO_STOCK_BADGE, ESTADO_STOCK_LABEL } from '@/lib/inventario/stock'
import { fmtValor } from '@/lib/inventario/valoracion'
import { etiquetaCobertura } from '@/lib/inventario/consumo'
import { fmtFechaEs } from '@/lib/date-utils'
import { horaEnTz, hoyEnTz } from '@/lib/fecha-tz'

const TIPO_LABEL: Record<string, string> = {
  FISICO: 'Físico', VIRTUAL: 'Virtual', TRANSITO: 'En tránsito', CONSIGNACION: 'Consignación',
}

/**
 * Qué hay en este almacén y cuánto vale.
 *
 * La pregunta que el módulo no respondía en ninguna parte: la lista de almacenes
 * era un CRUD de nombres con tarjetas que contaban «almacenes por tipo», el número
 * menos útil que se puede enseñar.
 */
type Tab = 'productos' | 'movimientos' | 'conteos'

export default function AlmacenDetalle(
  { data, conteos: listadoConteos }: { data: AlmacenDetalleData; conteos: ListadoConteos },
) {
  const router = useRouter()
  const { almacen, lineas, valor, monedaVista, movimientos, movimientosHayMas } = data
  const conteos = listadoConteos.conteos
  const [ajuste, setAjuste] = useState<AlmacenDetalleData['lineas'][number] | null>(null)
  const [tab, setTab] = useState<Tab>('productos')
  const [pendingContar, startContar] = useTransition()
  /** Elegir entre retomar la hoja abierta y empezar una nueva. */
  const [decidirConteo, setDecidirConteo] = useState(false)

  /**
   * La hoja abierta de este almacén, si hay.
   *
   * Solo puede haber UNA (índice único de la mig. 160) y **no caduca**: un conteo que se
   * guardó sin aplicar sigue ahí en enero. Por eso el botón tiene que decir cuál de las
   * dos cosas va a hacer — «Contar» abriendo la hoja del mes pasado con las cantidades de
   * entonces escritas es la trampa más cara de este módulo.
   */
  const borrador = conteos.find(c => c.estado === 'BORRADOR')
  const esDeHoy  = borrador?.fecha === hoyEnTz()

  /**
   * Abre (o recupera) el conteo de este almacén y lleva a él.
   *
   * `abrirConteo` es idempotente y además la BD lo garantiza (índice único de la mig.
   * 160), así que pulsar dos veces no crea dos hojas: la segunda vez se entra en la
   * misma.
   */
  function contar() {
    // Con una hoja abierta que NO es de hoy se pregunta antes: retomar el conteo de ayer
    // y empezar el de este mes son cosas distintas y solo el dueño sabe cuál quiere. Si es
    // de hoy no se pregunta nada: es la misma faena, interrumpida.
    if (borrador && !esDeHoy) { setDecidirConteo(true); return }
    irAlConteo(abrirConteo)
  }

  function irAlConteo(accion: typeof abrirConteo) {
    const ld = toastLoading('Abriendo la hoja de conteo…')
    startContar(async () => {
      const r = await accion(almacen.almacen_id)
      await ld.dismiss()
      setDecidirConteo(false)
      if (!r.ok || !r.conteo_id) { toastError(r.error ?? 'No se pudo abrir el conteo.'); return }
      router.push(`/portal/almacenes/${almacen.almacen_id}/conteo/${r.conteo_id}`)
    })
  }

  const { pageItems: lineasPage,  ...pagLineas  } = usePagination(lineas)
  const { pageItems: movsPage,    ...pagMovs    } = usePagination(movimientos)
  const { pageItems: conteosPage, ...pagConteos } = usePagination(conteos)

  const unidades  = lineas.reduce((s, l) => s + l.cantidad, 0)
  const alertas   = lineas.filter(l => {
    const e = estadoStock(l.cantidad, l.minimo)
    return e === 'bajo' || e === 'agotado'
  }).length
  const negativos = lineas.filter(l => l.cantidad < 0).length

  return (
    <div className="view-container">
      <div className="breadcrumb">
        <Link href="/portal/almacenes">Almacenes</Link>
        <span>›</span>
        <span className="breadcrumb-current">{almacen.nombre}</span>
      </div>

      <div className="det-page-header">
        <div>
          <div className="det-title-group">
            <h1 className="det-page-title">{almacen.nombre}</h1>
            <span className={`badge ${almacen.activo ? 'badge-success' : 'badge-neutral'}`}>
              {almacen.activo ? 'Activo' : 'Archivado'}
            </span>
          </div>
          <div className="det-meta-row">
            <span>{TIPO_LABEL[almacen.tipo] ?? almacen.tipo}</span>
            {data.empresa && <span className="ml-3">{data.empresa}</span>}
          </div>
        </div>
        <div className="det-actions">
          {/* Contar es la respuesta a lo que «Revisar» detecta, y la única vía de sanear
              un negativo: entra desde aquí, con la hoja ya delante.

              BOTÓN y no `<Link>`, y esto no es cosmético: abrir el conteo ESCRIBE, y
              Next **prefetcha los enlaces**, así que con un `<Link>` bastaba con pasar
              el ratón por encima para crear un borrador. En el entorno de prueba se
              acumularon 352. Ahora la escritura ocurre al PULSAR, una vez, y después se
              navega al conteo que ya existe. Se esconde a quien no puede editar. */}
          {almacen.activo && data.puede_editar && (
            <button className="btn btn-secondary" onClick={contar} disabled={pendingContar}
              title={borrador ? `Hoja abierta el ${fmtFechaEs(borrador.fecha)}` : undefined}>
              <ClipboardList size={14} strokeWidth={2} />
              {/* El botón dice lo que va a pasar. Con una hoja abierta, «Contar» prometía
                  una hoja nueva y entregaba la de la semana pasada a medio llenar. */}
              {pendingContar ? 'Abriendo…' : borrador ? 'Continuar conteo' : 'Contar'}
            </button>
          )}
          {/* La descarga sigue a la PESTAÑA, y el desplegable lo DICE: en Movimientos se
              lleva el historial de este almacén, no sus existencias. Mismo criterio que
              Productos → Categorías, donde el botón ya cambia de tabla según la pestaña.

              Las TRES pestañas, cada una con su tabla. Conteos no tenía la suya, así que
              caía en el `else` y se llevaba los movimientos: un archivo que no es lo que
              el dueño creía es peor que no tenerlo. */}
          <ExportarMenu
            clave={tab === 'productos' ? 'stock' : tab === 'conteos' ? 'conteos' : 'movimientos_inventario'}
            filtro={{ almacen_id: almacen.almacen_id }}
            resumen={[
              tab === 'productos' ? `Productos de ${almacen.nombre}`
                : tab === 'conteos' ? `Conteos de ${almacen.nombre}`
                : `Movimientos de ${almacen.nombre}`,
            ]}
          />
        </div>
      </div>

      {/* KPIs — lo que se pregunta al entrar aquí */}
      <div className="alm-stats-grid">
        <div className="alm-stat-card">
          <div className="alm-stat-count">{lineas.filter(l => l.cantidad > 0).length}</div>
          <div className="alm-stat-label">referencias</div>
        </div>
        <div className="alm-stat-card">
          <div className="alm-stat-count">{unidades.toLocaleString('es-ES')}</div>
          <div className="alm-stat-label">unidades</div>
        </div>
        <div className="alm-stat-card">
          {/* Valor NATIVO por moneda, sin convertir: es la regla que ya fijó Reportes. */}
          <div className="alm-stat-count alm-stat-valor">
            {valor.length === 0
              ? <span className="text-faint">—</span>
              : valor.map(v => <span key={v.moneda} className="alm-valor-chip">{fmtValor(v.valor, v.moneda)}</span>)}
          </div>
          <div className="alm-stat-label">
            valor
            {/* Un producto sin coste NO vale 0: se dice, no se esconde. */}
            {valor.some(v => v.sinCoste > 0) && (
              <span className="text-xs-hint"> · {valor[0].sinCoste} sin coste</span>
            )}
          </div>
        </div>
        <div className="alm-stat-card">
          <div className={`alm-stat-count${alertas > 0 ? ' alm-stat-count-alerta' : ''}`}>{alertas}</div>
          <div className="alm-stat-label">
            bajo mínimo
            {negativos > 0 && <span className="text-xs-hint"> · {negativos} en negativo</span>}
          </div>
        </div>
      </div>

      {/* Contenido */}
      <Tabs
        ariaLabel="Secciones del almacén"
        active={tab}
        onChange={id => setTab(id as Tab)}
        tabs={[
          { id: 'productos',   label: 'Productos',   count: lineas.length },
          { id: 'movimientos', label: 'Movimientos', count: movimientos.length },
          { id: 'conteos',     label: 'Conteos',     count: conteos.length },
        ]}
      />

      {/* Los conteos: el acta de cada uno tiene que poder encontrarse y enseñarse.
          Antes se aplicaba el conteo y desaparecía de la vista, cuando es justo el
          documento que justifica los ajustes que se hicieron ese día. */}
      {tab === 'conteos' && (
      <div className="card card-table">
        {/* El techo de los conteos no avisaba de nada: un almacén que se cuenta cada semana
            pasa el techo en unos años y las actas viejas desaparecían en silencio. */}
        {listadoConteos.hay_mas && (
          <AvisoTope mostrados={conteos.length} total={listadoConteos.total}
            limite={listadoConteos.limite} sustantivo="conteos" />
        )}

        {conteos.length === 0 ? (
          <div className="mon-empty">
            <ClipboardList size={40} strokeWidth={1} opacity={0.2} />
            <p>Este almacén no se ha contado nunca. «Contar» abre la hoja con lo que hay ahora.</p>
          </div>
        ) : (
          <>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Conteo</th>
                  <th>Contado por</th>
                  <th className="col-num">Contadas</th>
                  <th className="col-num">Diferencias</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {conteosPage.map(c => (
                  <tr key={c.conteo_id} className="table-row-clickable"
                    onClick={() => router.push(`/portal/almacenes/${almacen.almacen_id}/conteo/${c.conteo_id}`)}>
                    {/* Fecha y HORA en la misma celda que el código: dos conteos del
                        mismo día son indistinguibles por la fecha sola, y el listado
                        acababa siendo cinco filas idénticas. */}
                    <td data-label="Conteo">
                      <strong>{fmtFechaEs(c.fecha)} · {horaEnTz(c.created_at)}</strong>
                      <div className="table-cell-secondary">
                        {c.conteo_id}{c.notas ? ` · ${c.notas}` : ''}
                      </div>
                    </td>
                    <td data-label="Contado por">{c.contado_por || <span className="text-sm-muted">—</span>}</td>
                    <td data-label="Contadas" className="col-num">
                      {c.contadas > 0 ? c.contadas : <span className="text-sm-muted">sin empezar</span>}
                    </td>
                    <td data-label="Diferencias" className="col-num">
                      {c.diferencias > 0 ? c.diferencias : <span className="text-sm-muted">—</span>}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge ${c.estado === 'APLICADO' ? 'badge-success' : 'badge-neutral'}`}>
                        {c.estado === 'APLICADO' ? 'Aplicado' : 'Borrador'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pagConteos} />
          </>
        )}
      </div>
      )}

      {tab === 'productos' && (
      <div className="card card-table">
        {lineas.length === 0 ? (
          <div className="mon-empty">
            <Warehouse size={40} strokeWidth={1} opacity={0.2} />
            <p>Este almacén está vacío. Registra una entrada o confirma una compra con este almacén de destino.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="col-num">Cantidad</th>
                  <th className="col-num">Mínimo</th>
                  {/* La moneda va en la cabecera de su columna: sin el titular de la
                      tarjeta, era el único sitio que decía en qué moneda están estas dos. */}
                  <th className="col-num">Coste unit.{monedaVista && ` (${monedaVista})`}</th>
                  <th className="col-num">Valor{monedaVista && ` (${monedaVista})`}</th>
                  {/* Es el número que decide la compra. Y es una ESTIMACIÓN: se rotula
                      así, no se suma en ninguna parte y no genera aviso propio. */}
                  <th className="col-num" title="Estimación al ritmo de los últimos 90 días">Cobertura</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {lineasPage.map(l => {
                  const estado = estadoStock(l.cantidad, l.minimo)
                  return (
                    <tr key={l.producto_id}>
                      <td data-label="Producto">
                        <Link href={`/portal/productos/${l.producto_id}`} className="table-name-link cell-clamp">{l.nombre}</Link>
                        <div className="table-cell-secondary">{l.codigo}</div>
                      </td>
                      <td data-label="Cantidad" className={`col-num${l.cantidad < 0 ? ' mov-cant-neg' : ''}`}>
                        {l.cantidad.toLocaleString('es-ES')} {l.unidad}
                      </td>
                      <td data-label="Mínimo" className="col-num text-sm-muted">
                        {l.minimo > 0 ? l.minimo.toLocaleString('es-ES') : '—'}
                        {l.minimoPropio == null && l.minimo > 0 && <span className="text-xs-hint"> (general)</span>}
                      </td>
                      <td data-label="Coste unit." className="col-num text-sm-muted">
                        {l.costo != null ? l.costo.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td data-label="Valor" className="col-num">
                        {l.valor != null
                          ? l.valor.toLocaleString('es-ES', { maximumFractionDigits: 2 })
                          : <span className="text-faint">sin coste</span>}
                      </td>
                      <td data-label="Cobertura" className="col-num text-sm-muted">
                        {etiquetaCobertura(l.cobertura)}
                      </td>
                      {/* Los CUATRO estados con el mismo tratamiento: la familia
                          `.badge`, que dentro de una tabla el design system pinta plana
                          (`table .badge`). «En orden» iba como texto gris suelto, así
                          que la columna mezclaba dos tipografías y el estado bueno ni
                          siquiera llevaba su color. Un estado se lee, y se lee igual. */}
                      <td data-label="Estado">
                        <span className={`badge ${ESTADO_STOCK_BADGE[estado]}`}>
                          {ESTADO_STOCK_LABEL[estado]}
                        </span>
                      </td>
                      <td className="col-actions">
                        <RowActions>
                          <button className="row-actions-item" onClick={() => setAjuste(l)}>
                            <Layers size={15} strokeWidth={2} /> Ajustar stock
                          </button>
                          <button className="row-actions-item"
                            onClick={() => router.push(`/portal/productos/${l.producto_id}`)}>
                            <Package size={15} strokeWidth={2} /> Ver producto
                          </button>
                        </RowActions>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pagLineas} label="producto" />
      </div>
      )}

      {tab === 'movimientos' && (
        <div className="card card-table">
          {/* Decía «los primeros» y mandaba a otra pantalla a acotar por fecha: el techo
              recorta por fecha DESCENDENTE, así que lo que falta son los VIEJOS, y para
              llegar a ellos había que adivinar unas fechas. Ahora se traen desde aquí. */}
          {movimientosHayMas && (
            <AvisoTope mostrados={movimientos.length} total={data.movimientosTotal}
              limite={data.movimientosLimite} sustantivo="movimientos" />
          )}

          {movimientos.length === 0 ? (
            <div className="mon-empty">
              <Package size={40} strokeWidth={1} opacity={0.2} />
              <p>Aún no hay movimientos registrados en este almacén.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Producto</th>
                    <th className="col-num">Cantidad</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {movsPage.map(m => (
                    <tr key={m.movimiento_id}>
                      <td data-label="Fecha" className="text-sm-muted">{fmtFechaEs(m.fecha)}</td>
                      <td data-label="Tipo" className="text-sm-muted">{m.tipo}</td>
                      <td data-label="Producto"><span className="cell-clamp">{m.producto}</span></td>
                      <td data-label="Cantidad" className="col-num">{m.cantidad.toLocaleString('es-ES')}</td>
                      <td data-label="Motivo" className="text-sm-muted"><span className="cell-clamp">{m.motivo ?? '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <TablePagination {...pagMovs} label="movimiento" />
        </div>
      )}

      {/* Hay una hoja abierta de otro día: retomar o empezar de cero.
          No se decide por el dueño en ninguna de las dos direcciones. Retomar en
          silencio le da cantidades viejas creyendo que son de hoy; abrir una nueva en
          silencio le tira el trabajo de tres días de contar el almacén grande. */}
      {decidirConteo && borrador && (
        <ConfirmDialog
          title="Ya hay un conteo abierto"
          cancelLabel="Cancelar"
          confirmLabel="Retomar esa hoja"
          onCancel={() => setDecidirConteo(false)}
          onConfirm={() => irAlConteo(abrirConteo)}
          body={
            <>
              <p>
                Este almacén tiene una hoja abierta del <strong>{fmtFechaEs(borrador.fecha)}</strong>
                {borrador.contado_por ? <>, de {borrador.contado_por}</> : null}
                {borrador.contadas > 0
                  ? <>, con {borrador.contadas} {borrador.contadas === 1 ? 'línea contada' : 'líneas contadas'}.</>
                  : <>, todavía sin empezar.</>}
              </p>
              <p className="text-xs-muted mt-2">
                Contar un almacén lleva días, así que la hoja se guarda y se retoma. Pero si
                esto es un conteo nuevo, esas cantidades son de aquel día y no valen: empieza
                otra. No se toca ninguna existencia en ninguno de los dos casos.
              </p>
              <div className="alm-conteo-nuevo">
                <button type="button" className="btn btn-secondary btn-sm" disabled={pendingContar}
                  onClick={() => irAlConteo(empezarConteoNuevo)}>
                  Empezar una hoja nueva
                </button>
                <span className="text-xs-muted">
                  Se descarta lo contado el {fmtFechaEs(borrador.fecha)}.
                </span>
              </div>
            </>
          }
        />
      )}

      {ajuste && (
        <StockAjusteModal
          producto_id={ajuste.producto_id}
          nombre={ajuste.nombre}
          unidad={ajuste.unidad}
          almacenes={[{ almacen_id: almacen.almacen_id, nombre: almacen.nombre }]}
          almacenInicial={almacen.almacen_id}
          modoInicial="fijar"
          onClose={() => setAjuste(null)}
          onSaved={() => { setAjuste(null); router.refresh() }}
        />
      )}
    </div>
  )
}
