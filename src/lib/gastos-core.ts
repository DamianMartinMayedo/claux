// Núcleo de gastos y cobros (sin 'use server'): generador de código y la regla
// de la ETIQUETA. Lo comparten la server action `guardarGastoCobro` (alta manual)
// y el importador de datos.
//
// La regla (mig. 126): un GASTO se identifica por su categoría —obligatoria— y su
// etiqueta (columna `descripcion`) se DERIVA como «Categoría · Subcategoría»; el
// texto libre va en `notas`. Un COBRO lleva concepto de texto libre y no lleva
// categoría. Es la clase de regla que si se copia en dos sitios, se separa.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type TipoRegistro = 'GASTO' | 'COBRO'

// ── El COBRO que NO es ingreso ────────────────────────────────────────────────
// Casi todo `COBRO` de `gastos_cobros` es ingreso: una venta cobrada directa, sin
// factura. La excepción es el ANTICIPO que la empresa recupera. El subsidio de la
// nómina (mig. 144) lo adelanta la empresa dentro del neto del trabajador y luego
// se lo cobra a la Seguridad Social: es una cuenta por COBRAR, no un ingreso. No
// aumenta el resultado — recupera un dinero que ya salió.
//
// **No basta con dejar la fila sin `categoria_id`.** La categoría solo se consulta
// en las filas de tipo GASTO (para su `rol_pl`); un COBRO entra en ingresos por su
// importe, tenga categoría o no. Ese era el error: sin este filtro un subsidio
// inflaba los ingresos y el resultado neto por su importe completo, en Reportes y
// en el dossier que el dueño le enseña a su asesor.
//
// Vive aquí, y no en cada consumidor, porque son TRES los que suman ingresos —el
// estado de resultados (`apuntesDe`), el puente devengado↔caja y el dossier—: con
// una copia por sitio, el informe del dueño y el documento del asesor acabarían
// diciendo cifras distintas.
const ORIGENES_COBRO_ANTICIPO = new Set(['NOMINA'])

/** ¿Este COBRO es ingreso del período, o la recuperación de un anticipo? */
export function cobroEsIngreso(origen_tipo: string | null | undefined): boolean {
  return !origen_tipo || !ORIGENES_COBRO_ANTICIPO.has(origen_tipo)
}

export function generarRegistroId(tipo: TipoRegistro): string {
  const pre = tipo === 'GASTO' ? 'GAS' : 'COB'
  return `${pre}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
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
  | 'salarios'                // nómina confirmada: los netos que van a la plantilla
  | 'retenciones_nomina'      // nómina confirmada: lo retenido, a la agencia tributaria
  | 'impuestos_salario'       // nómina MIPYME_CUBA: IUFT, a cargo de la empresa
  | 'contribucion_ss_empresa' // nómina MIPYME_CUBA: SS de empresa (12,5 % + 1,5 %)
  | 'comisiones_bancarias'    // fees de transferencia

const NOMBRE_DEFECTO: Record<ClaveCategoriaSistema, string> = {
  compras:                 'Compras',
  servicios_terceros:      'Servicios de terceros',
  salarios:                'Salarios',
  retenciones_nomina:      'Retenciones de nómina',
  // Nomenclatura tal y como se usa en Cuba: nada de «aportes patronales».
  impuestos_salario:       'Impuestos de salario',
  contribucion_ss_empresa: 'Contribución a la Seguridad Social',
  comisiones_bancarias:    'Comisiones bancarias',
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
  const { data: categoria_id, error } = await db.rpc('cat_gasto_sistema', {
    p_client_id: client_id, p_clave: clave, p_nombre: nombreDefecto,
  })
  if (error || !categoria_id) return null

  // El nombre puede estar renombrado por el dueño: es el que se desnormaliza.
  const { data: cat } = await db.from('categorias_gastos')
    .select('nombre').eq('categoria_id', categoria_id).eq('client_id', client_id).maybeSingle()
  return { categoria_id: categoria_id as string, nombre: (cat?.nombre as string) ?? nombreDefecto }
}
