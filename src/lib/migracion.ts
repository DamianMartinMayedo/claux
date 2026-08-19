// Estado de migración de datos de un cliente (importador de autoservicio).
//
// Fuente ÚNICA de los valores y sus etiquetas: lo comparten el alta del cliente
// (ClienteFormModal), la ficha del admin (AccionesHeader) y las acciones
// `crearCliente`/`editarCliente`. Gobierna el aviso de bienvenida del portal y la
// visibilidad de la herramienta de importación. Ver el plan del importador de
// autoservicio §5 y la migración 198. Sin jerga en las etiquetas: describen la
// situación del negocio, no un término técnico.

export type MigracionEstado =
  | 'sin_datos_previos'
  | 'pendiente'
  | 'a_cargo_equipo'
  | 'completada'

// Etiqueta humana para el operador. Vale igual en el alta y en la ficha.
export const MIGRACION_ESTADO_LABEL: Record<MigracionEstado, string> = {
  sin_datos_previos: 'Empieza de cero (sin datos anteriores)',
  pendiente:         'Traerá sus datos él mismo',
  a_cargo_equipo:    'Migración a cargo del equipo',
  completada:        'Migración completada',
}

// Estados que el operador puede FIJAR EN EL ALTA. `completada` no está: se alcanza
// al terminar una migración, no se elige al nacer el cliente.
export const MIGRACION_ESTADOS_ALTA: MigracionEstado[] = [
  'sin_datos_previos',
  'pendiente',
  'a_cargo_equipo',
]

// Todos los estados (la edición en ficha sí puede llevar a `completada`).
export const MIGRACION_ESTADOS: MigracionEstado[] = [
  'sin_datos_previos',
  'pendiente',
  'a_cargo_equipo',
  'completada',
]

export function esMigracionEstado(v: unknown): v is MigracionEstado {
  return typeof v === 'string' && (MIGRACION_ESTADOS as string[]).includes(v)
}
