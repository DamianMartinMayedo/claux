// ── Roles y permisos del equipo interno — constantes y tipos PUROS ──
// Sin dependencias de servidor: este módulo lo importan también componentes
// cliente (Sidebar, Header, modales). La resolución del contexto (que sí toca
// BD/sesión) vive en `roles-server.ts`.

export type RolAdmin = 'super_admin' | 'vendedor'

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

/** ¿El contexto puede acceder a la sección `key`? super_admin siempre. */
export function puedeAcceder(ctx: ContextoAdmin | null, key: SeccionKey): boolean {
  if (!ctx) return false
  if (ctx.rol === 'super_admin') return true
  return ctx.permisos.includes(key)
}

/** Primera ruta a la que enviar a un usuario según sus permisos (para redirecciones). */
export function primeraRutaPermitida(ctx: ContextoAdmin | null): string {
  if (!ctx) return '/admin/login'
  if (ctx.rol === 'super_admin') return '/admin/dashboard'
  const orden: SeccionKey[] = ['solicitudes', 'presupuestos', 'clientes_ro', 'dashboard']
  const key = orden.find(k => ctx.permisos.includes(k)) ?? ctx.permisos[0]
  return key ? RUTA_SECCION[key] : '/admin/login'
}
