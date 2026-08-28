// Cómo lleva hoy sus cuentas el que hace el diagnóstico. Vive aquí y no dentro
// del formulario porque lo leen dos sitios: el paso que lo pregunta y la ficha
// del lead en el admin, que guarda el `id` y necesita el rótulo para enseñarlo.
// Es una lista corta y estable, así que va en código y no en una tabla: no es
// catálogo comercial, no cambia de precio ni se activa por cliente.

export const MODOS = [
  { id: 'papel', label: 'Papel / libreta',        desc: 'Apuntas todo a mano' },
  { id: 'excel', label: 'Excel / Hojas de cálculo', desc: 'Las cuentas en archivos que actualizas a mano' },
  { id: 'nada',  label: 'Empiezo desde cero',     desc: 'Todavía no tienes nada digitalizado' },
  { id: 'otra',  label: 'Otra herramienta',       desc: 'Usas otro sistema pero quieres cambiar' },
] as const

/** El rótulo del modo, o el propio id si algún lead antiguo trae otro valor. */
export function etiquetaModo(id: string): string {
  return MODOS.find((m) => m.id === id)?.label ?? id
}
