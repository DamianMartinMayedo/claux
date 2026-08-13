// ── El catálogo de cuentas por defecto ───────────────────────────────────────
//
// Las 19 raíces y las 93 subcategorías del clasificador, en CÓDIGO y no en base
// de datos. La razón es §9.5 de la especificación: `conceptos_pl` se deriva de la
// DEFINICIÓN GLOBAL del pack, no de las filas del tenant — un cliente sin el
// módulo de Contabilidad no tiene `categorias_gastos` sembradas y aun así
// necesita conceptos en su dossier. Si el catálogo viviera en una tabla del
// tenant, ese cliente no tendría nada que leer.
//
// Especificación: `clasificador-cuentas-parte1-v2` (Claudia) · plan de
// implementación: docs/planes/clasificador-cuentas-feedback.md
//
// ── Las dos claves, que no son la misma ──────────────────────────────────────
//
//   clave (clave_catalogo)  → «esta fila es tal entrada del pack». Identidad para
//                             la semilla. NO protege: lo sembrado se renombra, se
//                             archiva y se borra.
//   claveSistema            → «aquí escribe un módulo». Implica es_sistema, y eso
//                             es irreversible desde la interfaz.
//
// Una entrada puede tener las dos (Salarios), solo la primera (la mayoría) o solo
// la segunda (nada hoy: toda clave de sistema tiene su sitio en el catálogo).
//
// ── Por fases ────────────────────────────────────────────────────────────────
// Cada entrada declara su fase. La Fase 1 solo siembra gasto de resultado con los
// cuatro roles que ya existen en el CHECK de `categorias_gastos.rol_pl`; el resto
// del catálogo está escrito para que las fases 2-4 no lo vuelvan a escribir.

/** Los once destinos. Los cuatro primeros existen hoy en la BD; el resto entra por fases. */
export type RolCatalogo =
  | 'COSTE_VENTAS'      // renglón «Coste de ventas»          — existe
  | 'PERSONAL'          // renglón «Personal»                 — existe
  | 'OPERATIVO'         // renglón «Gastos operativos»        — existe
  | 'OTRO'              // renglón «Otros» (lado gasto)       — existe
  | 'INGRESO_OPERATIVO' // renglón «Ingresos»                 — fase 3
  | 'INGRESO_OTRO'      // renglón «Otros» (lado ingreso)     — fase 4
  | 'DEPRECIACION'      // renglón «Depreciación»             — fase 4
  | 'IMPUESTO_UTILIDAD' // renglón «Impuesto sobre utilidades»— fase 4
  | 'INVERSION'         // fuera del resultado                — fase 2
  | 'PATRIMONIO'        // fuera del resultado                — fase 2
  | 'FINANCIACION'      // fuera del resultado                — fase 2

export type FaseCatalogo = 1 | 2 | 3 | 4

export interface RaizCatalogo {
  /** `clave_catalogo` de la raíz. Es también el ancla del que cuelgan sus hijas. */
  clave: string
  nombre: string
  rol: RolCatalogo
  fase: FaseCatalogo
  /**
   * Solo G1 y G2: un módulo (compras, CxP de servicios) acabará escribiendo en
   * esta raíz.
   *
   * 🔴 **Invariante: cuando hay `claveSistema`, `clave` vale exactamente lo
   * mismo.** No es cosmética. `cat_gasto_sistema` busca por `clave_catalogo`
   * (rama b′ de la mig. 185), así que sembrar la raíz con esa clave es lo que
   * hace que el módulo la ADOPTE en vez de crearse otra al lado — y otra raíz
   * `COSTE_VENTAS` partiría en dos el coste de ventas del informe. La semilla
   * sigue sin escribir `clave_sistema`: la fila nace tocable.
   */
  claveSistema?: string
  /** Encabezado propio en la pantalla de Categorías (§6 de la especificación). */
  fueraDelResultado?: true
}

