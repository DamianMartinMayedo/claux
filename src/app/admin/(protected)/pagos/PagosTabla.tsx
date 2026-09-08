'use client'

import { Check, CreditCard, Pencil, Trash2 } from 'lucide-react'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import { RowActions } from '@/components/portal/RowActions'
import { ConfirmDialog } from '@/components/portal/Dialog'
import ExportarMenu from '@/components/portal/ExportarMenu'
import Filtros from '@/components/portal/Filtros'
import AvisoTope from '@/components/portal/AvisoTope'
import TablaCargando from '@/components/portal/TablaCargando'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'
import type { FiltroAdmin } from '@/lib/exportar/tablas-admin'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { confirmarPago, eliminarPago } from '@/app/actions/pagos'
import EditarPagoModal from './EditarPagoModal'
import { claveOrdenImporte, importeClaux } from '@/lib/moneda-claux'
import { METODO_PAGO_LABEL } from '@/lib/billing'

export type Pago = {
  pago_id: string; client_id: string; concepto: string | null; estado: string | null
  monto: number; metodo: string; fecha: string
  /** La del cobro, congelada en la fila: un pago de hace un año en dólares se lee
   *  en dólares aunque hoy a ese cliente se le facture en euros (mig. 225). */
  moneda: string | null
  fecha_inicio_periodo: string | null; fecha_fin_periodo: string | null
  notas: string | null
}

function conceptoLabel(concepto: string | null) {
  return concepto === 'configuracion' ? 'Configuración' : 'Suscripción'
}

function estadoLabel(estado: string | null) {
  return estado === 'por_confirmar' ? 'Por confirmar' : 'Confirmado'
}

