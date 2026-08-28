// Catálogo de avisos del ADMIN (registro EN CÓDIGO, no en BD).
//
// Espejo de src/lib/notificaciones/catalogo.ts para el panel interno. Reutiliza
// de allí lo que ya es genérico (Severidad, Umbral, umbralParaFecha) y cambia lo
// único que aquí es distinto: el candado no es el módulo contratado sino el
// PERMISO DE SECCIÓN del admin, y las categorías son las del negocio de CLAUX.
//
// Un tipo con `seccion` solo lo ve quien tenga ese permiso; `seccion: null` es un
// aviso de plataforma y lo ve solo super_admin. Ese filtro vive aquí y en las
// acciones, no en la UI.

import type { SeccionKey } from '@/lib/roles'
import type { Severidad, Umbral } from '@/lib/notificaciones/catalogo'

export type CategoriaAdmin = 'ventas' | 'soporte' | 'clientes' | 'plataforma'

export interface TipoAvisoAdmin {
  categoria:   CategoriaAdmin
  /** Permiso necesario para verlo. `null` = plataforma (solo super_admin). */
  seccion:     SeccionKey | null
  /** Nombre humano, para Preferencias. Sin jerga. */
  etiqueta:    string
  /** Qué avisa, en una línea. */
  descripcion: string
  /** Severidad por defecto cuando el tipo NO escala por tiempo. */
  severidad:   Severidad
  /** Escalones que genera, de más lejano a vencido. Solo tipos temporales. */
  umbrales?:   Umbral[]
  /** Severidad efectiva por escalón. Lo no listado cae en `severidad`. */
  porUmbral?:  Partial<Record<Umbral, Severidad>>
  /**
   * Si el evento o el escáner que lo produce ya existe. El catálogo describe TODO
   * lo notificable (documentación viva), pero Preferencias solo ofrece lo que de
   * verdad puede llegar: un interruptor para un aviso que nunca se dispara miente.
   */
  implementado: boolean
}

export const CATALOGO_ADMIN = {
  // ── Ventas (leads y ampliaciones) ──────────────────────────────────────────
  lead_nuevo: {
    categoria: 'ventas', seccion: 'solicitudes', severidad: 'info', implementado: true,
    etiqueta: 'Nuevo lead',
    descripcion: 'Alguien completó el diagnóstico desde la web.',
  },
  lead_pide_contacto: {
    categoria: 'ventas', seccion: 'solicitudes', severidad: 'aviso', implementado: true,
    etiqueta: 'Un lead pide que le llamemos',
    descripcion: 'Pulsó «Quiero que me contacten» en su diagnóstico.',
  },
  lead_sin_contactar: {
    categoria: 'ventas', seccion: 'solicitudes', severidad: 'aviso', implementado: true,
    etiqueta: 'Lead sin contactar',
    descripcion: 'Un lead lleva más de 48 horas sin que nadie lo mueva.',
  },
  ampliacion_solicitada: {
    categoria: 'ventas', seccion: 'solicitudes', severidad: 'aviso', implementado: true,
    etiqueta: 'Un cliente quiere ampliar',
    descripcion: 'Pidió activar un módulo desde su portal.',
  },
  migracion_ayuda: {
    categoria: 'ventas', seccion: 'solicitudes', severidad: 'aviso', implementado: true,
    etiqueta: 'Un cliente pide ayuda para importar',
    descripcion: 'Pidió que el equipo haga su migración de datos (servicio de pago).',
  },

  // ── Soporte ────────────────────────────────────────────────────────────────
  soporte_mensaje_nuevo: {
    categoria: 'soporte', seccion: 'soporte', severidad: 'aviso', implementado: true,
    etiqueta: 'Mensaje de soporte',
    descripcion: 'Un cliente escribió desde su portal.',
  },
  soporte_sin_responder: {
    categoria: 'soporte', seccion: 'soporte', severidad: 'urgente', implementado: true,
    etiqueta: 'Soporte sin responder',
    descripcion: 'Un mensaje lleva más de 24 horas sin respuesta.',
  },

  // ── Clientes y cobros ──────────────────────────────────────────────────────
  cliente_nuevo: {
    categoria: 'clientes', seccion: 'clientes', severidad: 'info', implementado: true,
    etiqueta: 'Cliente nuevo',
    descripcion: 'Se dio de alta un cliente en la plataforma.',
  },
  cliente_por_vencer: {
    categoria: 'clientes', seccion: 'clientes', severidad: 'aviso', implementado: true,
    etiqueta: 'Suscripción de cliente por vencer',
    descripcion: 'La suscripción de un cliente se acerca a su fecha.',
    umbrales: ['15d', '5d', '1d'], porUmbral: { '1d': 'urgente' },
  },
  cliente_vencido: {
    categoria: 'clientes', seccion: 'clientes', severidad: 'urgente', implementado: true,
    etiqueta: 'Cliente vencido',
    descripcion: 'Un cliente pasó de fecha y quedó desactivado.',
    umbrales: ['vencido'],
  },
  prueba_termina: {
    categoria: 'clientes', seccion: 'clientes', severidad: 'aviso', implementado: true,
    etiqueta: 'Fin de prueba',
    descripcion: 'A un cliente en prueba se le acaba el plazo.',
    umbrales: ['5d', '1d'],
  },
  pago_registrado: {
    categoria: 'clientes', seccion: 'pagos', severidad: 'info', implementado: true,
    etiqueta: 'Pago registrado',
    descripcion: 'Se anotó el pago de un cliente.',
  },
  socio_termina: {
    categoria: 'clientes', seccion: 'clientes', severidad: 'aviso', implementado: true,
    etiqueta: 'Se acaba una condición de Socio CLAUX',
    descripcion: 'A un socio se le termina el período gratuito y vuelve al flujo de cobro.',
    // Empieza a los 30 días, y no a los 15 como una suscripción normal: aquí no
    // hay una factura que renovar sino una conversación que tener —prorrogar,
    // convertir a cliente de pago o cerrar—, y esa conversación no se improvisa
    // la semana de antes. El escalón `vencido` es el que avisa de que el cliente
    // acaba de volver al flujo normal y ya se le puede cortar por fecha.
    umbrales: ['30d', '15d', '5d', '1d', 'vencido'], porUmbral: { '1d': 'urgente' },
  },
  cliente_inactivo: {
    categoria: 'clientes', seccion: 'clientes', severidad: 'aviso', implementado: true,
    etiqueta: 'Cliente inactivo',
    descripcion: 'Nadie de ese negocio entra al portal desde hace 30 días.',
  },

  // ── Plataforma (seccion null → solo super_admin) ───────────────────────────
  email_fallido: {
    categoria: 'plataforma', seccion: null, severidad: 'urgente', implementado: true,
    etiqueta: 'Correo que no salió',
    descripcion: 'Un envío quedó con error en el registro de correos.',
  },
  // Los tres siguientes están DESCRITOS pero no enganchados: no hay hoy un sitio
  // donde colgarlos sin inventarse la métrica. Al implementarlos, basta poner
  // `implementado: true` y aparecen en Preferencias.
  facturacion_fallida: {
    categoria: 'plataforma', seccion: null, severidad: 'urgente', implementado: false,
    etiqueta: 'Facturación automática fallida',
    descripcion: 'El cobro automático de una suscripción devolvió error.',
  },
  cron_no_ejecutado: {
    categoria: 'plataforma', seccion: null, severidad: 'urgente', implementado: false,
    etiqueta: 'El cron no corrió',
    descripcion: 'No hay rastro del barrido diario de hoy.',
  },
  ia_consumo_alto: {
    categoria: 'plataforma', seccion: null, severidad: 'aviso', implementado: false,
    etiqueta: 'Consumo de IA alto',
    descripcion: 'El gasto del mes en el asistente pasó del umbral.',
  },
} satisfies Record<string, TipoAvisoAdmin>

