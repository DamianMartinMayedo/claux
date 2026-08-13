// ── Los packs por sector ─────────────────────────────────────────────────────
//
// Un pack = **núcleo común + lo propio del giro**. Los sectores son los ONCE que
// ya existen en `plantillas_sector`; esta tabla no los amplía.
//
// Especificación §8 y §9 de `clasificador-cuentas-parte1-v2`.
//
// De los once packs teóricos solo se construyen seis (S1, S2, S4, S5, S6, S11)
// más el genérico S0. Los que faltan no son un olvido: sus subcategorías siguen
// en el catálogo y se pueden «añadir del catálogo» a mano. Construir un sector es
// una decisión comercial, no técnica.

import {
  ENTRADAS, RAICES, ENTRADA_POR_CLAVE, RAIZ_POR_CLAVE,
  type EntradaCatalogo, type FaseCatalogo, type RolCatalogo,
} from './catalogo'
import { type ConceptosSector, type GrupoPL } from '@/lib/sector'

const esRaizIngreso = (rol: RolCatalogo) =>
  rol === 'INGRESO_OPERATIVO' || rol === 'INGRESO_OTRO'

// ── El núcleo común ──────────────────────────────────────────────────────────
//
// 25 subcategorías que recibe todo negocio, tenga el giro que tenga. 18 en la
// Fase 1; las otras siete esperan a las fases 2 y 4.

export const NUCLEO: string[] = [
  // Personal (2) — fase 1
  // Solo `salarios`, y sin es_sistema: en Cuba lo normal es pagar al personal sin
  // nómina formal. Si no existe, el dueño se inventa «Pagos a empleados» y RRHH le
  // crea después un «Salarios» duplicado. Las otras tres de nómina no se siembran.
  'salarios', 'gas_estimulacion',
  // Local (6) — fase 1
  // `gas_respaldo_energia` está aquí a propósito: en Cuba el combustible de planta
  // es un gasto estructural, no una excepción. Dejarlo fuera obliga a todo cliente
  // a inventarse una categoría el primer mes, que es justo lo que esto resuelve.
  'gas_alquiler', 'gas_electricidad', 'gas_agua', 'gas_respaldo_energia',
  'gas_mantenimiento_local', 'gas_limpieza',
  // Comercial (1) — fase 1
  'gas_publicidad',
  // Administración (4) — fase 1
  'gas_telecom', 'gas_papeleria', 'gas_profesionales', 'gas_software',
  // Impuestos (2) — fase 1
  'gas_contrib_territorial', 'gas_licencias',
  // Financieros (3) — fase 1
  'comisiones_bancarias', 'gas_dif_cambio', 'gas_multas',
  // Impuesto sobre utilidades (1) — fase 4
  'gas_imp_util_anticipo',
  // Inversión (2) — fase 2
  'inv_equipos', 'inv_mobiliario',
  // Patrimonio (2) — fase 2
  'pat_aporte', 'pat_retiro',
  // Financiación (2) — fase 2
  'fin_prestamo_recibido', 'fin_devolucion_capital',
]

/** Ingresos que lleva todo pack, sea cual sea el giro (fase 3-4). */
const NUCLEO_INGRESOS: string[] = ['ing_dif_cambio', 'ing_reembolsos']

export interface Pack {
  id: string
  nombre: string
  /**
   * La raíz de ingreso dominante del giro. Es de donde cuelga `ing_venta_local`,
   * y la que el dossier pone primera.
   */
  raizIngreso: string
  /**
   * El cobro del día a día: el cierre de caja del TPV (`ing_venta_local`) o la
   * facturación recurrente (`ing_recurrente`). Un gimnasio cobra mensualidades,
   * no actos sueltos; sembrarle «Ventas del día» sería describir mal su negocio.
   */
  ingresoPrincipal: 'ing_venta_local' | 'ing_recurrente'
  /** Sobre el núcleo. */
  anade: string[]
  /** Solo notas de diseño; no cambia lo que se siembra. */
  nota?: string
}

// ── Los seis packs construidos + el genérico ─────────────────────────────────

