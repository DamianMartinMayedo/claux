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

/**
 * Qué hacer con un nombre del archivo que no se pudo emparejar. `USAR` lleva el
 * id de la ficha que el operador señaló; el resto no necesita destino.
 */
export type AccionResolucion = 'USAR' | 'CREAR' | 'OMITIR' | 'RECHAZAR'

export interface Resolucion {
  accion:   AccionResolucion
  destino?: string
}

/**
 * Un nombre del archivo que el importador no supo emparejar solo, con lo que
 * necesita el asistente para preguntar: a qué se parece, si se puede crear y
 * cuántas filas dependen de la respuesta.
 *
 * `decidir` separa las dos naturalezas, y es la que evita los 80 clics: si HAY
 * dudas (varias fichas con ese nombre, o ninguna pero algo parecido al lado) la
 * fila espera respuesta; si no se parece a nada, manda la política del lote y
 * esto es solo información —el operador puede redirigirlo igualmente—.
 */
export interface Pendiente {
  clave:         string   // identidad estable del pendiente (tipo|ámbito|nombre)
  tipo:          string   // 'categoria_gasto', 'tercero', 'cuenta'…
  etiqueta_tipo: string   // «Categoría de gasto»
  texto:         string   // lo que dice el archivo, tal cual
  ambito_etiqueta?: string   // «dentro de Suministros», «en Mi Empresa S.A.»
  /** 'VARIAS' = hay más de una con ese nombre · 'NINGUNA' = no existe ninguna. */
  causa:         'VARIAS' | 'NINGUNA'
  /** true = las filas que lo usan no se importan hasta que el operador decida. */
  decidir:       boolean
  filas:         number
  primera_fila:  number
  /** Fichas que puede elegir, las más parecidas primero. */
  opciones:      { valor: string; etiqueta: string }[]
  /** ¿Se puede dar de alta al vuelo? (una categoría sí; una cuenta de caja no) */
  creable:       boolean
  /** ¿Se puede dejar el campo vacío? (solo si el campo es opcional) */
  omitible:      boolean
  /** Lo que hay que saber ANTES de crearla (dónde caerá en el informe). */
  aviso?:        string
  /** Lo que se hará si no se toca nada. Solo cuando `decidir` es false. */
  defecto:       AccionResolucion
}

/** Mapeo elegido por el operador en el asistente. */
export interface MapeoImport {
  columnas: Record<string, string>   // campo interno → columna del CSV ('' = no mapeado)
  defaults: Record<string, string>   // campo interno → valor por defecto (empresa, moneda…)
  politica: PoliticaDuplicado
  /**
   * Decisiones sobre los nombres que no se emparejaron, por `Pendiente.clave`.
   * Viajan en el mapeo —y por tanto se guardan en el lote— para que revalidar y
   * aplicar tomen exactamente el mismo camino.
   */
  resoluciones?: Record<string, Resolucion>
}

export interface FilaResultado {
  fila:    number                                    // nº de fila (1-based, sin cabecera)
  ok:      boolean
  motivo?: string
  accion?: 'INSERTAR' | 'ACTUALIZAR' | 'SALTAR'
  /** No es un error del archivo: espera que el operador decida (§`Pendiente`). */
  decidir?: boolean
}

/**
 * Un total del lote (importe, unidades). El valor va en NÚMERO, no formateado,
 * porque el archivo se procesa en tandas y los totales de cada tanda se suman
 * por etiqueta; dos textos «1.500,00» no se pueden sumar. Formatea quien pinta.
 */
export interface TotalResumen {
  etiqueta: string
  valor:    number
  /** Es una cuenta de filas, no dinero: se pinta sin decimales. */
  entero?:  boolean
}

export interface ResultadoValidacion {
  total:   number
  ok:      number
  errores: number
  /** Filas que no son un error: esperan una decisión sobre un nombre. */
  por_decidir: number
  filas:   FilaResultado[]
  /** Totales de lo que se va a escribir (importes, unidades) para revisarlo antes. */
  resumen?: TotalResumen[]
  /** Nombres sin emparejar que recogió esta tanda (§`Pendiente`). */
  pendientes?: Pendiente[]
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
  /** Fila que se está procesando (1-based). La fija el motor antes de `preparar`. */
  fila?:     number
  /**
   * Recolector de nombres sin emparejar. Solo lo pone el DRY-RUN: en el commit
   * ya está todo decidido y no hay a quién preguntar.
   */
  pendientes?:   Map<string, Pendiente>
  /** Decisiones ya tomadas por el operador (`MapeoImport.resoluciones`). */
  resoluciones?: Record<string, Resolucion>
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
  | {
      ok: false
      motivo: string
      /**
       * La fila no está mal: espera que el operador diga a qué corresponde un
       * nombre. Se cuenta aparte de los errores porque la respuesta no es
       * «corrige el archivo» sino «decide y vuelve a validar».
       */
      decidir?: boolean
    }

/** Un adaptador por entidad importable. */
export interface Adaptador {
  entidad:   string
  etiqueta:  string
  /**
   * Sus filas son HECHOS, no fichas: dos idénticas pueden ser dos cosas reales
   * distintas (el mismo cliente paga dos veces lo mismo el mismo día). En esas
   * entidades, la colisión de clave DENTRO del archivo no es un error del
   * archivo, así que la decide la política del lote y con «Crear otro» entran
   * las dos. En un maestro (un producto, una ficha de cliente) es al revés: dos
   * filas con la misma identidad son un error y se avisa siempre.
   */
  repetible?: boolean
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
