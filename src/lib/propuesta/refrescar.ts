// ── Tirar la caché de las propuestas que enseñan un presupuesto ──────────────
//
// La propuesta pública no guarda ni un número: los lee del presupuesto y del
// catálogo en cada render (`lib/propuesta/cargar.ts`). Eso solo funciona si la
// caché de `/p/<token>` se tira cuando cambia el origen — si no, la promesa de
// «se actualiza sola» es exactamente al revés: la página se queda clavada en el
// precio del día que se publicó, que es el defecto que esto vino a resolver.
//
// Vive aquí y no dentro de `actions/propuestas.ts` porque quien lo llama es el
// presupuesto, y un fichero `'use server'` solo puede exportar funciones async
// —importarlo desde otra acción arrastra todo su árbol de dependencias por un
// helper de tres líneas—.
//
// NO es la única red: `/p/[token]` lleva además `revalidate = 3600`, porque el
// precio de cada módulo sale del catálogo y quien lo edita en `/admin/modulos`
// no tiene forma de saber qué propuestas lo enseñan.

import { revalidatePath } from 'next/cache'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any

export interface PropuestaVinculada {
  id:             number
  token:          string | null
  estado:         string
  nombre_negocio: string
}

/**
 * Las propuestas que cuelgan de un presupuesto.
 *
 * Va separada del refresco porque BORRAR obliga a leerlas ANTES: la FK es
 * `on delete set null`, así que en cuanto el presupuesto desaparece ya no hay
 * ninguna fila que lo referencie y la consulta vuelve vacía — la propuesta se
 * quedaría enseñando para siempre las cifras de algo que ya no existe.
 */
export async function propuestasDe(db: Db, presupuestoId: number): Promise<PropuestaVinculada[]> {
  try {
    const { data } = await db.from('propuestas')
      .select('id, token, estado, nombre_negocio')
      .eq('presupuesto_id', presupuestoId)
    return (data ?? []) as PropuestaVinculada[]
  } catch {
    return []
  }
}

/**
 * Refresca esas propuestas y devuelve los negocios cuya propuesta está
 * PUBLICADA — es decir, aquellos cuyo enlace, si se compartió, ya enseña el
 * precio nuevo. El admin lo dice en el toast: cambiar un presupuesto y que
 * cambie en silencio un documento que está en manos del cliente es justo lo que
 * no puede pasar sin que nadie se entere.
 */
export function refrescarPropuestas(propuestas: PropuestaVinculada[]): string[] {
  if (propuestas.length === 0) return []
  const publicadas: string[] = []
  for (const p of propuestas) {
    revalidatePath(`/admin/ventas/propuestas/${p.id}`)
    revalidatePath(`/p/preview/${p.id}`)
    if (p.estado === 'PUBLICADA' && p.token) {
      revalidatePath(`/p/${p.token}`)
      publicadas.push(p.nombre_negocio)
    }
  }
  revalidatePath('/admin/ventas/propuestas')
  return publicadas
}

/**
 * Las dos cosas de una vez, para quien no borra. Nunca lanza: es una
 * consecuencia del guardado, no parte de él. Si falla, el presupuesto ya se
 * guardó y lo peor que pasa es que la página tarde una hora en refrescarse sola.
 */
export async function refrescarPropuestasDe(db: Db, presupuestoId: number): Promise<string[]> {
  return refrescarPropuestas(await propuestasDe(db, presupuestoId))
}

/**
 * Las propuestas que PRESENTAN un módulo. Lo usa la biblioteca de capturas:
 * cambiar la captura de Caja cambia la diapositiva de Caja en todas las
 * propuestas que lo presentan, y ninguna guarda esa imagen —la leen de la
 * biblioteca al renderizar—. Aquí sí se puede saber cuáles son, porque la
 * propuesta lleva escrita su lista de módulos.
 */
export async function propuestasConModulo(db: Db, modulo: string): Promise<PropuestaVinculada[]> {
  try {
    const { data } = await db.from('propuestas')
      .select('id, token, estado, nombre_negocio')
      .contains('modulos', [modulo])
    return (data ?? []) as PropuestaVinculada[]
  } catch {
    return []
  }
}

/** Las dos cosas de una vez, para la biblioteca de capturas. */
export async function refrescarPropuestasConModulo(db: Db, modulo: string): Promise<string[]> {
  return refrescarPropuestas(await propuestasConModulo(db, modulo))
}

/**
 * TODAS las propuestas. Lo usan los textos fijos de `/admin/ventas/propuestas/textos`: «qué
 * es CLAUX», el antes y el después, por qué confiar, cómo empezamos y el reparto
 * del pago salen en todas las propuestas, así que no hay a quién filtrar.
 */
export async function refrescarTodasLasPropuestas(db: Db): Promise<string[]> {
  try {
    const { data } = await db.from('propuestas').select('id, token, estado, nombre_negocio')
    return refrescarPropuestas((data ?? []) as PropuestaVinculada[])
  } catch {
    return []
  }
}

/**
 * El aviso para el toast, o null si no hay ninguna propuesta publicada. `que`
 * es lo que ha cambiado: desde el presupuesto es el precio, desde la biblioteca
 * de capturas es la imagen.
 */
export function avisoPropuestas(negocios: string[], que = 'el precio nuevo'): string | null {
  if (negocios.length === 0) return null
  if (negocios.length === 1) return `La propuesta de ${negocios[0]} ya enseña ${que}.`
  return `${negocios.length} propuestas publicadas ya enseñan ${que}.`
}
