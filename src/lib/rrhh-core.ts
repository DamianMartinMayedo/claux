// Núcleo de Personal (sin 'use server'): catálogos de contrato, generador de
// código y construcción de campos de `empleados`. Lo comparten la server action
// `guardarEmpleado` (alta/edición manual) y el importador de datos, para que la
// normalización (tipo de contrato, periodicidad, salario) viva en UNA sola fuente.
//
// No hace I/O: no valida la moneda ni la empresa (eso es del llamante, con
// `monedaValida` / `obtenerEmpresas`). El estado ACTIVO/BAJA no se guarda: se
// deriva de `fecha_baja` (migración 027).

// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: con `toISOString()` a partir de
// las 20:00 la fecha ya es la de mañana, así que un documento fechado de noche el último día
// del mes caía en el mes siguiente. Una sola fuente: `lib/fecha-tz.ts`.
import { hoyEnTz } from '@/lib/fecha-tz'
import { importe2 } from '@/lib/rrhh/importe'

export type TipoContrato = 'INDEFINIDO' | 'TEMPORAL' | 'POR_OBRA' | 'PRACTICAS'
export type Periodicidad = 'MENSUAL' | 'QUINCENAL' | 'SEMANAL' | 'POR_HORA'

export const TIPOS_CONTRATO: TipoContrato[] = ['INDEFINIDO', 'TEMPORAL', 'POR_OBRA', 'PRACTICAS']
export const PERIODICIDADES: Periodicidad[] = ['MENSUAL', 'QUINCENAL', 'SEMANAL', 'POR_HORA']

export function generarEmpleadoId(): string {
  return `PER-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

export function validarTipoContrato(v: string): TipoContrato {
  return TIPOS_CONTRATO.includes(v as TipoContrato) ? (v as TipoContrato) : 'INDEFINIDO'
}

export function validarPeriodicidad(v: string): Periodicidad {
  return PERIODICIDADES.includes(v as Periodicidad) ? (v as Periodicidad) : 'MENSUAL'
}

/** Fecha de hoy en formato ISO corto (por defecto del alta). */
export function hoyIso(): string {
  return hoyEnTz()
}

/**
 * Entrada plana para armar los campos de un empleado. Viene de FormData (alta
 * manual) o de una fila de CSV mapeada (importador). `empresa_id` y `moneda` NO
 * van aquí: los fija el llamante tras validarlos (no se cambian igual al crear
 * que al editar).
 */
export interface EmpleadoInput {
  nombre:                 string
  apellidos?:             string | null
  documento?:             string | null
  documento_vencimiento?: string | null
  fecha_nacimiento?:      string | null
  telefono?:              string | null
  email?:                 string | null
  direccion?:             string | null
  cargo?:                 string | null
  departamento?:          string | null
  turno?:                 string | null
  tipo_contrato?:         string | null
  fecha_alta?:            string | null
  salario_base?:          number | null
  periodicidad?:          string | null
  notas?:                 string | null
  /**
   * Los dos campos del modelo cubano (mig. 142). `undefined` = «no viene en esta
   * entrada, NO lo toques»; es la diferencia que importa, porque el formulario solo
   * los pinta si la empresa usa `MIPYME_CUBA` y guardar los datos de contacto desde
   * una empresa en modelo General no puede desmarcar a un socio en silencio. Es la
   * misma trampa que documentó `vacaciones_apertura` (mig. 167), resuelta aquí en vez
   * de dejando el campo fuera del núcleo.
   */
  es_socio?:        boolean | undefined
  dias_laborables?: number | null | undefined
}

/** Arma el objeto de campos que se inserta/actualiza en `empleados`. */
export function construirCamposEmpleado(input: EmpleadoInput) {
  const s = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim()
    return t || null
  }
  const salario = input.salario_base
  // Solo se escriben si el llamante los trae: ver `EmpleadoInput.es_socio`.
  const cuba: { es_socio?: boolean; dias_laborables?: number | null } = {}
  if (input.es_socio !== undefined) cuba.es_socio = !!input.es_socio
  if (input.dias_laborables !== undefined) {
    const d = input.dias_laborables
    // Fuera de 1-31 no es una jornada, es un dedo en la tecla equivocada: se ignora y
    // el trabajador hereda los días de su empresa, que es el comportamiento de siempre.
    cuba.dias_laborables = d == null || isNaN(d) || d <= 0 || d > 31 ? null : d
  }
  return {
    ...cuba,
    nombre:                (input.nombre ?? '').trim(),
    apellidos:             s(input.apellidos),
    documento:             s(input.documento),
    documento_vencimiento: s(input.documento_vencimiento),
    fecha_nacimiento:      s(input.fecha_nacimiento),
    telefono:              s(input.telefono),
    email:                 s(input.email),
    direccion:             s(input.direccion),
    cargo:                 s(input.cargo),
    departamento:          s(input.departamento),
    turno:                 s(input.turno),
    tipo_contrato:         validarTipoContrato((input.tipo_contrato ?? '').trim()),
    fecha_alta:            s(input.fecha_alta) ?? hoyIso(),
    salario_base:          (salario == null || isNaN(salario) || salario < 0) ? 0 : importe2(salario),
    periodicidad:          validarPeriodicidad((input.periodicidad ?? '').trim()),
    notas:                 s(input.notas),
    updated_at:            new Date().toISOString(),
  }
}
