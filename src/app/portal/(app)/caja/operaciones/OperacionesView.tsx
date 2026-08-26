'use client'

import { Fragment, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ReceiptText, Boxes } from 'lucide-react'
import type { Ticket, MovimientoStock, LineaTicket } from '@/app/actions/portal/caja'
import { usePagination, TablePagination } from '@/components/TablePagination'
import TablaCargando from '@/components/portal/TablaCargando'
import Tabs from '@/components/Tabs'
import GavetaLanzador from '@/components/portal/GavetaLanzador'
import type { ResumenGaveta } from '@/lib/caja/pendientes'
import ExportarMenu from '@/components/portal/ExportarMenu'
import Filtros from '@/components/portal/Filtros'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'
import AvisoTope from '@/components/portal/AvisoTope'

type Linea = LineaTicket

interface Props {
  data: {
    tickets: Ticket[]; stock: MovimientoStock[]; cajaNombres: Record<string, string>
    lineasPorTicket: Record<string, Linea[]>
    rango: { desde: string; hasta: string }; hay_mas: boolean; total: number; limite: number
  }
}

const money = (n: number) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty   = (n: number) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 3 })
const fecha = (s: string) => s ? new Date(s).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—'

// `.badge` y no la familia propia `.mon-badge`: dentro de una tabla el design system
// apaga el fondo del badge (`table .badge` en 03-components.css) y el estado se lee como
// texto de color. `.mon-badge` no pasa por ahí, así que salía con pill.
function estadoBadge(estado: string) {
  if (estado === 'ANULADO')       return <span className="badge badge-warning">Anulada</span>
  if (estado === 'RECTIFICACION') return <span className="badge badge-info">Rectificación</span>
  return <span className="badge badge-neutral">Original</span>
}

