import { cache } from 'react'
import {
  obtenerCatalogoPublico as _obtenerCatalogoPublico,
  obtenerItemPublico as _obtenerItemPublico,
} from '@/app/actions/portal/catalogo'

// Las páginas públicas del Catálogo QR llaman a la MISMA lectura dos veces por
// visita: `generateMetadata` y el componente de página (y, en el detalle,
// `obtenerItemPublico`). Sin dedupe la consulta corre 2× por request, justo en la
// frontera de rendimiento móvil/3G (CONTEXTO §3). `cache` de React memoiza por
// request en componentes de servidor, así que la segunda llamada con los mismos
// argumentos reutiliza el resultado. El wrapper vive aquí y no en `catalogo.ts`
// porque ese fichero es `'use server'` (solo puede exportar funciones async; un
// `const = cache(...)` rompería el build, memoria `use-server-solo-async`).
export const obtenerCatalogoPublicoCache = cache(_obtenerCatalogoPublico)
export const obtenerItemPublicoCache = cache(_obtenerItemPublico)
