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
  // Reservas y Citas se venden por separado y casi nunca coinciden: una sola
  // categoría «Reservas y citas» obligaba a una peluquería a filtrar por una palabra
  // que no usa. Los compartidos se quedan en `reservas` con texto genérico.
  | 'suscripcion' | 'reservas' | 'citas' | 'finanzas'
  | 'inventario'  | 'rrhh'     | 'terceros'
  | 'servicios'   | 'dossier'
  // Gestión del equipo (solicitudes de acceso de un miembro al administrador).
  // Cosa del administrador: fuera de las categorías operativas de un `usuario`.
  | 'equipo'

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
  periodo_gracia_activado: {
    categoria: 'suscripcion', modulo: null, severidad: 'aviso', implementado: true,
    etiqueta: 'Se activó tu período especial',
    descripcion: 'Te avisamos cuando te damos más tiempo para ponerte al día sin perder el acceso.',
  },
  pago_confirmado: {
    categoria: 'suscripcion', modulo: null, severidad: 'info', implementado: true,
    etiqueta: 'Pago confirmado',
    descripcion: 'Confirmamos la recepción de tu pago.',
  },
  // Acuse de recibo de «Me interesa» (banner de captación del dashboard). Va en
  // la campana y NO como popup: el dueño acaba de pulsarlo, saltarle un aviso
  // encima es contarle lo que ya sabe. Lo que aporta es que quede constancia de
  // que se pidió, y cuándo, fuera del propio widget.
  contratacion_solicitada: {
    categoria: 'suscripcion', modulo: null, severidad: 'info', implementado: true,
    etiqueta: 'Pediste activar algo nuevo',
    descripcion: 'Confirmación de que recibimos tu solicitud de activar un módulo.',
  },
  ia_cupo_cerca: {
    categoria: 'suscripcion', modulo: 'asistente_ia', severidad: 'aviso', implementado: true,
    etiqueta: 'Cupo de IA cerca del tope',
    descripcion: 'Tu consumo mensual del asistente se acerca al límite.',
  },
  // Capacidad del nivel contratado (productos, trabajadores, empresas…). `modulo:
  // null` = plataforma: el tope existe tenga los módulos que tenga, y el aviso ha
  // de llegar igual al que solo tiene RRHH que al que lo tiene todo.
  limite_cerca: {
    categoria: 'suscripcion', modulo: null, severidad: 'aviso', implementado: true,
    etiqueta: 'Cerca del tope de tu nivel',
    descripcion: 'Te quedan pocos huecos en algo que tu nivel limita (productos, trabajadores, empresas…).',
  },
  limite_alcanzado: {
    categoria: 'suscripcion', modulo: null, severidad: 'urgente', implementado: true,
    etiqueta: 'Llegaste al tope de tu nivel',
    descripcion: 'Se llenó algo que tu nivel limita. No se corta nada, pero no puedes añadir más.',
  },
  // Documentos legales del alta sin firmar. `modulo: null` = plataforma: aplica a
  // todo cliente, tenga los módulos que tenga. La lanza el admin como recordatorio.
  documentos_firma_pendiente: {
    categoria: 'suscripcion', modulo: null, severidad: 'aviso', implementado: true,
    etiqueta: 'Documentos pendientes de firma',
    descripcion: 'Tienes el NDA, el contrato o el presupuesto sin firmar en tu perfil.',
  },

  // ── Reservas y Citas ───────────────────────────────────────────────────────
  reserva_nueva: {
    categoria: 'reservas', modulo: 'reservas_citas', severidad: 'aviso', implementado: true,
    etiqueta: 'Nueva reserva',
    descripcion: 'Alguien reservó desde la web o el bot de Telegram.',
  },
  cita_nueva: {
    categoria: 'citas', modulo: 'agenda', severidad: 'aviso', implementado: true,
    etiqueta: 'Nueva cita',
    descripcion: 'Alguien pidió cita desde la web o el bot de Telegram.',
  },
  reserva_cancelada_cliente: {
    categoria: 'reservas', modulo: ['reservas_citas', 'agenda'], severidad: 'aviso', implementado: true,
    etiqueta: 'Cancelada por el cliente',
    descripcion: 'El cliente canceló usando su enlace.',
  },
  // Se enciende con la fase 2: ahora el no-show se marca en LOTE al cerrar el día y
  // lo puede marcar el personal, no solo el dueño. El resumen semanal es lo que
  // convierte «uno no vino» en «esto me pasa dos veces por semana».
  reserva_no_show: {
    categoria: 'reservas', modulo: ['reservas_citas', 'agenda'], severidad: 'info', implementado: true,
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

  // ── Los agujeros que deja Telegram (fase 9) ────────────────────────────────
  bot_sin_vincular: {
    categoria: 'reservas', modulo: ['reservas_citas', 'agenda'], severidad: 'aviso', implementado: true,
    etiqueta: 'Bot sin vincular',
    descripcion: 'Tu bot está activo pero no has vinculado tu chat: no te llega ningún aviso.',
  },
  telegram_no_entregado: {
    categoria: 'reservas', modulo: ['reservas_citas', 'agenda'], severidad: 'aviso', implementado: true,
    etiqueta: 'Avisos que no llegaron',
    descripcion: 'Telegram rechazó algún mensaje: puede que hayas bloqueado el bot o cambiado el token.',
  },
  agenda_sin_configurar: {
    categoria: 'reservas', modulo: ['reservas_citas', 'agenda'], severidad: 'aviso', implementado: true,
    etiqueta: 'Web publicada sin configurar',
    descripcion: 'Tu enlace público está activo pero no hay nada que ofrecer todavía.',
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
  // ⚠️ Este tipo NACIÓ de una premisa que resultó falsa: «antes del vencimiento no hay
  // nada que hacer con un cobro ajeno». Sí lo hay, y es lo más rentable que hace un
  // negocio pequeño: llamar al cliente ANTES de la fecha. Cobrar a tiempo es más barato
  // que reclamar tarde, y en Cuba el cobro se persigue por teléfono. De ahí el aviso
  // previo, con la misma escala que el pago por vencer.
  cxc_por_vencer: {
    categoria: 'finanzas', modulo: 'base', severidad: 'aviso', implementado: true,
    etiqueta: 'Cobro por vencer',
    descripcion: 'Un cliente tiene un pago que se acerca a su fecha.',
    ...ESCALA_VENCIMIENTO,
  },
  cxc_vencida: {
    categoria: 'finanzas', modulo: 'base', severidad: 'urgente', implementado: true,
    etiqueta: 'Cobro vencido',
    descripcion: 'Un cliente te debe dinero y ya pasó la fecha.',
    umbrales: ['vencido'],
  },
  // Trabajo hecho y sin facturar. Con el cron de suscripciones dejando borradores
  // solos, es cada vez más fácil que uno se quede ahí para siempre.
  factura_borrador_estancada: {
    categoria: 'finanzas', modulo: 'base', severidad: 'aviso', implementado: true,
    etiqueta: 'Borrador sin emitir',
    descripcion: 'Una factura lleva demasiado tiempo en borrador.',
    umbrales: ['15d'],
  },
  oferta_por_caducar: {
    categoria: 'finanzas', modulo: 'base', severidad: 'aviso', implementado: true,
    etiqueta: 'Oferta por caducar',
    descripcion: 'Un presupuesto se acerca al fin de su validez.',
    umbrales: ['5d', '1d'],
  },
  // La tasa se refresca sola de madrugada (cron `/api/cron/tasas`), y por eso
  // mismo hay que avisar: TODO lo consolidado —ventas, deudas, el dashboard—
  // cambia de número sin que nadie haya tocado nada. Es 'info' y solo se crea
  // cuando la tasa cambió DE VERDAD: un aviso diario de «sigue igual» sería
  // ruido, y el ruido enseña a ignorar la campana.
  tasas_actualizadas: {
    categoria: 'finanzas', modulo: 'base', severidad: 'info', implementado: true,
    etiqueta: 'Tasas de cambio actualizadas',
    descripcion: 'La actualización automática de la madrugada trajo una tasa distinta.',
  },
  caja_abierta_sin_cerrar: {
    categoria: 'finanzas', modulo: 'caja', severidad: 'aviso', implementado: true,
    etiqueta: 'Caja abierta sin cerrar',
    descripcion: 'Una sesión de caja lleva demasiado tiempo abierta.',
  },
  // Los tres de abajo cubren el mismo hueco desde tres momentos distintos: ANTES de
  // vender (no hay caja de Tesorería asignada), DESPUÉS de vender y sin cerrar (el
  // dinero sigue en el móvil) y DESPUÉS de cerrar (el cierre se quedó a medias). Los
  // dos últimos son `urgente`: es dinero cobrado que no está en ningún libro, y un
  // aviso que se puede pasar por alto no sirve para eso.
  caja_venta_sin_contabilizar: {
    categoria: 'finanzas', modulo: 'caja', severidad: 'urgente', implementado: true,
    etiqueta: 'Ventas de caja sin contabilizar',
    descripcion: 'Hay ventas cuyo turno no se cerró, así que no están en tu contabilidad.',
  },
  caja_cierre_sin_contabilizar: {
    categoria: 'finanzas', modulo: 'caja', severidad: 'urgente', implementado: true,
    etiqueta: 'Cierre de caja a medias',
    descripcion: 'Un cierre tiene ventas en una moneda que no llegó a Tesorería.',
  },
  caja_sin_cuenta_configurada: {
    categoria: 'finanzas', modulo: 'caja', severidad: 'aviso', implementado: true,
    etiqueta: 'Punto de venta sin caja de Tesorería',
    descripcion: 'Un punto acepta una moneda que no tiene cuenta asignada.',
  },
  // Recurrente por umbral, NO por la fila: con `entidad_id = caja_id` a secas el aviso
  // saldría una vez en la vida y el silencio del mes siguiente se tragaría. Es el mismo
  // gotcha (5b) que ya mordió con el cobro de las suscripciones.
  caja_sin_sincronizar: {
    categoria: 'finanzas', modulo: 'caja', severidad: 'info', implementado: true,
    etiqueta: 'Punto de venta sin sincronizar',
    descripcion: 'Un punto de venta lleva días sin enviar sus ventas.',
    umbrales: ['30d', '15d', '5d'],
    porUmbral: { '30d': 'info', '15d': 'aviso', '5d': 'aviso' },
  },

  // ── Inventario ─────────────────────────────────────────────────────────────
  // Falta el aviso de CADUCIDAD, y no por descuido: exige lotes. Un solo campo
  // `fecha_caducidad` en el producto miente en cuanto el negocio repone (tres
  // tandas de leche, tres fechas). Es una feature de Inventario con su plan
  // propio: docs/planes/inventario-lotes-caducidad.md.
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
  cumpleanos_empleado: {
    categoria: 'rrhh', modulo: 'rrhh', severidad: 'info', implementado: true,
    etiqueta: 'Cumpleaños de un empleado',
    descripcion: 'El día que alguien de tu equipo cumple años.',
  },
  documento_empleado_vence: {
    categoria: 'rrhh', modulo: 'rrhh', severidad: 'aviso', implementado: true,
    etiqueta: 'Documento por caducar',
    descripcion: 'El carné o documento de un empleado se acerca a su caducidad.',
    ...ESCALA_VENCIMIENTO,
  },
  documento_empleado_vencido: {
    categoria: 'rrhh', modulo: 'rrhh', severidad: 'urgente', implementado: true,
    etiqueta: 'Documento caducado',
    descripcion: 'El carné o documento de un empleado ya caducó.',
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

  // ── Servicios (suscripciones a clientes) ────────────────────────────────────
  // «Por vencer / vencida» aplican a suscripciones con FIN FIJO y sin renovación
  // automática: una que se auto-renueva no vence, sigue. El estado «vencida» se
  // deriva (no se guarda), igual que en /portal/suscripciones.
  servicio_suscripcion_por_vencer: {
    categoria: 'servicios', modulo: 'servicios', severidad: 'aviso', implementado: true,
    etiqueta: 'Suscripción por vencer',
    descripcion: 'La suscripción de un cliente se acerca a su fecha de fin.',
    ...ESCALA_VENCIMIENTO,
  },
  servicio_suscripcion_vencida: {
    categoria: 'servicios', modulo: 'servicios', severidad: 'urgente', implementado: true,
    etiqueta: 'Suscripción vencida',
    descripcion: 'La suscripción de un cliente pasó su fecha de fin sin renovar.',
    umbrales: ['vencido'],
  },
  // Recordatorio del próximo cobro. Es el ÚNICO aviso recurrente de la bandeja: su
  // entidad es la suscripción más su ciclo (`SUS-XXXX@2026-08-01`), porque con la
  // suscripción sola el índice de idempotencia lo dejaría salir una vez en la vida.
  // Ver `escanearRenovaciones` en escaneres.ts.
  servicio_renovacion_proxima: {
    categoria: 'servicios', modulo: 'servicios', severidad: 'info', implementado: true,
    etiqueta: 'Cobro pendiente',
    descripcion: 'Una suscripción llega a su próximo cobro.',
    umbrales: ['5d', '1d'],
  },
  // Una pausa con fecha de vuelta se reanuda sola (mig. 161). Es un cambio que el dueño
  // no ha pulsado y que mueve dinero —el acuerdo vuelve a facturar—, así que se cuenta.
  // UNA sola vez por reanudación (la entidad es la suscripción y la pausa se borra al
  // reanudar), nunca una por cada mes que estuvo parada.
  servicio_suscripcion_reanudada: {
    categoria: 'servicios', modulo: 'servicios', severidad: 'info', implementado: true,
    etiqueta: 'Suscripción reanudada',
    descripcion: 'Una suscripción pausada llegó a su fecha de vuelta y se reactivó sola.',
  },

  // ── Dossier ────────────────────────────────────────────────────────────────
  dossier_snapshot_desactualizado: {
    categoria: 'dossier', modulo: 'dossier', severidad: 'info', implementado: true,
    etiqueta: 'Dossier desactualizado',
    descripcion: 'Tu dossier publicado muestra números viejos.',
  },

  // ── Equipo ─────────────────────────────────────────────────────────────────
  // La pide un miembro del equipo desde el módulo que solo puede consultar. No
  // depende de un módulo contratado (`modulo: null`): quien la lanza es
  // precisamente quien no tiene el permiso. La ve el administrador, que la
  // resuelve en Usuarios.
  solicitud_acceso: {
    categoria: 'equipo', modulo: null, severidad: 'aviso', implementado: true,
    etiqueta: 'Solicitud de acceso',
    descripcion: 'Un miembro del equipo pide poder editar un módulo que solo puede consultar.',
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

// ── Bandeja por rol (mapa fijo en código, decisión 4) ───────────────────────
// Un `usuario` (no administrador) ve en la bandeja SOLO lo operativo de sus
// módulos y NUNCA cifras de dinero agregadas: finanzas (CxC/CxP/caja/tasas),
// servicios (ingresos por suscripción), personal (nómina), clientes/proveedores
// (crédito) y dossier quedan fuera —son cosa del administrador—, igual que la
// suscripción del negocio a CLAUX. Cada categoría operativa apunta al módulo que
// la respalda: entra solo si el usuario ve al menos uno de esos módulos.
const CATEGORIAS_OPERATIVAS_USUARIO: Partial<Record<Categoria, string[]>> = {
  reservas:   ['reservas_citas', 'agenda'],
  citas:      ['agenda'],
  inventario: ['inventario'],
}

/**
 * Categorías de bandeja que un rol puede ver. `null` = TODAS (admin_empresa).
 * Para un `usuario`, la intersección de las categorías operativas con los
 * módulos que de verdad puede ver (lista vacía = sin bandeja).
 */
export function categoriasBandeja(
  rol: 'admin_empresa' | 'usuario',
  modulosVisibles: Iterable<string>,
): Categoria[] | null {
  if (rol === 'admin_empresa') return null
  const vis = new Set(modulosVisibles)
  return (Object.entries(CATEGORIAS_OPERATIVAS_USUARIO) as [Categoria, string[]][])
    .filter(([, mods]) => mods.some(m => vis.has(m)))
    .map(([cat]) => cat)
}

export const ETIQUETA_CATEGORIA: Record<Categoria, string> = {
  suscripcion: 'Suscripción',
  reservas:    'Reservas',
  citas:       'Citas',
  finanzas:    'Finanzas',
  inventario:  'Inventario',
  rrhh:        'Personal',
  terceros:    'Clientes y proveedores',
  servicios:   'Servicios',
  dossier:     'Dossier',
  equipo:      'Equipo',
}

export const ETIQUETA_SEVERIDAD: Record<Severidad, string> = {
  info:    'Solo en la campana',
  aviso:   'Aviso flotante',
  urgente: 'Urgente (insiste)',
}
