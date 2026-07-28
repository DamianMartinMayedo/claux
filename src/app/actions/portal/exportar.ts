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
import { getPortalSession } from './auth'
import { construirCsv, CSV_MIME, type ValorCelda } from '@/lib/exportar/csv'
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
