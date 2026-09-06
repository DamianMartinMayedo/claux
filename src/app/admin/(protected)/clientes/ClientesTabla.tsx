'use client'

import { Eye, User } from 'lucide-react'
import { useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { suscripcionLabel, precioMensualEfectivo, monedaDelCliente, esSocioHoy, type CondicionesCliente } from '@/lib/billing'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import { claveOrdenImporte } from '@/lib/moneda-claux'
import { diasDeCalendario } from '@/lib/fecha-tz'
import { RowActions } from '@/components/portal/RowActions'
import ExportarMenu from '@/components/portal/ExportarMenu'
import Filtros from '@/components/portal/Filtros'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'
import type { FiltroAdmin } from '@/lib/exportar/tablas-admin'

/**
 * Los estados de un cliente EN PALABRAS. El desplegable imprimía el código en crudo
 * («GRACIA», «DESACTIVADO») y el resumen de la descarga decía «Estado: ACTIVO»: la
 * etiqueta vive junto al valor precisamente para que eso no pueda volver a pasar.
 */
const ESTADOS = [
  { valor: 'ACTIVO',      label: 'Activo' },
  { valor: 'TRIAL',       label: 'Trial' },
  { valor: 'GRACIA',      label: 'Período especial' },
  { valor: 'DESACTIVADO', label: 'Suspendido' },
  { valor: 'VENCIDO',     label: 'Vencido' },
]

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-warning', VENCIDO: 'badge-error',
}

export type Cliente = CondicionesCliente & {
  client_id: string; nombre_empresa: string; nombre_contacto: string | null
  email_admin: string; estado: string
  ciclo_facturacion: string | null
  fecha_expiracion: string | null; fecha_inicio: string | null
  fecha_fin_gracia: string | null
  created_at: string | null; notas: string | null
  archivado_at: string | null
  es_prueba: boolean | null
}

