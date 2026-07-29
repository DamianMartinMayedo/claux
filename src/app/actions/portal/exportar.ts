'use server'

// Descargar un listado del portal en Excel o CSV.
//
// Es una función del DUEÑO: son sus datos y se los lleva para revisarlos, cruzarlos o
// dárselos a su asesor. Hubo un segundo exportador exclusivo de la sesión de
// configuración (`exportarTabla`, CSV de tabla entera) que se eliminó por redundante:
// hacía lo mismo, peor y solo en CSV.
//
// El candado es el MÓDULO del listado, declarado por cada entrada del registro
// (`modulos`), no que el botón esté o no pintado. Es lectura, no escritura: el usuario
// de solo-lectura puede y debe poder descargar lo que ve.
//
// La lista de tablas y sus columnas viven en `@/lib/exportar/tablas`, fuera de
// este fichero: en un módulo 'use server' toda exportación es un endpoint HTTP, y
// un registro de datos no lo es.

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, requireAlgunModulo } from './auth'
import { construirCsv, type ValorCelda } from '@/lib/exportar/csv'
import {
  construirXlsxBase64, texto, numero, fecha, esFechaIso, anchosPorColumna, MARCA,
} from '@/lib/exportar/excel'
import { tablaPorClave, type TablaExportable, type FiltroExport } from '@/lib/exportar/tablas'

/**
 * Nombre de hoja que Excel acepta: máximo 31 caracteres y sin `: \ / ? * [ ]`, que
 * hacen que el fichero se abra «reparado» o directamente no se abra. Hoy ninguna
 * etiqueta los lleva; esto es para que añadir una entrada al registro no pueda romper
 * la exportación por una barra en el nombre.
 */
function nombreHoja(etiqueta: string): string {
  return (etiqueta.replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'Datos')
}

export interface ResultadoListado {
  ok:      boolean
  error?:  string
  nombre?: string
  /** CSV como texto; Excel como base64. Nunca los dos. */
  csv?:    string
  xlsx?:   string
  filas?:  number
}

export async function exportarListado(
  clave: string,
  filtro: FiltroExport,
  formato: 'csv' | 'xlsx',
): Promise<ResultadoListado> {
  const tabla: TablaExportable | undefined = tablaPorClave(clave)
  if (!tabla) return { ok: false, error: 'Ese listado no se puede exportar.' }

  // El candado: hay que tener el módulo del listado. Lectura, no escritura — el usuario
  // de solo lectura puede y debe poder descargar lo que ve. `requireAlgunModulo` porque
  // hay listados que viven en varios módulos (Clientes y proveedores, en tres).
  await requireAlgunModulo(tabla.modulos)
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  let filas: ValorCelda[][]
  try {
    filas = await tabla.cargar(createAdminClient(), session.client_id, filtro)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudieron leer los datos.' }
  }

  // El nombre del fichero LLEVA EL PERÍODO. Sin él, tres descargas del mismo listado con
  // rangos distintos son tres ficheros indistinguibles en la carpeta de descargas. Sin
  // rango va la fecha de hoy, por lo mismo: «todo» no distingue dos descargas de dos días.
  const sufijo = filtro.desde || filtro.hasta
    ? `${filtro.desde || 'inicio'}_${filtro.hasta || 'hoy'}`
    : new Date().toISOString().slice(0, 10)
  const base = `${tabla.archivo?.(filtro) ?? tabla.clave}-${sufijo}`

  if (formato === 'csv') {
    return { ok: true, nombre: `${base}.csv`, filas: filas.length, csv: construirCsv(tabla.cabeceras, filas) }
  }

  // Excel: cada tipo va en su tipo de celda, no todo a texto. Un importe como texto es
  // una columna que no suma; una fecha como texto es una columna que no se ordena ni se
  // filtra por mes — que es justo para lo que alguien se baja el Excel.
  const cabecera = tabla.cabeceras.map(h =>
    texto(h, { fontWeight: 'bold', color: MARCA.blanco, backgroundColor: MARCA.teal, align: 'left' }))
  const cuerpo = filas.map(f => f.map(v =>
    typeof v === 'number'  ? numero(v, { format: '#,##0.00' })
    : typeof v === 'boolean' ? texto(v ? 'Sí' : 'No')
    : esFechaIso(v) ? (fecha(v) ?? texto(String(v)))
    : texto(v == null ? '' : String(v))))

  const xlsx = await construirXlsxBase64([{
    nombre:   nombreHoja(tabla.etiqueta),
    filas:    [cabecera, ...cuerpo],
    columnas: anchosPorColumna(tabla.cabeceras, filas),
  }])
  return { ok: true, nombre: `${base}.xlsx`, filas: filas.length, xlsx }
}
