import 'server-only'

/**
 * Grafo de la Academia: la relación entre piezas, en un solo sitio.
 *
 * De aquí salen los tres diagramas de cada ficha (una fuente, muchas salidas):
 *  - `flujo`      → cómo circula el dato DENTRO del módulo (relación interna).
 *  - `conexiones` → cómo se relaciona con OTROS módulos (dirección + qué fluye).
 *  - `capas`      → qué hace SOLO y qué le añade cada módulo (independencia).
 *
 * El Markdown de cada ficha coloca el diagrama donde toca con una directiva de
 * una línea: ```claux:flujo```, ```claux:conexiones```, ```claux:capas```. El
 * texto de «qué fluye» va en las palabras del negocio, nunca en jerga de tablas.
 *
 * La mayoría de las claves son slugs del catálogo (una por ficha). Las del final
 * —`plataforma`, `recorrido-*`— no lo son: son los diagramas de la Parte I, y el
 * Markdown las pide por su clave (```claux:flujo:recorrido-venta```).
 */

/** Sentido del dato respecto a ESTE módulo. */
export type Direccion = 'recibe' | 'entrega' | 'ambos'

/** Una relación con otra pieza del sistema. */
export type Arista = {
  /** Nombre visible de la otra pieza (como se ve en el portal). */
  otro: string
  /** Slug de su ficha, si es una del catálogo (para poder enlazar). */
  slug?: string
  direccion: Direccion
  /** Qué fluye, en una frase de negocio. */
  que: string
}

/** Un paso del flujo interno. */
export type Paso = { titulo: string; detalle: string }

/** Qué añade otra pieza cuando está presente. */
export type Aporte = { de: string; slug?: string; aporta: string }

export type Grafo = {
  flujo?: { titulo: string; pasos: Paso[] }
  conexiones?: {
    titulo: string
    aristas: Arista[]
    /** Rótulo de la columna de entrada. En un addon, «Le entra de» miente. */
    entradaTitulo?: string
    /** Rótulo de la columna de salida. */
    salidaTitulo?: string
    /**
     * Qué va en el centro. Por defecto, el nombre de la ficha en el catálogo;
     * se pone a mano en los diagramas que NO son de un módulo (Partes I y III),
     * donde el centro es un concepto y el catálogo no sabe nombrarlo.
     */
    hub?: string
  }
  capas?: {
    titulo: string
    /** Lo que el módulo hace por sí solo, sin ninguna otra pieza. */
    nucleo: string[]
    /** Lo que cada otra pieza le AÑADE (llenado rápido), si está. */
    aportes: Aporte[]
    /** Rótulo del núcleo. En un addon «Funciona sola» sería mentira. */
    nucleoTitulo?: string
    /** Rótulo de los añadidos. */
    aportesTitulo?: string
  }
}

