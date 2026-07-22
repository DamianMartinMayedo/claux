// Tipos del importador de datos. El motor (`motor.ts`) es genérico; cada entidad
// aporta un `Adaptador` que sabe validar, deduplicar, insertar y actualizar sus
// filas. Todo server-side (lo llaman las acciones de `actions/portal/importar.ts`).

export type ClienteDb = ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>

/** Un campo importable de una entidad. */
export interface CampoDef {
  campo:        string      // clave interna (ej. 'nombre')
  etiqueta:     string      // etiqueta visible
  obligatorio:  boolean
  alias?:       string[]    // cabeceras de CSV que auto-mapean a este campo
  ayuda?:       string
  /**
   * Valor de muestra para la fila de ejemplo de la plantilla modelo. Es lo que
   * le enseña al cliente el formato esperado (fecha, Sí/No, decimales) sin
   * explicárselo. El motor RECONOCE esa fila y la rechaza, para que un cliente
   * que rellene debajo sin borrarla no se traiga «Ejemplo S.A.» a sus datos.
   */
  ejemplo?:     string
}

/**
 * Valor global del lote que el CSV normalmente no trae (empresa, moneda, unidad,
 * categoría…). Se pide una vez en el asistente y rellena las celdas vacías. Si
 * el campo también está en `campos`, la columna mapeada manda fila a fila.
 */
export interface DefaultDef {
  campo:       string
  etiqueta:    string
  obligatorio: boolean
  ayuda?:      string
  valor?:      string   // sugerencia inicial
  tipo?:       'texto' | 'fecha'   // cómo lo pinta el asistente (por defecto, texto)
  /** Con opciones el asistente pinta un desplegable; sin ellas, texto libre. */
  opciones?:   (ctx: CtxImport) => Promise<{ valor: string; etiqueta: string }[]>
}

/** El mismo default ya resuelto (opciones incluidas) para pintarlo en el cliente. */
export interface DefaultResuelto {
  campo:       string
  etiqueta:    string
  obligatorio: boolean
  ayuda?:      string
  valor?:      string
  tipo?:       'texto' | 'fecha'
  opciones?:   { valor: string; etiqueta: string }[]
}

export type PoliticaDuplicado = 'SALTAR' | 'ACTUALIZAR' | 'CREAR'

/** Mapeo elegido por el operador en el asistente. */
export interface MapeoImport {
  columnas: Record<string, string>   // campo interno → columna del CSV ('' = no mapeado)
  defaults: Record<string, string>   // campo interno → valor por defecto (empresa, moneda…)
  politica: PoliticaDuplicado
}

export interface FilaResultado {
  fila:    number                                    // nº de fila (1-based, sin cabecera)
  ok:      boolean
  motivo?: string
  accion?: 'INSERTAR' | 'ACTUALIZAR' | 'SALTAR'
}

/**
 * Un total del lote (importe, unidades). El valor va en NÚMERO, no formateado,
 * porque el archivo se procesa en tandas y los totales de cada tanda se suman
 * por etiqueta; dos textos «1.500,00» no se pueden sumar. Formatea quien pinta.
 */
export interface TotalResumen {
  etiqueta: string
  valor:    number
}

export interface ResultadoValidacion {
  total:   number
  ok:      number
  errores: number
  filas:   FilaResultado[]
  /** Totales de lo que se va a escribir (importes, unidades) para revisarlo antes. */
  resumen?: TotalResumen[]
}

export interface ResumenAplicacion {
  insertadas:   number
  actualizadas: number
  saltadas:     number
  errores:      number
}

/**
 * El archivo se procesa en TANDAS: a ~130 ms por fila (una consulta por fila
 * contra Supabase), un catálogo de 800 productos no cabe en el tiempo de una
 * función serverless. El asistente llama en bucle hasta que `siguiente` es null,
 * y así además puede enseñar el progreso.
 *
 * `claves` viaja de ida y vuelta para que la tanda siguiente siga detectando
 * duplicados de las anteriores dentro del mismo archivo.
 */
export interface TrozoValidacion extends ResultadoValidacion {
  siguiente: number | null
  claves:    string[]
}

export interface TrozoAplicacion extends ResumenAplicacion {
  siguiente: number | null
  claves:    string[]
}

/** Contexto de ejecución, resuelto desde la sesión (impersonada). */
export interface CtxImport {
  db:        ClienteDb
  client_id: string
  empresas:  { empresa_id: string; nombre: string }[]
  monedas:   string[]
  /** Búsquedas repetidas del lote (categoría por nombre, proveedor…) → `memo()`. */
  cache:     Map<string, unknown>
  /** Lote que se está aplicando; lo fija el motor en el commit (traza del ledger). */
  lote_id?:  string
}

export type Preparado =
  | {
      ok: true
      datos: Record<string, unknown>
      clave: string
      /**
       * Claves de `datos` que el archivo TRAE de verdad. Al ACTUALIZAR solo se
       * escriben esas: un archivo parcial (una lista de precios, un cambio de
       * cargo) no puede vaciar la categoría ni resetear la fecha de alta de lo
       * que ya estaba. Sin esta lista se actualiza `datos` entero.
       */
      provistos?: string[]
    }
  | { ok: false; motivo: string }

/** Un adaptador por entidad importable. */
export interface Adaptador {
  entidad:   string
  etiqueta:  string
  modulos:   string[]     // módulos que habilitan escribir esta entidad (candado)
  revalidar: string       // ruta a revalidar tras aplicar
  campos:    CampoDef[]
  defaults:  DefaultDef[] // valores globales que pide el asistente antes de validar
  /**
   * Valida y arma una fila (sin escribir); devuelve datos listos + clave natural.
   * `deColumna` = campos que trae el archivo (el resto los puso un default).
   */
  preparar:        (valores: Record<string, string>, ctx: CtxImport, deColumna: Set<string>) => Promise<Preparado>
  /** Busca si la clave ya existe → id existente o null. */
  buscarExistente: (datos: Record<string, unknown>, ctx: CtxImport) => Promise<string | null>
  /** Inserta una fila nueva; devuelve el código creado. */
  insertar:        (datos: Record<string, unknown>, ctx: CtxImport) => Promise<string>
  /** Actualiza una fila existente por su código. */
  actualizar:      (id: string, datos: Record<string, unknown>, ctx: CtxImport) => Promise<void>
  /**
   * Totales del lote validado (importes por moneda, unidades…). Se enseñan en el
   * paso de revisar: un decimal mal leído se ve al instante en el total, y no
   * cuando ya está escrito en los libros.
   */
  resumen?:        (filas: Record<string, unknown>[]) => TotalResumen[]
  /**
   * Deshace UNA fila insertada por un lote (`pk` = lo que devolvió `insertar`).
   * Devuelve el motivo por el que NO se pudo deshacer, o null si se deshizo.
   *
   * En los maestros es borrar la ficha —y negarse si ya la usa alguien—; en el
   * ledger NO se borra: se compensa con un movimiento de reverso. Sin esta
   * función, la entidad no se puede deshacer.
   */
  deshacer?:       (pk: string, ctx: CtxImport) => Promise<string | null>
}
