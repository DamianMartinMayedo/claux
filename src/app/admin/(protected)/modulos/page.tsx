import { requireAccesoPagina } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import { nombresDeNiveles } from '@/lib/niveles-server'
import ModulosPageClient, { type Modulo } from './ModulosPageClient'

export default async function ModulosPage() {
  await requireAccesoPagina('modulos')
  const supabase = await createClient()

  // Los rótulos de las tres columnas de precio los pone el dueño en /admin/niveles:
  // esta tabla no puede llevar «Empresa» escrito a mano el día que lo renombre.
  const [{ data: modulos }, nombresNivel] = await Promise.all([
    supabase.from('modulos_catalogo').select('*').order('orden'),
    nombresDeNiveles(),
  ])

  return <ModulosPageClient modulos={(modulos ?? []) as Modulo[]} nombresNivel={nombresNivel} />
}
