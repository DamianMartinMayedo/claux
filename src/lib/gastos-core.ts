// Núcleo de gastos y cobros (sin 'use server'): generador de código y la regla
// de la ETIQUETA. Lo comparten la server action `guardarGastoCobro` (alta manual)
// y el importador de datos.
//
// La regla (mig. 126): un GASTO se identifica por su categoría —obligatoria— y su
// etiqueta (columna `descripcion`) se DERIVA como «Categoría · Subcategoría»; el
// texto libre va en `notas`. Un COBRO lleva concepto de texto libre y no lleva
// categoría. Es la clase de regla que si se copia en dos sitios, se separa.

import { RAIZ_POR_CLAVE, ENTRADA_POR_CLAVE } from '@/lib/catalogo/catalogo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type TipoRegistro = 'GASTO' | 'COBRO'

// ── El estado de un registro se DERIVA, no se guarda ─────────────────────────
// No existe la columna `gastos_cobros.estado`: PENDIENTE / PARCIAL / LIQUIDADO
// salen de comparar el importe con lo liquidado en Tesorería, igual que en las
// facturas. Pedirla en un `select` hace fallar la consulta ENTERA (PostgREST no
// ignora la columna que sobra) — así estuvo rota la descarga de «Gastos y cobros».
// Vive aquí porque son dos los consumidores: la pantalla y la exportación.

export type EstadoRegistro = 'PENDIENTE' | 'PARCIAL' | 'LIQUIDADO'

/** Céntimos de tolerancia: un redondeo no puede dejar un gasto eternamente PARCIAL. */
export const EPS_LIQUIDACION = 0.005

export function estadoDeRegistro(monto: number, liquidado: number): EstadoRegistro {
  if (liquidado <= EPS_LIQUIDACION)         return 'PENDIENTE'
  if (liquidado >= monto - EPS_LIQUIDACION) return 'LIQUIDADO'
  return 'PARCIAL'
}

// ── COSTE y DEUDA dejan de ser el mismo número (mig. 166) ────────────────────
//
// Una fila de `gastos_cobros` cumplía DOS papeles a la vez: línea de coste del estado
// de resultados y deuda en Cuentas por pagar. Se sostenía porque en toda fila los dos
// papeles valían lo mismo. Dejó de ser cierto dos veces:
//
//  1. El subsidio de la nómina (mig. 144): el trabajador lo cobra, pero a la empresa
//     no le cuesta —se lo reembolsa la Seguridad Social—. Se parcheó a mano con una
//     lista de orígenes, más un aviso de que todo consumidor nuevo debía recordarla.
//  2. La nómina entera (mig. 166), y por una razón de NEGOCIO: el coste de las
//     vacaciones se reconoce cuando se ACUMULAN y el pago sale cuando se DISFRUTAN,
//     así que el reparto por acreedor y el reparto por categoría de coste son dos
//     listas distintas del mismo dinero.
//
// Ahora lo dice la propia fila, con tres valores. `AMBAS` es el defecto y el
// comportamiento de todo lo anterior, así que nada del histórico cambia.
//
// Los predicados viven AQUÍ y no en cada consumidor porque son muchos y de los dos
// lados —el estado de resultados, el dossier, el dashboard y el puente devengado↔caja
// suman coste; CxC/CxP, Tesorería y el escáner de avisos miran deuda—: con una copia
// por sitio, el informe del dueño y el documento de su asesor acabarían discrepando.
// Eso ya pasó una vez, con el subsidio, en tres consumidores a la vez.

export type NaturalezaRegistro = 'COSTE' | 'DEUDA' | 'AMBAS'

/** Fila sin la columna leída (o anterior a la mig. 166) ⇒ `AMBAS`, como siempre fue. */
function naturalezaDe(n: string | null | undefined): NaturalezaRegistro {
  return n === 'COSTE' || n === 'DEUDA' ? n : 'AMBAS'
}

/**
 * ¿Esta fila cuenta en el estado de resultados (coste si es GASTO, ingreso si es COBRO)?
 *
 * Excluye lo que es **solo deuda**: el salario neto y las retenciones de una nómina
 * —su coste ya está dentro del devengado, y contarlo otra vez es el agujero de la
 * mig. 139 por la puerta contraria— y el subsidio por cobrar.
 */
export function computaEnResultados(naturaleza: string | null | undefined): boolean {
  return naturalezaDe(naturaleza) !== 'DEUDA'
}

/**
 * ¿Esta fila genera saldo en CxC/CxP y puede liquidarse en Tesorería?
 *
 * Excluye lo que es **solo coste**: las filas de coste de la nómina (el salario
 * devengado, la acumulación de vacaciones) no se le deben a nadie por sí mismas —la
 * deuda va en sus propias filas—, así que aparecer en Cuentas por pagar las contaría
 * dos veces y generaría avisos de deuda vencida que nadie puede pagar.
 */
