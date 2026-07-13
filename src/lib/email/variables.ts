export type TipoEmail =
  | 'diagnostico_cita'
  | 'bienvenida'
  | 'password_reset'
  | 'respuesta_soporte'
  | 'confirmacion_pago'
  | 'reactivacion'
  | 'recordatorio_pago'
  | 'fin_prueba'
  | 'suspension'

export const TIPOS_EMAIL: { tipo: TipoEmail; label: string }[] = [
  { tipo: 'diagnostico_cita',  label: 'Diagnóstico → agendar cita' },
  { tipo: 'bienvenida',        label: 'Bienvenida (nuevo cliente)' },
  { tipo: 'password_reset',    label: 'Nueva contraseña' },
  { tipo: 'respuesta_soporte', label: 'Respuesta de soporte' },
  { tipo: 'confirmacion_pago', label: 'Confirmación de pago' },
  { tipo: 'reactivacion',      label: 'Reactivación de cuenta' },
  { tipo: 'recordatorio_pago', label: 'Recordatorio de vencimiento' },
  { tipo: 'fin_prueba',        label: 'Fin de prueba (trial)' },
  { tipo: 'suspension',        label: 'Aviso de suspensión' },
]

interface VarDef {
  clave:   string
  label:   string
  ejemplo: string
}

// Variables válidas por tipo + valor de ejemplo (alimenta interpolado y preview).
export const PLANTILLAS_VARS: Record<TipoEmail, VarDef[]> = {
  diagnostico_cita: [
    { clave: 'nombre',      label: 'Nombre del lead',   ejemplo: 'María Pérez' },
    { clave: 'link_agenda', label: 'Link para agendar', ejemplo: 'https://calendar.app.google/nqrnpDat4JoYtd1Y8' },
  ],
  bienvenida: [
    { clave: 'nombre',            label: 'Nombre de contacto',      ejemplo: 'María Pérez' },
    { clave: 'empresa',           label: 'Nombre de la empresa',    ejemplo: 'Restaurante El Sabor' },
    { clave: 'usuario',           label: 'Email de usuario',        ejemplo: 'maria@elsabor.com' },
    { clave: 'password_temporal', label: 'Contraseña temporal',     ejemplo: 'Xk29pTqw' },
    { clave: 'link_portal',       label: 'Link al portal',          ejemplo: 'https://claux.es/portal/login' },
  ],
  password_reset: [
    { clave: 'nombre',            label: 'Nombre de contacto',   ejemplo: 'María Pérez' },
    { clave: 'empresa',           label: 'Nombre de la empresa', ejemplo: 'Restaurante El Sabor' },
    { clave: 'usuario',           label: 'Email de usuario',     ejemplo: 'maria@elsabor.com' },
    { clave: 'password_temporal', label: 'Contraseña temporal',  ejemplo: 'Xk29pTqw' },
    { clave: 'link_portal',       label: 'Link al portal',       ejemplo: 'https://claux.es/portal/login' },
  ],
  respuesta_soporte: [
    { clave: 'nombre',        label: 'Nombre de contacto',        ejemplo: 'María Pérez' },
    { clave: 'asunto',        label: 'Asunto del mensaje',        ejemplo: 'Duda sobre facturación' },
    { clave: 'mensaje_admin', label: 'Respuesta escrita por ti',  ejemplo: 'Ya quedó resuelto, revisa tu panel de Ventas.' },
  ],
  confirmacion_pago: [
    { clave: 'empresa',          label: 'Nombre de la empresa', ejemplo: 'Restaurante El Sabor' },
    { clave: 'monto',            label: 'Monto pagado (USD)',   ejemplo: '35.00' },
    { clave: 'fecha_expiracion', label: 'Fecha de vencimiento', ejemplo: '15 ago 2026' },
  ],
  reactivacion: [
    { clave: 'empresa', label: 'Nombre de la empresa', ejemplo: 'Restaurante El Sabor' },
  ],
  recordatorio_pago: [
    { clave: 'empresa',          label: 'Nombre de la empresa', ejemplo: 'Restaurante El Sabor' },
    { clave: 'dias',             label: 'Días para el vencimiento', ejemplo: '5' },
    { clave: 'fecha_expiracion', label: 'Fecha de vencimiento', ejemplo: '15 ago 2026' },
  ],
  fin_prueba: [
    { clave: 'empresa',          label: 'Nombre de la empresa', ejemplo: 'Restaurante El Sabor' },
    { clave: 'fecha_expiracion', label: 'Fecha de fin de prueba', ejemplo: '15 ago 2026' },
  ],
  suspension: [
    { clave: 'empresa', label: 'Nombre de la empresa', ejemplo: 'Restaurante El Sabor' },
  ],
}