// S5 y S6 se declaran aparte porque las dos mezclas (gimnasio, alquiler) restan
// de ellas. Se resta en vez de copiar: si mañana S5 gana una subcategoría, el
// gimnasio la gana también. Copiar la lista sería crear un segundo sitio donde
// arreglar cada cambio, y el segundo sitio es el que siempre se olvida.
const S5_BASE = [
  'gas_materias_primas', // productos de uso
  'gas_mercancia', 'gas_ropa_trabajo', 'gas_desechos', 'gas_capacitacion',
  'gas_lavanderia', 'gas_imp_servicios',
  'inv_obras', 'inv_informatica', // fase 2
]

const S6_BASE = [
  'gas_lavanderia',
  'gas_materias_primas', // desayunos, amenities
  'gas_comision_plataforma', 'gas_seguridad', 'gas_seguros', 'gas_imp_servicios',
  'inv_obras', // fase 2 — `inv_equipos` (climatización) ya viene en el núcleo
]

const sin = (base: string[], quita: string[]) => base.filter(c => !quita.includes(c))

export const PACKS: Record<string, Pack> = {
  S0: {
    id: 'S0', nombre: 'Genérico',
    // El TPV vende algo por el mostrador; «Venta de mercancías» es lo que menos
    // supone sobre un negocio que no sabemos cuál es. El dueño la mueve en un
    // toque si se equivoca — es una raíz, no una decisión irreversible.
    raizIngreso: 'ing_mercancias', ingresoPrincipal: 'ing_venta_local',
    anade: [],
    nota: 'Solo el núcleo y las cinco raíces de ingreso. Para lo que no encaje.',
  },

  S1: {
    id: 'S1', nombre: 'Gastronomía',
    raizIngreso: 'ing_produccion', ingresoPrincipal: 'ing_venta_local',
    anade: [
      'gas_materias_primas', 'gas_envases', 'gas_mermas', 'gas_gas',
      'gas_alimentacion_personal', 'gas_ropa_trabajo', 'gas_desechos',
      'gas_reparto', 'gas_atenciones', 'gas_comision_plataforma',
      'gas_imp_servicios',
      'inv_obras', // fase 2
    ],
  },

  S2: {
    id: 'S2', nombre: 'Comercio minorista',
    raizIngreso: 'ing_mercancias', ingresoPrincipal: 'ing_venta_local',
    anade: [
      'gas_mercancia', 'gas_flete_compra', 'gas_envases', 'gas_mermas',
      'gas_almacenaje', 'gas_seguridad', 'gas_comision_plataforma',
      'gas_imp_ventas',
      'inv_informatica', // fase 2
    ],
  },

  S4: {
    id: 'S4', nombre: 'Servicios técnicos y talleres',
    raizIngreso: 'ing_servicios', ingresoPrincipal: 'ing_venta_local',
    anade: [
      'gas_materias_primas', // piezas y repuestos
      'gas_subcontrata', 'gas_ropa_trabajo', 'gas_capacitacion',
      'gas_imp_servicios',
      'inv_herramientas', // fase 2
    ],
  },

  S5: {
    id: 'S5', nombre: 'Belleza y salud',
    raizIngreso: 'ing_servicios', ingresoPrincipal: 'ing_venta_local',
    anade: S5_BASE,
    nota: 'La clínica encaja peor: material sanitario y laboratorio externo se quedan sin sitio propio.',
  },

  S6: {
    id: 'S6', nombre: 'Hospedaje y alquiler',
    raizIngreso: 'ing_alquileres', ingresoPrincipal: 'ing_venta_local',
    anade: S6_BASE,
  },

  S11: {
    id: 'S11', nombre: 'Servicios profesionales y creativos',
    raizIngreso: 'ing_servicios', ingresoPrincipal: 'ing_recurrente',
    anade: [
      'gas_capacitacion',
      'gas_subcontrata', // freelancers
      'gas_contratos_servicio', 'gas_comision_plataforma', 'gas_imp_servicios',
      'inv_informatica', 'inv_intangibles', // fase 2
    ],
    nota: 'El pack más ligero: sin mercancía, sin envases y sin mermas.',
  },

  // ── Las dos mezclas propias ────────────────────────────────────────────────
  // No son sectores nuevos: son S5 y S6 con el ingreso corregido. Sus
  // `conceptos_pl` reales ya lo dicen — el gimnasio cobra «Mensualidades» y el
  // alquiler «Abonos y bonos». Los dos venden acceso recurrente, no actos.

  GIMNASIO: {
    id: 'GIMNASIO', nombre: 'Gimnasio',
    raizIngreso: 'ing_servicios', ingresoPrincipal: 'ing_recurrente',
    anade: sin(S5_BASE, ['gas_lavanderia', 'gas_desechos']),
    nota: 'S5 sin lavandería ni desechos sanitarios. La inversión dominante es la máquina, no el mobiliario.',
  },

  ALQUILER: {
    id: 'ALQUILER', nombre: 'Alquiler de espacios',
    raizIngreso: 'ing_alquileres', ingresoPrincipal: 'ing_recurrente',
    anade: sin(S6_BASE, ['gas_lavanderia', 'gas_materias_primas']),
    nota: 'S6 sin lavandería ni desayunos: es cesión de espacio por horas, no hospedaje.',
  },
}

