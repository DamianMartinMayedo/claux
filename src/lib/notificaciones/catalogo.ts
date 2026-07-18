// Catálogo de tipos notificables (registro EN CÓDIGO, no en BD).
//
// Fuente única de: categoría, severidad por defecto, módulo requerido y escalado
// temporal de cada aviso interno del portal. Las preferencias por tenant
// (tabla `notificacion_config`) solo sobreescriben `activa` y la severidad.
//
// Un tipo con `modulo` no se genera nunca si el tenant no lo tiene contratado:
// el candado comercial vive aquí, no en la UI (ver crear.ts).

export type Severidad = 'info' | 'aviso' | 'urgente'

export type Categoria =
  | 'suscripcion' | 'reservas' | 'finanzas'
  | 'inventario'  | 'rrhh'     | 'terceros'
  | 'dossier'     | 'sistema'

/** Escalón temporal de un aviso de vencimiento. Parte de la clave de dedupe. */
export type Umbral = '30d' | '15d' | '5d' | '1d' | 'vencido'

export interface TipoNotificacion {
  categoria:   Categoria
  /** Nombre humano, para la pestaña Preferencias. Sin jerga. */
  etiqueta:    string
  /** Qué avisa, en una línea. Se muestra bajo la etiqueta. */
  descripcion: string
  /** Severidad por defecto cuando el tipo NO escala por tiempo. */
  severidad:   Severidad
  /**
   * Módulo/funcionalidad que hay que tener contratada. `null` = plataforma.
   * Una lista significa "basta con tener UNO" (p. ej. el resumen del día sirve
   * igual al que tiene Reservas que al que tiene Citas).
   */
  modulo:      string | string[] | null
  /** Escalones que genera, de más lejano a vencido. Solo tipos temporales. */
  umbrales?:   Umbral[]
  /** Severidad efectiva por escalón. Lo no listado cae en `severidad`. */
  porUmbral?:  Partial<Record<Umbral, Severidad>>
  /**
   * Si el generador/evento que lo produce ya existe. El catálogo describe TODO
   * lo notificable del producto (documentación viva), pero Preferencias solo
   * lista lo que de verdad puede llegar: ofrecer un toggle para un aviso que
   * nunca se dispara es mentirle al dueño.
   */
  implementado: boolean
}

/** Escalado por defecto de los vencimientos: avisa pronto, aprieta al final. */
const ESCALA_VENCIMIENTO = {
  umbrales:  ['30d', '15d', '5d', '1d'] as Umbral[],
  porUmbral: { '1d': 'urgente' } as Partial<Record<Umbral, Severidad>>,
}

