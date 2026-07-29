'use server'

// Exportar una tabla entera del negocio a Excel o CSV.
//
// SOLO PARA LA SESIÓN DE CONFIGURACIÓN (impersonación). No es una función del
// portal: es la herramienta con la que el equipo CLAUX se lleva los datos de un
// cliente para revisarlos, migrarlos o entregárselos. El usuario del negocio no
// la ve y, si construyera la petición a mano, tampoco la ejecutaría — el candado
// está AQUÍ, no en que el botón esté oculto.
//
// La lista de tablas y sus columnas viven en `@/lib/exportar/tablas`, fuera de
// este fichero: en un módulo 'use server' toda exportación es un endpoint HTTP, y
// un registro de datos no lo es.

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, requireAccesoModulo } from './auth'
import { construirCsv, type ValorCelda } from '@/lib/exportar/csv'
import { construirXlsxBase64, texto, numero, MARCA, anchoPara } from '@/lib/exportar/excel'
import { tablaPorClave, TABLAS_EXPORTABLES, type TablaExportable } from '@/lib/exportar/tablas'

export interface OpcionExportable { clave: string; etiqueta: string }

/** Catálogo para pintar el menú. Vacío si la sesión no es de configuración. */
export async function tablasExportables(): Promise<OpcionExportable[]> {
  const session = await getPortalSession()
  if (!session?.imp) return []
  return TABLAS_EXPORTABLES.map(t => ({ clave: t.clave, etiqueta: t.etiqueta }))
}

export interface ResultadoExportacion {
  ok:         boolean
  error?:     string
  nombre?:    string
  /** El CSV completo, con su BOM. Viaja como texto: no hay binario que codificar. */
  contenido?: string
  filas?:     number
}

// Solo CSV, a propósito. Un .xlsx es un ZIP de XML que además hay que codificar en
// base64 para cruzar la server action: pesa varias veces más por los mismos datos y
// esto se descarga en 3G. Para revisar o migrar datos —que es para lo que existe—
// el CSV se abre igual en Excel y viaja mucho más ligero. El generador de xlsx
// (`lib/exportar/excel.ts`) sigue en pie para Reportes y Nómina, donde el fichero
// es un DOCUMENTO con formato y ahí sí compensa.
export async function exportarTabla(clave: string): Promise<ResultadoExportacion> {
  const session = await getPortalSession()
  if (!session)     return { ok: false, error: 'Sesión inválida.' }
  if (!session.imp) return { ok: false, error: 'Solo disponible en la sesión de configuración.' }

  const tabla: TablaExportable | undefined = tablaPorClave(clave)
  if (!tabla) return { ok: false, error: 'Esa tabla no se puede exportar.' }

  let filas: ValorCelda[][]
  try {
    filas = await tabla.cargar(createAdminClient(), session.client_id)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudieron leer los datos.' }
  }

  // El fichero se genera aunque no haya filas: uno con solo cabeceras dice «no hay
  // nada», mientras que un error diría «algo se rompió». No son lo mismo.
  return {
    ok:        true,
    nombre:    `${tabla.clave}-${new Date().toISOString().slice(0, 10)}.csv`,
    filas:     filas.length,
    contenido: construirCsv(tabla.cabeceras, filas),
  }
}

// ── Exportar LO QUE HAY EN PANTALLA (quick win 1) ─────────────────────────────
//
// Acción distinta de `exportarTabla`, no un parámetro más, porque son dos permisos
// distintos con el mismo motor:
//   · `exportarTabla`   → la tabla entera, solo la sesión de CONFIGURACIÓN. Ese candado
//     existe para que el negocio no se lleve tablas completas por un endpoint construido
//     a mano, y aflojarlo para añadir un caso de uso sería perderlo.
//   · `exportarListado` → lo filtrado, para el DUEÑO. «Todas las facturas de este
//     período» es el caso de uso del día a día y no tiene nada de excepcional.
//
// Aquí sí hay Excel además de CSV: lo filtrado es pequeño, y el propietario pidió los dos
// formatos. La tabla entera se queda en CSV a secas por peso (ver la nota de arriba).

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
  filtro: { desde?: string; hasta?: string; q?: string },
  formato: 'csv' | 'xlsx',
): Promise<ResultadoListado> {
  // Lectura, no escritura: basta con tener el módulo (y verlo). El candado de edición no
  // aplica — un usuario de solo lectura puede y debe poder descargar lo que ve.
  await requireAccesoModulo('base')
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  const tabla: TablaExportable | undefined = tablaPorClave(clave)
  if (!tabla)            return { ok: false, error: 'Ese listado no se puede exportar.' }
  if (!tabla.porRango)   return { ok: false, error: 'Ese listado no admite exportar por período.' }

  let filas: ValorCelda[][]
  try {
    filas = await tabla.cargar(createAdminClient(), session.client_id, filtro)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudieron leer los datos.' }
  }

  // El nombre del fichero LLEVA EL PERÍODO. Sin él, tres descargas del mismo listado con
  // rangos distintos son tres ficheros indistinguibles en la carpeta de descargas.
  const sufijo = filtro.desde || filtro.hasta
    ? `${filtro.desde || 'inicio'}_${filtro.hasta || 'hoy'}`
    : 'todo'
  const base = `${tabla.clave}-${sufijo}`

  if (formato === 'csv') {
    return { ok: true, nombre: `${base}.csv`, filas: filas.length, csv: construirCsv(tabla.cabeceras, filas) }
  }

  // Excel: los importes van como NÚMERO con formato, no como texto. Es la diferencia
  // entre una columna que se suma sola y una que hay que reescribir a mano.
  const cabecera = tabla.cabeceras.map(h =>
    texto(h, { fontWeight: 'bold', color: MARCA.blanco, backgroundColor: MARCA.teal, align: 'left' }))
  const cuerpo = filas.map(f => f.map(v =>
    typeof v === 'number' ? numero(v, { format: '#,##0.00' })
    : typeof v === 'boolean' ? texto(v ? 'Sí' : 'No')
    : texto(v == null ? '' : String(v))))

  const xlsx = await construirXlsxBase64([{
    nombre:   tabla.etiqueta.slice(0, 31),   // Excel no admite hojas de más de 31 caracteres
    filas:    [cabecera, ...cuerpo],
    columnas: tabla.cabeceras.map(h => ({ width: anchoPara(h) })),
  }])
  return { ok: true, nombre: `${base}.xlsx`, filas: filas.length, xlsx }
}
