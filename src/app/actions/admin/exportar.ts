'use server'

// Descargar un listado del ADMIN en Excel o CSV.
//
// Gemela de `actions/portal/exportar.ts` y con el mismo motor (`lib/exportar/csv`,
// `lib/exportar/excel`); lo que cambia es el candado: allí es el módulo contratado por
// el cliente, aquí la SECCIÓN del admin. Un vendedor con permiso de Solicitudes que
// mande la clave «pagos» se lleva un error, no un fichero — que el botón no se pinte
// nunca ha sido control de acceso.
//
// El registro de listados y sus columnas viven en `@/lib/exportar/tablas-admin`, fuera
// de este fichero: en un módulo 'use server' toda exportación es un endpoint HTTP, y un
// registro de datos no lo es.

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { construirCsv } from '@/lib/exportar/csv'
import {
  construirXlsxBase64, texto, numero, fecha, esFechaIso, anchosPorColumna, MARCA,
} from '@/lib/exportar/excel'
import { tablaAdminPorClave, type FiltroAdmin } from '@/lib/exportar/tablas-admin'
import type { ValorCelda } from '@/lib/exportar/csv'
// «Hoy» en la zona del negocio, no en UTC: con `toISOString()` a partir de las 20:00 la
// fecha ya es la de mañana, y el fichero se llamaría con el día siguiente.
import { hoyEnTz } from '@/lib/fecha-tz'

export interface ResultadoListadoAdmin {
  ok:      boolean
  error?:  string
  nombre?: string
  /** CSV como texto; Excel como base64. Nunca los dos. */
  csv?:    string
  xlsx?:   string
  filas?:  number
}

/** Nombre de hoja que Excel acepta: 31 caracteres y sin `: \ / ? * [ ]`. */
function nombreHoja(etiqueta: string): string {
  return etiqueta.replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'Datos'
}

export async function exportarListadoAdmin(
  clave: string,
  filtro: FiltroAdmin,
  formato: 'csv' | 'xlsx',
): Promise<ResultadoListadoAdmin> {
  const tabla = tablaAdminPorClave(clave)
  if (!tabla) return { ok: false, error: 'Ese listado no se puede exportar.' }

  // El candado. Lanza si el admin en sesión no tiene la sección.
  await requirePermiso(tabla.seccion)

  let filas: ValorCelda[][]
  try {
    filas = await tabla.cargar(createAdminClient(), filtro)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudieron leer los datos.' }
  }

  // El nombre del fichero LLEVA EL PERÍODO. Sin él, tres descargas del mismo listado con
  // rangos distintos son tres ficheros indistinguibles en la carpeta de descargas.
  const sufijo = filtro.desde || filtro.hasta
    ? `${filtro.desde || 'inicio'}_${filtro.hasta || 'hoy'}`
    : hoyEnTz()
  const base = `${tabla.clave}-${sufijo}`

  if (formato === 'csv') {
    return { ok: true, nombre: `${base}.csv`, filas: filas.length, csv: construirCsv(tabla.cabeceras, filas) }
  }

  // Excel: cada tipo en su tipo de celda, no todo a texto. Un importe como texto es una
  // columna que no suma; una fecha como texto es una columna que no se ordena por mes —
  // que es justo para lo que alguien se baja el Excel.
  const cabecera = tabla.cabeceras.map(h =>
    texto(h, { fontWeight: 'bold', color: MARCA.blanco, backgroundColor: MARCA.teal, align: 'left' }))
  const cuerpo = filas.map(f => f.map(v =>
    typeof v === 'number'    ? numero(v, { format: '#,##0.00' })
    : typeof v === 'boolean' ? texto(v ? 'Sí' : 'No')
    : esFechaIso(v)          ? (fecha(v) ?? texto(String(v)))
    : texto(v == null ? '' : String(v))))

  const xlsx = await construirXlsxBase64([{
    nombre:   nombreHoja(tabla.etiqueta),
    filas:    [cabecera, ...cuerpo],
    columnas: anchosPorColumna(tabla.cabeceras, filas),
  }])
  return { ok: true, nombre: `${base}.xlsx`, filas: filas.length, xlsx }
}