export const CATALOGO = {
  // ── Suscripción / plataforma (siempre activa, no depende de módulo) ─────────
  suscripcion_por_vencer: {
    categoria: 'suscripcion', modulo: null, severidad: 'aviso', implementado: true,
    etiqueta: 'Tu suscripción está por vencer',
    descripcion: 'Aviso antes de que caduque tu suscripción a CLAUX.',
    umbrales: ['15d', '5d', '1d'], porUmbral: { '1d': 'urgente' },
  },
  suscripcion_vencida: {
    categoria: 'suscripcion', modulo: null, severidad: 'urgente', implementado: true,
    etiqueta: 'Tu suscripción ha vencido',
    descripcion: 'Tu suscripción caducó y el acceso puede cortarse.',
    umbrales: ['vencido'],
  },
  pago_confirmado: {
    categoria: 'suscripcion', modulo: null, severidad: 'info', implementado: true,
    etiqueta: 'Pago confirmado',
    descripcion: 'Confirmamos la recepción de tu pago.',
  },
  ia_cupo_cerca: {
    categoria: 'suscripcion', modulo: 'asistente_ia', severidad: 'aviso', implementado: true,
    etiqueta: 'Cupo de IA cerca del tope',
    descripcion: 'Tu consumo mensual del asistente se acerca al límite.',
  },

  // ── Reservas y Citas ───────────────────────────────────────────────────────
  reserva_nueva: {
    categoria: 'reservas', modulo: 'reservas_citas', severidad: 'aviso', implementado: true,
    etiqueta: 'Nueva reserva',
    descripcion: 'Alguien reservó desde la web o el bot de Telegram.',
  },
  cita_nueva: {
    categoria: 'reservas', modulo: 'agenda', severidad: 'aviso', implementado: true,
    etiqueta: 'Nueva cita',
    descripcion: 'Alguien pidió cita desde la web o el bot de Telegram.',
  },
  reserva_cancelada_cliente: {
    categoria: 'reservas', modulo: ['reservas_citas', 'agenda'], severidad: 'aviso', implementado: true,
    etiqueta: 'Cancelada por el cliente',
    descripcion: 'El cliente canceló usando su enlace.',
  },
  // NO implementado a propósito: al `NO_SHOW` lo marca el propio negocio desde el
  // panel. Avisar al dueño de lo que acaba de hacer él es ruido, igual que con la
  // cita creada a mano. Si algún día lo marca el personal y el dueño quiere
  // enterarse, se activa aquí y se engancha en cambiarEstado*.
  reserva_no_show: {
    categoria: 'reservas', modulo: 'reservas_citas', severidad: 'info', implementado: false,
    etiqueta: 'No-show',
    descripcion: 'Una reserva se marcó como no presentada.',
  },
  reservas_hoy: {
    categoria: 'reservas', modulo: ['reservas_citas', 'agenda'], severidad: 'info', implementado: true,
    etiqueta: 'Resumen de hoy',
    descripcion: 'Cuántas reservas y citas tienes para hoy.',
  },
  reserva_pendiente_confirmar: {
    categoria: 'reservas', modulo: ['reservas_citas', 'agenda'], severidad: 'aviso', implementado: true,
    etiqueta: 'Sin confirmar',
    descripcion: 'Llevan horas pendientes de que las confirmes.',
  },

  // ── Finanzas (base contable) ───────────────────────────────────────────────
  // OJO: no existe un tipo `factura_vencida`. Una factura EMITIDA con saldo es,
  // por definición, una cuenta por cobrar: `cobranza.ts` construye CxC juntando
  // facturas y registros de tipo COBRO. Tener los dos tipos avisaría DOS VECES
  // de la misma deuda. `cxc_vencida` cubre ambos y su `enlace` lleva a la
  // factura cuando el documento es una factura.
  cxp_por_vencer: {
    categoria: 'finanzas', modulo: 'base', severidad: 'aviso', implementado: true,
    etiqueta: 'Pago por vencer',
    descripcion: 'Una cuenta por pagar se acerca a su fecha de vencimiento.',
    ...ESCALA_VENCIMIENTO,
  },
  cxp_vencida: {
    categoria: 'finanzas', modulo: 'base', severidad: 'urgente', implementado: true,
    etiqueta: 'Pago vencido',
    descripcion: 'Le debes dinero a un proveedor y ya pasó la fecha.',
    umbrales: ['vencido'],
  },
  // Solo "vencida", sin aviso previo: antes del vencimiento no hay nada que
  // hacer con un cobro ajeno. Lo accionable es reclamarlo cuando ya se pasó.
  cxc_vencida: {
    categoria: 'finanzas', modulo: 'base', severidad: 'urgente', implementado: true,
    etiqueta: 'Cobro vencido',
    descripcion: 'Un cliente te debe dinero y ya pasó la fecha.',
    umbrales: ['vencido'],
  },
  oferta_por_caducar: {
    categoria: 'finanzas', modulo: 'base', severidad: 'aviso', implementado: true,
    etiqueta: 'Oferta por caducar',
    descripcion: 'Un presupuesto se acerca al fin de su validez.',
    umbrales: ['5d', '1d'],
  },
  caja_abierta_sin_cerrar: {
    categoria: 'finanzas', modulo: 'caja', severidad: 'aviso', implementado: true,
    etiqueta: 'Caja abierta sin cerrar',
    descripcion: 'Una sesión de caja lleva demasiado tiempo abierta.',
  },

  // ── Inventario ─────────────────────────────────────────────────────────────
  stock_bajo: {
    categoria: 'inventario', modulo: 'inventario', severidad: 'aviso', implementado: true,
    etiqueta: 'Stock bajo',
    descripcion: 'Un producto llegó a su mínimo.',
  },
  stock_agotado: {
    categoria: 'inventario', modulo: 'inventario', severidad: 'urgente', implementado: true,
    etiqueta: 'Producto agotado',
    descripcion: 'Un producto se quedó sin existencias.',
  },

  // ── RRHH ───────────────────────────────────────────────────────────────────
  contrato_empleado_vence: {
    categoria: 'rrhh', modulo: 'rrhh', severidad: 'aviso', implementado: true,
    etiqueta: 'Contrato de empleado por vencer',
    descripcion: 'Un contrato temporal se acerca a su fecha de fin.',
    ...ESCALA_VENCIMIENTO,
  },
  contrato_empleado_vencido: {
    categoria: 'rrhh', modulo: 'rrhh', severidad: 'urgente', implementado: true,
    etiqueta: 'Contrato de empleado vencido',
    descripcion: 'Un contrato temporal ya pasó su fecha de fin.',
    umbrales: ['vencido'],
  },
  nomina_pendiente: {
    categoria: 'rrhh', modulo: 'rrhh', severidad: 'aviso', implementado: true,
    etiqueta: 'Nómina del mes pendiente',
    descripcion: 'Se acerca fin de mes y no has generado la nómina.',
  },

  // ── Terceros (clientes y proveedores) ──────────────────────────────────────
  contrato_tercero_vence: {
    categoria: 'terceros', modulo: 'base', severidad: 'aviso', implementado: true,
    etiqueta: 'Contrato por vencer',
    descripcion: 'El contrato con un cliente o proveedor se acerca a su fin.',
    ...ESCALA_VENCIMIENTO,
  },
  contrato_tercero_vencido: {
    categoria: 'terceros', modulo: 'base', severidad: 'urgente', implementado: true,
    etiqueta: 'Contrato vencido',
    descripcion: 'El contrato con un cliente o proveedor ya venció.',
    umbrales: ['vencido'],
  },
  limite_credito_cerca: {
    categoria: 'terceros', modulo: 'base', severidad: 'aviso', implementado: true,
    etiqueta: 'Límite de crédito al tope',
    descripcion: 'Un cliente se acerca o supera el crédito que le diste.',
  },

  // ── Dossier ────────────────────────────────────────────────────────────────
  dossier_snapshot_desactualizado: {
    categoria: 'dossier', modulo: 'dossier', severidad: 'info', implementado: true,
    etiqueta: 'Dossier desactualizado',
    descripcion: 'Tu dossier publicado muestra números viejos.',
  },
} satisfies Record<string, TipoNotificacion>