export const GRAFO: Record<string, Grafo> = {
  // ── Contabilidad (patrón) ───────────────────────────────────────────────────
  contabilidad: {
    flujo: {
      titulo: 'Por dentro: del documento al resultado',
      pasos: [
        { titulo: 'Documento', detalle: 'Una factura (Ventas) o un gasto queda registrado.' },
        { titulo: 'Deuda', detalle: 'Su saldo aparece solo en Cuentas por cobrar o por pagar.' },
        { titulo: 'Cobro o pago', detalle: 'Salda la deuda —total o parcial— y mueve Tesorería.' },
        { titulo: 'Resultado', detalle: 'Reportes dice si ganas o pierdes, por mes y por moneda.' },
      ],
    },
    conexiones: {
      titulo: 'Cómo se relaciona con el resto',
      aristas: [
        { otro: 'Inventario', slug: 'inventario', direccion: 'recibe', que: 'Coste y margen de cada línea, descuento de existencias y las compras a crédito.' },
        { otro: 'Punto de venta', slug: 'punto-de-venta', direccion: 'recibe', que: 'Cada cierre de caja: su ingreso a Tesorería y sus ventas al informe.' },
        { otro: 'RRHH', slug: 'rrhh', direccion: 'recibe', que: 'Los salarios de la nómina, como gasto de Personal.' },
        { otro: 'Servicios', slug: 'servicios', direccion: 'recibe', que: 'Las suscripciones facturan solas: entran en Ventas y en Cuentas por cobrar.' },
        { otro: 'Importador', direccion: 'recibe', que: 'La carga inicial del histórico, saldada contra una cuenta de «Apertura».' },
        { otro: 'Dossier', slug: 'dossier', direccion: 'entrega', que: 'El estado de resultados que alimenta el documento para inversores.' },
        { otro: 'Monedas y tasas', direccion: 'ambos', que: 'La tasa vigente para cualquier total que junte varias monedas.' },
      ],
    },
    capas: {
      titulo: 'Funciona sola; se llena sola',
      nucleo: [
        'Facturas y ofertas',
        'Gastos y cobros',
        'Cuentas por cobrar y por pagar',
        'Tesorería con saldo por moneda',
        'Estado de resultados y flujo de caja',
      ],
      aportes: [
        { de: 'Inventario', slug: 'inventario', aporta: 'coste y margen de cada línea, y descuento de existencias al facturar' },
        { de: 'Punto de venta', slug: 'punto-de-venta', aporta: 'las ventas del mostrador, sin teclearlas una a una' },
        { de: 'RRHH', slug: 'rrhh', aporta: 'el gasto de la nómina, ya calculado' },
        { de: 'Servicios', slug: 'servicios', aporta: 'la facturación que se repite, emitida sola' },
        { de: 'Asistente IA', slug: 'asistente-ia', aporta: 'consejos sobre tus propios números' },
      ],
    },
  },

  // ── Inventario ──────────────────────────────────────────────────────────────
  inventario: {
    flujo: {
      titulo: 'Por dentro: de la compra al acta de conteo',
      pasos: [
        { titulo: 'Compra', detalle: 'La mercancía entra y sube el stock del almacén.' },
        { titulo: 'Existencias', detalle: 'Cada producto tiene su cantidad y su coste, por almacén.' },
        { titulo: 'Salida', detalle: 'Una venta, una merma o un traspaso descuenta, siempre con motivo.' },
        { titulo: 'Conteo', detalle: 'Cuadra el sistema con la realidad y cierra un acta.' },
      ],
    },
    conexiones: {
      titulo: 'Cómo se relaciona con el resto',
      aristas: [
        { otro: 'Punto de venta', slug: 'punto-de-venta', direccion: 'recibe', que: 'Cada cierre de caja descuenta del almacén lo vendido, en un resumen por producto.' },
        { otro: 'Asistente IA', slug: 'asistente-ia', direccion: 'recibe', que: 'Autocompletado de la ficha y conteo dictado, siempre a confirmar.' },
        { otro: 'Importador', direccion: 'recibe', que: 'La carga inicial de productos y existencias.' },
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'entrega', que: 'Coste y margen de cada línea, el descuento al facturar y la compra a crédito en Cuentas por pagar.' },
        { otro: 'Catálogo digital', slug: 'catalogo-digital', direccion: 'entrega', que: 'Los productos, importables a la carta pública; el dueño ve el stock en la ficha.' },
      ],
    },
    capas: {
      titulo: 'Funciona solo; se llena solo',
      nucleo: [
        'Productos con coste y precio',
        'Almacenes y existencias',
        'Movimientos con motivo',
        'Compras a proveedor',
        'Conteo físico y acta',
      ],
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'la compra se registra como gasto y como deuda, y la factura descuenta' },
        { de: 'Punto de venta', slug: 'punto-de-venta', aporta: 'lo vendido en el mostrador sale del almacén sin teclearlo' },
        { de: 'Catálogo digital', slug: 'catalogo-digital', aporta: 'publica esos productos de cara al cliente' },
        { de: 'Asistente IA', slug: 'asistente-ia', aporta: 'rellena las fichas y permite contar dictando' },
      ],
    },
  },

  // ── Servicios ───────────────────────────────────────────────────────────────
  servicios: {
    flujo: {
      titulo: 'Por dentro: del catálogo al cobro que se repite',
      pasos: [
        { titulo: 'Catálogo', detalle: 'Cada servicio con su precio y su coste por moneda.' },
        { titulo: 'Acuerdo', detalle: 'Una suscripción: qué servicios, a qué precio y cada cuánto.' },
        { titulo: 'Borrador', detalle: 'El día del ciclo, CLAUX deja la factura hecha —nunca la emite sola—.' },
        { titulo: 'Cobro', detalle: 'Se emite y pasa a Cuentas por cobrar con el resto.' },
      ],
    },
    conexiones: {
      titulo: 'Cómo se relaciona con el resto',
      aristas: [
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'entrega', que: 'Las facturas de suscripción entran en Ventas y en Cuentas por cobrar; al emitir se registra el coste y se calcula el margen.' },
        { otro: 'Citas', slug: 'citas', direccion: 'ambos', que: 'Los servicios se cruzan en las dos direcciones: un corte o una consulta puede vivir en ambas sin que ninguna dependa de la otra.' },
        { otro: 'Punto de venta', slug: 'punto-de-venta', direccion: 'ambos', que: 'Una caja puede vender servicios además de productos, si el negocio tiene los dos.' },
      ],
    },
    capas: {
      titulo: 'Funciona solo; se llena solo',
      nucleo: [
        'Catálogo de servicios',
        'Suscripciones y periodicidad',
        'Calendario de cobros',
        'Pausas y subidas de tarifa',
      ],
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'la factura, el cobro y el margen quedan en el libro' },
        { de: 'Citas', slug: 'citas', aporta: 'comparte los servicios con los de la agenda' },
        { de: 'Punto de venta', slug: 'punto-de-venta', aporta: 'permite cobrarlos también en el mostrador' },
      ],
    },
  },

  // ── RRHH ────────────────────────────────────────────────────────────────────
  rrhh: {
    flujo: {
      titulo: 'Por dentro: de la ficha al recibo',
      pasos: [
        { titulo: 'Personal', detalle: 'Cada trabajador con su contrato y su saldo de vacaciones.' },
        { titulo: 'Turnos', detalle: 'La rotación propone los días trabajados del mes.' },
        { titulo: 'Nómina', detalle: 'El borrador calcula devengos, retenciones y aportes de empresa.' },
        { titulo: 'Confirmar', detalle: 'Queda el recibo y nace la deuda con cada acreedor.' },
      ],
    },
    conexiones: {
      titulo: 'Cómo se relaciona con el resto',
      aristas: [
        { otro: 'Asistente IA', slug: 'asistente-ia', direccion: 'recibe', que: 'Repasa el borrador antes de confirmar y explica el recibo en palabras. No confirma nada.' },
        { otro: 'Importador', direccion: 'recibe', que: 'La carga inicial de la plantilla y sus contratos.' },
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'entrega', que: 'El coste de personal y la deuda con cada acreedor —neto, retenciones, aportes— con su vencimiento, pagable en Tesorería.' },
        { otro: 'Citas', slug: 'citas', direccion: 'entrega', que: 'El personal ya cargado, importable como profesionales de la agenda.' },
      ],
    },
    capas: {
      titulo: 'Funciona solo; se llena solo',
      nucleo: [
        'Fichas y contratos',
        'Turnos y cuadrante',
        'Nómina con desglose',
        'Recibo por trabajador',
        'Nómina MIPYME cubana',
        'Reportes de coste',
      ],
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'registra el coste y las deudas, y permite pagarlas' },
        { de: 'Citas', slug: 'citas', aporta: 'reutiliza la plantilla como profesionales de la agenda' },
        { de: 'Asistente IA', slug: 'asistente-ia', aporta: 'repasa la nómina antes de confirmar' },
      ],
    },
  },

  // ── Punto de venta ──────────────────────────────────────────────────────────
  'punto-de-venta': {
    flujo: {
      titulo: 'Por dentro: del turno abierto al libro',
      pasos: [
        { titulo: 'Abrir turno', detalle: 'Con su fondo inicial, en el aparato del mostrador.' },
        { titulo: 'Cobrar', detalle: 'Ventas y salidas de efectivo, con o sin internet.' },
        { titulo: 'Arqueo', detalle: 'Al cerrar, el efectivo esperado frente al contado.' },
        { titulo: 'Sincronizar', detalle: 'El cierre sube a CLAUX y recibe su número Z.' },
      ],
    },
    conexiones: {
      titulo: 'Cómo se relaciona con el resto',
      aristas: [
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'entrega', que: 'Cada cierre postea su ingreso por moneda en Tesorería, las salidas de efectivo como egresos y su venta en el estado de resultados.' },
        { otro: 'Inventario', slug: 'inventario', direccion: 'entrega', que: 'Descuenta del almacén lo vendido, en un resumen por producto (admite negativo: la venta ya ocurrió).' },
        { otro: 'Servicios', slug: 'servicios', direccion: 'ambos', que: 'Un punto de venta puede cobrar servicios además de productos.' },
      ],
    },
    capas: {
      titulo: 'Funciona solo; se llena solo',
      nucleo: [
        'App instalable sin conexión',
        'Cobro y cambio',
        'Arqueo del turno',
        'Cierres con número Z',
        'Panel de operaciones',
      ],
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'el ingreso entra en Tesorería y la venta en el informe' },
        { de: 'Inventario', slug: 'inventario', aporta: 'lo vendido sale del almacén solo' },
        { de: 'Servicios', slug: 'servicios', aporta: 'añade los servicios a la rejilla de la caja' },
      ],
    },
  },

  // ── Menú / catálogo digital ─────────────────────────────────────────────────
  'catalogo-digital': {
    flujo: {
      titulo: 'Por dentro: del ítem a la mesa del cliente',
      pasos: [
        { titulo: 'Ítems', detalle: 'Cada plato o producto con su foto, precio y categoría.' },
        { titulo: 'Orden', detalle: 'Las categorías agrupan y ordenan la carta.' },
        { titulo: 'Publicación', detalle: 'La dirección web del negocio y su código QR.' },
        { titulo: 'Página pública', detalle: 'El cliente la abre en su móvil, y ve el cambio al momento.' },
      ],
    },
    conexiones: {
      titulo: 'Cómo se relaciona con el resto',
      aristas: [
        { otro: 'Inventario', slug: 'inventario', direccion: 'recibe', que: 'Productos importables como llenado rápido; con Inventario, el dueño ve el stock en la ficha.' },
        { otro: 'Servicios', slug: 'servicios', direccion: 'recibe', que: 'Los servicios del catálogo interno, también importables.' },
        { otro: 'Asistente IA', slug: 'asistente-ia', direccion: 'recibe', que: 'Autocompleta la ficha del ítem —descripción, datos de comida— y da consejos del catálogo.' },
        { otro: 'Citas', slug: 'citas', direccion: 'ambos', que: 'Comparten la dirección web del negocio, y los servicios pueden pasar de una a otra.' },
        { otro: 'Reservas', slug: 'reservas', direccion: 'ambos', que: 'Comparten la dirección web: es del negocio, no de la pieza.' },
      ],
    },
    capas: {
      titulo: 'Funciona solo; se llena solo',
      nucleo: [
        'Editor de ítems',
        'Categorías y orden',
        'Enlace y código QR',
        'Página pública en varios idiomas',
      ],
      aportes: [
        { de: 'Inventario', slug: 'inventario', aporta: 'importa los productos y enseña sus existencias' },
        { de: 'Servicios', slug: 'servicios', aporta: 'importa los servicios del catálogo interno' },
        { de: 'Asistente IA', slug: 'asistente-ia', aporta: 'rellena la descripción y los datos del ítem' },
        { de: 'Citas y Reservas', slug: 'citas', aporta: 'comparten la misma dirección web del negocio' },
      ],
    },
  },

  // ── Citas ───────────────────────────────────────────────────────────────────
  citas: {
    flujo: {
      titulo: 'Por dentro: del horario al hueco reservado',
      pasos: [
        { titulo: 'Servicios', detalle: 'Cada tipo de cita, con la duración que ocupa.' },
        { titulo: 'Personal', detalle: 'Su horario semanal es lo que genera los huecos.' },
        { titulo: 'Huecos', detalle: 'El cliente solo ve los que están libres de verdad.' },
        { titulo: 'Cita', detalle: 'Entra por web, bot o a mano, y recorre sus estados.' },
      ],
    },
    conexiones: {
      titulo: 'Cómo se relaciona con el resto',
      aristas: [
        { otro: 'RRHH', slug: 'rrhh', direccion: 'recibe', que: 'El personal ya cargado, importable como profesionales. Sin RRHH se dan de alta a mano.' },
        { otro: 'Asistente IA', slug: 'asistente-ia', direccion: 'recibe', que: 'El bot pasa a entender lenguaje natural; sin el addon funciona con botones.' },
        { otro: 'Catálogo digital', slug: 'catalogo-digital', direccion: 'ambos', que: 'Los servicios se importan de una a otra, y comparten la dirección web del negocio.' },
        { otro: 'Reservas', slug: 'reservas', direccion: 'ambos', que: 'Comparten la dirección web, los días de cierre y las reglas: son del negocio, no de la pieza.' },
      ],
    },
    capas: {
      titulo: 'Funciona sola; se llena sola',
      nucleo: [
        'Agenda y estados',
        'Servicios con duración',
        'Personal con horario y ausencias',
        'Enlace público y QR',
        'Bot de Telegram',
      ],
      aportes: [
        { de: 'RRHH', slug: 'rrhh', aporta: 'trae la plantilla ya cargada' },
        { de: 'Catálogo digital', slug: 'catalogo-digital', aporta: 'trae los servicios y comparte la dirección web' },
        { de: 'Asistente IA', slug: 'asistente-ia', aporta: 'el bot entiende lenguaje natural' },
      ],
    },
  },

  // ── Reservas ────────────────────────────────────────────────────────────────
  reservas: {
    flujo: {
      titulo: 'Por dentro: del aforo a la mesa apartada',
      pasos: [
        { titulo: 'Franjas', detalle: 'Cada una con la capacidad real que admite.' },
        { titulo: 'Reglas', detalle: 'Antelación, ventana de reserva y días de cierre.' },
        { titulo: 'Reserva', detalle: 'Entra por web, bot o a mano, y solo si queda sitio.' },
        { titulo: 'Estados', detalle: 'Confirmada, atendida, o cerrada por el propio sistema.' },
      ],
    },
    conexiones: {
      titulo: 'Cómo se relaciona con el resto',
      aristas: [
        { otro: 'Asistente IA', slug: 'asistente-ia', direccion: 'recibe', que: 'El bot pasa a entender lenguaje natural; sin el addon funciona con botones.' },
        { otro: 'Citas', slug: 'citas', direccion: 'ambos', que: 'Comparten la dirección web, los días de cierre y las reglas del negocio.' },
        { otro: 'Catálogo digital', slug: 'catalogo-digital', direccion: 'ambos', que: 'Comparten la dirección web: cambiarla en una la cambia en la otra.' },
      ],
    },
    capas: {
      titulo: 'Funciona sola; se llena sola',
      nucleo: [
        'Página pública de reserva',
        'Aforo por franja',
        'Panel y estados',
        'Reglas y días de cierre',
        'Bot de Telegram',
      ],
      aportes: [
        { de: 'Asistente IA', slug: 'asistente-ia', aporta: 'el bot entiende lenguaje natural' },
        { de: 'Citas', slug: 'citas', aporta: 'comparte dirección, cierres y reglas del negocio' },
        { de: 'Catálogo digital', slug: 'catalogo-digital', aporta: 'la carta y la reserva viven bajo la misma dirección' },
      ],
    },
  },

  // ── Dossier del negocio ─────────────────────────────────────────────────────
  dossier: {
    flujo: {
      titulo: 'Por dentro: del asistente al enlace publicado',
      pasos: [
        { titulo: 'Asistente', detalle: 'Nombre, color y logo propios del dossier.' },
        { titulo: 'Relato', detalle: 'El texto del negocio y su equipo.' },
        { titulo: 'Números', detalle: 'Una foto congelada de las cifras: los dos documentos beben de ella.' },
        { titulo: 'Publicar', detalle: 'Un enlace privado y revocable, más el PDF de resultados.' },
      ],
    },
    conexiones: {
      titulo: 'Cómo se relaciona con el resto',
      aristas: [
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'recibe', que: 'El estado de resultados, con fusión no destructiva: traer nunca pisa una fila escrita a mano sin avisar.' },
        { otro: 'RRHH', slug: 'rrhh', direccion: 'recibe', que: 'El equipo, precargado.' },
        { otro: 'Asistente IA', slug: 'asistente-ia', direccion: 'recibe', que: 'Redacta, revisa y traduce la prosa. Las cifras las calcula CLAUX, no la IA.' },
        { otro: 'Varios dossiers', slug: 'varios-dossiers', direccion: 'entrega', que: 'Cuántos caben lo dice el nivel: con sitio para más, cada dossier lleva su relato y su enlace.' },
      ],
    },
    capas: {
      titulo: 'Funciona solo; se llena solo',
      nucleo: [
        'Presentación publicada por enlace',
        'Estado de resultados en PDF',
        'Marca propia del dossier',
        'Versión en inglés',
        'Contador de aperturas',
      ],
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'trae los números en vez de teclearlos' },
        { de: 'RRHH', slug: 'rrhh', aporta: 'precarga el equipo' },
        { de: 'Asistente IA', slug: 'asistente-ia', aporta: 'redacta y traduce los textos' },
        { de: 'Varios dossiers', slug: 'varios-dossiers', aporta: 'tener varios a la vez, si el nivel da sitio' },
      ],
    },
  },

  // ── Asistente IA (addon) ────────────────────────────────────────────────────
  'asistente-ia': {
    flujo: {
      titulo: 'Por dentro: la IA propone, el dueño decide',
      pasos: [
        { titulo: 'Tus datos', detalle: 'La IA lee lo que ya hay en el negocio, no un caso genérico.' },
        { titulo: 'Propuesta', detalle: 'Redacta, autocompleta o señala lo que se sale de lo normal.' },
        { titulo: 'Revisión', detalle: 'El dueño confirma, corrige o descarta.' },
        { titulo: 'Aplicado', detalle: 'Solo entonces se escribe algo. La IA nunca confirma sola.' },
      ],
    },
    conexiones: {
      titulo: 'Dónde ayuda, módulo a módulo',
      // El addon no «recibe» de estos módulos: actúa dentro de ellos. De ahí el
      // rótulo propio: «Le entra de» leería la flecha justo al revés.
      salidaTitulo: 'Actúa dentro de',
      aristas: [
        { otro: 'RRHH', slug: 'rrhh', direccion: 'entrega', que: 'Repasa el borrador de nómina antes de confirmar y explica el recibo al trabajador.' },
        { otro: 'Inventario', slug: 'inventario', direccion: 'entrega', que: 'Autocompleta la ficha del producto y permite el conteo dictado.' },
        { otro: 'Catálogo digital', slug: 'catalogo-digital', direccion: 'entrega', que: 'Rellena la descripción y los datos del ítem.' },
        { otro: 'Citas y Reservas', slug: 'citas', direccion: 'entrega', que: 'El bot pasa de botones a entender lenguaje natural.' },
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'entrega', que: 'Consejos con datos propios en Ventas, Gastos, Reportes y Tesorería.' },
        { otro: 'Dossier', slug: 'dossier', direccion: 'entrega', que: 'Redacta, revisa la coherencia y traduce los textos.' },
      ],
    },
    capas: {
      titulo: 'Qué hace con poco, y qué gana con cada módulo',
      nucleoTitulo: 'Con el addon solo',
      aportesTitulo: 'Y gana un sitio más por cada módulo que haya…',
      nucleo: [
        'Chat del dueño en lenguaje normal',
        'Consejos con datos propios',
      ],
      aportes: [
        { de: 'RRHH', slug: 'rrhh', aporta: 'repaso de la nómina y explicación del recibo' },
        { de: 'Inventario', slug: 'inventario', aporta: 'autocompletado de fichas y conteo dictado' },
        { de: 'Citas y Reservas', slug: 'citas', aporta: 'un bot que entiende lenguaje natural' },
        { de: 'Dossier', slug: 'dossier', aporta: 'redacción y traducción del documento' },
      ],
    },
  },

  // ── Varias empresas (capacidad del nivel) ───────────────────────────────────
  // Fue el addon `multiempresa`: cuántas caben lo dice ahora `nivel_limites`.
  'varias-empresas': {
    flujo: {
      titulo: 'Por dentro: varias empresas, un solo dueño',
      pasos: [
        { titulo: 'Alta', detalle: 'Cada empresa con sus datos y su letra de facturación.' },
        { titulo: 'Trabajo', detalle: 'Se elige en cuál se está y se trabaja ahí dentro.' },
        { titulo: 'Separación', detalle: 'Facturación, numeración, nómina y terceros son de cada una.' },
        { titulo: 'Consolidado', detalle: 'Reportes las suma en la moneda de configuración, y lo señala.' },
      ],
    },
    conexiones: {
      titulo: 'Qué cambia en cada módulo',
      salidaTitulo: 'Cambia',
      aristas: [
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'entrega', que: 'Cada empresa con su facturación, su numeración y su Tesorería; Reportes añade la vista consolidada.' },
        { otro: 'RRHH', slug: 'rrhh', direccion: 'entrega', que: 'La nómina pasa a ser por empresa, con su propio modelo fiscal.' },
        { otro: 'Clientes y proveedores', direccion: 'entrega', que: 'Cada tercero tiene ficha por empresa; el selector siempre dice de cuál.' },
      ],
    },
    capas: {
      titulo: 'Qué enciende, y sobre qué',
      nucleoTitulo: 'Lo que añade tener varias',
      aportesTitulo: 'Y se nota sobre todo si hay…',
      nucleo: [
        'Varias empresas bajo el mismo acceso, hasta donde llegue el nivel',
        'Numeración independiente',
        'Reparto de acceso por empresa',
        'Vista consolidada',
      ],
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'la vista consolidada de todas las empresas' },
        { de: 'RRHH', slug: 'rrhh', aporta: 'una nómina y un modelo fiscal por empresa' },
      ],
    },
  },

  // ── Varios dossiers (capacidad del nivel) ───────────────────────────────────
  // Fue el addon `multidossier`. Sin «capas»: una capacidad que solo existe sobre
  // el Dossier no puede afirmar que funciona sola, y fingir un núcleo propio sería
  // mentir en el diagrama.
  'varios-dossiers': {
    flujo: {
      titulo: 'Por dentro: de un documento a una colección',
      pasos: [
        { titulo: 'Dossier único', detalle: 'Con tope de uno, un documento y un enlace.' },
        { titulo: 'Listado', detalle: 'Con sitio para más, la página pasa a ser una lista.' },
        { titulo: 'Duplicar', detalle: 'Una copia del contenido para no partir de cero.' },
        { titulo: 'Enlace propio', detalle: 'Cada dossier publica el suyo, nunca el del original.' },
      ],
    },
    conexiones: {
      titulo: 'De qué depende y en qué lo convierte',
      entradaTitulo: 'Requiere',
      salidaTitulo: 'Y lo convierte en',
      aristas: [
        { otro: 'Dossier', slug: 'dossier', direccion: 'recibe', que: 'Es su requisito: sin la funcionalidad Dossier no hay nada de lo que tener varios.' },
        { otro: 'Un listado de dossiers', slug: 'dossier', direccion: 'entrega', que: 'El documento único pasa a ser una lista: cada dossier con su relato, su marca y su enlace propio.' },
      ],
    },
  },

  // ── Piezas transversales ────────────────────────────────────────────────────
  // No se contratan: vienen con todo CLAUX. Por eso sus diagramas de `capas` van
  // al revés que los de un módulo —lo que aportan los demás no es funcionalidad
  // que les falte, sino sitios donde su trabajo se nota—.
  'monedas-y-tasas': {
    flujo: {
      titulo: 'Por dentro: de la moneda a la cifra convertida',
      pasos: [
        { titulo: 'Monedas', detalle: 'Se dan de alta las monedas con las que trabaja el negocio: CUP, MLC, USD, EUR…' },
        { titulo: 'Pares de cambio', detalle: 'En cuanto hay dos monedas, su par aparece solo. No hay que crearlo.' },
        { titulo: 'Fuente de la tasa', detalle: 'Cada par toma su tasa de El Toque (informal, contra el peso), del mercado internacional o a mano.' },
        { titulo: 'Actualización', detalle: 'Las automáticas se refrescan solas cada madrugada, y hay un botón para pedirlo al momento.' },
        { titulo: 'Conversión', detalle: 'Cualquier importe se expresa en la moneda de consolidación con la tasa vigente, y se dice que está convertido.' },
      ],
    },
    conexiones: {
      titulo: 'Quién trabaja con las monedas',
      entradaTitulo: 'De aquí sale la tasa',
      salidaTitulo: 'Y la usan',
      aristas: [
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'entrega', que: 'La moneda de cada factura, gasto y movimiento de tesorería, y la conversión de los reportes.' },
        { otro: 'Inventario', slug: 'inventario', direccion: 'entrega', que: 'La moneda de cada compra y el coste con el que se valora lo que entra.' },
        { otro: 'Punto de venta', slug: 'punto-de-venta', direccion: 'entrega', que: 'Las monedas que acepta cada punto de venta y el cambio que da al cobrar.' },
        { otro: 'RRHH', slug: 'rrhh', direccion: 'entrega', que: 'La moneda de cada contrato y de cada nómina, que no tiene por qué ser una sola.' },
        { otro: 'Clientes y proveedores', slug: 'clientes-y-proveedores', direccion: 'entrega', que: 'La moneda con la que se trabaja por defecto con cada uno.' },
        { otro: 'Dashboard', slug: 'dashboard', direccion: 'ambos', que: 'La tarjeta de tasas, que enseña la edad de cada una y permite actualizarlas ahí mismo.' },
      ],
    },
    capas: {
      titulo: 'Qué hace sola y dónde se nota',
      nucleoTitulo: 'Funciona desde el primer día, sin contratar nada',
      nucleo: [
        'Alta de las monedas del negocio, con su código, su nombre y su símbolo',
        'Pares de cambio generados solos en cuanto hay dos monedas',
        'Tasa automática contra el peso cubano, tasa automática internacional o tasa a mano',
        'Actualización sola cada madrugada, antes de abrir el negocio',
        'Moneda de consolidación: en cuál se expresan los totales',
        'Aviso de tasa vieja, con los días que lleva sin refrescarse',
      ],
      aportesTitulo: 'Y cada módulo contratado le da un sitio donde trabajar',
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'Facturas, gastos y tesorería en la moneda que toque, sumados en el reporte.' },
        { de: 'Inventario', slug: 'inventario', aporta: 'Compras a proveedor en su moneda, con el coste convertido.' },
        { de: 'Punto de venta', slug: 'punto-de-venta', aporta: 'Cobro en mostrador en varias monedas a la vez.' },
        { de: 'RRHH', slug: 'rrhh', aporta: 'Salarios pactados en divisa junto a los de peso.' },
        { de: 'Notificaciones', slug: 'notificaciones', aporta: 'Aviso en la campana el día que una tasa cambia de verdad.' },
      ],
    },
  },

  'clientes-y-proveedores': {
    flujo: {
      titulo: 'Por dentro: de la ficha al historial',
      pasos: [
        { titulo: 'Ficha', detalle: 'Nombre, identificación, representante, teléfono, dirección. Cliente, proveedor o las dos cosas.' },
        { titulo: 'Condiciones', detalle: 'Cómo paga, cuánto crédito se le da, en qué moneda se trabaja y por qué vía se cobra.' },
        { titulo: 'Contrato', detalle: 'Número, fechas de inicio y fin y el documento firmado, con aviso cuando se acerca el final.' },
        { titulo: 'Su actividad', detalle: 'Sus productos, sus suscripciones y lo que se le debe, cada uno en su pestaña.' },
        { titulo: 'Historial', detalle: 'Lo vendido y lo comprado mes a mes, para saber qué representa de verdad ese nombre.' },
      ],
    },
    conexiones: {
      titulo: 'Cómo se relaciona con el resto',
      aristas: [
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'ambos', que: 'Le pone nombre a cada factura y a cada gasto, y recibe de vuelta la deuda de cada uno.' },
        { otro: 'Inventario', slug: 'inventario', direccion: 'ambos', que: 'El proveedor de cada compra, y de vuelta qué productos se le compran.' },
        { otro: 'Servicios', slug: 'servicios', direccion: 'entrega', que: 'El cliente de cada acuerdo recurrente que factura solo.' },
        { otro: 'Monedas y tasas', slug: 'monedas-y-tasas', direccion: 'recibe', que: 'La moneda con la que se trabaja por defecto con cada uno.' },
        { otro: 'Notificaciones', slug: 'notificaciones', direccion: 'entrega', que: 'Contrato a punto de vencer y límite de crédito superado.' },
        { otro: 'Varias empresas', slug: 'varias-empresas', direccion: 'recibe', que: 'La ficha es de una empresa; se copia a otra cuando el mismo cliente compra a las dos.' },
      ],
    },
    capas: {
      titulo: 'Qué hace sola y qué le añade cada módulo',
      nucleoTitulo: 'Funciona desde el primer día, sin contratar nada',
      nucleo: [
        'Agenda de a quién se le vende y a quién se le compra, con sus datos de contacto',
        'Identificación fiscal, representante y cargo, para el documento formal',
        'Condición de pago, límite de crédito y moneda de trabajo de cada uno',
        'Vías de cobro y pago habituales',
        'Contrato con número, fechas y documento adjunto',
        'Archivar sin borrar: deja de ofrecerse, pero su historial no se toca',
      ],
      aportesTitulo: 'Y cada módulo le añade contenido',
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'Facturas emitidas, lo que debe y lo que se le debe.' },
        { de: 'Inventario', slug: 'inventario', aporta: 'Compras hechas y qué productos entran por él.' },
        { de: 'Servicios', slug: 'servicios', aporta: 'Acuerdos recurrentes activos y su próximo cobro.' },
        { de: 'Varias empresas', slug: 'varias-empresas', aporta: 'La misma persona con ficha propia en cada empresa.' },
      ],
    },
  },

  dashboard: {
    flujo: {
      titulo: 'Por dentro: cuatro zonas, de lo urgente a lo general',
      pasos: [
        { titulo: 'Pendiente', detalle: 'Lo accionable de todos los módulos junto: una línea por cosa que hay que atender hoy.' },
        { titulo: 'Tu dinero', detalle: 'Cómo va el negocio, qué hay que cobrar y pagar, y con qué tasas se están convirtiendo esas cifras.' },
        { titulo: 'Tu día', detalle: 'Lo que pasa hoy: reservas, citas y lo que lleva cobrado el mostrador.' },
        { titulo: 'Tu negocio', detalle: 'Lo que se mueve despacio: existencias, personal, acuerdos, catálogo y dossier.' },
      ],
    },
    conexiones: {
      titulo: 'De dónde saca lo que enseña',
      entradaTitulo: 'Le entra de',
      salidaTitulo: 'Y devuelve',
      aristas: [
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'recibe', que: 'Resultado del mes, cobros y pagos pendientes por tramo.' },
        { otro: 'Monedas y tasas', slug: 'monedas-y-tasas', direccion: 'ambos', que: 'La edad de cada tasa, y el botón para actualizarlas sin salir de aquí.' },
        { otro: 'Punto de venta', slug: 'punto-de-venta', direccion: 'recibe', que: 'Lo cobrado hoy y las cajas que quedaron sin cerrar.' },
        { otro: 'Reservas', slug: 'reservas', direccion: 'recibe', que: 'Las del día y las que están sin confirmar.' },
        { otro: 'Inventario', slug: 'inventario', direccion: 'recibe', que: 'Lo que está bajo mínimos y el valor de lo que hay.' },
        { otro: 'RRHH', slug: 'rrhh', direccion: 'recibe', que: 'Plantilla, contratos por vencer y la nómina del mes.' },
      ],
    },
    capas: {
      titulo: 'Qué hace solo y qué le añade cada módulo',
      nucleoTitulo: 'Funciona desde el primer día, sin contratar nada',
      nucleo: [
        'Saludo con el nombre del negocio, la fecha y el estado de la suscripción',
        'Las empresas del negocio, cada una con su color',
        'Qué falta para poder operar: crear la empresa y configurar una moneda',
        'Accesos rápidos mientras no haya ningún panel que enseñar',
        'Qué más se puede activar, con lo que le falta al negocio y sin repetir lo ya pedido',
      ],
      aportesTitulo: 'Y cada módulo aporta su tarjeta a la zona que le toca',
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'La tarjeta ancha de «Tu dinero» y la de cobros y pagos.' },
        { de: 'Punto de venta', slug: 'punto-de-venta', aporta: 'Lo cobrado hoy, en «Tu día».' },
        { de: 'Reservas', slug: 'reservas', aporta: 'La agenda del día, en «Tu día».' },
        { de: 'Citas', slug: 'citas', aporta: 'Las citas del día, en «Tu día».' },
        { de: 'Inventario', slug: 'inventario', aporta: 'Existencias y bajo mínimos, en «Tu negocio».' },
        { de: 'RRHH', slug: 'rrhh', aporta: 'Plantilla y nómina, en «Tu negocio».' },
      ],
    },
  },

  notificaciones: {
    flujo: {
      titulo: 'Por dentro: del hecho al aviso atendido',
      pasos: [
        { titulo: 'Algo pasa', detalle: 'Una fecha se acerca, un umbral se cruza o entra una reserva. Nadie lo teclea.' },
        { titulo: 'Nivel', detalle: 'Informativo va a la campana; aviso salta en una tarjeta que se cierra sola; urgente se queda en rojo hasta que se atiende.' },
        { titulo: 'Dónde se ve', detalle: 'Campana en la cabecera, tarjeta arriba a la derecha y la bandeja completa en Notificaciones.' },
        { titulo: 'Se resuelve solo', detalle: 'Cuando el motivo deja de existir —la factura se cobra—, el aviso se archiva sin que nadie lo cierre.' },
        { titulo: 'Se limpia sola', detalle: 'Lo leído y lo archivado de hace más de tres meses desaparece: la bandeja no crece para siempre.' },
      ],
    },
    conexiones: {
      titulo: 'Quién le manda avisos',
      entradaTitulo: 'Le avisan',
      salidaTitulo: 'Y avisa a',
      aristas: [
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'recibe', que: 'Cobros y pagos vencidos, y ofertas a punto de caducar.' },
        { otro: 'Clientes y proveedores', slug: 'clientes-y-proveedores', direccion: 'recibe', que: 'Contrato a punto de vencer y límite de crédito superado.' },
        { otro: 'Inventario', slug: 'inventario', direccion: 'recibe', que: 'Existencias bajo mínimos.' },
        { otro: 'RRHH', slug: 'rrhh', direccion: 'recibe', que: 'Contratos por vencer, documentos caducados, cumpleaños y la nómina del mes.' },
        { otro: 'Punto de venta', slug: 'punto-de-venta', direccion: 'recibe', que: 'Caja que se quedó sin cerrar.' },
        { otro: 'Reservas', slug: 'reservas', direccion: 'recibe', que: 'Reserva entrante, cancelación del cliente y resumen del día.' },
        { otro: 'Monedas y tasas', slug: 'monedas-y-tasas', direccion: 'recibe', que: 'Aviso el día que una tasa cambia de verdad.' },
      ],
    },
    capas: {
      titulo: 'Qué hace sola y qué le añade cada módulo',
      nucleoTitulo: 'Funciona desde el primer día, sin contratar nada',
      nucleo: [
        'Bandeja del negocio, compartida: lo que uno atiende lo ven todos',
        'Tres niveles, según lo que se pueda esperar: informativo, aviso y urgente',
        'Campana en la cabecera y tarjeta emergente para lo que no puede esperar',
        'Preferencias: qué se avisa y qué no',
        'Avisos de la propia suscripción a CLAUX, se contrate lo que se contrate',
      ],
      aportesTitulo: 'Y cada módulo contratado le añade sus avisos',
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'Vencimientos de cobro y pago, y ofertas que caducan.' },
        { de: 'Inventario', slug: 'inventario', aporta: 'Bajo mínimos.' },
        { de: 'RRHH', slug: 'rrhh', aporta: 'Contratos, documentos, cumpleaños y nómina.' },
        { de: 'Servicios', slug: 'servicios', aporta: 'Acuerdos por vencer y cobros del mes.' },
        { de: 'Reservas', slug: 'reservas', aporta: 'Peticiones entrantes y el resumen del día.' },
      ],
    },
  },

  // ── Parte I: la plataforma y sus recorridos ─────────────────────────────────
  // Estas entradas NO son fichas del catálogo: son los diagramas del marco
  // general. El Markdown las llama por clave —```claux:flujo:recorrido-venta```—
  // en lugar de por el slug de la ficha en la que están.

  plataforma: {
    capas: {
      titulo: 'Cómo se arma un CLAUX',
      nucleoTitulo: 'Todo CLAUX trae esto, se contrate lo que se contrate',
      nucleo: [
        'Un espacio propio, aislado del de los demás negocios',
        'Los datos de la empresa y su marca',
        'Usuarios, con permisos por persona',
        'Las monedas del negocio y sus tasas de cambio',
        'Avisos en la campana',
        'El sector, que fija cómo se llaman las cosas',
      ],
      aportesTitulo: 'Y sobre esa base se enciende lo que el negocio necesite',
      aportes: [
        { de: 'Contabilidad', slug: 'contabilidad', aporta: 'El dinero: facturas, gastos, quién debe, quién cobra y si se gana.' },
        { de: 'Inventario', slug: 'inventario', aporta: 'Qué hay, dónde está y a cuánto salió.' },
        { de: 'Servicios', slug: 'servicios', aporta: 'Lo que se cobra por hacer, y los cobros que se repiten solos.' },
        { de: 'RRHH', slug: 'rrhh', aporta: 'El personal, sus turnos y la nómina.' },
        { de: 'Punto de venta', slug: 'punto-de-venta', aporta: 'Cobrar en el mostrador, incluso sin conexión.' },
        { de: 'Menú / catálogo digital', slug: 'catalogo-digital', aporta: 'La carta o el catálogo del negocio, por QR y desde el móvil.' },
        { de: 'Citas', slug: 'citas', aporta: 'La agenda: quién atiende a quién y cuándo.' },
        { de: 'Reservas', slug: 'reservas', aporta: 'Mesas, pistas o clases, con su aforo y sus horarios.' },
        { de: 'Dossier', slug: 'dossier', aporta: 'El negocio presentado en una página con enlace propio.' },
      ],
    },
  },

  'recorrido-venta': {
    flujo: {
      titulo: 'Recorrido: de una venta al dinero en la cuenta',
      pasos: [
        { titulo: 'Se prepara la factura', detalle: 'En Ventas, con sus líneas. Si se enlazan al catálogo, queda congelado el coste y puede verse el margen.' },
        { titulo: 'Se emite', detalle: 'Toma su número. Si esa factura lo marca, descuenta existencias del almacén elegido: es una decisión de la factura, no una configuración general.' },
        { titulo: 'Queda por cobrar', detalle: 'Aparece en Cuentas por cobrar mientras le quede saldo. Nadie la marca como vencida: se calcula.' },
        { titulo: 'Se cobra', detalle: 'El cobro escribe un movimiento en Tesorería apuntando a esa factura. Lo pendiente es la resta, no una casilla.' },
        { titulo: 'Suma en los números del negocio', detalle: 'Dashboard y Reportes, convertido a la moneda de consolidación con la tasa vigente.' },
      ],
    },
  },

  'recorrido-caja': {
    flujo: {
      titulo: 'Recorrido: de la caja sin conexión a los libros',
      pasos: [
        { titulo: 'Se vende sin línea', detalle: 'El punto de venta cobra y cierra contra su propia copia en el móvil o la tablet, con internet o sin él.' },
        { titulo: 'Se sincroniza', detalle: 'Al volver la conexión suben los tickets, los movimientos de efectivo y los turnos, incluido el que sigue abierto.' },
        { titulo: 'El cierre saca el dinero de la caja', detalle: 'Al cerrar el turno, quien tenga Contabilidad recibe un ingreso en Tesorería por cada moneda y su destino, y un cobro resumen; con Inventario, la salida de cada producto.' },
        { titulo: 'Nada se duplica', detalle: 'Volver a sincronizar, o subir otra vez el mismo archivo, no repite un ticket ni un cierre: cada pieza se reconoce.' },
        { titulo: 'Y si nadie cerró el turno', detalle: 'Se fue la luz, se perdió el móvil: esas ventas aparecen en Cierres como sin contabilizar y el dueño las cierra desde el portal, con la fecha del último ticket.' },
      ],
    },
  },

  'recorrido-reserva': {
    flujo: {
      titulo: 'Recorrido: de la petición a la visita atendida',
      pasos: [
        { titulo: 'Entra por una de tres puertas', detalle: 'La web pública del negocio, el bot de Telegram o el alta manual del dueño. Las tres pasan por las mismas reglas: antelación, aforo, horarios y días cerrados.' },
        { titulo: 'El dueño puede forzar; el público no', detalle: 'En el alta manual el sistema avisa de qué regla se saltaría y deja pasar, dejando constancia de que se forzó. Por los canales públicos no se ofrece siquiera.' },
        { titulo: 'Se avisa a los dos lados', detalle: 'Al dueño, campana y Telegram. Al cliente, su propio enlace para cancelar o cambiar, y un botón que abre el chat con el mensaje ya redactado.' },
        { titulo: 'Se confirma o se rechaza', detalle: 'El estado manda lo que puede hacerse después. Deshacer una cancelación solo cabe con fecha futura y volviendo a comprobar el aforo: el hueco puede estar dado ya.' },
        { titulo: 'El pasado lo cierra el sistema', detalle: 'Cada madrugada: lo pendiente que ya pasó caduca, y lo confirmado pasa a atendido, marcado como cierre automático para que se sepa que no lo hizo el dueño.' },
      ],
    },
  },

  // ── Parte III: el recorrido comercial ───────────────────────────────────────
  embudo: {
    flujo: {
      titulo: 'El recorrido: del primer contacto al cliente que paga',
      pasos: [
        { titulo: 'Llega el interesado', detalle: 'Por el diagnóstico de la web, que le pregunta sector, qué necesita y cómo lo lleva hoy, y le devuelve un informe con lo que le encaja.' },
        { titulo: 'Aparece como solicitud', detalle: 'El lead cae en el panel interno con todo lo que respondió. Nadie transcribe nada.' },
        { titulo: 'Se le arma el presupuesto', detalle: 'La calculadora separa el pago único de la puesta en marcha de la cuota mensual, y sale en PDF con la marca.' },
        { titulo: 'Aprobado, se da de alta', detalle: 'El alta se abre con los módulos del presupuesto ya marcados: no se vuelve a elegir, ni se puede elegir otra cosa por descuido.' },
        { titulo: 'Empieza a contar al cobrar', detalle: 'El cliente nace desactivado y se activa al confirmar el primer cobro, o dándole un plazo de gracia.' },
        { titulo: 'Y sigue creciendo', detalle: 'Desde su portal el dueño pide ampliaciones con un «Me interesa», que vuelve al panel como una solicitud más.' },
      ],
    },
  },

  necesidades: {
    conexiones: {
      titulo: 'De lo que dice el dueño a lo que se le ofrece',
      hub: 'Lo que el dueño dice que necesita',
      salidaTitulo: 'El módulo que lo resuelve',
      aristas: [
        { otro: 'Contabilidad', slug: 'contabilidad', direccion: 'entrega', que: '«Quiero llevar las cuentas de mi negocio.»' },
        { otro: 'Inventario', slug: 'inventario', direccion: 'entrega', que: '«Quiero controlar mi inventario y mis compras.»' },
        { otro: 'Servicios', slug: 'servicios', direccion: 'entrega', que: '«Vendo servicios y los cobro cada período.»' },
        { otro: 'Reservas y Citas', slug: 'reservas', direccion: 'entrega', que: '«Quiero mejorar mis reservas o mis citas.»' },
        { otro: 'Catálogo digital', slug: 'catalogo-digital', direccion: 'entrega', que: '«Quiero digitalizar mi menú o mi catálogo.»' },
        { otro: 'RRHH', slug: 'rrhh', direccion: 'entrega', que: '«Quiero gestionar mis empleados y la nómina.»' },
        { otro: 'Punto de venta', slug: 'punto-de-venta', direccion: 'entrega', que: '«Quiero cobrar y llevar la caja del día.»' },
        { otro: 'Asistente IA', slug: 'asistente-ia', direccion: 'entrega', que: '«Quiero atender a mis clientes por chat.»' },
        { otro: 'Dossier del negocio', slug: 'dossier', direccion: 'entrega', que: '«Quiero enseñarle mis números a un inversor.»' },
      ],
    },
  },

  presupuesto: {
    flujo: {
      titulo: 'Cómo se arma el precio de una instalación',
      pasos: [
        { titulo: 'Se eligen los módulos', detalle: 'De ahí sale la cuota mensual, que se lee del catálogo en vivo y no se teclea en el presupuesto.' },
        { titulo: 'Se marcan las fases que hacen falta', detalle: 'Alta y configuración · Puesta en marcha · Formación · Validación y cierre. La que no aplica se desmarca y desaparece del papel, no sale a cero.' },
        { titulo: 'Se declara el volumen real', detalle: 'Cuántos productos, cuántos empleados, cuántos clientes. Las horas suben por tramos: migrar veinte productos no es migrar cinco mil.' },
        { titulo: 'Todo se convierte en horas', detalle: 'No hay recargos sueltos en dólares. Horas × tarifa, con una tarifa por hora que se puede negociar por cliente.' },
        { titulo: 'Y si hay descuento, lleva motivo', detalle: 'El margen comercial existe y queda escrito, en vez de bajar el número sin dejar rastro.' },
        { titulo: 'Sale el PDF', detalle: 'Con la marca de CLAUX, eligiendo qué se le enseña al cliente. Pago único arriba, cuota mensual aparte.' },
      ],
    },
  },
  // ── Parte IV: poner en marcha y sostener ────────────────────────────────────
  alta: {
    flujo: {
      titulo: 'Recorrido: del presupuesto aprobado al negocio funcionando',
      pasos: [
        { titulo: 'Se aprueba el presupuesto', detalle: 'El alta se abre con los módulos ya marcados. No se vuelven a elegir a mano, así que no puede acabar contratando algo distinto de lo que se le enseñó.' },
        { titulo: 'Nace la cuenta, todavía sin acceso', detalle: 'El cliente se crea suspendido —o en prueba, si se pactó—, con su sector, sus empresas y la contraseña temporal del administrador del negocio.' },
        { titulo: 'Se entra a configurarlo', detalle: 'El equipo abre el portal del cliente sin su contraseña para dejarlo montado: empresas, monedas, categorías, usuarios y permisos.' },
        { titulo: 'Se traen los datos de antes', detalle: 'Catálogo, clientes, proveedores, personal, existencias y el histórico de gastos y cobros, con el asistente de importación.' },
        { titulo: 'Se forma al equipo', detalle: 'Con sus propios datos ya dentro, que es lo que hace que la formación se quede.' },
        { titulo: 'Se activa al cobrar', detalle: 'Registrar el primer pago abre el acceso y fija la fecha de vencimiento. Hasta entonces el dueño ve la pantalla de cuenta suspendida.' },
      ],
    },
  },

  'ciclo-cliente': {
    flujo: {
      titulo: 'La vida de una cuenta: del alta a la renovación',
      pasos: [
        { titulo: 'Suspendido', detalle: 'Como nace. Los datos existen y el portal no abre. También es donde vuelve si deja de pagar.' },
        { titulo: 'Activo', detalle: 'Lo abre el primer cobro registrado. La fecha de vencimiento es la del final del período pagado, mensual o anual.' },
        { titulo: 'Aviso antes de vencer', detalle: 'El sistema escribe al administrador del negocio unos días antes —cuántos se configura— y deja el aviso en la bandeja del panel.' },
        { titulo: 'Período especial', detalle: 'Se concede a mano, con fecha de fin y motivo escrito. El cliente sigue trabajando; el motivo queda en su ficha.' },
        { titulo: 'Suspendido otra vez', detalle: 'Si vence el período especial o la fecha de expiración, la cuenta se cierra sola y queda registrado quién y por qué.' },
        { titulo: 'Y vuelve con un cobro', detalle: 'Registrar el pago reactiva la cuenta y recoloca la fecha. Nada se borra por el camino.' },
      ],
    },
  },

  migracion: {
    flujo: {
      titulo: 'Traer los datos de antes sin destrozar el histórico',
      pasos: [
        { titulo: 'Se elige qué se trae', detalle: 'Una cosa por vez: clientes y proveedores, catálogo, personal, existencias, gastos, cobros o acuerdos de servicios.' },
        { titulo: 'Se sube el archivo', detalle: 'Preferiblemente Excel: trae las celdas ya tipadas y desaparecen los acentos rotos y el «1.500» leído como 1,50. Hay plantilla descargable con fila de ejemplo.' },
        { titulo: 'Se dice qué columna es qué', detalle: 'El asistente propone el emparejado por el nombre de la cabecera; lo que no reconozca se señala a mano.' },
        { titulo: 'Se prueba sin escribir', detalle: 'La prueba enseña los totales por moneda, los errores agrupados por causa y lo que hay que decidir. Es lo único que caza un decimal mal leído a tiempo.' },
        { titulo: 'Se aplica en tandas', detalle: 'El trabajo se trocea y se ve avanzar. Reintentar un lote no reescribe lo ya escrito.' },
        { titulo: 'Y se puede deshacer', detalle: 'En los maestros se retira lo insertado, y solo si nadie lo usa ya; en el dinero se compensa con un movimiento de reverso, nunca borrando.' },
      ],
    },
  },

  // ── Parte V: el motor fiscal cubano ─────────────────────────────────────────
  'nomina-cuba': {
    flujo: {
      titulo: 'Del salario pactado al coste real de la empresa',
      pasos: [
        { titulo: 'Salario del contrato', detalle: 'Se congela al generar la nómina: es la foto del mes, y a partir de ahí nada de lo que se toque en la ficha la cambia.' },
        { titulo: 'Se ajusta por días', detalle: 'Quien entró el 20 o causó baja el 5 no cobra el mes entero. El ajuste entra como una línea propia que dice por qué cobra menos.' },
        { titulo: 'Se suma lo del mes', detalle: 'Nocturnidad, feriados, pago extra, vacaciones disfrutadas, penalizaciones. Con eso queda cerrado el DEVENGADO.' },
        { titulo: 'Se retiene al trabajador', detalle: 'Sobre el devengado ya cerrado. Lo retenido no es un ahorro de la empresa: es dinero del trabajador que se le ingresa a la agencia tributaria.' },
        { titulo: 'Y la empresa aporta encima', detalle: 'Los aportes de empresa no se le descuentan a nadie: se pagan por encima del devengado y son coste puro.' },
        { titulo: 'Coste real', detalle: 'Devengado + aportes + la acumulación de vacaciones del mes. Nunca el neto: quien lee el neto se cree que la plantilla cuesta menos de lo que cuesta.' },
      ],
    },
  },

}