function formatFecha(fecha: string | null) {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(-2)}`
}

/**
 * Clave de orden del importe, con la MONEDA delante. Ordenar por el número pelado
 * pondría 100 CUP por encima de 50 USD, que es una comparación que no existe: aquí
 * cada moneda se ordena dentro de su bloque y el listado no insinúa una conversión
 * que nadie ha hecho (la moneda del pago es la del cobro, mig. 225).
 */
const claveImporte = (p: Pago) => claveOrdenImporte(p.monto, p.moneda)


type Pendiente = { accion: 'confirmar' | 'eliminar'; pago: Pago }

export default function PagosTabla({
  pagos,
  clienteNombre,
  clientesPrueba,
  total,
  limite,
  hayMas,
}: {
  pagos: Pago[]
  clienteNombre: Record<string, string>
  clientesPrueba: string[]
  /** Cuántos cumplen el filtro de verdad (el `count` de la consulta), para el aviso. */
  total: number
  limite: number
  /** El listado viene recortado por el techo: los filtros pasan a aplicarse en la consulta. */
  hayMas: boolean
}) {
  const router = useRouter()
  const idsPrueba = useMemo(() => new Set(clientesPrueba), [clientesPrueba])

  /**
   * Los cuatro filtros viven en la URL. En `useState` no se podía mandar a nadie un enlace
   * a «lo que está por confirmar», y volver de la ficha de un cliente devolvía la lista
   * entera con el filtro perdido.
   */
  const params         = useSearchParams()
  const busqueda       = params.get('q') ?? ''
  const filtroEstado   = params.get('estado') ?? ''
  const filtroConcepto = params.get('concepto') ?? ''
  const filtroMetodo   = params.get('metodo') ?? ''

  /**
   * LA DECLARACIÓN. El ESTADO va primero porque es el operativo —«qué me queda por
   * cobrar»—; concepto y método son de análisis y caen en «Filtros (N)».
   *
   * Los tres `escalado`: mientras los pagos quepan bajo el techo el navegador mira el
   * conjunto completo y filtra al instante —mismo resultado, sin viaje—; en cuanto la
   * consulta recorte, suben al servidor. Filtrar en el navegador una lista recortada
   * enseñaría «lo que de eso cayó entre las 500 últimas», sin decirlo.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      clave: 'estado', label: 'Todos los estados', rotulo: 'Estado',
      valor: filtroEstado, widget: 'select', donde: 'escalado',
      opciones: [
        { valor: 'por_confirmar', label: 'Por confirmar' },
        { valor: 'confirmado',    label: 'Confirmado' },
      ],
    },
    {
      clave: 'concepto', label: 'Todos los conceptos', rotulo: 'Concepto',
      valor: filtroConcepto, widget: 'select', donde: 'escalado',
      opciones: [
        { valor: 'suscripcion',   label: 'Suscripción' },
        { valor: 'configuracion', label: 'Configuración' },
      ],
    },
    {
      clave: 'metodo', label: 'Todos los métodos', rotulo: 'Método',
      valor: filtroMetodo, widget: 'select', donde: 'escalado',
      // De la MISMA constante que pinta la columna: una lista a mano aquí se queda corta
      // el día que se acepte otra forma de cobro, y en silencio.
      opciones: Object.entries(METODO_PAGO_LABEL).map(([valor, label]) => ({ valor, label })),
    },
  ], [filtroEstado, filtroConcepto, filtroMetodo])

  // Los dos diálogos de la fila: el de confirmar/eliminar (una pregunta) y el de
  // editar (un formulario). Los abre la fila, no un botón que se pinta cada
  // componente: en la celda hay UN menú, y de él cuelgan las tres acciones.
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [editando, setEditando]   = useState<Pago | null>(null)
  const [enCurso, setEnCurso]     = useState(false)
  const [cargando, setCargando]   = useState(false)

  const nombreDe = (p: Pago) => clienteNombre[p.client_id] ?? p.client_id

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase()
    return pagos.filter(p => {
      const nombre = (clienteNombre[p.client_id] ?? '').toLowerCase()
      const coincideBusqueda  = !q || nombre.includes(q) || p.client_id.toLowerCase().includes(q)
      const conceptoP = p.concepto === 'configuracion' ? 'configuracion' : 'suscripcion'
      const coincideConcepto  = !filtroConcepto || conceptoP === filtroConcepto
      const estadoP = p.estado === 'por_confirmar' ? 'por_confirmar' : 'confirmado'
      const coincideEstado    = !filtroEstado || estadoP === filtroEstado
      const coincideMetodo    = !filtroMetodo || p.metodo  === filtroMetodo
      return coincideBusqueda && coincideConcepto && coincideEstado && coincideMetodo
    })
  }, [pagos, busqueda, filtroConcepto, filtroEstado, filtroMetodo, clienteNombre])

  // Se reconstruye con `clienteNombre` porque la columna «Cliente» ordena por el
  // nombre que se ve, no por el `client_id` que hay debajo.
  const columnas: ColumnasOrden<Pago> = useMemo(() => ({
    id:       { label: 'ID',        valor: p => p.pago_id },
    cliente:  { label: 'Cliente',   valor: p => clienteNombre[p.client_id] ?? p.client_id },
    concepto: { label: 'Concepto',  valor: p => conceptoLabel(p.concepto) },
    estado:   { label: 'Estado',    valor: p => estadoLabel(p.estado) },
    metodo:   { label: 'Método',    valor: p => METODO_PAGO_LABEL[p.metodo] ?? p.metodo },
    monto:    { label: 'Monto',     valor: claveImporte },
    fecha:    { label: 'Fecha',     valor: p => p.fecha },
  }), [clienteNombre])

  // Se ordena lo filtrado y después se pagina; al revés se ordenaría solo la página
  // visible. Por defecto, lo último cobrado arriba.
  const orden = useOrden(filtrados, columnas, { clave: 'fecha', dir: 'desc' })
  const { pageItems, ...pag } = usePagination(orden.filas)

  async function ejecutar() {
    if (!pendiente) return
    const { accion, pago } = pendiente
    setEnCurso(true)
    const res = accion === 'confirmar'
      ? await confirmarPago(pago.pago_id)
      : await eliminarPago(pago.pago_id)
    setEnCurso(false)
    if (!res.ok) { toastError(res.error ?? 'No se pudo completar la operación.'); return }
    toastSuccess(accion === 'confirmar' ? 'Pago confirmado' : 'Pago eliminado')
    setPendiente(null)
    router.refresh()
  }

  return (
    <>
      {/* La barra del sistema. Los tres desplegables, el buscador, los chips de lo puesto y
          el «Limpiar» salen de la declaración de arriba. */}
      <Filtros
        filtros={declaracion}
        q={busqueda}
        placeholder="Buscar por empresa o ID cliente…"
        visibles={1}
        hayMas={hayMas}
        onCargando={setCargando}
        acciones={
          /* Se descarga lo que cae en el filtro —no la página pintada— y en Excel además
             de CSV. Filtro y resumen GENERADOS: el de antes traducía a mano cada valor y
             ya decía «Confirmados» donde la pantalla dice «Confirmado». */
          <ExportarMenu
            ambito="admin"
            clave="pagos"
            pequeno
            filtro={filtroExport<FiltroAdmin>(declaracion, { q: busqueda })}
            resumen={resumenDe(declaracion)}
            sinPeriodo
          />
        }
      />

      {/* El techo recorta por FECHA DESCENDENTE: lo que falta son los pagos más VIEJOS.
          Se dice cuántos faltan y se pueden traer. */}
      {hayMas && (
        <AvisoTope mostrados={filtrados.length} total={total} limite={limite} sustantivo="pagos" />
      )}

      <TablaCargando activo={cargando}>
      {filtrados.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <CreditCard size={40} strokeWidth={1.5} />
            <p>No se encontraron pagos con los filtros aplicados.</p>
          </div>
        </div>
      ) : (
        <>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <ThOrden orden={orden} clave="id">ID</ThOrden>
                <ThOrden orden={orden} clave="cliente">Cliente</ThOrden>
                <ThOrden orden={orden} clave="concepto">Concepto</ThOrden>
                <ThOrden orden={orden} clave="estado">Estado</ThOrden>
                <ThOrden orden={orden} clave="metodo">Método</ThOrden>
                <ThOrden orden={orden} clave="monto" className="col-num">Monto</ThOrden>
                <ThOrden orden={orden} clave="fecha">Fecha</ThOrden>
                <th>Período</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {pageItems.map(p => (
                <tr key={p.pago_id}>
                  <td data-label="ID"><span className="table-code-muted">{p.pago_id}</span></td>
                  <td data-label="Cliente">
                    {/* Un pago es un REGISTRO, no una entidad con ficha: la fila no
                        lleva a ningún sitio y quien enlaza es el nombre del cliente,
                        que sí la tiene. */}
                    <div className="table-empresa cell-clamp">
                      <Link href={`/admin/clientes/${p.client_id}`} className="table-name-link">
                        {nombreDe(p)}
                      </Link>
                      {idsPrueba.has(p.client_id) && <span className="badge badge-purple">Prueba</span>}
                    </div>
                    <div className="table-empresa-contact">{p.client_id}</div>
                  </td>
                  <td data-label="Concepto">
                    <span className={`badge ${p.concepto === 'configuracion' ? 'badge-info' : 'badge-neutral'}`}>
                      {conceptoLabel(p.concepto)}
                    </span>
                  </td>
                  <td data-label="Estado">
                    <span className={`badge ${p.estado === 'por_confirmar' ? 'badge-warning' : 'badge-success'}`}>
                      {estadoLabel(p.estado)}
                    </span>
                  </td>
                  <td data-label="Método">
                    <span className="badge badge-neutral">
                      {METODO_PAGO_LABEL[p.metodo] ?? p.metodo}
                    </span>
                  </td>
                  <td data-label="Monto" className="col-num table-price">{importeClaux(p.monto, p.moneda)}</td>
                  <td data-label="Fecha" className="table-muted">{formatFecha(p.fecha)}</td>
                  <td data-label="Período" className="table-muted text-xs">
                    {p.fecha_inicio_periodo && p.fecha_fin_periodo
                      ? `${formatFecha(p.fecha_inicio_periodo)} → ${formatFecha(p.fecha_fin_periodo)}`
                      : '—'}
                  </td>
                  <td className="col-actions">
                    <RowActions>
                      {p.estado === 'por_confirmar' && (
                        <button
                          className="row-actions-item row-actions-item-success"
                          onClick={() => setPendiente({ accion: 'confirmar', pago: p })}
                        >
                          <Check size={15} /> Confirmar cobro
                        </button>
                      )}
                      <button className="row-actions-item" onClick={() => setEditando(p)}>
                        <Pencil size={14} /> Editar
                      </button>
                      <button
                        className="row-actions-item row-actions-item-danger"
                        onClick={() => setPendiente({ accion: 'eliminar', pago: p })}
                      >
                        <Trash2 size={14} /> Eliminar
                      </button>
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination {...pag} label="pago" />
        </>
      )}
      </TablaCargando>

      {pendiente?.accion === 'confirmar' && (
        <ConfirmDialog
          title="Confirmar pago"
          body={<>
            Marca como cobrado <strong>{pendiente.pago.pago_id}</strong> de {nombreDe(pendiente.pago)}
            {' '}({pendiente.pago.concepto === 'configuracion' ? 'configuración' : 'suscripción'})
            {' '}por <strong>{importeClaux(pendiente.pago.monto, pendiente.pago.moneda)}</strong>. A partir
            de aquí cuenta como ingreso. Se confirma una vez verificado el dinero.
          </>}
          confirmLabel="Confirmar cobro"
          pending={enCurso}
          pendingLabel="Confirmando…"
          onConfirm={ejecutar}
          onCancel={() => setPendiente(null)}
        />
      )}

      {pendiente?.accion === 'eliminar' && (
        <ConfirmDialog
          title={`¿Eliminar ${pendiente.pago.pago_id}?`}
          body={<>
            Se elimina el pago de <strong>{nombreDe(pendiente.pago)}</strong> y la expiración
            del cliente vuelve al período anterior. No se puede deshacer.
          </>}
          confirmLabel="Eliminar pago"
          danger
          pending={enCurso}
          pendingLabel="Eliminando…"
          onConfirm={ejecutar}
          onCancel={() => setPendiente(null)}
        />
      )}

      {editando && (
        <EditarPagoModal
          pago={editando}
          clienteNombre={nombreDe(editando)}
          onClose={() => setEditando(null)}
        />
      )}
    </>
  )
}