export interface EntradaCatalogo {
  /** `clave_catalogo` de la subcategoría. */
  clave: string
  nombre: string
  /**
   * `clave` de su raíz. El `padre` que aparece aquí es el del catálogo; cuando
   * la entrada lleva `padreSegunPack`, el pack del sector lo sustituye.
   */
  padre: string
  /**
   * La raíz de la que cuelga depende del giro: un restaurante vende producción
   * propia y una tienda mercancía, pero el cierre de caja del TPV es el mismo
   * hecho. El pack decide; esto es solo el valor por defecto.
   */
  padreSegunPack?: true
  fase: FaseCatalogo
  /**
   * El módulo que acabará adoptando esta fila.
   *
   * 🔴 **La semilla NUNCA escribe `clave_sistema`.** Solo `clave_catalogo`. La
   * fila nace renombrable, archivable y borrable; deja de serlo el día que el
   * módulo la reclama por `cat_gasto_sistema`, que la encuentra justamente por
   * su `clave_catalogo` (rama b′ de la mig. 185). Sembrarla ya como de sistema
   * le quitaría al dueño una categoría que todavía no usa nadie.
   */
  claveSistema?: string
  /**
   * Existe en el catálogo pero la semilla no la crea: nadie la anota a mano
   * nunca, y el módulo la crea sola al primer uso. Sembrarla sería llenarle la
   * pantalla de filas que no puede ni tocar ni entender.
   */
  nuncaSembrar?: true
  /** Va a `descripcion` al sembrar. El dueño puede editarla (`descripcion_editada`). */
  ayuda: string
  /** Solo para la interfaz: el contraste es la mitad de la enseñanza. */
  noVa?: string
}

// ── Raíces ───────────────────────────────────────────────────────────────────

export const RAICES: RaizCatalogo[] = [
  // Ingresos (fase 3). Las cuatro operativas son seleccionables directamente para
  // un cobro sin factura; su desglose comercial lo da el catálogo de productos.
  { clave: 'ing_mercancias',    nombre: 'Venta de mercancías',   rol: 'INGRESO_OPERATIVO', fase: 3 },
  { clave: 'ing_produccion',    nombre: 'Producción propia',     rol: 'INGRESO_OPERATIVO', fase: 3 },
  { clave: 'ing_servicios',     nombre: 'Servicios prestados',   rol: 'INGRESO_OPERATIVO', fase: 3 },
  { clave: 'ing_alquileres',    nombre: 'Alquileres',            rol: 'INGRESO_OPERATIVO', fase: 3 },
  { clave: 'ing_otros',         nombre: 'Otros ingresos',        rol: 'INGRESO_OTRO',      fase: 4 },

  // Gastos que van al resultado.
  { clave: 'compras',       nombre: 'Compras y mercancía',            rol: 'COSTE_VENTAS', fase: 1, claveSistema: 'compras' },
  { clave: 'servicios_terceros', nombre: 'Servicios para producir o vender', rol: 'COSTE_VENTAS', fase: 1, claveSistema: 'servicios_terceros' },
  { clave: 'gas_personal',      nombre: 'Personal',                       rol: 'PERSONAL',     fase: 1 },
  { clave: 'gas_local',         nombre: 'Local y servicios básicos',      rol: 'OPERATIVO',    fase: 1 },
  { clave: 'gas_transporte',    nombre: 'Transporte y logística',         rol: 'OPERATIVO',    fase: 1 },
  { clave: 'gas_comercial',     nombre: 'Comercial y publicidad',         rol: 'OPERATIVO',    fase: 1 },
  { clave: 'gas_admin',         nombre: 'Administración y oficina',       rol: 'OPERATIVO',    fase: 1 },
  { clave: 'gas_impuestos_op',  nombre: 'Impuestos de la operación',      rol: 'OPERATIVO',    fase: 1 },
  { clave: 'gas_otros',         nombre: 'Financieros y extraordinarios',  rol: 'OTRO',         fase: 1 },
  { clave: 'gas_imp_utilidad',  nombre: 'Impuesto sobre utilidades',      rol: 'IMPUESTO_UTILIDAD', fase: 4 },
  { clave: 'gas_devengos',      nombre: 'Depreciación y provisiones',     rol: 'DEPRECIACION', fase: 4 },

  // Fuera del resultado (fase 2). Encabezado propio: «Movimientos que no afectan
  // tu resultado». El encabezado es parte de la enseñanza, no decoración.
  { clave: 'inv_bienes',        nombre: 'Inversiones del negocio', rol: 'INVERSION',    fase: 2, fueraDelResultado: true },
  { clave: 'pat_dueno',         nombre: 'Movimientos del dueño',   rol: 'PATRIMONIO',   fase: 2, fueraDelResultado: true },
  { clave: 'fin_prestamos',     nombre: 'Préstamos y financiación', rol: 'FINANCIACION', fase: 2, fueraDelResultado: true },
]

// ── Subcategorías ────────────────────────────────────────────────────────────