export type TipoAvisoClave = keyof typeof CATALOGO_ADMIN

export function definicionAdmin(tipo: TipoAvisoClave): TipoAvisoAdmin {
  return CATALOGO_ADMIN[tipo]
}

/** Tipos que de verdad se generan hoy — los únicos que ofrece Preferencias. */
export function tiposAdminImplementados(): TipoAvisoClave[] {
  return (Object.keys(CATALOGO_ADMIN) as TipoAvisoClave[]).filter(t => CATALOGO_ADMIN[t].implementado)
}

/** Severidad efectiva de un tipo en un escalón concreto (antes del override). */
export function severidadAdminDe(tipo: TipoAvisoClave, umbral?: Umbral | null): Severidad {
  const def = definicionAdmin(tipo)
  if (umbral && def.porUmbral?.[umbral]) return def.porUmbral[umbral]!
  if (umbral === 'vencido') return 'urgente'
  return def.severidad
}

/**
 * Escalón que toca para unos días restantes, o null si aún no toca ninguno.
 * Copia del `umbralParaFecha` del portal porque los umbrales los declara ESTE
 * catálogo; la escala (1d < 5d < 15d < 30d) es la misma a propósito.
 */
export function umbralAdminParaFecha(tipo: TipoAvisoClave, diasRestantes: number): Umbral | null {
  const umbrales = definicionAdmin(tipo).umbrales ?? []
  if (diasRestantes < 0) return umbrales.includes('vencido') ? 'vencido' : null
  // De más apretado a más lejano: el primero que ya se cumple gana, para que un
  // cron que se saltó días no avise "faltan 15" cuando falta 1.
  const escala: [Umbral, number][] = [['1d', 1], ['5d', 5], ['15d', 15], ['30d', 30]]
  for (const [u, dias] of escala) {
    if (umbrales.includes(u) && diasRestantes <= dias) return u
  }
  return null
}

export const ETIQUETA_CATEGORIA_ADMIN: Record<CategoriaAdmin, string> = {
  ventas:     'Ventas',
  soporte:    'Soporte',
  clientes:   'Clientes y cobros',
  plataforma: 'Plataforma',
}
