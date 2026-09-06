'use client'

import { useState, useMemo } from 'react'
import { ScrollText } from 'lucide-react'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import ExportarMenu from '@/components/portal/ExportarMenu'
import Filtros from '@/components/portal/Filtros'
import TablaCargando from '@/components/portal/TablaCargando'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'
import type { FiltroAdmin } from '@/lib/exportar/tablas-admin'
import { ENTIDADES_AUDIT } from '@/lib/audit'

type Registro = {
  id: number
  created_at: string
  user_email: string
  entity: string
  entity_id: string | null
  action: string
  description: string
}

/**
 * La etiqueta y el tono salen del catálogo de `lib/audit.ts`, que es de donde salen también
 * las claves que se pueden escribir en `audit_log`. Aquí había una copia con CINCO de las
 * quince, así que diez tipos de línea se pintaban con el código crudo —«modulo_catalogo»,
 * «diagnostico_necesidad»— y ninguno se podía filtrar.
 *
 * Los tonos son variantes de la familia `.badge`, que dentro de la tabla van sin fondo.
 */
const etiquetaEntidad = (e: string) =>
  ENTIDADES_AUDIT[e as keyof typeof ENTIDADES_AUDIT]?.label ?? e
const tonoEntidad = (e: string) =>
  ENTIDADES_AUDIT[e as keyof typeof ENTIDADES_AUDIT]?.tono ?? 'badge-neutral'

const ACTION_LABEL: Record<string, string> = {
  crear:          'Crear',
  editar:         'Editar',
  eliminar:       'Eliminar',
  duplicar:       'Duplicar',
  registrar:      'Registrar',
  cambiar_plan:   'Cambiar plan',
  cambiar_estado: 'Cambiar estado',
  gracia:         'Período especial',
  configuracion:  'Configuración',
}

function formatFecha(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Se ordena por el DATO, no por la etiqueta: la fecha por el ISO —que ordena solo—
 * y no por «5 sept 2026», que como texto pone septiembre antes que enero.
 */
const COLUMNAS: ColumnasOrden<Registro> = {
  fecha:       { label: 'Fecha',       valor: r => r.created_at },
  entidad:     { label: 'Entidad',     valor: r => etiquetaEntidad(r.entity) },
  accion:      { label: 'Acción',      valor: r => ACTION_LABEL[r.action] ?? r.action },
  descripcion: { label: 'Descripción', valor: r => r.description },
  usuario:     { label: 'Usuario',     valor: r => r.user_email },
}

export default function ActividadTabla({
  registros, entidad, q,
}: {
  registros: Registro[]
  /** Filtros YA aplicados por la consulta (`page.tsx`), no lo que pide la URL. */
  entidad: string
  q: string
}) {
  const [cargando, setCargando] = useState(false)

  /**
   * LA DECLARACIÓN. `servidor`, no `cliente`: la pantalla se queda con las 200 líneas más
   * recientes, así que filtrar en el navegador solo miraría esas 200 y llamaría a eso «los
   * pagos». Cambiar el filtro es una consulta nueva — y por eso la tabla lleva su
   * indicador de carga.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      clave: 'entidad', label: 'Todo', rotulo: 'Entidad',
      valor: entidad, widget: 'select', donde: 'servidor',
      opciones: Object.entries(ENTIDADES_AUDIT).map(([valor, e]) => ({ valor, label: e.label })),
    },
  ], [entidad])

  // Lo último primero, que es como llega del servidor y como se lee un registro.
  const orden = useOrden(registros, COLUMNAS, { clave: 'fecha', dir: 'desc' })
  const { pageItems, ...pag } = usePagination(orden.filas)

  return (
    <>
      {/* Barra de filtros del sistema, no una propia: era `.act-toolbar` con su
          buscador y sus píldoras a mano, idénticas a las del portal. */}
      <Filtros
        filtros={declaracion}
        q={q}
        placeholder="Buscar por descripción, email o ID…"
        onCargando={setCargando}
        acciones={
          /* La pantalla trae las últimas 200 líneas; la descarga baja hasta 5.000, que es
             para lo que se pide un registro de actividad. */
          <ExportarMenu
            ambito="admin"
            clave="actividad"
            filtro={filtroExport<FiltroAdmin>(declaracion, { q })}
            resumen={resumenDe(declaracion)}
            detalle="Hasta las 5.000 últimas líneas."
            pequeno
            sinPeriodo
          />
        }
      />

      <TablaCargando activo={cargando}>
      <div className="card card-table">
      {registros.length === 0 ? (
        <div className="table-empty">
          <ScrollText size={40} strokeWidth={1.5} />
          <h3 className="table-empty-title">Sin actividad</h3>
          {/* Con un filtro puesto, la lista vacía significa «nada QUE CUMPLA», y
              decir «todavía no ha pasado nada» sería mentira: el registro puede
              estar lleno y la entidad elegida no tener ni una línea. */}
          <p>{entidad || q
            ? 'No hay movimientos con los filtros aplicados.'
            : 'Aquí se anota cada cambio que hace el equipo.'}</p>
        </div>
      ) : (
        <>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <ThOrden orden={orden} clave="fecha" className="act-col-date">Fecha</ThOrden>
                <ThOrden orden={orden} clave="entidad" className="act-col-entity">Entidad</ThOrden>
                <ThOrden orden={orden} clave="accion" className="act-col-action">Acción</ThOrden>
                <ThOrden orden={orden} clave="descripcion">Descripción</ThOrden>
                <ThOrden orden={orden} clave="usuario" className="act-col-user">Usuario</ThOrden>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(r => (
                <tr key={r.id}>
                  <td data-label="Fecha" className="table-muted text-xs">
                    {formatFecha(r.created_at)}
                  </td>

                  <td data-label="Entidad">
                    <span className={`badge ${tonoEntidad(r.entity)}`}>
                      {etiquetaEntidad(r.entity)}
                    </span>
                  </td>

                  <td data-label="Acción" className="table-muted text-xs">
                    {ACTION_LABEL[r.action] ?? r.action}
                  </td>

                  <td data-label="Descripción">
                    <span className="cell-clamp" title={r.description}>{r.description}</span>
                    {r.entity_id && (
                      <span className="act-entity-id">[{r.entity_id}]</span>
                    )}
                  </td>

                  <td data-label="Usuario" className="table-muted text-xs act-user-cell">
                    {r.user_email}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <TablePagination {...pag} label="registro" />
        </>
      )}
      </div>
      </TablaCargando>
    </>
  )
}
