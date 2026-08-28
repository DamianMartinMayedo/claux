import { requireAccesoPagina } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import { DIMENSIONES_LIMITE, etiquetaDimension } from '@/lib/limites'
import { NIVELES, normalizarNivel } from '@/lib/niveles'
import NivelesPageClient, { type NivelFila, type LimiteFila } from './NivelesPageClient'

export default async function NivelesPage() {
  // Mismo permiso que el catálogo de módulos: poner precio y decidir cuánto cabe
  // son la misma decisión, y una llave más sería una llave que nadie da.
  await requireAccesoPagina('modulos')
  const supabase = await createClient()

  const [{ data: niveles }, { data: limites }] = await Promise.all([
    supabase.from('niveles').select('clave, nombre, descripcion, orden, activo').order('orden'),
    supabase.from('nivel_limites').select('nivel, dimension, base'),
  ])

  // La matriz se sirve COMPLETA aunque a la tabla le falte una fila: una celda
  // que no existe se pinta vacía (= ilimitado) y al guardar se crea. Así una
  // dimensión nueva del código no obliga a una migración de datos.
  const porClave = new Map(
    ((limites ?? []) as { nivel: string; dimension: string; base: number | null }[])
      .map(l => [`${normalizarNivel(l.nivel)}|${l.dimension}`, l.base]),
  )
  const matriz: LimiteFila[] = DIMENSIONES_LIMITE.map(dim => ({
    dimension: dim,
    etiqueta:  etiquetaDimension(dim),
    base: Object.fromEntries(
      NIVELES.map(n => [n, porClave.get(`${n}|${dim}`) ?? null]),
    ) as LimiteFila['base'],
  }))

  return (
    <NivelesPageClient
      niveles={((niveles ?? []) as NivelFila[]).map(n => ({ ...n, clave: normalizarNivel(n.clave) }))}
      matriz={matriz}
    />
  )
}
