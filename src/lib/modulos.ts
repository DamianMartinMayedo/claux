// Helpers de módulos à la carte. La 'base' contable siempre está activa: el portal
// funciona completo sin ningún módulo; los módulos solo AÑADEN conveniencias.
// (ver regla de independencia de módulos en la memoria del proyecto).

export function normalizarModulos(modulos: unknown): string[] {
  const arr = Array.isArray(modulos) ? (modulos as string[]) : []
  return arr.includes('base') ? arr : ['base', ...arr]
}

export function tieneModulo(modulos: unknown, modulo: string): boolean {
  return normalizarModulos(modulos).includes(modulo)
}
