import { createAdminClient } from '@/lib/supabase/admin'
import { clasificarSoporte, type ClasificacionSoporte } from '@/lib/ia/equipo'

// ── Etiquetar un mensaje de soporte ──────────────────────────────────────────
// Vive fuera de las acciones porque lo llaman las DOS caras: el portal cuando el
// cliente envía el mensaje (en `after()`, sin hacerle esperar) y el admin cuando
// alguien pulsa «Clasificar» en uno viejo. Una acción del admin llamada desde el
// portal da 500 en producción, así que el trabajo común baja aquí.
//
// Es la única escritura de IA sin clic (plan §Fase 5): no toca ningún dato del
// cliente ni nada que él vea, solo etiqueta una fila nuestra. Lo que decide una
// persona manda: en cuanto alguien corrige la etiqueta, `clasificado_ia` se apaga
// y esto no vuelve a pisarla.

export async function clasificarMensaje(args: {
  id:      number
  asunto:  string
  mensaje: string
}): Promise<ClasificacionSoporte | null> {
  const db = createAdminClient()

  const { data: modulos } = await db
    .from('modulos_catalogo')
    .select('clave, nombre')
    .eq('activo', true)
    .order('orden')

  const clasificacion = await clasificarSoporte({
    asunto:  args.asunto,
    mensaje: args.mensaje,
    modulos: (modulos ?? []) as { clave: string; nombre: string }[],
  })
  if (!clasificacion) return null

  const { error } = await db
    .from('soporte_mensajes')
    .update({
      tema:           clasificacion.tema,
      tipo:           clasificacion.tipo,
      prioridad:      clasificacion.prioridad,
      resumen:        clasificacion.resumen || null,
      clasificado_ia: true,
    })
    .eq('id', args.id)
  if (error) return null

  return clasificacion
}
