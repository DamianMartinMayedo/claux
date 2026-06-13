// Helper de auditoría — no es server action, es una utilidad interna.
// Se llama dentro de cada server action después de una mutación exitosa.
// Falla silenciosamente para no interrumpir el flujo principal.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logActividad(supabase: any, params: {
  user_email: string
  entity:     'cliente' | 'plan' | 'pago' | 'sistema' | 'modulo_catalogo' | 'modulo_cliente'
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