export default function OperacionesView({ data, gaveta }: Props & { gaveta: ResumenGaveta }) {
  const [tab, setTab] = useState<'ventas' | 'stock'>('ventas')
  const [cargando, setCargando] = useState(false)
  // Los filtros viven en la URL, como el rango: refrescar ya no los tira.
  const params = useSearchParams()
  const search = params.get('q')      ?? ''
  const punto  = params.get('punto')  ?? ''   // '' = todos
  const estado = params.get('estado') ?? ''
  const medio  = params.get('medio')  ?? ''
  const dto    = params.get('dto')    ?? ''   // '1' = solo las ventas con descuento
  const conDescuentoCount = useMemo(
    () => data.tickets.filter(t => Number(t.bruto) - Number(t.total) > 0.005).length,
    [data.tickets])
  const cajaNombre = (id: string) => data.cajaNombres[id] ?? id

  /**
   * LA DECLARACIÓN.
   *
   * **Solo el punto de venta va en píldoras.** Los tres filtros las pedían y la barra
   * acababa con hasta once controles a un clic —cuatro de estado, tres de medio de pago y
   * uno por caja— envolviendo en dos y tres líneas antes de la tabla, que es a lo que se
   * viene. Las píldoras son un atajo para lo que SE CAMBIA; el estado y el medio de pago se
   * tocan para responder una pregunta puntual («¿qué cobré por transferencia?») y viven
   * mejor en «Filtros», como en el resto del portal. El punto de venta se queda fuera
   * porque es el que cambia qué estás mirando (y con una sola caja se oculta solo).
   *
   * `cliente` porque la búsqueda de esta pantalla mira nombres que vienen de otra tabla;
   * cuando el listado queda recortado lo dice el aviso del techo.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      clave: 'cuenta_id', param: 'punto', label: 'Todos', valor: punto,
      rotulo: 'Punto de venta',
      widget: 'pastillas', donde: 'cliente',
      // Con un solo punto no hay nada que filtrar: sería una fila de cromo.
      ocultarSi: Object.keys(data.cajaNombres).length <= 1,
      opciones: Object.entries(data.cajaNombres).map(([id, nombre]) => ({ valor: id, label: nombre })),
    },
    // El estado ya lo soportaba la DESCARGA (`operaciones_caja`) y no la pantalla: se podía
    // bajar un fichero solo de anuladas que aquí no había forma de ver.
    {
      clave: 'estado', param: 'estado', label: 'Todas las ventas', valor: estado,
      rotulo: 'Estado', widget: 'select', donde: 'cliente',
      opciones: [
        { valor: 'VIGENTE',       label: 'Originales' },
        { valor: 'RECTIFICACION', label: 'Rectificaciones' },
        { valor: 'ANULADO',       label: 'Anuladas' },
      ],
    },
    // Efectivo o transferencia: desde la mig. 172 deciden a QUÉ cuenta va el dinero, así
    // que cuadrar una caja empieza por poder separarlos.
    {
      clave: 'medio_pago', param: 'medio', label: 'Todos los medios de pago', valor: medio,
      rotulo: 'Medio de pago', widget: 'select', donde: 'cliente',
      opciones: [
        { valor: 'Efectivo',      label: 'Efectivo' },
        { valor: 'Transferencia', label: 'Transferencia' },
      ],
    },
    // Sin techo por descuento, el control es poder VER lo que se regaló. Una columna más
    // no se lee en un listado de 400 ventas: hace falta pedir las once que interesan.
    {
      clave: 'con_descuento', param: 'dto',
      label: conDescuentoCount > 0 ? `Solo con descuento (${conDescuentoCount})` : 'Solo con descuento',
      valor: dto, widget: 'toggle', donde: 'cliente',
      // Un negocio que nunca hace descuentos no necesita el interruptor.
      ocultarSi: conDescuentoCount === 0,
    },
  ], [punto, estado, medio, dto, conDescuentoCount, data.cajaNombres])

  // El buscador mira TAMBIÉN el producto, que es lo que el `placeholder` prometía y la
  // pestaña de Ventas no hacía: se buscaba «cerveza» y no salía nada, con la caja de texto
  // diciendo «Buscar por punto de venta, producto…».
  const textoDe = (t: Ticket) => [
    cajaNombre(t.caja_id), t.moneda, t.medio_pago,
    ...(data.lineasPorTicket[t.ticket_uuid] ?? []).map(l => l.descripcion),
  ].filter(Boolean).join(' ').toLowerCase()

  const ventas = useMemo(() => {
    const q = search.toLowerCase().trim()
    return data.tickets.filter(t =>
      (!punto  || t.caja_id === punto) &&
      (!estado || (t.estado ?? 'VIGENTE') === estado) &&
      (!medio  || (t.medio_pago ?? '') === medio) &&
      (dto !== '1' || Number(t.bruto) - Number(t.total) > 0.005) &&
      (!q || textoDe(t).includes(q)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tickets, data.lineasPorTicket, search, punto, estado, medio, dto])

  // Totales por moneda de lo que se está viendo. La pantalla que responde «cuánto vendí»
  // no lo decía: había que sumar la columna a mano. Las anuladas no cuentan.
  const totales = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of ventas) {
      if ((t.estado ?? 'VIGENTE') === 'ANULADO') continue
      m.set(t.moneda, (m.get(t.moneda) ?? 0) + Number(t.total))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [ventas])

  const stock = useMemo(() => {
    const q = search.toLowerCase().trim()
    return data.stock.filter(l =>
      (!punto || l.caja_id === punto) &&
      (!q || [cajaNombre(l.caja_id), l.descripcion].filter(Boolean).join(' ').toLowerCase().includes(q)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.stock, search, punto])

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Operaciones</h1>
          <p className="page-subtitle">Detalle de las ventas sincronizadas desde tus puntos de venta, una a una.</p>
        </div>
        {/* La descarga sigue a la PESTAÑA y lo dice en el desplegable. Antes bajaba
            siempre los tickets: desde «Movimientos de stock» te llevabas las ventas, con
            el mismo botón y sin un texto que lo desmintiera. */}
        <div className="tes-header-actions">
          <ExportarMenu
            clave={tab === 'ventas' ? 'operaciones_caja' : 'lineas_caja'}
            /* El rango VIAJA al fichero: la pantalla ya no se trae la historia entera. */
            filtro={filtroExport(declaracion, { q: search, desde: data.rango.desde, hasta: data.rango.hasta })}
            resumen={[
              tab === 'ventas' ? 'Ventas' : 'Movimientos de stock',
              ...resumenDe(declaracion),
              ...(search ? [`«${search}»`] : []),
            ]}
          />
        </div>
      </div>

      {/* Aquí NACE lo que falta clasificar: quien mira las operaciones del punto de
          venta es quien mejor recuerda para qué se sacó ese dinero. Se clasifica en
          Tesorería, que es donde está el movimiento. */}
      <GavetaLanzador resumen={gaveta} />

      <Tabs<'ventas' | 'stock'>
        ariaLabel="Tipos de operación"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'ventas', label: 'Ventas' },
          { id: 'stock',  label: 'Movimientos de stock' },
        ]}
      />

      {/* El rango se aplica EN LA CONSULTA. Esta pantalla se traía 1.000 tickets sin rango
          y sin avisar, y encima filtraba en el navegador: en un mostrador con historia, las
          ventas viejas no estaban y nada lo decía. */}
      {/* `visibles={1}`: en la fila, el rango, el buscador y el punto de venta. El estado y
          el medio de pago, dentro de «Filtros» con su rótulo. */}
      <Filtros
        filtros={declaracion}
        rango={data.rango}
        q={search}
        placeholder="Buscar por punto de venta, producto…"
        hayMas={data.hay_mas}
        visibles={1}
        onCargando={setCargando}
      />

      {data.hay_mas && (
        <AvisoTope mostrados={data.tickets.length} total={data.total}
          limite={data.limite} sustantivo="ventas" femenino>
          Los movimientos de stock son las líneas de esas mismas ventas.
        </AvisoTope>
      )}

      {tab === 'ventas' && totales.length > 0 && (
        <div className="caja-totales">
          {totales.map(([m, v]) => (
            <span key={m} className="caja-total-chip">
              <span className="caja-total-cod">{m}</span>
              <strong>{money(v)}</strong>
            </span>
          ))}
        </div>
      )}

      <TablaCargando activo={cargando}>
        {tab === 'ventas'
          ? <VentasTabla items={ventas} cajaNombre={cajaNombre} lineas={data.lineasPorTicket} />
          : <StockTabla  items={stock}  cajaNombre={cajaNombre} />}
      </TablaCargando>
    </div>
  )
}

