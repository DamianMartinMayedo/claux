// Núcleo PURO de terceros (sin 'use server'): tipos y helpers de validación y
// construcción de campos. Lo comparten la server action `guardarTercero`
// (alta/edición manual) y el importador de datos, para que las reglas vivan en
// UNA sola fuente y no se dupliquen (CONTEXTO: «la copia local que descuadra»).
//
// No hace I/O: no valida la moneda contra la BD (eso es async, lo hace el
// llamante con `monedaValida`) ni sube el contrato. Solo normaliza y arma campos.

export type TipoTercero   = 'CLIENTE' | 'PROVEEDOR' | 'AMBOS'
export type CondicionPago = 'CONTADO' | '15' | '30' | '60' | '90'

/**
 * Cómo se le paga a un tercero. Dato documental (se muestra en su ficha; no lo
 * consumen Tesorería ni las facturas). Se guarda como jsonb, así que los campos
 * son todos opcionales: cada `tipo` usa los suyos. El catálogo de tipos y qué
 * campos pide cada uno viven en `(app)/terceros/_vias-pago.ts`.
 */
export interface ViaPago {
  tipo:         string
  moneda?:      string
  titular?:     string
  cuenta?:      string
  banco?:       string
  telefono?:    string
  tipo_cuenta?: string
  swift?:       string
  routing?:     string
  id_titular?:  string
  direccion?:   string
  nombre?:      string
  contacto?:    string
  email_link?:  string
  referencia?:  string
}

export function generarTerceroId(): string {
  return `TER-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

export function validarTipo(v: string): TipoTercero {
  return (['CLIENTE', 'PROVEEDOR', 'AMBOS'] as TipoTercero[]).includes(v as TipoTercero)
    ? (v as TipoTercero)
    : 'CLIENTE'
}

export function validarCondicion(v: string): CondicionPago {
  return (['CONTADO', '15', '30', '60', '90'] as CondicionPago[]).includes(v as CondicionPago)
    ? (v as CondicionPago)
    : 'CONTADO'
}

export function parseVia(str: string): ViaPago | null {
  if (!str) return null
  try { return JSON.parse(str) as ViaPago }
  catch { return null }
}

/**
 * Entrada plana para armar los campos de un tercero. Viene de FormData (alta
 * manual) o de una fila de CSV mapeada (importador). Los strings se normalizan
 * aquí (trim → null si vacío); `nombre`, `empresa_id` y la validez de la moneda
 * los comprueba el llamante antes de llamar (necesita devolver error/hacer I/O).
 */
export interface TerceroInput {
  empresa_id:             string
  tipo?:                  string | null
  nombre?:                string | null
  identificacion?:        string | null
  representante?:         string | null
  cargo?:                 string | null
  telefono?:              string | null
  email?:                 string | null
  direccion?:             string | null
  ciudad?:                string | null
  pais?:                  string | null
  condicion_pago?:        string | null
  limite_credito?:        number | null
  moneda_defecto?:        string | null
  via_primaria?:          ViaPago | null
  via_secundaria?:        ViaPago | null
  contrato_url?:          string | null
  num_contrato?:          string | null
  fecha_inicio_contrato?: string | null
  fecha_fin_contrato?:    string | null
  notas?:                 string | null
}

/** Arma el objeto de campos que se inserta/actualiza en `third_parties`. */
export function construirCamposTercero(input: TerceroInput) {
  const s = (v: string | null | undefined): string | null => {
    const t = ((v ?? '') as string).trim()
    return t || null
  }
  return {
    empresa_id:            input.empresa_id,
    tipo:                  validarTipo((input.tipo ?? '') as string),
    nombre:                ((input.nombre ?? '') as string).trim(),
    identificacion:        s(input.identificacion),
    representante:         s(input.representante),
    cargo:                 s(input.cargo),
    telefono:              s(input.telefono),
    email:                 s(input.email),
    direccion:             s(input.direccion),
    ciudad:                s(input.ciudad),
    pais:                  s(input.pais),
    condicion_pago:        validarCondicion((input.condicion_pago ?? '') as string),
    limite_credito:        (input.limite_credito != null && !isNaN(input.limite_credito)) ? input.limite_credito : null,
    moneda_defecto:        input.moneda_defecto ?? null,
    via_primaria:          (input.via_primaria ?? null) as object | null,
    via_secundaria:        (input.via_secundaria ?? null) as object | null,
    contrato_url:          input.contrato_url ?? null,
    num_contrato:          s(input.num_contrato),
    fecha_inicio_contrato: s(input.fecha_inicio_contrato),
    fecha_fin_contrato:    s(input.fecha_fin_contrato),
    notas:                 s(input.notas),
    updated_at:            new Date().toISOString(),
  }
}
