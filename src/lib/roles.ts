// ── Roles y permisos del equipo interno — constantes y tipos PUROS ──
// Sin dependencias de servidor: este módulo lo importan también componentes
// cliente (Sidebar, Header, modales). La resolución del contexto (que sí toca
// BD/sesión) vive en `roles-server.ts`.

/**
 * Quién tiene cuenta en el sistema del equipo. Dos roles, no tres.
 *
 * `super_admin` lo ve todo. `vendedor` es **quien vende CLAUX**, sea del equipo
 * o un revendedor de fuera: entra al panel por sus secciones de venta
 * (`permisos`) y lee el manual en la capa `vendedor`, que le impone el rol.
 *
 * Hubo un tercer rol, `partner`, para el revendedor externo, y sobraba: no hacía
 * nada que el vendedor no hiciera —solo leer el manual—, y separarlos obligaba a
 * mantener dos veces la misma frontera. Quien revende es un vendedor con sus
 * secciones de venta; lo que ve del manual lo decide la capa, no un rol aparte.
 */
export type RolAdmin = 'super_admin' | 'vendedor'

/** Dónde vive el manual. Se entra por `/partners`, que es la puerta que se da a
 *  quien vende; una vez dentro se lee en esta misma ruta, para que un enlace a
 *  un apartado sirva igual para el equipo y para un revendedor. */
export const RUTA_MANUAL = '/academia'

/** Cómo se llama cada rol en pantalla. Un solo sitio: lo pintan la cabecera del
 *  panel, el listado del equipo y el modal de alta. */
export const ROL_LABEL: Record<RolAdmin, string> = {
  super_admin: 'Super Admin',
  vendedor:    'Vendedor',
}

/** Un rol que viene de fuera (formulario, fila de BD) convertido en uno válido.
 *  Lo desconocido cae a `vendedor`, que es el que menos ve: equivocarse al
 *  teclear no puede ascender a nadie a super_admin. */
export function normalizarRol(valor: unknown): RolAdmin {
  return valor === 'super_admin' ? 'super_admin' : 'vendedor'
}

export type SeccionKey =
  | 'dashboard' | 'metricas' | 'solicitudes' | 'presupuestos' | 'clientes_ro'
  | 'clientes' | 'modulos' | 'ia' | 'diagnostico'
  | 'pagos' | 'soporte' | 'configuracion' | 'notificaciones' | 'actividad' | 'usuarios'

/** Catálogo de secciones (orden = orden de aparición en la config avanzada). */
export const SECCIONES: { key: SeccionKey; label: string }[] = [
  { key: 'solicitudes',    label: 'Solicitudes' },
  { key: 'presupuestos',   label: 'Presupuestos de instalación' },
  { key: 'clientes_ro',    label: 'Clientes (solo lectura)' },
  { key: 'clientes',       label: 'Clientes (gestión completa)' },
  { key: 'modulos',        label: 'Módulos' },
  { key: 'ia',             label: 'Asistente IA' },
  { key: 'diagnostico',    label: 'Diagnóstico (catálogo)' },
  { key: 'pagos',          label: 'Pagos' },
  { key: 'soporte',        label: 'Soporte' },
  { key: 'dashboard',      label: 'Dashboard' },
  { key: 'metricas',       label: 'Métricas de uso' },
  { key: 'configuracion',  label: 'Configuración' },
  { key: 'notificaciones', label: 'Notificaciones' },
  { key: 'actividad',      label: 'Actividad' },
  { key: 'usuarios',       label: 'Usuarios del equipo' },
]

/** Secciones marcadas por defecto al crear un vendedor. */
export const PERMISOS_VENDEDOR_DEFAULT: SeccionKey[] = ['solicitudes', 'presupuestos', 'clientes_ro']

/** Ruta de la página de cada sección (para nav y redirecciones). */
export const RUTA_SECCION: Record<SeccionKey, string> = {
  dashboard:     '/admin/dashboard',
  metricas:      '/admin/metricas',
  solicitudes:   '/admin/solicitudes',
  presupuestos:  '/admin/presupuestos',
  clientes_ro:   '/admin/ventas/clientes',
  clientes:      '/admin/clientes',
  modulos:       '/admin/modulos',
  ia:            '/admin/ia',
  diagnostico:   '/admin/diagnostico',
  pagos:         '/admin/pagos',
  soporte:       '/admin/soporte',
  configuracion: '/admin/configuracion',
  notificaciones:'/admin/notificaciones',
  actividad:     '/admin/actividad',
  usuarios:      '/admin/usuarios',
}

export interface ContextoAdmin {
  email:    string
  nombre:   string
  rol:      RolAdmin
  permisos: SeccionKey[]
}

/**
 * ¿El contexto puede acceder a la sección `key`? super_admin siempre; el resto,
 * solo las que tenga marcadas. Se corta aquí y no en cada página para que una
 * sección nueva nazca cerrada sin que nadie tenga que acordarse.
 */
export function puedeAcceder(ctx: ContextoAdmin | null, key: SeccionKey): boolean {
  if (!ctx) return false
  if (ctx.rol === 'super_admin') return true
  return ctx.permisos.includes(key)
}

/**
 * ¿A este solo le queda el manual? Un vendedor sin NINGUNA sección marcada es
 * quien vende de puertas afuera: comparte tabla de cuentas y login con el
 * equipo, pero el panel no tiene nada que enseñarle. Se pregunta aquí, en un
 * solo sitio, porque de ello dependen dos cosas lejanas entre sí: que el panel
 * lo devuelva al manual y que el manual le ofrezca un botón de salir.
 */
export function soloManual(ctx: ContextoAdmin | null): boolean {
  return !!ctx && ctx.rol !== 'super_admin' && ctx.permisos.length === 0
}

/** Primera ruta a la que enviar a un usuario según sus permisos (para redirecciones). */
export function primeraRutaPermitida(ctx: ContextoAdmin | null): string {
  if (!ctx) return '/admin/login'
  if (ctx.rol === 'super_admin') return '/admin/dashboard'
  const orden: SeccionKey[] = ['solicitudes', 'presupuestos', 'clientes_ro', 'dashboard']
  const key = orden.find(k => ctx.permisos.includes(k)) ?? ctx.permisos[0]
  // Sin ninguna sección marcada, el sitio de un vendedor es el manual: es lo que
  // tiene siempre, y mandarlo al login otra vez parecería que su cuenta no vale.
  return key ? RUTA_SECCION[key] : RUTA_MANUAL
}
