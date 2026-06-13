// Subscription state badges (ACTIVO, TRIAL, GRACIA, SUSPENDIDO, VENCIDO)
export const ESTADO_BADGE: Record<string, string> = {
  ACTIVO:     'badge-success',
  TRIAL:      'badge-info',
  GRACIA:     'badge-warning',
  SUSPENDIDO: 'badge-warning',
  VENCIDO:    'badge-error',
}

export const ESTADO_LABEL: Record<string, string> = {
  ACTIVO:     'Activo',
  TRIAL:      'Trial',
  GRACIA:     'Gracia',
  SUSPENDIDO: 'Suspendido',
  VENCIDO:    'Vencido',
}

// Plan level badges
export const NIVEL_BADGE: Record<string, string> = {
  basico:       'badge-info',
  profesional:  'badge-warning',
  empresarial:  'badge-neutral',
}

export const NIVEL_LABEL: Record<string, string> = {
  basico:       'Básico',
  profesional:  'Profesional',
  empresarial:  'Empresarial',
}

// Plan modalidad labels
export const MODALIDAD_LABEL: Record<string, string> = {
  mensual:       'Mensual',
  trimestral:    'Trimestral',
  semestral:     'Semestral',
  anual:         'Anual',
  personalizado: 'Personalizado',
}
