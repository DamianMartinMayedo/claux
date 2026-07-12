import { requireAccesoPagina } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import NecesidadesPageClient, { type ModuloLite, type Necesidad } from './NecesidadesPageClient'

export default async function DiagnosticoAdminPage() {
  await requireAccesoPagina('diagnostico')
  const supabase = await createClient()

  const [necRes, modRes] = await Promise.all([
    supabase.from('diagnostico_necesidades').select('*').order('orden'),
    supabase
      .from('modulos_catalogo')
      .select('clave, nombre')
      .eq('activo', true)
      .order('orden'),
  ])

  // Todos los módulos, incluida la contabilidad ('base'): ahora es opcional, así
  // que una necesidad (p.ej. "Contabilidad") puede mapear a 'base' como a cualquier otro.
  const modulos: ModuloLite[] = (modRes.data ?? [])
    .map((m) => ({ clave: m.clave, nombre: m.nombre }))

  return (
    <NecesidadesPageClient
      necesidades={(necRes.data ?? []) as Necesidad[]}
      modulos={modulos}
    />
  )
}