export const ENTRADAS: EntradaCatalogo[] = [
  // G1 · Compras y mercancía — COSTE_VENTAS
  { clave: 'gas_mercancia',          nombre: 'Mercancía para reventa',            padre: 'compras', fase: 1, ayuda: 'Productos comprados hechos para vender igual.', noVa: 'Materiales que transformas → Materias primas' },
  { clave: 'gas_materias_primas',    nombre: 'Materias primas e insumos',         padre: 'compras', fase: 1, ayuda: 'Lo que se consume al producir o prestar el servicio.', noVa: 'Lo que dura años → Inversiones' },
  { clave: 'gas_envases',            nombre: 'Envases, embalaje y desechables',   padre: 'compras', fase: 1, ayuda: 'Bolsas, cajas, vasos, servilletas, etiquetas.', noVa: 'Envases retornables duraderos → Inversiones' },
  { clave: 'gas_flete_compra',       nombre: 'Fletes y traslado de compras',      padre: 'compras', fase: 1, ayuda: 'Traer lo que compraste.', noVa: 'Llevar a tus clientes → Reparto y mensajería' },
  { clave: 'gas_mermas',             nombre: 'Mermas, roturas y vencidos',        padre: 'compras', fase: 1, ayuda: 'Pérdida normal por deterioro o caducidad.', noVa: 'Robo o siniestro → Pérdidas por siniestro' },
  { clave: 'gas_energia_produccion', nombre: 'Energía y combustible de producción', padre: 'compras', fase: 1, ayuda: 'Energía consumida directamente al producir.', noVa: 'La luz del local → Electricidad' },

  // G2 · Servicios para producir o vender — COSTE_VENTAS
  { clave: 'gas_maquila',        nombre: 'Elaboración o maquila por terceros',      padre: 'servicios_terceros', fase: 1, ayuda: 'Alguien produce para ti parte de lo que vendes.', noVa: 'Un servicio administrativo → Servicios profesionales' },
  { clave: 'gas_comision_venta', nombre: 'Comisiones a vendedores e intermediarios', padre: 'servicios_terceros', fase: 1, ayuda: 'Comisión por venta conseguida.', noVa: 'De una app o pasarela → Comisiones de plataformas' },
  { clave: 'gas_alq_equipos_op', nombre: 'Alquiler de equipos de la operación',     padre: 'servicios_terceros', fase: 1, ayuda: 'Máquinas rentadas para producir o vender.', noVa: 'El local → Alquiler del local' },
  { clave: 'gas_subcontrata',    nombre: 'Subcontratación de mano de obra',        padre: 'servicios_terceros', fase: 1, ayuda: 'Cuadrillas o personas contratadas por obra.', noVa: 'Personal con nómina → Personal' },

  // G3 · Personal — PERSONAL
  // Las cuatro de sistema las escribe la nómina. Solo `salarios` se siembra: en
  // Cuba lo normal es pagar al personal sin nómina formal, y si no existe el
  // dueño se inventa «Pagos a empleados» y RRHH le crea un «Salarios» duplicado
  // después. Las otras tres no las anota nadie a mano nunca.
  { clave: 'salarios',                 nombre: 'Salarios',                             padre: 'gas_personal', fase: 1, claveSistema: 'salarios',                 ayuda: 'Salario devengado del período, menos las vacaciones disfrutadas. Lo escribe la nómina.' },
  { clave: 'vacaciones_acumuladas',    nombre: 'Vacaciones acumuladas',                padre: 'gas_personal', fase: 1, claveSistema: 'vacaciones_acumuladas',    nuncaSembrar: true, ayuda: 'Provisión mensual de vacaciones. Lo escribe la nómina; no mueve dinero.' },
  { clave: 'impuestos_salario',        nombre: 'Impuestos de salario',                 padre: 'gas_personal', fase: 1, claveSistema: 'impuestos_salario',        nuncaSembrar: true, ayuda: 'Tributo por emplear personal (IUFT). Lo escribe la nómina.', noVa: 'No va en Impuestos de la operación: es coste de tener plantilla' },
  { clave: 'contribucion_ss_empresa',  nombre: 'Contribución a la Seguridad Social',   padre: 'gas_personal', fase: 1, claveSistema: 'contribucion_ss_empresa',  nuncaSembrar: true, ayuda: 'Aporte del negocio a la Seguridad Social. Lo escribe la nómina.', noVa: 'Lo retenido al trabajador — no es gasto, va sin categoría' },
  { clave: 'gas_estimulacion',         nombre: 'Estimulación, bonos y propinas',       padre: 'gas_personal', fase: 1, ayuda: 'Pagos al personal fuera de nómina.', noVa: 'Salario formal → lo escribe la nómina' },
  { clave: 'gas_alimentacion_personal', nombre: 'Alimentación del personal',           padre: 'gas_personal', fase: 1, ayuda: 'Comida del equipo en jornada.', noVa: 'Comida que vendes → Materias primas' },
  { clave: 'gas_transporte_personal',  nombre: 'Transporte del personal',              padre: 'gas_personal', fase: 1, ayuda: 'Que tu gente llegue o se mueva.', noVa: 'Vehículos del negocio → Combustible de vehículos' },
  { clave: 'gas_ropa_trabajo',         nombre: 'Ropa de trabajo y protección',         padre: 'gas_personal', fase: 1, ayuda: 'Uniformes, guantes, calzado, cascos.', noVa: 'Ropa que vendes → Mercancía para reventa' },
  { clave: 'gas_capacitacion',         nombre: 'Capacitación y certificaciones',       padre: 'gas_personal', fase: 1, ayuda: 'Cursos y licencias profesionales del personal.', noVa: 'Licencias del negocio → Licencias y tasas' },
  { clave: 'gas_contratos_servicio',   nombre: 'Contratos por servicios',              padre: 'gas_personal', fase: 1, ayuda: 'Personas que facturan servicios puntuales, sin vínculo laboral.', noVa: 'Cuadrillas por obra → Subcontratación' },

  // G4 · Local y servicios básicos — OPERATIVO
  { clave: 'gas_alquiler',            nombre: 'Alquiler del local',            padre: 'gas_local', fase: 1, ayuda: 'Renta del espacio donde opera el negocio.', noVa: 'La luz y el agua, aunque las pagues con la renta' },
  { clave: 'gas_electricidad',        nombre: 'Electricidad',                  padre: 'gas_local', fase: 1, ayuda: 'Factura eléctrica del local.', noVa: 'Energía de producción → Energía de producción' },
  { clave: 'gas_agua',                nombre: 'Agua',                          padre: 'gas_local', fase: 1, ayuda: 'Factura, pipas, cisternas.' },
  { clave: 'gas_gas',                 nombre: 'Gas y combustible del local',   padre: 'gas_local', fase: 1, ayuda: 'Gas de cocina, calderas.', noVa: 'Vehículos → Combustible de vehículos' },
  { clave: 'gas_respaldo_energia',    nombre: 'Respaldo energético',           padre: 'gas_local', fase: 1, ayuda: 'Combustible de planta, baterías, inversores.', noVa: 'Comprar la planta → Inversiones' },
  { clave: 'gas_mantenimiento_local', nombre: 'Mantenimiento del local',       padre: 'gas_local', fase: 1, ayuda: 'Arreglos que conservan el local.', noVa: 'Ampliar o mejorar → Obras y mejoras' },
  { clave: 'gas_limpieza',            nombre: 'Limpieza e higiene',            padre: 'gas_local', fase: 1, ayuda: 'Productos, servicio de limpieza, fumigación.' },
  { clave: 'gas_lavanderia',          nombre: 'Lavandería y lencería',         padre: 'gas_local', fase: 1, ayuda: 'Lavado de ropa de cama, mantelería, uniformes.', noVa: 'Comprar la lencería → Mobiliario y enseres' },
  { clave: 'gas_seguridad',           nombre: 'Seguridad y vigilancia',        padre: 'gas_local', fase: 1, ayuda: 'Custodia, alarmas, cámaras (el servicio).', noVa: 'Comprar las cámaras → Inversiones' },
  { clave: 'gas_desechos',            nombre: 'Recogida de desechos',          padre: 'gas_local', fase: 1, ayuda: 'Basura y desechos especiales.' },

  // G5 · Transporte y logística — OPERATIVO
  { clave: 'gas_combustible',       nombre: 'Combustible de vehículos',       padre: 'gas_transporte', fase: 1, ayuda: 'Combustible de los vehículos del negocio.', noVa: 'De planta eléctrica → Respaldo energético' },
  { clave: 'gas_mant_vehiculos',    nombre: 'Mantenimiento de vehículos',     padre: 'gas_transporte', fase: 1, ayuda: 'Piezas, talleres, gomas.', noVa: 'Comprar el vehículo → Vehículos' },
  { clave: 'gas_reparto',           nombre: 'Reparto y mensajería',           padre: 'gas_transporte', fase: 1, ayuda: 'Llevar el pedido al cliente.', noVa: 'Traer lo comprado → Fletes de compras' },
  { clave: 'gas_parqueo',           nombre: 'Parqueo y peajes',               padre: 'gas_transporte', fase: 1, ayuda: 'Parqueo, peajes, permisos de circulación.', noVa: 'Multas → Multas y sanciones' },
  { clave: 'gas_seguro_vehiculo',   nombre: 'Seguro de vehículos',            padre: 'gas_transporte', fase: 1, ayuda: 'Pólizas de los vehículos.', noVa: 'Del local o mercancía → Seguros del negocio' },
  { clave: 'gas_almacenaje',        nombre: 'Almacenaje y depósito',          padre: 'gas_transporte', fase: 1, ayuda: 'Almacén externo, custodia.', noVa: 'Tu propio almacén → Alquiler del local' },

  // G6 · Comercial y publicidad — OPERATIVO
  { clave: 'gas_publicidad',           nombre: 'Publicidad y promoción',            padre: 'gas_comercial', fase: 1, ayuda: 'Anuncios, influencers, promociones pagadas.', noVa: 'Descuentos, que ya bajan el ingreso' },
  { clave: 'gas_diseno_impresion',     nombre: 'Diseño, impresión y rotulación',    padre: 'gas_comercial', fase: 1, ayuda: 'Menús, carteles, tarjetas, logos.', noVa: 'Papelería de oficina → Papelería y útiles' },
  { clave: 'gas_atenciones',           nombre: 'Atenciones y degustaciones',        padre: 'gas_comercial', fase: 1, ayuda: 'Muestras, cortesías, regalos a clientes.', noVa: 'Deterioro → Mermas y vencidos' },
  { clave: 'gas_comision_plataforma',  nombre: 'Comisiones de plataformas',         padre: 'gas_comercial', fase: 1, ayuda: 'Lo que descuentan apps y marketplaces.', noVa: 'Del banco → Comisiones bancarias' },
  { clave: 'gas_eventos',              nombre: 'Eventos y ferias',                  padre: 'gas_comercial', fase: 1, ayuda: 'Stands, ferias, eventos propios.' },

  // G7 · Administración y oficina — OPERATIVO
  { clave: 'gas_telecom',       nombre: 'Telefonía, internet y datos',    padre: 'gas_admin', fase: 1, ayuda: 'Recargas, planes de datos, internet del local.' },
  { clave: 'gas_papeleria',     nombre: 'Papelería y útiles de oficina',  padre: 'gas_admin', fase: 1, ayuda: 'Papel, tinta, bolígrafos, carpetas.', noVa: 'Impresión promocional → Diseño e impresión' },
  { clave: 'gas_profesionales', nombre: 'Servicios profesionales',        padre: 'gas_admin', fase: 1, ayuda: 'Contador, abogado, gestor, consultor.', noVa: 'Quien produce para ti → Elaboración por terceros' },
  { clave: 'gas_software',      nombre: 'Software y suscripciones',       padre: 'gas_admin', fase: 1, ayuda: 'CLAUX, antivirus, apps, licencias mensuales.', noVa: 'Licencias estatales → Licencias y tasas' },
  { clave: 'gas_tramites',      nombre: 'Trámites, notaría y gestiones',  padre: 'gas_admin', fase: 1, ayuda: 'Notaría, registros, gestiones oficiales.', noVa: 'El impuesto en sí → Impuestos de la operación' },
  { clave: 'gas_seguros',       nombre: 'Seguros del negocio',            padre: 'gas_admin', fase: 1, ayuda: 'Local, mercancía, responsabilidad.', noVa: 'Vehículos → Seguro de vehículos' },
  { clave: 'gas_cuotas',        nombre: 'Cuotas de asociaciones',         padre: 'gas_admin', fase: 1, ayuda: 'Membresías empresariales, cámaras.' },

  // G8 · Impuestos de la operación — OPERATIVO
  // Las tarifas cambian por resolución: ninguna se codifica, el clasificador solo
  // nombra el concepto.
  { clave: 'gas_imp_ventas',          nombre: 'Impuesto sobre las ventas',   padre: 'gas_impuestos_op', fase: 1, ayuda: 'Impuesto sobre ventas de bienes.', noVa: 'Servicios → Impuesto sobre los servicios' },
  { clave: 'gas_imp_servicios',       nombre: 'Impuesto sobre los servicios', padre: 'gas_impuestos_op', fase: 1, ayuda: 'Impuesto sobre servicios prestados.', noVa: 'Bienes → Impuesto sobre las ventas' },
  { clave: 'gas_contrib_territorial', nombre: 'Contribución territorial',     padre: 'gas_impuestos_op', fase: 1, ayuda: 'Contribución sobre ingresos al municipio.' },
  { clave: 'gas_cuota_fija',          nombre: 'Cuota fija mensual',           padre: 'gas_impuestos_op', fase: 1, ayuda: 'Cuota del TCP en régimen simplificado.', noVa: 'Si tributas por régimen general, no aplica' },
  { clave: 'gas_aranceles',           nombre: 'Aranceles y aduana',           padre: 'gas_impuestos_op', fase: 1, ayuda: 'Aranceles, despacho, almacenaje aduanal.', noVa: 'Flete internacional → Fletes de compras' },
  { clave: 'gas_licencias',           nombre: 'Licencias, tasas y sellos',    padre: 'gas_impuestos_op', fase: 1, ayuda: 'Licencia comercial, sanitaria, de anuncios.', noVa: 'Cursos → Capacitación' },
  { clave: 'gas_imp_documentos',      nombre: 'Impuesto sobre documentos',    padre: 'gas_impuestos_op', fase: 1, ayuda: 'Sellos del timbre y equivalentes.' },

  // G9 · Financieros y extraordinarios — OTRO
  { clave: 'comisiones_bancarias', nombre: 'Comisiones bancarias',             padre: 'gas_otros', fase: 1, claveSistema: 'comisiones_bancarias', ayuda: 'Comisiones y mantenimiento de cuentas.', noVa: 'De pasarelas → Comisiones de plataformas' },
  { clave: 'gas_intereses',        nombre: 'Intereses de préstamos',           padre: 'gas_otros', fase: 1, ayuda: 'Solo el interés, nunca el capital.', noVa: 'El capital → Devolución de capital' },
  { clave: 'gas_dif_cambio',       nombre: 'Diferencias de cambio',            padre: 'gas_otros', fase: 1, ayuda: 'Pérdida por variación de la tasa.' },
  { clave: 'gas_multas',           nombre: 'Multas, recargos y sanciones',     padre: 'gas_otros', fase: 1, ayuda: 'Multas fiscales, de tránsito, sanciones.', noVa: 'El impuesto que las originó → Impuestos de la operación' },
  { clave: 'gas_perdidas',         nombre: 'Pérdidas por robo o siniestro',    padre: 'gas_otros', fase: 1, ayuda: 'Robo, incendio, inundación.', noVa: 'Merma normal → Mermas y vencidos' },
  { clave: 'gas_incobrables',      nombre: 'Deudas incobrables',               padre: 'gas_otros', fase: 1, ayuda: 'Facturas ya dadas por perdidas.', noVa: 'Vencidas pero cobrables → siguen en Cuentas por cobrar' },
  { clave: 'gas_donaciones',       nombre: 'Donaciones y aportes sociales',    padre: 'gas_otros', fase: 1, ayuda: 'Donaciones a la comunidad o a entidades.', noVa: 'Regalos a clientes → Atenciones' },

  // G10 · Impuesto sobre utilidades — IMPUESTO_UTILIDAD (fase 4)
  { clave: 'gas_imp_util_anticipo',    nombre: 'Pagos a cuenta',      padre: 'gas_imp_utilidad', fase: 4, ayuda: 'Anticipos mensuales o trimestrales.' },
  { clave: 'gas_imp_util_liquidacion', nombre: 'Liquidación anual',   padre: 'gas_imp_utilidad', fase: 4, ayuda: 'Ajuste de la declaración jurada anual.' },

  // G11 · Depreciación y provisiones — DEPRECIACION (fase 4)
  // Toda la raíz escribe filas con `naturaleza = 'COSTE'`: gastos reales del
  // período que NO mueven dinero. No piden cuenta, no generan CxP, no salen en el
  // flujo de caja. No se carga en ningún pack: solo con el complemento C1.
  { clave: 'dep_equipos',           nombre: 'Depreciación de equipos',        padre: 'gas_devengos', fase: 4, ayuda: 'Desgaste anual repartido por meses.', noVa: 'Comprar el equipo → Equipos y maquinaria' },
  { clave: 'dep_vehiculos',         nombre: 'Depreciación de vehículos',      padre: 'gas_devengos', fase: 4, ayuda: 'Desgaste anual de los vehículos.', noVa: 'Su mantenimiento → Mantenimiento de vehículos' },
  { clave: 'dep_obras',             nombre: 'Amortización de obras y mejoras', padre: 'gas_devengos', fase: 4, ayuda: 'Reparto del coste de la reforma.', noVa: 'La obra → Obras y mejoras del local' },
  { clave: 'dep_intangibles',       nombre: 'Amortización de intangibles',    padre: 'gas_devengos', fase: 4, ayuda: 'Marcas, derechos, licencias plurianuales.', noVa: 'Suscripciones → Software y suscripciones' },
  { clave: 'dep_prov_incobrables',  nombre: 'Provisión para incobrables',     padre: 'gas_devengos', fase: 4, ayuda: 'Estimación de lo que no cobrarás.', noVa: 'Dar por perdida una factura concreta → Deudas incobrables' },
  { clave: 'dep_deterioro_inv',     nombre: 'Deterioro de inventario',        padre: 'gas_devengos', fase: 4, ayuda: 'Estimación de pérdida de valor del stock.', noVa: 'Producto roto o vencido → Mermas' },

  // N1 · Inversiones del negocio — INVERSION (fase 2)
  { clave: 'inv_equipos',      nombre: 'Equipos y maquinaria',              padre: 'inv_bienes', fase: 2, ayuda: 'Freezers, hornos, compresores, máquinas.', noVa: 'Repararlos → Mantenimiento' },
  { clave: 'inv_mobiliario',   nombre: 'Mobiliario y enseres',              padre: 'inv_bienes', fase: 2, ayuda: 'Mesas, sillas, estantes, vitrinas.', noVa: 'Vajilla de reposición frecuente → Materias primas' },
  { clave: 'inv_vehiculos',    nombre: 'Vehículos',                         padre: 'inv_bienes', fase: 2, ayuda: 'Autos, motos, camiones, bicicletas.', noVa: 'Combustible y mantenimiento → Transporte' },
  { clave: 'inv_obras',        nombre: 'Obras y mejoras del local',         padre: 'inv_bienes', fase: 2, ayuda: 'Reformas que amplían o mejoran.', noVa: 'Arreglos que solo conservan → Mantenimiento' },
  { clave: 'inv_herramientas', nombre: 'Herramientas y utensilios',         padre: 'inv_bienes', fase: 2, ayuda: 'Herramientas que duran años.', noVa: 'Consumibles → Materias primas' },
  { clave: 'inv_informatica',  nombre: 'Equipos informáticos',              padre: 'inv_bienes', fase: 2, ayuda: 'Computadoras, tablets, TPV, impresoras.', noVa: 'Suscripciones → Software' },
  { clave: 'inv_biologicos',   nombre: 'Animales y plantaciones',           padre: 'inv_bienes', fase: 2, ayuda: 'Ganado reproductor, frutales, cultivos permanentes.', noVa: 'Piensos y semillas de ciclo corto → Materias primas' },
  { clave: 'inv_intangibles',  nombre: 'Licencias y derechos duraderos',    padre: 'inv_bienes', fase: 2, ayuda: 'Marcas, derechos, licencias plurianuales.', noVa: 'Licencias anuales → Licencias y tasas' },

  // N2 · Movimientos del dueño — PATRIMONIO (fase 2)
  { clave: 'pat_aporte',         nombre: 'Aporte del dueño',                padre: 'pat_dueno', fase: 2, ayuda: 'Dinero o bienes que el dueño mete al negocio.', noVa: 'Un préstamo → Préstamo recibido' },
  { clave: 'pat_retiro',         nombre: 'Retiro del dueño',                padre: 'pat_dueno', fase: 2, ayuda: 'Dinero que el dueño saca para sí.', noVa: 'Su salario, si está en nómina' },
  { clave: 'pat_gasto_personal', nombre: 'Gastos personales del dueño',     padre: 'pat_dueno', fase: 2, ayuda: 'Compras personales con dinero del negocio.', noVa: 'Gastos mixtos: se separa la parte del negocio' },
  { clave: 'pat_reparto',        nombre: 'Reparto de utilidades',           padre: 'pat_dueno', fase: 2, ayuda: 'Distribución de ganancias a los socios.' },

  // N3 · Préstamos y financiación — FINANCIACION (fase 2)
  { clave: 'fin_prestamo_recibido',  nombre: 'Préstamo recibido',      padre: 'fin_prestamos', fase: 2, ayuda: 'Dinero que te prestan.', noVa: 'Lo que aporta el dueño → Aporte del dueño' },
  { clave: 'fin_devolucion_capital', nombre: 'Devolución de capital',  padre: 'fin_prestamos', fase: 2, ayuda: 'La parte de la cuota que baja la deuda.', noVa: 'El interés → Intereses de préstamos' },
  { clave: 'fin_prestamo_otorgado',  nombre: 'Préstamo a terceros',    padre: 'fin_prestamos', fase: 2, ayuda: 'Dinero que el negocio presta.', noVa: 'Un anticipo a proveedor → queda en Cuentas por pagar' },

  // Ingresos · las ocho subcategorías fijas (fase 3)
  // Las cuatro raíces operativas no llevan hijas fijas: su desglose comercial lo
  // da el catálogo de productos. Estas ocho son las que nunca tienen un producto
  // detrás, más las dos de sistema.
  { clave: 'ing_venta_local',  nombre: 'Ventas del día',                   padre: 'ing_produccion', fase: 3, claveSistema: 'ing_venta_local', padreSegunPack: true, ayuda: 'Cierre de caja del TPV. Su raíz la decide el pack del sector.' },
  { clave: 'ing_recurrente',   nombre: 'Cobros recurrentes',               padre: 'ing_servicios',  fase: 3, claveSistema: 'ing_recurrente',  ayuda: 'Facturación de suscripciones y membresías.' },
  { clave: 'ing_dif_cambio',   nombre: 'Diferencias de cambio favorables', padre: 'ing_otros', fase: 3, ayuda: 'Ganancia por variación de la tasa.', noVa: 'La conversión de un cobro normal' },
  { clave: 'ing_venta_activo', nombre: 'Venta de bienes usados',           padre: 'ing_otros', fase: 4, ayuda: 'Vender un freezer, un auto, mobiliario.', noVa: 'Vender mercancía del catálogo' },
  { clave: 'ing_reembolsos',   nombre: 'Reembolsos y devoluciones',        padre: 'ing_otros', fase: 3, ayuda: 'Lo que te devuelve un proveedor o una plataforma.', noVa: 'Un cobro a un cliente' },
  { clave: 'ing_financieros',  nombre: 'Intereses y rendimientos',         padre: 'ing_otros', fase: 4, ayuda: 'Intereses ganados, rendimientos.', noVa: 'Dinero que te prestan → Préstamo recibido' },
  { clave: 'ing_propinas',     nombre: 'Propinas retenidas',               padre: 'ing_otros', fase: 4, ayuda: 'Propinas que el negocio se queda.', noVa: 'Las que repartes al personal — no son ingreso' },
  { clave: 'ing_indemnizacion', nombre: 'Indemnizaciones y seguros',       padre: 'ing_otros', fase: 4, ayuda: 'Lo que paga un seguro por un siniestro.', noVa: 'La pérdida en sí → Pérdidas por siniestro' },
]

