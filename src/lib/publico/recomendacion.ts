// Reglas de recomendación del diagnóstico — LÓGICA PURA (CONTEXTO §9:
// determinista, instantánea, sin IA). El origen de verdad de las sugerencias
// por sector es plantillas_sector.modulos, y el de las necesidades es
// diagnostico_necesidades.modulos; aquí solo combinamos.
import type { NecesidadPublica, SectorPublico } from './tipos'

/**
 * Devuelve las claves de módulo recomendadas:
 *   módulos sugeridos por el sector (plantillas_sector)
 *   + módulos que cubren las necesidades elegidas (diagnostico_necesidades).
 *
 * La contabilidad ('base') es un módulo más: solo se recomienda si el cliente
 * marca la necesidad "Contabilidad" (que mapea a 'base'). No se fuerza.
 *
 * `necesidadesSel` son CLAVES DE NECESIDAD (no de módulo); se expanden a sus
 * módulos vía el catálogo `necesidades`.
 */
export function generarRecomendacion(
  sectorId: string,
  necesidadesSel: string[],
  sectores: SectorPublico[],
  necesidades: NecesidadPublica[],
): string[] {
  const claves = new Set<string>()

  const plantilla = sectores.find((s) => s.sector === sectorId)
  if (plantilla) for (const clave of plantilla.modulos) claves.add(clave)

  for (const sel of necesidadesSel) {
    const necesidad = necesidades.find((n) => n.clave === sel)
    if (necesidad) for (const clave of necesidad.modulos) claves.add(clave)
  }

  return Array.from(claves)
}
