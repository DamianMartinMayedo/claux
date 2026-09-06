// Helper de auditoría — no es server action, es una utilidad interna.
// Se llama dentro de cada server action después de una mutación exitosa.
// Falla silenciosamente para no interrumpir el flujo principal.

/**
 * SOBRE QUÉ SE ACTUÓ: la palabra que se lee y el tono de su distintivo.
 *
 * La lista de claves vivía solo en la firma de abajo, y el registro de actividad tenía la
 * suya propia —con CINCO etiquetas y CUATRO filtros—. O sea que diez de estas quince se
 * pintaban en crudo («modulo_catalogo», «diagnostico_necesidad») y no se podían filtrar:
 * buscar lo que se ha tocado de un presupuesto no era posible desde la pantalla.
 *
 * Aquí para que sea imposible añadir una entidad y olvidar su etiqueta: la firma se deriva
 * de estas claves, así que una entidad nueva no compila hasta estar aquí.
 *
 * El ORDEN es el del menú, y es el de uso: lo comercial arriba, el sistema al final.
 */
export const ENTIDADES_AUDIT = {
  cliente:               { label: 'Cliente',              tono: 'badge-info' },
  pago:                  { label: 'Pago',                 tono: 'badge-success' },
  presupuesto:           { label: 'Presupuesto',          tono: 'badge-info' },
  propuesta:             { label: 'Propuesta',            tono: 'badge-info' },
  lead:                  { label: 'Lead',                 tono: 'badge-info' },
  ampliacion:            { label: 'Ampliación',           tono: 'badge-warning' },
  diagnostico_necesidad: { label: 'Diagnóstico',          tono: 'badge-neutral' },
  plan:                  { label: 'Plan',                 tono: 'badge-warning' },
  nivel:                 { label: 'Nivel',                tono: 'badge-warning' },
  modulo_catalogo:       { label: 'Módulo del catálogo',  tono: 'badge-warning' },
  modulo_cliente:        { label: 'Módulo de un cliente', tono: 'badge-warning' },
  faq:                   { label: 'Pregunta frecuente',   tono: 'badge-neutral' },
  categoria:             { label: 'Categoría de gasto',   tono: 'badge-neutral' },
  usuario:               { label: 'Usuario',              tono: 'badge-info' },
  firma:                 { label: 'Firma',                tono: 'badge-neutral' },
  captura:               { label: 'Captura',              tono: 'badge-neutral' },
  sistema:               { label: 'Sistema',              tono: 'badge-neutral' },
} as const

export type EntidadAudit = keyof typeof ENTIDADES_AUDIT

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logActividad(supabase: any, params: {
  user_email: string
  entity:     EntidadAudit
  entity_id?: string | null
  action:     string
  description: string
}) {
  try {
    await supabase.from('audit_log').insert({
      user_email:  params.user_email,
      entity:      params.entity,
      entity_id:   params.entity_id ?? null,
      action:      params.action,
      description: params.description,
    })
  } catch {
    // Silencioso — el log nunca debe romper la acción principal
  }
}