// ── Índices ──────────────────────────────────────────────────────────────────

export const RAIZ_POR_CLAVE: ReadonlyMap<string, RaizCatalogo> =
  new Map(RAICES.map(r => [r.clave, r]))

export const ENTRADA_POR_CLAVE: ReadonlyMap<string, EntradaCatalogo> =
  new Map(ENTRADAS.map(e => [e.clave, e]))

/** La raíz de una entrada. Es donde vive el `rol_pl` que de verdad se lee. */
export function raizDe(clave: string): RaizCatalogo | undefined {
  const e = ENTRADA_POR_CLAVE.get(clave)
  return e ? RAIZ_POR_CLAVE.get(e.padre) : RAIZ_POR_CLAVE.get(clave)
}

/**
 * El rol efectivo de una entrada: **el de su raíz**.
 *
 * No es un atajo: la mig. 134 dejó escrito que `rol_pl` existe en las filas hijas
 * pero NO se lee — el cálculo del estado de resultados sube al padre. Preguntarle
 * el rol a una hija es preguntárselo a una columna que nadie mira.
 */
export function rolDe(clave: string): RolCatalogo | undefined {
  return raizDe(clave)?.rol
}

/** Una raíz «invariante»: puede tener gastos propios Y subcategorías a la vez. */
export function hijasDe(claveRaiz: string): EntradaCatalogo[] {
  return ENTRADAS.filter(e => e.padre === claveRaiz)
}