function VentasTabla({ items, cajaNombre, lineas }: {
  items: Ticket[]; cajaNombre: (id: string) => string; lineas: Record<string, Linea[]>
}) {
  const { pageItems, ...pag } = usePagination(items)
  // Qué venta está abierta. Desplegar y no una página de detalle: un ticket son tres
  // líneas, y navegar fuera para verlas obliga a volver y perder la posición del listado.
  const [abierta, setAbierta] = useState<string | null>(null)

  return (
    <div className="card card-table">
      {items.length === 0 ? (
        <div className="mon-empty">
          <ReceiptText size={36} strokeWidth={1} opacity={0.25} />
          <p>Sin ventas sincronizadas.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th><th>Punto de venta</th><th>Medio de pago</th>
                <th className="col-num">Descuento</th>
                <th className="col-num">Total</th><th>Moneda</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(t => {
                const suyas = lineas[t.ticket_uuid] ?? []
                const abre  = abierta === t.ticket_uuid
                // Las dos capas juntas (línea y ticket): bruto − total. Es la cifra que
                // el dueño quiere, y no obliga a sumar dos columnas mentalmente.
                const regalado = Math.round((Number(t.bruto) - Number(t.total)) * 100) / 100
                return (
                  <Fragment key={t.ticket_uuid}>
                    <tr className={suyas.length ? 'table-row-clickable' : undefined}
                      onClick={suyas.length ? () => setAbierta(abre ? null : t.ticket_uuid) : undefined}>
                      <td data-label="Fecha">{fecha(t.fecha)}</td>
                      <td data-label="Punto de venta">{cajaNombre(t.caja_id)}</td>
                      <td data-label="Medio de pago">{t.medio_pago ?? '—'}</td>
                      <td data-label="Descuento" className="col-num">{regalado > 0 ? `− ${money(regalado)}` : '—'}</td>
                      <td data-label="Total" className="col-num">{money(t.total)}</td>
                      <td data-label="Moneda">{t.moneda}</td>
                      <td data-label="Estado">{estadoBadge(t.estado)}</td>
                    </tr>
                    {abre && (
                      <tr className="caja-detalle-fila">
                        <td colSpan={7}>
                          <ul className="caja-detalle-lineas">
                            {suyas.map((l, i) => (
                              <li key={i}>
                                <span>
                                  {qty(l.cantidad)} × {l.descripcion}
                                  {/* Lo que se le quitó A ESTA LÍNEA. Sin esto, repasar
                                      una venta con el cajero es imposible: el neto solo
                                      dice que el número no es el del catálogo. */}
                                  {l.descuento_importe > 0 && (
                                    <span className="caja-detalle-dto"> · descuento {money(l.descuento_importe)}</span>
                                  )}
                                </span>
                                <span className="col-num">{money(l.subtotal)} {t.moneda}</span>
                              </li>
                            ))}
                            {/* El descuento de la compra entera va aparte de las líneas,
                                que es exactamente como se aplicó. */}
                            {Number(t.descuento_importe) > 0 && (
                              <li>
                                <span>Descuento de la venta</span>
                                <span className="col-num">− {money(t.descuento_importe)} {t.moneda}</span>
                              </li>
                            )}
                            {regalado > 0 && (
                              <li className="caja-detalle-total">
                                <span>Se cobró (antes, {money(t.bruto)})</span>
                                <span className="col-num">{money(t.total)} {t.moneda}</span>
                              </li>
                            )}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <TablePagination {...pag} label="venta" />
    </div>
  )
}

function StockTabla({ items, cajaNombre }: { items: MovimientoStock[]; cajaNombre: (id: string) => string }) {
  const { pageItems, ...pag } = usePagination(items)
  return (
    <div className="card card-table">
      {items.length === 0 ? (
        <div className="mon-empty">
          <Boxes size={36} strokeWidth={1} opacity={0.25} />
          <p>Sin movimientos de stock. Aquí aparecen las líneas de cada venta.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th><th>Punto de venta</th><th>Producto</th>
                <th className="col-num">Cantidad</th><th className="col-num">Precio</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((l, i) => (
                <tr key={`${l.ticket_uuid}-${i}`}>
                  <td data-label="Fecha">{fecha(l.fecha)}</td>
                  <td data-label="Punto de venta">{cajaNombre(l.caja_id)}</td>
                  <td data-label="Producto" className="cell-truncate">{l.descripcion}</td>
                  <td data-label="Cantidad" className="col-num">{qty(l.cantidad)}</td>
                  <td data-label="Precio" className="col-num">{money(l.precio_unitario)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TablePagination {...pag} label="movimiento" />
    </div>
  )
}
