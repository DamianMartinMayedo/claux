'use client'

import { Check, Eye, FileText, Pencil, Plus, Presentation, Trash2, UserPlus, X, Download } from 'lucide-react'
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { RowActions } from '@/components/portal/RowActions'
import PresupuestoPdfMenu from '@/components/admin/PresupuestoPdfMenu'
import { ConfirmDialog } from '@/components/portal/Dialog'
import Filtros from '@/components/portal/Filtros'
import ModalShell from '@/components/portal/ModalShell'
import FormHelp from '@/components/portal/FormHelp'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import VentasTabs from '@/components/admin/VentasTabs'
import { useToast, toastLoading, toastTono } from '@/app/contexts/ToastContext'
import ClienteFormModal, {
  type ModuloCatalogo,
  type PlantillaSector,
  type InitialCliente,
} from '../clientes/ClienteFormModal'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import { filtroExport, resumenDe, type Filtro as FiltroDecl } from '@/lib/filtros'
import type { FiltroAdmin } from '@/lib/exportar/tablas-admin'
import { descargarPresupuesto } from '@/lib/pdf/presupuesto'
import { importeCiclo } from '@/lib/billing'
import { normalizarNivel, precioModulo, type Nivel } from '@/lib/niveles'
import { numeroPresupuesto } from '@/lib/presupuesto/config'
import { claveOrdenImporte, importeClaux, normalizarMonedaClaux } from '@/lib/moneda-claux'
import {
  obtenerPresupuesto,
  actualizarHorasReales,
  aprobarPresupuesto,
  eliminarPresupuesto,
  type PresupuestoRow,
} from '@/app/actions/presupuestos'
import { crearPropuesta } from '@/app/actions/propuestas'
import ExportarMenu from '@/components/portal/ExportarMenu'

type DesgloseFase = { fase: string; horas: number; subtotal: number; detalle?: string }
type Revision = { linea: string; motivo: string }
/** Los tres estados de un presupuesto, que son también las pastillas del filtro. */
type EstadoPresupuesto = 'guardado' | 'aprobado' | 'instalado'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detalle = Record<string, any>


function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}
// La moneda la trae CADA presupuesto, no el que mira la lista: un presupuesto
// enseñado en dólares se lee en dólares para siempre, aunque a ese cliente hoy se
// le facture en euros. Por eso el importe siempre pide su moneda al lado.
const imp = (n: number, moneda: unknown) => importeClaux(n, normalizarMonedaClaux(moneda))

// El presupuesto avanza guardado → aprobado → instalado, y ordenar por estado
// tiene que seguir ese camino, no el alfabeto.
const ESTADO_PRIORIDAD: Record<string, number> = { guardado: 0, aprobado: 1, instalado: 2 }

const COLUMNAS: ColumnasOrden<PresupuestoRow> = {
  estado:      { label: 'Estado',      valor: p => ESTADO_PRIORIDAD[p.estado] ?? 9 },
  fecha:       { label: 'Fecha',       valor: p => p.created_at },
  negocio:     { label: 'Negocio',     valor: p => p.nombre_negocio },
  comercial:   { label: 'Comercial',   valor: p => p.comercial_nombre },
  horas:       { label: 'Horas est.',  valor: p => p.horas_total },
  instalacion: { label: 'Instalación', valor: p => claveOrdenImporte(p.total_final ?? p.coste_instalacion, p.moneda) },
  cuota:       { label: 'Cuota/mes',   valor: p => claveOrdenImporte(p.cuota_mensual, p.moneda) },
  reales:      { label: 'Reales',      valor: p => p.horas_reales },
}

function EstadoBadge({ estado }: { estado: string }) {
  if (estado === 'aprobado')  return <span className="badge badge-success">Aprobado</span>
  if (estado === 'instalado') return <span className="badge badge-purple">Instalado</span>
  return <span className="badge badge-info">Guardado</span>
}

