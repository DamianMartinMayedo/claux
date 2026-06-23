import { createClient } from '@/lib/supabase/server'
import NecesidadesPageClient, { type ModuloLite, type Necesidad } from './NecesidadesPageClient'

export default async function DiagnosticoAdminPage() {
  const supabase = await createClient()

  const [necRes, modRes] = await Promise.all([
    supabase.from('diagnostico_necesidades').select('*').order('orden'),
    supabase
      .from('modulos_catalogo')
      .select('clave, nombre, es_base')
      .eq('activo', true)
      .order('orden'),
  ])

  // Solo módulos no-base: la contabilidad (base) va siempre incluida.
  const modulos: ModuloLite[] = (modRes.data ?? [])
    .filter((m) => !m.es_base)
    .map((m) => ({ clave: m.clave, nombre: m.nombre }))

  return (
    <NecesidadesPageClient
      necesidades={(necRes.data ?? []) as Necesidad[]}
      modulos={modulos}
    />
  )
}
