// Loader server-side del catálogo público. ÚNICO origen de verdad para la
// landing y el diagnóstico: lee modulos_catalogo + plantillas_sector +
// diagnostico_necesidades. Así, al añadir un módulo, cambiar un sector o editar
// las necesidades en el admin, el embudo se actualiza solo (las páginas que lo
// consumen usan ISR — ver `revalidate` en cada page).
import { createAdminClient } from '@/lib/supabase/admin'
import { etiquetasDe } from '@/lib/sector'
import type {
  CatalogoPublico,
  ModuloPublico,
  NecesidadPublica,
  SectorPublico,
} from './tipos'

export type { CatalogoPublico, ModuloPublico, NecesidadPublica, SectorPublico }

export async function obtenerCatalogoPublico(): Promise<CatalogoPublico> {
  const db = createAdminClient()

  const [modRes, secRes, necRes] = await Promise.all([
    db
      .from('modulos_catalogo')
      .select('clave, nombre, descripcion, tipo, mostrar_en_landing')
      .eq('activo', true)
      .order('orden', { ascending: true }),
    db
      .from('plantillas_sector')
      .select('sector, nombre, modulos, etiquetas')
      .eq('activa', true)
      .order('orden', { ascending: true }),
    db
      .from('diagnostico_necesidades')
      .select('clave, etiqueta, descripcion, icono, modulos')
      .eq('activa', true)
      .order('orden', { ascending: true }),
  ])

  const modulos: ModuloPublico[] = (modRes.data ?? []).map((m) => ({
    clave: m.clave,
    nombre: m.nombre,
    descripcion: m.descripcion ?? '',
    tipo: m.tipo,
    mostrarEnLanding: m.mostrar_en_landing !== false,
  }))

  const sectores: SectorPublico[] = (secRes.data ?? []).map((s) => ({
    sector: s.sector,
    nombre: s.nombre,
    modulos: Array.isArray(s.modulos) ? (s.modulos as string[]) : [],
    etiquetas: etiquetasDe(s.etiquetas),
  }))

  const necesidades: NecesidadPublica[] = (necRes.data ?? []).map((n) => ({
    clave: n.clave,
    etiqueta: n.etiqueta,
    descripcion: n.descripcion ?? '',
    icono: n.icono ?? 'generico',
    modulos: Array.isArray(n.modulos) ? (n.modulos as string[]) : [],
  }))

  return { modulos, sectores, necesidades }
}