// ── El mapa sector → pack ────────────────────────────────────────────────────
//
// Los once sectores reales de `plantillas_sector`. `servicios` es el único que no
// se resuelve solo: necesita la pregunta del §9.3.

export const PACK_POR_SECTOR: Record<string, string> = {
  restaurante: 'S1', cafeteria: 'S1', bar: 'S1',
  tienda: 'S2',
  peluqueria: 'S5', barberia: 'S5', estetica: 'S5', clinica: 'S5',
  gimnasio: 'GIMNASIO',
  alquiler: 'ALQUILER',
  // `servicios` → no está aquí a propósito: lo decide `packDeServicios`.
}

/**
 * La pregunta que desambigua `servicios`, en el alta y **re-preguntable después**:
 * el dueño puede equivocarse, y la diferencia entre los dos packs es real.
 */
export const PREGUNTA_SERVICIOS = {
  texto: '¿Trabajas con piezas y materiales, o solo con tu tiempo y conocimiento?',
  opciones: [
    { valor: 'materiales', etiqueta: 'Con piezas y materiales', pack: 'S4' },
    { valor: 'conocimiento', etiqueta: 'Solo mi tiempo y conocimiento', pack: 'S11' },
  ],
} as const

export function packDeServicios(respuesta: string | null | undefined): string {
  return respuesta === 'conocimiento' ? 'S11' : 'S4'
}

/**
 * El pack de un cliente. `respuestaServicios` solo se mira cuando el sector es
 * `servicios`; un sector desconocido cae en S0, que es el núcleo pelado — nunca
 * en nada, porque un cliente sin categorías es el problema que esto resuelve.
 */
export function packDe(sector: string | null | undefined, respuestaServicios?: string | null): Pack {
  if (sector === 'servicios') return PACKS[packDeServicios(respuestaServicios)]
  return PACKS[PACK_POR_SECTOR[sector ?? ''] ?? 'S0']
}

// ── El complemento C1 ────────────────────────────────────────────────────────
//
// **Interruptor, no sector.** Se suma a cualquier pack. Una cafetería con contador
// y una sin contador tienen el mismo giro; lo que cambia es quién lleva los libros.
// Por la regla del P&L progresivo, activarlo no cambia nada visible hasta el primer
// registro. Fase 4.

/**
 * La pregunta que enciende el complemento, dicha por lo que el dueño hace.
 *
 * No se pregunta «¿quieres contabilidad formal?» ni se nombra la depreciación: el
 * que no sabe qué es contesta que no por si acaso, y el que sí lo sabe reconoce
 * su situación de un vistazo. Lo que de verdad separa a los dos clientes es si
 * alguien le lleva los libros, así que eso es lo que se pregunta.
 */
export const PREGUNTA_C1 = {
  texto: '¿Un contador te lleva los libros?',
  ejemplo: 'Si los lleva, añadimos las cuentas que él va a necesitar: depreciación, provisiones y el impuesto sobre utilidades. Si no, no te hacen falta.',
  opciones: [
    { valor: true,  etiqueta: 'Sí, me lleva la contabilidad' },
    { valor: false, etiqueta: 'No, llevo yo las cuentas' },
  ],
} as const

export const COMPLEMENTO_C1: string[] = [
  // la raíz G11 entera
  'dep_equipos', 'dep_vehiculos', 'dep_obras', 'dep_intangibles',
  'dep_prov_incobrables', 'dep_deterioro_inv',
  'gas_imp_util_liquidacion', 'gas_incobrables', 'inv_intangibles', 'pat_reparto',
]

