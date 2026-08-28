import { createAdminClient } from '@/lib/supabase/admin'
import { usoDeLimites } from '@/lib/limites'
import CapacidadTabla from './CapacidadTabla'

// Cuánto cabe y cuánto lleva usado. Es la tarjeta que contesta «¿a quién le vendo
// el siguiente nivel?» sin tener que preguntárselo al cliente.
//
// Cliente de servicio a propósito: las tablas del tenant tienen RLS por
// `client_id` y la sesión del admin no las ve. La página ya pasó por
// `requireAccesoPagina('clientes')`.
export default async function CapacidadCard({
  clientId, nivelNombre, limitesOverride,
}: {
  clientId: string
  nivelNombre: string
  limitesOverride: Record<string, unknown> | null
}) {
  const db = createAdminClient()
  let uso
  try {
    uso = await usoDeLimites(db, clientId)
  } catch (e) {
    // `contarActivos` propaga a propósito: un conteo que falla y se lee como cero
    // es el límite desapareciendo en silencio. Aquí se dice y ya está.
    return (
      <div className="card">
        <div className="card-header"><h2 className="card-title">Capacidad del nivel</h2></div>
        <div className="alert alert-error">
          <strong className="alert-titulo">No se pudo contar el uso</strong>
          {e instanceof Error ? e.message : 'Error desconocido'}
        </div>
      </div>
    )
  }

  const ov = (limitesOverride && typeof limitesOverride === 'object')
    ? limitesOverride as Record<string, unknown>
    : {}
  const motivos = (ov._motivos && typeof ov._motivos === 'object')
    ? ov._motivos as Record<string, string>
    : {}

  const filas = uso.map(u => ({
    ...u,
    override: Number.isFinite(Number(ov[u.dimension])) && Number(ov[u.dimension]) > 0
      ? Math.floor(Number(ov[u.dimension]))
      : null,
    motivo: motivos[u.dimension] ?? '',
  }))

  return <CapacidadTabla clientId={clientId} nivelNombre={nivelNombre} filas={filas} />
}