export function generaSaldo(naturaleza: string | null | undefined): boolean {
  return naturalezaDe(naturaleza) !== 'COSTE'
}

/**
 * ¿Este COBRO es ingreso del período, o la recuperación de un anticipo?
 *
 * Se conserva el nombre porque es el vocabulario de los tres consumidores que suman
 * ingresos, pero ya **no** es una lista de orígenes: lee la naturaleza de la fila. El
 * subsidio dejó de ser una excepción escrita a mano y es el primer caso normal de la
 * regla general.
 */
export function cobroEsIngreso(naturaleza: string | null | undefined): boolean {
  return computaEnResultados(naturaleza)
}

// ── El COBRO del cierre de caja ───────────────────────────────────────────────
// Cada cierre del punto de venta escribe UNA fila resumen por moneda en
// `gastos_cobros` (mig. 149 + `lib/caja/ingesta.ts`). Su detalle —ticket a ticket—
// se queda en el módulo Caja a propósito: en Contabilidad el dueño quiere una línea
// por cierre, no cuatrocientas por día.
//
// Son TRES preguntas distintas sobre la misma fila, y mezclarlas es el error fácil:
//   1. ¿suma como ingreso?   → sí (`cobroEsIngreso`: no es un anticipo)
//   2. ¿en qué renglón?      → Ventas, no «cobros directos» (`fuenteDeCobro`)
//   3. ¿está cobrado?        → sí, ya (`cobroNaceLiquidado`)
// El COBRO del subsidio de la nómina responde justo lo contrario a la 1 y a la 3, y
// los dos son «un COBRO con origen»: por eso ningún filtro puede generalizarse a
// «tiene `origen_tipo`».
export const ORIGEN_CIERRE_CAJA = 'CIERRE_CAJA'

/**
 * Renglón del estado de resultados al que va este COBRO.
 *
 * Un cierre de caja **es una venta** (mostrador, sin factura), así que va al renglón
 * «Ventas» junto a las facturas. Sin esto el importe cae en «cobros directos» y el
 * renglón de Ventas de un negocio que solo vende por TPV se queda en blanco.
 */
export function fuenteDeCobro(origen_tipo: string | null | undefined): 'VENTA' | 'COBRO' {
  return origen_tipo === ORIGEN_CIERRE_CAJA ? 'VENTA' : 'COBRO'
}

/**
 * ¿Este COBRO nace ya cobrado?
 *
 * El dinero del cierre de caja entró en la caja por el movimiento de Tesorería del
 * propio cierre (`origen='CAJA'`), que **no** lleva `referencia_id` a este registro:
 * la liquidación no existe como tal. Sin este predicado el registro se queda
 * PENDIENTE para siempre, aparece en CxC como si alguien debiera ese dinero y el
 * puente devengado↔caja enseña un «pendiente de cobro» que ya está en la caja.
 */
export function cobroNaceLiquidado(origen_tipo: string | null | undefined): boolean {
  return origen_tipo === ORIGEN_CIERRE_CAJA
}

// ── La gaveta del TPV: lo que sale y entra DURANTE el turno (mig. 193) ───────
//
// No confundir con `ORIGEN_CIERRE_CAJA`, que es el resumen de VENTAS de un cierre.
// Esto es lo otro que pasa en la gaveta: el dependiente le paga al proveedor, el
// dueño retira, se mete sencillo para dar cambio. La ingesta lo postea en Tesorería
// (`origen='CAJA'`) y hasta la mig. 193 moría ahí, fuera del estado de resultados.
//
// La clasificación NO la hace el dispositivo: la hace el dueño después, en la
// bandeja de pendientes del portal, contestando la misma pregunta que el movimiento
// manual de Tesorería. Por eso estas filas nacen desde una acción del portal y no
// desde la ingesta.
export const ORIGEN_CAJA_SALIDA  = 'CAJA_SALIDA'
export const ORIGEN_CAJA_ENTRADA = 'CAJA_ENTRADA'

/**
 * ¿Esta fila la generó una operación de la gaveta del TPV?
 *
 * La usan las dos puertas de Gastos (editar y borrar) para no dejar retocar a mano
 * un importe que lo fija el dispositivo: bajarlo aquí dejaría el gasto discrepando
 * del EGRESO de Tesorería que ya está posteado, y nada avisaría.
 */
export function esGavetaTpv(origen_tipo: string | null | undefined): boolean {
  return origen_tipo === ORIGEN_CAJA_SALIDA || origen_tipo === ORIGEN_CAJA_ENTRADA
}

