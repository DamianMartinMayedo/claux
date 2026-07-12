import { requireAccesoPagina } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import ModulosPageClient, { type Modulo } from './ModulosPageClient'

export default async function ModulosPage() {
  await requireAccesoPagina('modulos')
  const supabase = await createClient()

  const { data: modulos } = await supabase
    .from('modulos_catalogo')
    .select('*')
    .order('orden')

  return <ModulosPageClient modulos={(modulos ?? []) as Modulo[]} />
}
