// Loader server-side del catálogo público. ÚNICO origen de verdad para la
// landing y el diagnóstico: lee modulos_catalogo + plantillas_sector +
// diagnostico_necesidades + niveles/nivel_limites. Así, al añadir un módulo, cambiar un sector o editar
// las necesidades en el admin, el embudo se actualiza solo: las páginas que lo
// consumen (landing y diagnóstico) son `force-dynamic`, así que leen en cada
// visita y un cambio del admin se ve al recargar, sin desplegar ni revalidar.
import { createAdminClient } from '@/lib/supabase/admin'
import { etiquetasDe } from '@/lib/sector'
import type {
  CatalogoPublico,
  ModuloPublico,
  NecesidadPublica,
  NivelPublico,
  SectorPublico,
} from './tipos'

export type { CatalogoPublico, ModuloPublico, NecesidadPublica, NivelPublico, SectorPublico }

// Catálogo vacío: fallback cuando la BD/secreto no está disponible. Una página
// pública de marketing (landing/diagnóstico) NUNCA debe tumbar el build ni
// devolver 500 por un fallo de lectura: degradamos a vacío, y como se renderizan
// por petición, el fallo se queda en esa visita — la siguiente ya vuelve a leer.
const CATALOGO_VACIO: CatalogoPublico = { modulos: [], sectores: [], necesidades: [], niveles: [] }

export async function obtenerCatalogoPublico(): Promise<CatalogoPublico> {
  try {
    return await cargarCatalogoPublico()
  } catch (err) {
    console.error('[obtenerCatalogoPublico] fallo al leer el catálogo público:', err)
    return CATALOGO_VACIO
  }
}

async function cargarCatalogoPublico(): Promise<CatalogoPublico> {
  const db = createAdminClient()

  const [modRes, secRes, necRes, nivRes, limRes] = await Promise.all([
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
    db
      .from('niveles')
      .select('clave, nombre, descripcion')
      .eq('activo', true)
      .order('orden', { ascending: true }),
    db
      .from('nivel_limites')
      .select('nivel, dimension, base'),
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

  // Los límites llegan en una sola consulta (30 filas) y se reparten por nivel.
  // `base` NULL es SIN TOPE, no cero: se conserva el null hasta la pantalla, que
  // es la que decide cómo se dice.
  const porNivel = new Map<string, Record<string, number | null>>()
  for (const l of (limRes.data ?? []) as { nivel: string; dimension: string; base: number | null }[]) {
    const m = porNivel.get(l.nivel) ?? {}
    m[l.dimension] = l.base === null || l.base === undefined ? null : Number(l.base)
    porNivel.set(l.nivel, m)
  }

  const niveles: NivelPublico[] = (nivRes.data ?? []).map((n) => ({
    clave: n.clave,
    nombre: n.nombre,
    descripcion: n.descripcion ?? '',
    limites: porNivel.get(n.clave) ?? {},
  }))

  return { modulos, sectores, necesidades, niveles }
}