/**
 * La naturaleza con la que nace un registro clasificado desde la gaveta.
 *
 * **`COSTE`, y esto es lo que hace que la fase entera no toque a ningún consumidor.**
 * El efectivo YA salió del cajón —la ingesta posteó su EGRESO en Tesorería—, así que
 * la fila tiene que contar en el estado de resultados y **no** generar deuda: si
 * naciera `AMBAS` (el defecto), al dueño le aparecería en Cuentas por pagar una
 * factura fantasma por un dinero que pagó la semana pasada, y el puente devengado↔caja
 * enseñaría un pendiente imposible de liquidar.
 *
 * Es exactamente la semántica que la mig. 166 ya definió para el salario devengado, y
 * la misma por la que §1.9 reclasifica la depreciación. No hay caso nuevo: hay un
 * tercer caso normal de una regla que ya está enhebrada en los ocho consumidores.
 */
export const NATURALEZA_GAVETA: NaturalezaRegistro = 'COSTE'

export function generarRegistroId(tipo: TipoRegistro): string {
  const pre = tipo === 'GASTO' ? 'GAS' : 'COB'
  return `${pre}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

/** Id de una categoría de gasto. Lo usan el alta manual y el importador. */
export function generarCategoriaGastoId(): string {
  return `CATGAS-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

/**
 * Parte «Bebidas, Carnes, Limpieza» en nombres limpios.
 *
 * Acepta coma Y salto de línea porque la gente pega listas, no solo las teclea.
 * Quita vacíos (una coma de más al final no debe crear una categoría sin nombre),
 * normaliza espacios internos y descarta repetidos **sin distinguir mayúsculas**:
 * «Bebidas, bebidas» son la misma, y dejarlas pasar reventaría el índice único
 * `(client_id, parent_id, nombre)` a mitad del lote.
 */
export function parsearSubcategorias(texto: string | null | undefined): string[] {
  if (!texto) return []
  const vistos = new Set<string>()
  const out: string[] = []
  for (const bruto of texto.split(/[,\n]/)) {
    const nombre = bruto.trim().replace(/\s+/g, ' ')
    if (!nombre) continue
    const clave = nombre.toLowerCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    out.push(nombre)
  }
  return out
}

export interface EtiquetaCategoria {
  categoria_id: string
  /** Nombre de la categoría elegida (desnormalizado en `gastos_cobros.categoria`). */
  nombre:       string
  /** Etiqueta derivada: «Categoría» o «Categoría · Subcategoría». */
  descripcion:  string
}

/**
 * Resuelve la etiqueta de un gasto a partir de su categoría (subiendo al padre si
 * es una subcategoría). Devuelve null si la categoría no existe o está inactiva.
 */
export async function etiquetaDeCategoria(
  db: Db, client_id: string, categoria_id: string,
): Promise<EtiquetaCategoria | null> {
  const { data: nodo } = await db.from('categorias_gastos')
    .select('nombre, parent_id, estado')
    .eq('categoria_id', categoria_id).eq('client_id', client_id)
    .maybeSingle()
  if (!nodo || nodo.estado !== 'ACTIVO') return null

  let descripcion = nodo.nombre as string
  if (nodo.parent_id) {
    const { data: padre } = await db.from('categorias_gastos')
      .select('nombre').eq('categoria_id', nodo.parent_id).eq('client_id', client_id).maybeSingle()
    if (padre) descripcion = `${padre.nombre} · ${nodo.nombre}`
  }
  return { categoria_id, nombre: nodo.nombre as string, descripcion }
}

// ── Categorías que escribe el SISTEMA ────────────────────────────────────────
//
// Las cuatro categorías que no nacen de un formulario sino de un módulo. Su
// identidad es la CLAVE (`categorias_gastos.clave_sistema`, mig. 133), nunca el
// nombre: el dueño puede renombrarlas y buscarlas por nombre crearía un duplicado
// a su espalda en la siguiente escritura — el bug de datos de la mig. 122.

export type ClaveCategoriaSistema =
  | 'compras'                 // entrada de mercancía (inv_confirmar_compra)
  | 'servicios_terceros'      // CxP al proveedor de un servicio (srv_cxp_generar)
  | 'salarios'                // nómina confirmada: el salario devengado (coste)
  // `retenciones_nomina` se retiró en la mig. 184: nadie la escribía desde la
  // mig. 166. La retención no es un gasto de la empresa — es parte del salario
  // devengado que se le retiene al trabajador, y la fila DEUDA de la nómina va
  // sin categoría a propósito.
  | 'vacaciones_acumuladas'   // nómina MIPYME_CUBA: la provisión del mes (mig. 166)
  | 'impuestos_salario'       // nómina MIPYME_CUBA: IUFT, a cargo de la empresa
  | 'contribucion_ss_empresa' // nómina MIPYME_CUBA: SS de empresa (12,5 % + 1,5 %)
  | 'comisiones_bancarias'    // fees de transferencia

// Los nombres históricos, a propósito: son los que ya tienen los clientes en
// producción. Ponerles ahora los del catálogo («Compras y mercancía») haría que la
// búsqueda por nombre de `cat_gasto_sistema` no encontrase la suya y le creara una
// segunda al lado. Cuando el catálogo esté sembrado ninguno de estos nombres se
// usa: la fila se encuentra por su clave.
const NOMBRE_DEFECTO: Record<ClaveCategoriaSistema, string> = {
  compras:                 'Compras',
  servicios_terceros:      'Servicios de terceros',
  salarios:                'Salarios',
  vacaciones_acumuladas:   'Vacaciones acumuladas',
  // Nomenclatura tal y como se usa en Cuba: nada de «aportes patronales».
  impuestos_salario:       'Impuestos de salario',
  contribucion_ss_empresa: 'Contribución a la Seguridad Social',
  comisiones_bancarias:    'Comisiones bancarias',
}

/**
 * Bajo qué categoría principal debe nacer una categoría de sistema.
 *
 * Sale del catálogo por defecto (`src/lib/catalogo/`), no de una tabla escrita a
 * mano aquí: son la misma decisión, y tenerla en dos sitios garantiza que un día
 * digan cosas distintas. Devuelve `null` cuando la propia clave ES una raíz
 * (`compras`, `servicios_terceros`).
 */
function padreDeClaveSistema(
  clave: ClaveCategoriaSistema,
): { clave: string; nombre: string; rol: string } | null {
  if (RAIZ_POR_CLAVE.has(clave)) return null
  const entrada = ENTRADA_POR_CLAVE.get(clave)
  const raiz    = entrada && RAIZ_POR_CLAVE.get(entrada.padre)
  return raiz ? { clave: raiz.clave, nombre: raiz.nombre, rol: raiz.rol } : null
}

// El `rol_pl` de cada una NO se manda desde aquí: lo fija `cat_gasto_sistema`
// (mig. 139) por su clave, para que nazca igual venga de TypeScript o de dentro de
// otra función Postgres. Antes no se fijaba en absoluto y la categoría se quedaba
// en el default 'OPERATIVO': el «Salarios» de todo cliente nuevo caía fuera del
// renglón Personal del estado de resultados.

/**
 * Resuelve —creándola si hace falta— la categoría de sistema de este cliente.
 *
 * Delega en la RPC `cat_gasto_sistema` (mig. 133) para que Postgres y TypeScript
 * compartan UNA sola implementación: la misma que usan por dentro
 * `inv_confirmar_compra` y `srv_cxp_generar`. Antes cada llamador hacía su propio
 * `select ... eq('nombre', 'Salarios')`, y como las categorías del sistema solo se
 * sembraron para los clientes que existían en la mig. 074, un cliente dado de alta
 * después escribía el gasto sin `categoria_id` — invisible para el P&L estructurado.
 *
 * Devuelve null solo si la RPC falla; el llamador debe seguir escribiendo el gasto
 * (un gasto sin clasificar es mejor que una nómina que no se confirma).
 */
export async function resolverCategoriaSistema(
  db: Db, client_id: string, clave: ClaveCategoriaSistema,
): Promise<{ categoria_id: string; nombre: string } | null> {
  const nombreDefecto = NOMBRE_DEFECTO[clave]
  // La madre bajo la que debe nacer, sacada del catálogo por defecto para que no
  // haya dos listas que mantener. Sin esto la categoría nace en la RAÍZ, y una
  // raíz suelta más por cada módulo es justo el árbol plano que el clasificador
  // viene a arreglar (mig. 185 · rama c).
  const padre = padreDeClaveSistema(clave)
  const { data: categoria_id, error } = await db.rpc('cat_gasto_sistema', {
    p_client_id: client_id, p_clave: clave, p_nombre: nombreDefecto,
    p_clave_padre:  padre?.clave  ?? null,
    p_nombre_padre: padre?.nombre ?? null,
    p_rol_padre:    padre?.rol    ?? null,
  })
  if (error || !categoria_id) return null

  // El nombre puede estar renombrado por el dueño: es el que se desnormaliza.
  const { data: cat } = await db.from('categorias_gastos')
    .select('nombre').eq('categoria_id', categoria_id).eq('client_id', client_id).maybeSingle()
  return { categoria_id: categoria_id as string, nombre: (cat?.nombre as string) ?? nombreDefecto }
}