function formatFecha(fecha: string | null) {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

type DiasInfo = { label: string; variant: 'error' | 'warning' | 'success' | 'muted' }

/**
 * La fecha que de verdad gobierna a este cliente.
 *
 * Un Socio CLAUX no paga, así que su `fecha_expiracion` se queda congelada en el
 * último ciclo que pagó y retrocede en el pasado para siempre. Su reloj es
 * `socio_hasta` — el mismo criterio que ya aplican el dashboard del portal
 * (`fechaTope` en `actions/portal/dashboard.ts`) y el escáner de la bandeja del
 * admin. Sin fecha, la condición es indefinida y no hay nada que contar.
 */
function fechaTope(c: Cliente): string | null {
  if (esSocioHoy(c)) return c.socio_hasta ?? null
  return (c.estado === 'GRACIA' && c.fecha_fin_gracia) ? c.fecha_fin_gracia : c.fecha_expiracion
}

// `hoy` llega del servidor, en el día del NEGOCIO (America/Havana). Antes salía del
// reloj del navegador, así que los días que le quedan a un cliente cambiaban según
// desde dónde se mirase la lista.
function cuentaAtras(fecha: string, hoy: string): DiasInfo {
  const dias = diasDeCalendario(hoy, fecha.split('T')[0])

  if (dias < 0)   return { label: 'Vencido',   variant: 'error' }
  if (dias === 0) return { label: 'Hoy',        variant: 'error' }
  if (dias <= 5)  return { label: `${dias}d`,   variant: 'error' }
  if (dias <= 14) return { label: `${dias}d`,   variant: 'warning' }
  return              { label: `${dias}d`,       variant: 'success' }
}

/**
 * Los días que le quedan. Esta columna pintaba «Vencido» en rojo sobre un socio con
 * el acceso garantizado —le pasó a DEUS— porque miraba `fecha_expiracion` a secas,
 * cuando el resto del admin (dashboard, bandeja, cron de recordatorios) ya descarta
 * al socio con `esSocioHoy`. Era la única voz de la pantalla que no lo hacía.
 */
function calcDiasRestantes(c: Cliente, hoy: string): DiasInfo {
  if (!esSocioHoy(c) && c.estado === 'DESACTIVADO') return { label: '—', variant: 'muted' }
  const fecha = fechaTope(c)
  if (!fecha) return { label: '—', variant: 'muted' }
  return cuentaAtras(fecha, hoy)
}


/**
 * Clave de orden de la columna «Suscripción». Lleva la MONEDA delante a propósito:
 * ordenar por el número pelado pondría 100 CUP por encima de 50 USD, que es una
 * comparación que no existe. Así cada moneda se ordena dentro de su propio bloque y
 * el listado nunca insinúa un cambio que nadie ha aplicado.
 */
const claveImporte = (c: Cliente) =>
  claveOrdenImporte(precioMensualEfectivo(c), monedaDelCliente(c))



/**
 * Las columnas por las que se puede ordenar. Fuera de `ClientesTabla` para que no se
 * reconstruya el objeto en cada render: `useOrden` lo tiene entre las dependencias del
 * `useMemo` que ordena, así que un objeto nuevo por render volvería a ordenar la lista
 * entera cada vez. `hoy` no hace falta aquí porque ninguna clave depende de él: los
 * días se ordenan por la fecha tope, que es el dato, y no por la etiqueta.
 */
const COLUMNAS: ColumnasOrden<Cliente> = {
  empresa:     { label: 'Empresa',     valor: c => c.nombre_empresa },
  email:       { label: 'Email',       valor: c => c.email_admin },
  suscripcion: { label: 'Suscripción', valor: claveImporte },
  estado:      { label: 'Estado',      valor: c => c.estado },
  // La misma fecha que pinta la columna y que cuenta los días: la de vencimiento del
  // socio cuando lo es, y la de expiración (o fin de gracia) cuando no.
  vence:       { label: 'Expiración',  valor: c => fechaTope(c) },
}

export default function ClientesTabla({
  clientes,
  descuentoAnualPct,
  hoy,
}: {
  clientes: Cliente[]
  descuentoAnualPct: number
  /** Día del negocio, calculado en el servidor. */
  hoy: string
}) {
  const router = useRouter()

  /**
   * Los filtros viven en la URL, como en el portal. En `useState` no sobrevivían a nada:
   * volver de la ficha de un cliente devolvía la lista EN BLANCO —con el filtro perdido— y
   * no había forma de mandarle a nadie un enlace a «los que vencen este mes».
   */
  const params        = useSearchParams()
  const busqueda      = params.get('q') ?? ''
  const filtroEstado  = params.get('estado') ?? ''
  const verArchivados = params.get('archivados') === '1'

  const nArchivados = useMemo(() => clientes.filter(c => c.archivado_at).length, [clientes])

  /**
   * LA DECLARACIÓN. Los dos en `cliente` y es correcto: esta pantalla se trae la cartera
   * ENTERA —no hay techo— así que filtrar en el navegador da el mismo resultado que la
   * consulta. El día que la lista lleve techo (Fase 6.2 del plan), pasan a `escalado`.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      clave: 'estado', label: 'Todos los estados', rotulo: 'Estado',
      valor: filtroEstado, widget: 'select', donde: 'cliente',
      opciones: ESTADOS,
    },
    {
      clave: 'archivados', rotulo: 'Archivados',
      label: `Archivados (${nArchivados})`,
      valor: verArchivados ? '1' : '', widget: 'toggle', donde: 'cliente',
      // Sin ninguno archivado no hay nada que enseñar ni que esconder.
      ocultarSi: nArchivados === 0,
    },
  ], [filtroEstado, verArchivados, nArchivados])

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase()
    return clientes.filter(c => {
      // Por defecto, los archivados no aparecen (activar "Ver archivados").
      if (!verArchivados && c.archivado_at) return false
      const coincideBusqueda = !q ||
        c.nombre_empresa.toLowerCase().includes(q) ||
        c.email_admin.toLowerCase().includes(q) ||
        c.client_id.toLowerCase().includes(q)
      const coincideEstado = !filtroEstado || c.estado === filtroEstado
      return coincideBusqueda && coincideEstado
    })
  }, [clientes, busqueda, filtroEstado, verArchivados])

  // Primero se ORDENA lo filtrado y después se pagina: al revés se ordenaría solo la
  // página que se está viendo. Por defecto, lo que urge — el que vence antes arriba;
  // el tercer clic en una cabecera devuelve el orden del servidor (alta más reciente).
  const orden = useOrden(filtrados, COLUMNAS, { clave: 'vence', dir: 'asc' })
  const { pageItems, ...pag } = usePagination(orden.filas)

  return (
    <>
      {/* La barra del sistema, no una a mano: el buscador, el estado y el interruptor de
          archivados salen de la declaración de arriba, y con ellos los chips de lo puesto y
          el «Limpiar» que esta pantalla no tenía. */}
      <Filtros
        filtros={declaracion}
        q={busqueda}
        placeholder="Buscar por empresa, email o ID…"
        acciones={
          /* Se descarga TODO lo que cae en el filtro, no la página pintada, y en Excel
             además de CSV. El `filtro` y el resumen se GENERAN de la declaración: no hay un
             objeto que escribir a mano y que se pueda quedar corto, ni un resumen que
             imprima «Estado: ACTIVO» como imprimía éste. */
          <ExportarMenu
            ambito="admin"
            clave="clientes"
            pequeno
            filtro={filtroExport<FiltroAdmin>(declaracion, { q: busqueda })}
            resumen={resumenDe(declaracion)}
            sinPeriodo
          />
        }
      />

      {filtrados.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <User size={40} strokeWidth={1.5} />
            <p>No se encontraron clientes con los filtros aplicados.</p>
          </div>
        </div>
      ) : (
        <>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <ThOrden orden={orden} clave="empresa">Empresa</ThOrden>
                <ThOrden orden={orden} clave="email">Email</ThOrden>
                <ThOrden orden={orden} clave="suscripcion">Suscripción</ThOrden>
                <ThOrden orden={orden} clave="estado">Estado</ThOrden>
                <ThOrden orden={orden} clave="vence">Expiración</ThOrden>
                {/* «Días» es la misma fecha contada de otra forma: ordenar por ella es
                    ordenar por «Expiración», y dos cabeceras que hacen lo mismo confunden. */}
                <th className="col-center">Días</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(c => {
                const dias = calcDiasRestantes(c, hoy)
                return (
                  <tr key={c.client_id} className="table-row-clickable" onClick={() => router.push(`/admin/clientes/${c.client_id}`)}>
                    <td data-label="Empresa">
                      <Link
                        href={`/admin/clientes/${c.client_id}`}
                        className="table-name-link"
                        onClick={e => e.stopPropagation()}
                      >
                        {c.nombre_empresa}
                      </Link>
                      <div className="table-empresa-contact">{c.client_id}</div>
                    </td>
                    <td data-label="Email" className="table-muted">{c.email_admin}</td>
                    <td data-label="Suscripción" className="table-muted">
                      {suscripcionLabel(precioMensualEfectivo(c), c.ciclo_facturacion ?? 'mensual', descuentoAnualPct, monedaDelCliente(c))}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge badge-dot ${ESTADO_BADGE[c.estado] ?? 'badge-neutral'}`}>
                        {c.estado}
                      </span>
                      {c.es_prueba && <span className="badge badge-purple">Prueba</span>}
                      {esSocioHoy(c) && <span className="badge badge-indigo">Socio</span>}
                      {c.archivado_at && <span className="badge badge-neutral">Archivado</span>}
                    </td>
                    <td data-label="Expiración" className="table-muted">{formatFecha(fechaTope(c))}</td>
                    <td data-label="Días" className="col-center">
                      <span className={`dias-value dias-value-${dias.variant}`}>
                        {dias.label}
                      </span>
                    </td>
                    {/* La fila entera navega, así que el clic del menú se para aquí: sin
                        esto, abrir «Acciones» abría además la ficha por debajo. */}
                    <td className="col-actions" onClick={e => e.stopPropagation()}>
                      <RowActions>
                        <button className="row-actions-item" onClick={() => router.push(`/admin/clientes/${c.client_id}`)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                      </RowActions>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <TablePagination {...pag} label="cliente" />
        </>
      )}
    </>
  )
}