// Precarga del alta de cliente a partir del presupuesto. El correo (contacto
// principal) y el sector vienen del diagnóstico de origen; si no hay diagnóstico
// (presupuesto manual) se cae al `contacto` cuando parece un email. Los módulos y
// el nivel vienen del presupuesto, y el pago de configuración = coste calculado.
function initialDesde(d: Detalle): InitialCliente {
  const diag = d.diagnosticos ?? null
  const contacto = String(d.contacto ?? '').trim()
  const email = String(diag?.email ?? '').trim() || (contacto.includes('@') ? contacto : '')
  return {
    nombre_empresa:  d.nombre_negocio ?? '',
    nombre_contacto: d.nombre_responsable ?? '',
    email_admin:     email,
    sector:          diag?.sector ?? '',
    nivel:           normalizarNivel(d.nivel),
    modulos:         Array.isArray(d.modulos) ? d.modulos : [],
    // Lo que se cobra es el total tras el descuento, no el coste bruto: cobrar el bruto
    // sería no aplicar lo que se le prometió al cliente.
    pago_setup:      Number(d.total_final ?? d.coste_instalacion ?? 0),
    // El cliente nace en la moneda de su presupuesto: es la que firmó. Convertirla
    // aquí sería facturarle un número que no vio nunca.
    moneda:          normalizarMonedaClaux(d.moneda),
  }
}