// ── Lo que la semilla tiene que crear ────────────────────────────────────────

export interface FilaSemilla {
  clave: string
  nombre: string
  /** `clave_catalogo` de la raíz de la que cuelga. `null` si ella misma es raíz. */
  padre: string | null
  rol: RolCatalogo
  descripcion: string
  /** Solo informativo: la semilla NUNCA escribe `clave_sistema`. Ver catalogo.ts. */
  claveSistema?: string
}

/**
 * Las filas que le tocan a un cliente: primero las raíces, después las hijas.
 *
 * El orden importa — una hija no puede insertarse antes que su `parent_id`.
 *
 * `hastaFase` acota lo que se siembra hoy: la Fase 1 solo escribe gasto de
 * resultado, porque los otros siete roles todavía no pasan el CHECK de
 * `categorias_gastos.rol_pl`. Sembrarlos ahora reventaría el insert entero.
 */
/**
 * Hasta qué fase del catálogo se puede sembrar HOY.
 *
 * Es un solo número porque el límite es uno solo y real: el CHECK de
 * `categorias_gastos.rol_pl`. Sembrar un rol que el CHECK no admite no crea una
 * fila mala, tira el insert ENTERO y el cliente se queda sin catálogo.
 *
 *   · 1 — los cuatro roles de resultado (mig. 134)
 *   · 2 — + INVERSION, PATRIMONIO, FINANCIACION (mig. 188)
 *   · 3 — + INGRESO_OPERATIVO (mig. 190)
 *   · 4 — + INGRESO_OTRO, DEPRECIACION, IMPUESTO_UTILIDAD (mig. 191) ← aquí estamos
 *
 * Subirlo es lo ÚLTIMO que se hace al cerrar una fase, nunca lo primero: mientras
 * apunte a la fase anterior, todo lo demás se puede construir y probar sin que
 * ningún cliente reciba filas que su informe todavía no sabe pintar.
 */
export const FASE_SEMBRABLE: FaseCatalogo = 4

export function filasDelPack(pack: Pack, opciones: { hastaFase: FaseCatalogo; conC1?: boolean }): FilaSemilla[] {
  const { hastaFase, conC1 = false } = opciones

  const claves = new Set<string>([
    ...NUCLEO,
    ...pack.anade,
    ...NUCLEO_INGRESOS,
    pack.ingresoPrincipal,
    ...(conC1 ? COMPLEMENTO_C1 : []),
  ])

  // El padre real, ya resuelto: `ing_venta_local` cuelga de donde diga el pack.
  const padreReal = (e: EntradaCatalogo) => (e.padreSegunPack ? pack.raizIngreso : e.padre)

  // 🔴 La fase efectiva de una hija es la MÁS TARDÍA de la suya y la de su raíz.
  // No es defensivo: `ing_dif_cambio` y `ing_reembolsos` están declarados en fase 3
  // y cuelgan de «Otros ingresos», cuyo rol `INGRESO_OTRO` no existe hasta la
  // fase 4. Sin esta regla la semilla intentaría insertar una hija cuyo padre
  // todavía no existe, y el insert entero se cae.
  const faseEfectiva = (e: EntradaCatalogo) =>
    Math.max(e.fase, RAIZ_POR_CLAVE.get(padreReal(e))?.fase ?? e.fase) as FaseCatalogo

  const entradas: EntradaCatalogo[] = [...claves]
    .map(c => ENTRADA_POR_CLAVE.get(c))
    .filter((e): e is EntradaCatalogo => !!e)
    // `nuncaSembrar`: las tres de nómina las crea el módulo al primer uso.
    .filter(e => !e.nuncaSembrar)
    .filter(e => faseEfectiva(e) <= hastaFase)

  // Las raíces de GASTO son encabezados: solo se siembran si algo cuelga de
  // ellas — un encabezado vacío el primer día no enseña nada.
  //
  // Dos excepciones, y ninguna es cosmética:
  //
  //  · Las de INGRESO. Las cuatro operativas son SELECCIONABLES directamente para
  //    un cobro sin factura (§4.1): son categorías de uso, no títulos.
  //  · Las que llevan `claveSistema` (Compras, Servicios para producir o vender).
  //    Si no están, el día que el módulo de compras o el de CxP escriba,
  //    `cat_gasto_sistema` no encontrará su ancla y creará una raíz nueva al
  //    lado — y el coste de ventas del informe quedaría partido en dos.
  const raicesNecesarias = new Set(entradas.map(padreReal))

  const filasRaiz: FilaSemilla[] = RAICES
    .filter(r => r.fase <= hastaFase)
    .filter(r => raicesNecesarias.has(r.clave) || esRaizIngreso(r.rol) || !!r.claveSistema)
    .map(r => ({
      clave: r.clave, nombre: r.nombre, padre: null, rol: r.rol,
      descripcion: '', claveSistema: r.claveSistema,
    }))

  const filasHija: FilaSemilla[] = entradas.map(e => ({
    clave: e.clave, nombre: e.nombre, padre: padreReal(e),
    // 🔴 El rol vive en la raíz. La mig. 134 dejó `rol_pl` en las hijas pero
    // NADIE lo lee: el estado de resultados sube al padre. Se escribe el de la
    // raíz para que la columna no diga una cosa distinta de la que se calcula.
    rol: RAICES.find(r => r.clave === padreReal(e))!.rol,
    descripcion: e.ayuda, claveSistema: e.claveSistema,
  }))

  return [...filasRaiz, ...filasHija]
}

