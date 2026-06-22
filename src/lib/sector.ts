// ── Etiquetas por sector ──
// El código usa claves de módulo estables (reservas_citas, agenda, catalogo_qr);
// la etiqueta VISIBLE la decide el sector del negocio (plantillas_sector.etiquetas).
// CONTEXTO §1 / MODELO-MODULOS §6: nunca hornear "menú"/"mesa" en el código.

export interface EtiquetasSector {
  reservas:   string  // "Reservas" | "Citas" | "Clases" | "Turnos"
  recurso:    string  // "Mesa" | "Profesional" | "Cancha" | "Cabina"
  recurso_pl: string
  servicio:   string  // "Servicio" | "Tratamiento" | "Clase"
  catalogo:   string  // "Menú" | "Carta" | "Catálogo" | "Servicios"
}

// Valores por defecto (negocio sin sector asignado). Se eligen palabras que un
// dueño entiende sin jerga; el sector concreto las sobreescribe (Barbero, Cabina,
// Cancha…). "Recurso" era jerga técnica → "Profesional" como genérico humano.
export const ETIQUETAS_DEFAULT: EtiquetasSector = {
  reservas:   'Reservas',
  recurso:    'Profesional',
  recurso_pl: 'Profesionales',
  servicio:   'Servicio',
  catalogo:   'Catálogo',
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
    catalogo:   pick('catalogo'),
  }
}
