// ── Etiquetas por sector ──
// El código usa claves de módulo estables (reservas_citas, agenda, catalogo_qr);
// la etiqueta VISIBLE la decide el sector del negocio (plantillas_sector.etiquetas).
// CONTEXTO §1 / MODELO-MODULOS §6: nunca hornear "menú"/"mesa" en el código.

export type CatalogoIcono = 'comida' | 'producto'

export interface EtiquetasSector {
  reservas:   string  // "Reservas" | "Citas" | "Clases" | "Turnos"
  recurso:    string  // "Mesa" | "Profesional" | "Cancha" | "Cabina"
  recurso_pl: string
  servicio:   string  // "Servicio" | "Tratamiento" | "Clase"
  /** "Suscripciones" | "Membresías" (gimnasio) | "Bonos" (peluquería) | "Cuotas".
   *  NUNCA «Contratos»: esa entrada del sidebar ya existe y es de RRHH (mig. 164). */
  suscripcion: string
  catalogo:   string  // "Menú" | "Carta" | "Catálogo" | "Servicios"
  // Icono de la card de catálogo sin foto: comida → cubiertos, producto → caja.
  catalogoIcono: CatalogoIcono
}

// Valores por defecto (negocio sin sector asignado). Se eligen palabras que un
// dueño entiende sin jerga; el sector concreto las sobreescribe (Barbero, Cabina,
// Cancha…). Genérico = "Personal" (cercano y alineado con la lista de RRHH).
export const ETIQUETAS_DEFAULT: EtiquetasSector = {
  reservas:   'Reservas',
  recurso:    'Personal',
  recurso_pl: 'Personal',
  servicio:   'Servicio',
  suscripcion: 'Suscripciones',
  catalogo:   'Catálogo',
  catalogoIcono: 'producto',  // sin sector → icono genérico de producto (no comida)
}

// ── Conceptos del estado de resultados por sector (mig. 135) ─────────────────
//
// Lo que un negocio de ese tipo suele tener en su P&L, con el mismo vocabulario
// que `dossier_lineas`. Sirve para PRECARGAR LAS FILAS del desglose, nunca los
// importes: un importe sugerido es un número inventado en un documento que el
// dueño le enseña a un inversor.

export type GrupoPL = 'INGRESO' | 'COSTO_VENTAS' | 'GASTO_OPERATIVO'

export const GRUPOS_PL: GrupoPL[] = ['INGRESO', 'COSTO_VENTAS', 'GASTO_OPERATIVO']

export const LABEL_GRUPO_PL: Record<GrupoPL, string> = {
  INGRESO:         'Ingresos',
  COSTO_VENTAS:    'Coste de ventas',
  GASTO_OPERATIVO: 'Gastos operativos',
}

export type ConceptosSector = Record<GrupoPL, string[]>

/** Sin sector asignado: genérico y corto, que es mejor que una pantalla vacía. */
export const CONCEPTOS_DEFAULT: ConceptosSector = {
  INGRESO:         ['Ventas', 'Servicios', 'Otros ingresos'],
  COSTO_VENTAS:    ['Mercancía', 'Materiales'],
  GASTO_OPERATIVO: ['Salarios', 'Alquiler', 'Electricidad', 'Transporte', 'Publicidad'],
}

/** Normaliza el jsonb `conceptos_pl`; cae al genérico si el sector no trae el suyo. */
export function conceptosDe(raw: unknown): ConceptosSector {
  if (!raw || typeof raw !== 'object') return { ...CONCEPTOS_DEFAULT }
  const r = raw as Record<string, unknown>
  const lista = (k: GrupoPL): string[] => {
    const v = r[k]
    if (!Array.isArray(v)) return CONCEPTOS_DEFAULT[k]
    const limpios = v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim())
    return limpios.length ? limpios : CONCEPTOS_DEFAULT[k]
  }
  return { INGRESO: lista('INGRESO'), COSTO_VENTAS: lista('COSTO_VENTAS'), GASTO_OPERATIVO: lista('GASTO_OPERATIVO') }
}

/**
 * La cascada del repo: **override del cliente → etiqueta del sector → genérico**.
 *
 * `clients.etiquetas` (mig. 164) manda porque un negocio puede llamar a las cosas como
 * quiera aunque comparta sector con otros. Se aplica sobre el resultado ya normalizado,
 * así que un override vacío o mal escrito no borra la etiqueta del sector.
 */
export function etiquetasCliente(sector: unknown, cliente: unknown): EtiquetasSector {
  const base = etiquetasDe(sector)
  if (!cliente || typeof cliente !== 'object') return base
  const r = cliente as Record<string, unknown>
  const out = { ...base }
  for (const k of ['reservas', 'recurso', 'recurso_pl', 'servicio', 'suscripcion', 'catalogo'] as const) {
    if (typeof r[k] === 'string' && (r[k] as string).trim()) out[k] = (r[k] as string).trim()
  }
  return out
}

/** Normaliza el jsonb `etiquetas` de plantillas_sector contra los valores por defecto. */
export function etiquetasDe(raw: unknown): EtiquetasSector {
  if (!raw || typeof raw !== 'object') return { ...ETIQUETAS_DEFAULT }
  const r = raw as Record<string, unknown>
  const pick = (k: keyof EtiquetasSector) =>
    (typeof r[k] === 'string' && r[k]) ? (r[k] as string) : ETIQUETAS_DEFAULT[k]
  return {
    reservas:   pick('reservas'),
    recurso:    pick('recurso'),
    recurso_pl: pick('recurso_pl'),
    servicio:   pick('servicio'),
    suscripcion: pick('suscripcion'),
    catalogo:   pick('catalogo'),
    catalogoIcono: r.catalogoIcono === 'comida' ? 'comida' : 'producto',
  }
}