export default function PresupuestosView({
  presupuestos,
  rol,
  permisos,
  catalogo,
  plantillas,
  nombresNivel,
  descuentoAnualPct,
}: {
  presupuestos: PresupuestoRow[]
  rol: RolAdmin
  permisos: SeccionKey[]
  catalogo: ModuloCatalogo[]
  plantillas: PlantillaSector[]
  nombresNivel: Record<Nivel, string>
  descuentoAnualPct: number
}) {
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()
  // En la URL: un enlace a «los aprobados» se puede mandar, y volver de un
  // presupuesto no deshace el filtro.
  const filtro = useSearchParams().get('estado') ?? ''
  const puedePropuestas = rol === 'super_admin' || permisos.includes('propuestas')

  /**
   * El presupuesto en PDF, con la misma plantilla de marca que la factura.
   *
   * Se arma desde el SNAPSHOT guardado (`desglose`, `tarifa_hora`, `descuento_*`), no
   * recalculando: un presupuesto enseñado al cliente hace tres meses tiene que imprimirse tal
   * como se le enseñó, aunque la tarifa base haya subido desde entonces.
   */
  async function descargarPdf(d: Detalle, incluir: 'todo' | 'instalacion' | 'suscripcion') {
    const claves: string[] = Array.isArray(d.modulos) ? d.modulos : []
    const moneda = normalizarMonedaClaux(d.moneda)
    const mods = catalogo
      .filter(m => claves.includes(m.clave))
      .map(m => ({ nombre: m.nombre, precio: precioModulo(m, d.nivel, moneda) }))
    const mensual = Number(d.cuota_mensual ?? 0)
    try {
      await descargarPresupuesto({
        numero:  numeroPresupuesto(d.id),
        fecha:   fmtFecha(d.created_at),
        negocio: d.nombre_negocio ?? '',
        responsable: d.nombre_responsable,
        contacto:    d.contacto,
        desglose:    Array.isArray(d.desglose) ? d.desglose : [],
        horasTotal:  Number(d.horas_total ?? 0),
        tarifaHora:  Number(d.tarifa_hora ?? 0),
        costeInstalacion: Number(d.coste_instalacion ?? 0),
        descuentoPct:     Number(d.descuento_pct ?? 0),
        totalInstalacion: Number(d.total_final ?? d.coste_instalacion ?? 0),
        modulos:      mods,
        cuotaMensual: mensual,
        cuotaAnual:   importeCiclo(mensual, 'anual', descuentoAnualPct),
        descuentoAnualPct,
        moneda,
        incluir,
      }, `${numeroPresupuesto(d.id)}${incluir === 'todo' ? '' : `-${incluir}`}.pdf`)
    } catch {
      toastError('No se pudo generar el PDF.')
    }
  }
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  // La fila que se está abriendo. Guardar la fila entera y no un booleano permite
  // pintar la cabecera del modal —nombre y número— desde el primer momento, en vez
  // de un recuadro sin título mientras el servidor devuelve el presupuesto.
  const [cargando, setCargando] = useState<PresupuestoRow | null>(null)
  const [horasReales, setHorasReales] = useState('')
  const [horasRealesOriginales, setHorasRealesOriginales] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [aprobando, setAprobando] = useState(false)
  // El borrador que se está confirmando para borrar: el estado vive aquí, no en la
  // fila ni en el menú (que se desmonta al pulsar y se llevaría el diálogo con él).
  const [borrar, setBorrar]   = useState<PresupuestoRow | null>(null)
  const [borrando, setBorrando] = useState(false)

  // Alta de cliente desde un presupuesto aprobado (modal compartido).
  const [clienteOpen, setClienteOpen] = useState(false)
  const [clienteInitial, setClienteInitial] = useState<InitialCliente | undefined>(undefined)
  const [clientePresupuestoId, setClientePresupuestoId] = useState<number | undefined>(undefined)

  const visibles = useMemo(
    () => presupuestos.filter(p => filtro === '' || p.estado === filtro),
    [presupuestos, filtro],
  )
  const orden = useOrden(visibles, COLUMNAS, { clave: 'fecha', dir: 'desc' })
  const { pageItems, ...pag } = usePagination(orden.filas)

  const cuantos = (e: EstadoPresupuesto) => presupuestos.filter(p => p.estado === e).length
  const nAprobados = cuantos('aprobado')

  /** LA DECLARACIÓN. `cliente`: los presupuestos vienen enteros y son pocos. */
  const declaracion: FiltroDecl[] = useMemo(() => {
    const cuenta = (e: EstadoPresupuesto) => presupuestos.filter(p => p.estado === e).length
    return [{
      clave: 'estado', label: 'Todos', rotulo: 'Estado',
      valor: filtro, widget: 'pastillas', donde: 'cliente',
      todasCount: presupuestos.length,
      opciones: [
        { valor: 'guardado',  label: 'Guardados',  count: cuenta('guardado') },
        { valor: 'aprobado',  label: 'Aprobados',  count: cuenta('aprobado') },
        { valor: 'instalado', label: 'Instalados', count: cuenta('instalado') },
      ],
    }]
  }, [filtro, presupuestos])

  // Qué petición es la que vale. Con una conexión lenta —la de Cuba— da tiempo a
  // cerrar el modal o a pulsar otra fila antes de que conteste el servidor, y sin
  // esto la respuesta atrasada volvía a abrir el modal, o pisaba el presupuesto que
  // se acababa de pedir con el anterior.
  const peticion = useRef(0)

  async function abrir(p: PresupuestoRow) {
    const mia = ++peticion.current
    setCargando(p)
    const d = await obtenerPresupuesto(p.id)
    if (peticion.current !== mia) return
    setCargando(null)
    if (!d) { toastError('No se pudo cargar el presupuesto'); return }
    setDetalle(d)
    setHorasReales(d.horas_reales != null ? String(d.horas_reales) : '')
    setHorasRealesOriginales(d.horas_reales != null ? String(d.horas_reales) : '')
  }

  function cerrarDetalle() {
    peticion.current++
    setDetalle(null)
    setCargando(null)
  }

  async function guardarHoras() {
    if (!detalle) return
    setGuardando(true)
    const val = horasReales.trim() === '' ? null : parseFloat(horasReales)
    const r = await actualizarHorasReales(detalle.id, val)
    setGuardando(false)
    if (!r.ok) { toastError(r.error ?? 'Error al guardar'); return }
    toastSuccess('Horas reales guardadas')
    setDetalle(null)
    router.refresh()
  }

  async function borrarPresupuesto() {
    if (!borrar) return
    setBorrando(true)
    const r = await eliminarPresupuesto(borrar.id)
    setBorrando(false)
    if (!r.ok) { toastError(r.error ?? 'No se pudo eliminar'); return }
    toastSuccess(r.yaEliminado ? 'El presupuesto ya no existía; lista actualizada' : 'Borrador eliminado')
    setBorrar(null)
    router.refresh()
  }

  async function aprobar(id: number, aprobado: boolean) {
    setAprobando(true)
    const r = await aprobarPresupuesto(id, aprobado)
    setAprobando(false)
    if (!r.ok) { toastError(r.error ?? 'Error al guardar'); return }
    toastSuccess(aprobado ? 'Presupuesto aprobado' : 'Aprobación retirada')
    // Aprobar mueve el cobro de configuración (crearlo, ajustarlo o retirarlo).
    // Si ya estaba confirmado no se toca y el aviso llega en tono de advertencia.
    if (r.aviso) toastTono(r.avisoTono ?? 'info', r.aviso)
    if (detalle?.id === id) setDetalle({ ...detalle, estado: aprobado ? 'aprobado' : 'guardado' })
    router.refresh()
  }

  // La propuesta hereda del presupuesto el nivel, la moneda y los módulos: son
  // decisiones ya pactadas aquí, y volver a teclearlas es cómo la diapositiva 13
  // acabó contradiciendo a la 14. Lo hace la acción; esto solo abre el editor.
  async function nuevaPropuesta(p: PresupuestoRow) {
    const ld = toastLoading('Creando…')
    const r = await crearPropuesta({ nombreNegocio: p.nombre_negocio, presupuestoId: p.id })
    await ld.dismiss()
    if (!r.ok || !r.id) { toastError(r.error ?? 'No se pudo crear la propuesta'); return }
    router.push(`/admin/ventas/propuestas/${r.id}`)
  }

  // Ir a la ficha del cliente NAVEGA fuera de aquí: las horas escritas y sin guardar
  // se irían con la página. Se guardan antes y se navega a mano. Solo se intercepta el
  // clic simple: con ⌘/Ctrl/⇧/Alt o botón central el enlace abre otra pestaña y este
  // modal se queda como está, con las horas intactas, así que no hay nada que salvar.
  async function irAFichaCliente(e: MouseEvent<HTMLAnchorElement>, clientId: string) {
    if (!detalle || !horasHanCambiado) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    setGuardando(true)
    const val = horasReales.trim() === '' ? null : parseFloat(horasReales)
    const r = await actualizarHorasReales(detalle.id, val)
    setGuardando(false)
    if (!r.ok) { toastError(r.error ?? 'No se pudieron guardar las horas reales'); return }
    toastSuccess('Horas reales guardadas')
    router.push(`/admin/clientes/${clientId}`)
  }

  // Dar de alta el cliente CIERRA este modal, así que las horas escritas y sin guardar
  // se irían con él sin decir nada. Se guardan primero — y solo las de ESTE presupuesto:
  // desde la fila se abre sin modal y el estado de horas puede ser de otro que se miró
  // antes. Ojo: guardar horas deja el presupuesto en «instalado», igual que el botón.
  async function abrirClienteConDetalle(d: Detalle) {
    if (detalle?.id === d.id && horasHanCambiado) {
      setGuardando(true)
      const val = horasReales.trim() === '' ? null : parseFloat(horasReales)
      const r = await actualizarHorasReales(d.id, val)
      setGuardando(false)
      if (!r.ok) { toastError(r.error ?? 'No se pudieron guardar las horas reales'); return }
      toastSuccess('Horas reales guardadas')
    }
    setClienteInitial(initialDesde(d))
    setClientePresupuestoId(d.id)
    setDetalle(null)
    setClienteOpen(true)
  }

  async function abrirCrearClienteRow(id: number) {
    const d = await obtenerPresupuesto(id)
    if (!d) { toastError('No se pudo cargar el presupuesto'); return }
    await abrirClienteConDetalle(d)
  }

  const desglose: DesgloseFase[] = Array.isArray(detalle?.desglose) ? detalle!.desglose : []
  const revisiones: Revision[] = Array.isArray(detalle?.revisiones) ? detalle!.revisiones : []
  const horasHanCambiado = horasReales !== horasRealesOriginales
  // La acción principal la fija el ESTADO: lo que mueve el presupuesto hacia adelante.
  // «Guardar» va aparte y SIEMPRE en primary (conviven), pero sí empuja al PDF a
  // secundario: con horas escritas, la acción del momento no es bajarse un papel.
  const accionPrincipal =
    detalle?.estado === 'guardado'   ? 'aprobar'
    : detalle?.estado === 'aprobado' ? 'cliente'
    : horasHanCambiado               ? 'horas'
    : 'pdf'

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Presupuestos de instalación</h1>
          <p className="page-subtitle">
            {presupuestos.length} guardado{presupuestos.length !== 1 ? 's' : ''} · {nAprobados} aprobado{nAprobados !== 1 ? 's' : ''}.
          </p>
        </div>
        <Link href="/admin/presupuestos/nuevo" className="btn btn-primary">
          <Plus size={16} /> Nuevo presupuesto
        </Link>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />

      <Filtros
        filtros={declaracion}
        acciones={
          <ExportarMenu
            ambito="admin"
            clave="presupuestos"
            filtro={filtroExport<FiltroAdmin>(declaracion)}
            resumen={resumenDe(declaracion)}
            pequeno
            sinPeriodo
          />
        }
      />

      {visibles.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <FileText size={40} strokeWidth={1.5} />
            <h3 className="table-empty-title">Sin presupuestos</h3>
            <p>{filtro === '' ? 'Calcula el primero con el botón de arriba.' : 'No hay presupuestos en este estado.'}</p>
          </div>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <ThOrden orden={orden} clave="estado" />
                  <ThOrden orden={orden} clave="fecha" />
                  <ThOrden orden={orden} clave="negocio" />
                  <ThOrden orden={orden} clave="comercial" />
                  <ThOrden orden={orden} clave="horas"       className="col-center" />
                  <ThOrden orden={orden} clave="instalacion" className="col-num" />
                  <ThOrden orden={orden} clave="cuota"       className="col-num" />
                  <ThOrden orden={orden} clave="reales"      className="col-center" />
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(p => (
                  <tr key={p.id} className="table-row-clickable" onClick={() => abrir(p)}>
                    <td data-label="Estado"><EstadoBadge estado={p.estado} /></td>
                    <td data-label="Fecha" className="table-muted">{fmtFecha(p.created_at)}</td>
                    <td data-label="Negocio">{p.nombre_negocio}</td>
                    <td data-label="Comercial" className="table-muted">{p.comercial_nombre ?? '—'}</td>
                    <td data-label="Horas est." className="col-center">{p.horas_total}</td>
                    <td data-label="Instalación" className="col-num">{imp(p.total_final ?? p.coste_instalacion, p.moneda)}</td>
                    <td data-label="Cuota/mes" className="col-num">{imp(p.cuota_mensual, p.moneda)}</td>
                    <td data-label="Reales" className="col-center">{p.horas_reales ?? '—'}</td>
                    {/* La fila abre la ficha; el menú de acciones no la abre por
                        debajo mientras eliges dentro de él. */}
                    <td className="col-actions" onClick={e => e.stopPropagation()}>
                      <RowActions>
                        <button className="row-actions-item" onClick={() => abrir(p)}>
                          <Eye size={15} strokeWidth={2} /> Ver detalles
                        </button>
                        {puedePropuestas && (
                          <button className="row-actions-item" onClick={() => nuevaPropuesta(p)}>
                            <Presentation size={15} strokeWidth={2} /> Crear propuesta
                          </button>
                        )}
                        {/* Editar solo en borrador: aprobado/instalado son foto congelada. */}
                        {p.estado === 'guardado' && (
                          <Link href={`/admin/presupuestos/${p.id}/editar`} className="row-actions-item">
                            <Pencil size={15} strokeWidth={2} /> Editar
                          </Link>
                        )}
                        {p.estado !== 'instalado' && (
                          p.estado === 'aprobado'
                            ? <button className="row-actions-item" onClick={() => aprobar(p.id, false)}>
                                <X size={15} strokeWidth={2} /> Quitar aprobación
                              </button>
                            : <button className="row-actions-item" onClick={() => aprobar(p.id, true)}>
                                <Check size={15} strokeWidth={2} /> Aprobar
                              </button>
                        )}
                        {p.estado === 'aprobado' && !p.client_id && (
                          <button className="row-actions-item" onClick={() => abrirCrearClienteRow(p.id)}>
                            <UserPlus size={15} strokeWidth={2} /> Crear cliente
                          </button>
                        )}
                        {p.client_id && (
                          <Link href={`/admin/clientes/${p.client_id}`} className="row-actions-item">
                            <UserPlus size={15} strokeWidth={2} /> Ver cliente {p.client_id}
                          </Link>
                        )}
                        {/* Eliminar solo el borrador: un presupuesto que se hizo por
                            error no debería quedarse compitiendo por ser «el» del cliente. */}
                        {p.estado === 'guardado' && (
                          <button
                            className="row-actions-item row-actions-item-danger"
                            onClick={() => setBorrar(p)}
                          >
                            <Trash2 size={14} strokeWidth={2} /> Eliminar
                          </button>
                        )}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} label="presupuesto" />
        </div>
      )}

      {(detalle || cargando) && (
        <ModalShell
          title={detalle?.nombre_negocio ?? cargando?.nombre_negocio ?? ''}
          subtitle={`${numeroPresupuesto(detalle?.id ?? cargando!.id)} · ${fmtFecha(detalle?.created_at ?? cargando!.created_at)}`}
          size="modal-640 modal-fixed-actions"
          onClose={cerrarDetalle}
        >
          {!detalle ? (
            <div className="modal-body"><p className="text-sm-muted"><span className="spinner" /> Cargando…</p></div>
          ) : (
            <>
              <div className="modal-body">
                <div className="sol-detalle">
                  <div className="sol-row"><span className="sol-label">Estado</span><span className="sol-value"><EstadoBadge estado={detalle.estado} /></span></div>
                  <div className="sol-row"><span className="sol-label">Comercial</span><span className="sol-value">{detalle.comercial_nombre ?? '—'}</span></div>
                  <div className="sol-row"><span className="sol-label">Responsable</span><span className="sol-value">{detalle.nombre_responsable ?? '—'}</span></div>
                  <div className="sol-row"><span className="sol-label">Contacto</span><span className="sol-value">{detalle.contacto ?? '—'}</span></div>
                  <div className="sol-row"><span className="sol-label">Nivel</span><span className="sol-value">{nombresNivel[normalizarNivel(detalle.nivel)]}</span></div>
                  <div className="sol-row"><span className="sol-label">Módulos</span><span className="sol-value">{(detalle.modulos ?? []).join(', ') || '—'}</span></div>
                  {detalle.client_id && (
                    <div className="sol-row"><span className="sol-label">Cliente</span><span className="sol-value">{detalle.client_id}</span></div>
                  )}
                </div>

                <div className="pres-desglose">
                  <p className="mod-list-label">Desglose por fase</p>
                  {desglose.map((d, i) => (
                    <div key={i} className="pres-fase-row">
                      <span className="pres-fase-nombre">{d.fase}</span>
                      <span className="pres-fase-horas">{d.horas}h</span>
                      <span className="pres-fase-sub">{imp(d.subtotal, detalle.moneda)}</span>
                    </div>
                  ))}
                </div>

                {revisiones.length > 0 && (
                  <div className="alert alert-warning">
                    <strong>Líneas a revisar</strong>
                    <ul className="pres-revisiones">
                      {revisiones.map((r, i) => <li key={i}><strong>{r.linea}:</strong> {r.motivo}</li>)}
                    </ul>
                  </div>
                )}

                {/* Dos precios, dos bloques: el pago único y lo recurrente no se suman. */}
                <div className="pres-totales">
                  <p className="pres-bloque-titulo">Pago único · Instalación</p>
                  <div><span className="pres-total-label">Horas totales</span><span className="pres-total-valor">{detalle.horas_total}h</span></div>
                  {/* La tarifa que se aplicó, no la vigente: un presupuesto de hace tres
                      meses tiene que seguir explicando su propio número. */}
                  {Number(detalle.tarifa_hora) > 0 && (
                    <div><span className="pres-total-label">Tarifa aplicada</span><span className="pres-total-valor">{imp(detalle.tarifa_hora, detalle.moneda)}/h</span></div>
                  )}
                  <div><span className="pres-total-label">Coste instalación</span><span className="pres-total-valor">{imp(detalle.coste_instalacion, detalle.moneda)}</span></div>
                  {Number(detalle.descuento_pct) > 0 && (
                    <>
                      <div className="pres-total-dto">
                        <span className="pres-total-label">
                          Descuento ({Number(detalle.descuento_pct)}%)
                          {detalle.descuento_motivo && <em className="pres-dto-motivo"> · {detalle.descuento_motivo}</em>}
                        </span>
                        <span className="pres-total-valor">
                          −{imp(Number(detalle.coste_instalacion) - Number(detalle.total_final), detalle.moneda)}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="pres-total-final">
                    <span className="pres-total-label">Total a pagar una vez</span>
                    <span className="pres-total-valor">{imp(detalle.total_final ?? detalle.coste_instalacion, detalle.moneda)}</span>
                  </div>
                </div>

                <div className="pres-totales">
                  <p className="pres-bloque-titulo">Suscripción</p>
                  <div className="pres-total-final">
                    <span className="pres-total-label">Cada mes</span>
                    <span className="pres-total-valor">{imp(detalle.cuota_mensual, detalle.moneda)}</span>
                  </div>
                  {Number(detalle.cuota_mensual) > 0 && (
                    <div>
                      <span className="pres-total-label">Pagando por año (−{descuentoAnualPct}%)</span>
                      <span className="pres-total-valor">
                        {imp(importeCiclo(Number(detalle.cuota_mensual), 'anual', descuentoAnualPct), detalle.moneda)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="input-group">
                  <div className="form-label-with-help">
                    <label htmlFor="horas-reales">Horas reales de la instalación</label>
                    <FormHelp text="Permite comparar estimado vs. real para afinar tarifas/límites." label="Para qué sirven las horas reales" />
                  </div>
                  <input id="horas-reales" type="number" min="0" step="0.5" className="input"
                    value={horasReales} onChange={e => setHorasReales(e.target.value)}
                    placeholder="Completar al cerrar la instalación" />
                </div>
              </div>
              {/* Orden por importancia: lo secundario a la izquierda, la acción principal
                  la última (a la derecha en escritorio; arriba en móvil, que invierte la
                  columna). Sin «Cerrar»: para eso está la ✕ de la cabecera. */}
              <div className="modal-footer">
                <PresupuestoPdfMenu
                  nombre={detalle.nombre_negocio}
                  destacado={accionPrincipal === 'pdf'}
                  onDownload={tipo => descargarPdf(detalle, tipo)}
                >
                  <Download size={16} strokeWidth={2} /> Descargar PDF
                </PresupuestoPdfMenu>
                {detalle.estado === 'guardado' && (
                  <>
                    <Link href={`/admin/presupuestos/${detalle.id}/editar`} className="btn btn-secondary">
                      <Pencil size={16} strokeWidth={2} /> Editar
                    </Link>
                    <button
                      className={accionPrincipal === 'aprobar' ? 'btn btn-primary' : 'btn btn-secondary'}
                      disabled={aprobando}
                      onClick={() => aprobar(detalle.id, true)}
                    >
                      {aprobando ? <><span className="spinner" /> …</> : <><Check size={16} strokeWidth={2} /> Aprobar</>}
                    </button>
                  </>
                )}
                {detalle.estado === 'aprobado' && (
                  <>
                    <button className="btn btn-secondary" disabled={aprobando} onClick={() => aprobar(detalle.id, false)}>
                      {aprobando ? <><span className="spinner" /> …</> : <><X size={16} strokeWidth={2} /> Quitar aprobación</>}
                    </button>
                    {detalle.client_id ? (
                      <Link
                        href={`/admin/clientes/${detalle.client_id}`}
                        className={accionPrincipal === 'cliente' ? 'btn btn-primary' : 'btn btn-secondary'}
                        aria-disabled={guardando}
                        onClick={e => irAFichaCliente(e, detalle.client_id)}
                      >
                        {guardando
                          ? <><span className="spinner" /> Guardando...</>
                          : <><UserPlus size={16} strokeWidth={2} /> Ver cliente</>}
                      </Link>
                    ) : (
                      <button
                        className={accionPrincipal === 'cliente' ? 'btn btn-primary' : 'btn btn-secondary'}
                        disabled={guardando}
                        onClick={() => abrirClienteConDetalle(detalle)}
                      >
                        {guardando
                          ? <><span className="spinner" /> Guardando...</>
                          : <><UserPlus size={16} strokeWidth={2} /> Crear cliente</>}
                      </button>
                    )}
                  </>
                )}
                {horasHanCambiado && (
                  <button className="btn btn-primary" disabled={guardando} onClick={guardarHoras}>
                    {guardando ? <><span className="spinner" /> Guardando...</> : 'Guardar'}
                  </button>
                )}
              </div>
            </>
          )}
        </ModalShell>
      )}

      {borrar && (
        <ConfirmDialog
          title={`¿Eliminar el borrador de ${borrar.nombre_negocio}?`}
          body={<>
            Se borra el presupuesto de <strong>{imp(borrar.total_final ?? borrar.coste_instalacion, borrar.moneda)}</strong>{' '}
            de instalación ({borrar.horas_total}h) guardado el {fmtFecha(borrar.created_at)}. No se puede deshacer.
          </>}
          confirmLabel="Eliminar"
          pendingLabel="Eliminando…"
          danger
          pending={borrando}
          onConfirm={borrarPresupuesto}
          onCancel={() => setBorrar(null)}
        />
      )}

      <ClienteFormModal
        open={clienteOpen}
        onClose={() => setClienteOpen(false)}
        catalogo={catalogo}
        plantillas={plantillas}
        nombresNivel={nombresNivel}
        descuentoAnualPct={descuentoAnualPct}
        initial={clienteInitial}
        presupuestoId={clientePresupuestoId}
      />
    </div>
  )
}