export type TipoClave = keyof typeof CATALOGO

export function definicion(tipo: TipoClave): TipoNotificacion {
  return CATALOGO[tipo]
}

/** Tipos que de verdad se generan hoy — los únicos que ofrece Preferencias. */
export function tiposImplementados(): TipoClave[] {
  return (Object.keys(CATALOGO) as TipoClave[]).filter(t => CATALOGO[t].implementado)
}

/** Severidad efectiva de un tipo en un escalón concreto (antes del override). */
export function severidadDe(tipo: TipoClave, umbral?: Umbral | null): Severidad {
  const def = definicion(tipo)
  if (umbral && def.porUmbral?.[umbral]) return def.porUmbral[umbral]!
  if (umbral === 'vencido') return 'urgente'
  return def.severidad
}

/**
 * Escalón que toca hoy para una fecha de vencimiento, o null si aún no toca
 * ninguno. Devuelve el MÁS APRETADO que ya se alcanzó, para que un cron que se
 * saltó días no se quede avisando "faltan 30" cuando falta 1.
 */
export function umbralParaFecha(
  tipo: TipoClave,
  diasRestantes: number,
): Umbral | null {
  const def = definicion(tipo)
  const umbrales = def.umbrales ?? []
  if (diasRestantes < 0) return umbrales.includes('vencido') ? 'vencido' : null
  // De más apretado a más lejano: el primero que ya se cumple gana.
  const escala: [Umbral, number][] = [['1d', 1], ['5d', 5], ['15d', 15], ['30d', 30]]
  for (const [u, dias] of escala) {
    if (umbrales.includes(u) && diasRestantes <= dias) return u
  }
  return null
}

export const ETIQUETA_CATEGORIA: Record<Categoria, string> = {
  suscripcion: 'Suscripción',
  reservas:    'Reservas y citas',
  finanzas:    'Finanzas',
  inventario:  'Inventario',
  rrhh:        'Personal',
  terceros:    'Clientes y proveedores',
  dossier:     'Dossier',
  sistema:     'Sistema',
}

export const ETIQUETA_SEVERIDAD: Record<Severidad, string> = {
  info:    'Solo en la campana',
  aviso:   'Aviso flotante',
  urgente: 'Urgente (insiste)',
}
