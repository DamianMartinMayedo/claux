// Helpers de módulos à la carte. La contabilidad ('base') es un módulo más:
// se contrata o no como cualquier otro. Un cliente puede tener solo Reservas,
// por ejemplo. Cada módulo funciona solo; otros módulos solo AÑADEN
// conveniencias (ver regla de independencia de módulos en la memoria).

export function normalizarModulos(modulos: unknown): string[] {
  return Array.isArray(modulos) ? (modulos as string[]) : []
}

export function tieneModulo(modulos: unknown, modulo: string): boolean {
  return normalizarModulos(modulos).includes(modulo)
}
