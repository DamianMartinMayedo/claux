// ── Roles y permisos del equipo interno — constantes y tipos PUROS ──
// Sin dependencias de servidor: este módulo lo importan también componentes
// cliente (Sidebar, Header, modales). La resolución del contexto (que sí toca
// BD/sesión) vive en `roles-server.ts`.

/**
 * Quién tiene cuenta en el sistema del equipo.
 *
 * `super_admin` y `vendedor` son gente de CLAUX y entran al panel. `partner` es
 * un revendedor EXTERNO: usa la misma tabla y el mismo login porque no había
 * ninguna razón para montarle un sistema de cuentas aparte, pero **no accede a
 * ninguna sección de /admin** —`puedeAcceder` le dice que no a todas— y su única
 * superficie es el manual, leído en la capa `partner`, que le impone el rol.
 */
export type RolAdmin = 'super_admin' | 'vendedor' | 'partner'

/** ¿Es alguien de fuera de CLAUX? Hoy solo el partner; la pregunta se hace en
 *  varios sitios y conviene que sea una y no un `=== 'partner'` repetido. */
export function esExterno(rol: RolAdmin): boolean {
  return rol === 'partner'
}

/** Dónde vive el manual. El partner entra por `/partners`, que es la puerta que
 *  se le da; una vez dentro lee en esta misma ruta, para que un enlace a un
 *  apartado sirva igual para el equipo y para él. */
export const RUTA_MANUAL = '/academia'

/** Cómo se llama cada rol en pantalla. Un solo sitio: lo pintan la cabecera del
 *  panel, el listado del equipo y el modal de alta. */
export const ROL_LABEL: Record<RolAdmin, string> = {
  super_admin: 'Super Admin',
  vendedor:    'Vendedor',
  partner:     'Partner',
}

/** Un rol que viene de fuera (formulario, fila de BD) convertido en uno válido.
 *  Lo desconocido cae a `partner`, que es el que menos ve: equivocarse al
 *  teclear no puede ascender a nadie a equipo interno. */
export function normalizarRol(valor: unknown): RolAdmin {
  return valor === 'super_admin' ? 'super_admin'
    : valor === 'vendedor' ? 'vendedor'
    : 'partner'
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

/** Secciones marcadas por defecto al crear un vendedor. Un partner no lleva
 *  ninguna: su acceso no se describe por secciones del panel. */
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
 * ¿El contexto puede acceder a la sección `key`? super_admin siempre.
 *
 * Un partner NUNCA: es de fuera, y el panel enseña clientes, cobros y márgenes.
 * Se corta aquí y no en cada página para que una sección nueva nazca cerrada
 * para él sin que nadie tenga que acordarse.
 */
export function puedeAcceder(ctx: ContextoAdmin | null, key: SeccionKey): boolean {
  if (!ctx) return false
  if (esExterno(ctx.rol)) return false
  if (ctx.rol === 'super_admin') return true
  return ctx.permisos.includes(key)
}

/** Primera ruta a la que enviar a un usuario según sus permisos (para redirecciones). */
export function primeraRutaPermitida(ctx: ContextoAdmin | null): string {
  if (!ctx) return '/admin/login'
  // El partner no tiene ninguna sección del panel: su sitio es el manual.
  if (esExterno(ctx.rol)) return RUTA_MANUAL
  if (ctx.rol === 'super_admin') return '/admin/dashboard'
  const orden: SeccionKey[] = ['solicitudes', 'presupuestos', 'clientes_ro', 'dashboard']
  const key = orden.find(k => ctx.permisos.includes(k)) ?? ctx.permisos[0]
  return key ? RUTA_SECCION[key] : '/admin/login'
}