// ── §9.5 · `conceptos_pl` es una proyección del pack ─────────────────────────
//
// Deja de ser una segunda lista que mantener. Y se deriva de la definición GLOBAL
// del pack, no de las filas del tenant: el cliente sin módulo de Contabilidad no
// tiene `categorias_gastos` sembradas —la semilla es una escritura del módulo— y
// aun así necesita conceptos en su dossier.

const GRUPO_DE_ROL: Partial<Record<RolCatalogo, GrupoPL>> = {
  INGRESO_OPERATIVO: 'INGRESO',
  INGRESO_OTRO: 'INGRESO',
  COSTE_VENTAS: 'COSTO_VENTAS',
  PERSONAL: 'GASTO_OPERATIVO',
  OPERATIVO: 'GASTO_OPERATIVO',
  OTRO: 'GASTO_OPERATIVO',
  DEPRECIACION: 'GASTO_OPERATIVO',
  IMPUESTO_UTILIDAD: 'GASTO_OPERATIVO',
  // INVERSION, PATRIMONIO y FINANCIACION no aparecen: no van al resultado, y el
  // dossier es un estado de resultados.
}

/**
 * Los conceptos del dossier para un pack. Todo pack tiene que poder generar esta
 * lista; si no puede, está mal diseñado (§9.5).
 *
 * 🔴 **Se proyecta por RAÍCES, no por hojas.** Las hojas del pack de gastronomía
 * son 29 en la Fase 1, y el desglose del dossier precarga FILAS que el dueño
 * rellena a mano: darle 29 renglones donde hoy tiene 5 no es más detalle, es una
 * pantalla que no termina. La raíz es además el nivel en el que el estado de
 * resultados suma de verdad (el `rol_pl` de la hija no lo lee nadie), así que el
 * dossier acaba diciendo exactamente lo que dice el informe.
 */
export function conceptosDelPack(pack: Pack): ConceptosSector {
  const salida: ConceptosSector = { INGRESO: [], COSTO_VENTAS: [], GASTO_OPERATIVO: [] }

  for (const fila of filasDelPack(pack, { hastaFase: 4 })) {
    if (fila.padre !== null) continue
    const grupo = GRUPO_DE_ROL[fila.rol]
    if (!grupo) continue
    if (!salida[grupo].includes(fila.nombre)) salida[grupo].push(fila.nombre)
  }

  return salida
}

/** Toda entrada del catálogo que no está en ningún pack sigue disponible a mano. */
export function fueraDeTodoPack(): EntradaCatalogo[] {
  const enAlgunPack = new Set<string>([...NUCLEO, ...COMPLEMENTO_C1, ...NUCLEO_INGRESOS])
  for (const p of Object.values(PACKS)) {
    enAlgunPack.add(p.ingresoPrincipal)
    p.anade.forEach(c => enAlgunPack.add(c))
  }
  return ENTRADAS.filter(e => !enAlgunPack.has(e.clave))
}
