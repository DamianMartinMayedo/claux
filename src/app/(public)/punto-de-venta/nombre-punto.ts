import { createAdminClient } from '@/lib/supabase/admin'

// Nombre del punto de venta para la identidad de la PWA (título, manifest, etiqueta
// bajo el icono). El dispositivo se queda con este nombre para siempre, así que se
// lee de la base de datos en vez de derivarlo del slug de la URL: el slug pierde
// acentos y mayúsculas («Caja Café Ñico» → «caja-cafe-nico»), y esto es lo que el
// dueño va a ver cada día en su pantalla de inicio.
//
// Va por `caja_id` y no por el token: el manifest lo pide el navegador como recurso
// suelto, sin el fragmento de la URL, así que el token no llega hasta aquí — ni debe.
// El caja_id no es una credencial (seed y sync siguen exigiendo el token); lo único
// que expone es el nombre del punto, y son 8 hex de un UUID, no algo enumerable.
export async function nombrePunto(cajaId: string | undefined): Promise<string | null> {
  // Alfanumérico y no solo hex: `generarCajaId` produce hex (CAJ-9538E715), pero los
  // datos sembrados usan ids legibles como CAJ-DEMO0003, y con un patrón de hex puro
  // esos caían al nombre genérico sin que nada lo dijera. El filtro es solo una puerta
  // barata de cordura; quien acota de verdad es el `.eq()` sobre la clave primaria.
  if (!cajaId || !/^CAJ-[A-Z0-9]{4,16}$/i.test(cajaId)) return null
  const { data } = await createAdminClient()
    .from('cajas').select('nombre').eq('caja_id', cajaId).maybeSingle()
  const nombre = (data as { nombre?: string } | null)?.nombre?.trim()
  return nombre || null
}

/** Lee `?c=` de los searchParams de una página. */
export function cajaIdDe(sp: Record<string, string | string[] | undefined>): string | undefined {
  const c = sp.c
  return typeof c === 'string' ? c : undefined
}
