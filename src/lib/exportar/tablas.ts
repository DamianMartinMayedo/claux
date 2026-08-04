// Registro de tablas exportables — «sácame todos los X de este negocio».
//
// Lo usa EL DUEÑO desde cada listado del portal: son sus datos y se los lleva a Excel
// para revisarlos, cruzarlos o dárselos a su asesor. Hubo un tiempo en que esto era
// exclusivo de la sesión de configuración (el equipo CLAUX dentro del portal del
// cliente); ese segundo botón se eliminó por redundante — hacía lo mismo, peor y solo
// en CSV. El candado que queda es el módulo de cada listado (`modulos`).
//
// Lo que se descarga es TODO lo que cae dentro del filtro, no la página que se está
// viendo: el listado pagina para no traerse la historia entera a la pantalla, pero
// «descargar las facturas de este trimestre» significa las del trimestre.
//
// ── POR QUÉ UN REGISTRO Y NO UN EXPORTADOR POR PANTALLA ───────────────────────
// Todas las exportaciones hacen lo mismo: leer una tabla del tenant, ponerle
// cabeceras legibles y volcarla. Escribirlo una vez por vista habría dado diez
// copias que divergen — que es exactamente lo que ya pasó con el CSV, del que hay
// cuatro generadores a mano en el repo, cada uno con su separador y uno de ellos
// sin BOM. Aquí: una entrada por entidad, y añadir una tabla nueva son ~10 líneas.
//
// Las columnas se eligen a mano en vez de volcar `select *` a propósito: se
// traducen a nombres que un humano entiende, se omiten los `client_id` (todas las
// filas son del mismo cliente) y no se filtra ningún dato por accidente.
//
// No es 'use server': lo consume la server action `exportarListado`.

import { estadoCobro, type Tramo } from '@/lib/cobranza-core'
import { calcularCobroAcuerdo, estadoEfectivo, type DescuentoModo, type PeriodicidadSub } from '@/lib/suscripciones'
import {
  cobroNaceLiquidado, estadoDeRegistro, generaSaldo, type EstadoRegistro,
} from '@/lib/gastos-core'
import { MOTIVO_LABEL, type MotivoTipo } from '@/app/actions/portal/_inventario-helpers'
import { obtenerCuentasPorCobrar, obtenerCuentasPorPagar } from '@/app/actions/portal/cobranza'
import { SIN_CATEGORIA, SIN_TERCERO, importeBuscado } from '@/lib/listados'
// «Hoy» en la zona del NEGOCIO (America/Havana). Con `toISOString()` (UTC), a partir de las
// 20:00 la fecha ya es la de mañana: el tramo de antigüedad de una deuda y el estado
// efectivo de un acuerdo salían distintos en el fichero y en la pantalla.
import { hoyEnTz } from '@/lib/fecha-tz'
import type { ValorCelda } from './csv'

// Los centinelas de «los que no tienen» viven en `lib/listados.ts`: los necesitan las
// vistas, y este fichero no se puede importar desde el navegador (arrastra acciones de
// servidor). Aquí solo se consumen.

const TRAMO_ETIQUETA: Record<Tramo, string> = {
  AL_DIA: 'Al día', V_1_30: '1–30 días', V_31_60: '31–60 días', V_60: '+60 días',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * Filtros que puede recibir una exportación.
 *
 * El mismo registro sirve para DOS casos de uso con el mismo motor:
 *   · la tabla ENTERA (configuración) → sin filtro,
 *   · lo que hay EN PANTALLA (el dueño) → con el rango y la búsqueda aplicados.
 * Una entrada que no sepa filtrar simplemente ignora el argumento y devuelve todo:
 * ninguna exporta MENOS de lo que debería por no implementarlo.
 */
export interface FiltroExport {
  desde?: string
  hasta?: string
  q?:     string
  // ── Filtros de la vista ─────────────────────────────────────────────────────
  // Las vistas filtran EN EL NAVEGADOR (un `useMemo` sobre lo ya cargado), así que sin
  // esto el fichero no se parece a la pantalla: filtras «vencidas» y te bajas todas.
  // Cada entrada aplica los que entiende e ignora el resto; ninguna exporta de menos
  // por no implementar uno.
  empresa_id?: string
  estado?:     string
  tipo?:       string
  tercero?:    string
  categoria?:  string
  cuenta_id?:  string
  almacen_id?: string
  /** Movimientos de inventario: el motivo del ajuste (`motivo_tipo`). */
  motivo?:     string
  /** Acta de un conteo físico concreto (mig. 159). */
  conteo_id?:  string
  /** CxC/CxP: tramo de antigüedad de la deuda (`AL_DIA`, `V_1_30`…). */
  tramo?:      string
  /** Los listados esconden lo archivado salvo que se pida verlo. */
  archivadas?: boolean
  /** CxC/CxP: solo lo que queda por cobrar/pagar. */
  con_saldo?:  boolean
  /** Catálogo: solo lo que está en o por debajo de su mínimo de stock. */
  bajo_minimo?: boolean
  /** Catálogo de servicios: solo los que se pueden contratar como suscripción. */
  suscribibles?: boolean

  // ── Alcance (NO es un filtro de pantalla) ───────────────────────────────────
  /**
   * Empresas que este usuario tiene DERECHO a ver.
   *
   * **Lo pone el servidor**: `exportarListado` lo sobrescribe siempre, así que lo que
   * llegue del navegador se descarta. No es una preferencia como `empresa_id` —que es
   * «enséñame solo esta»— sino el permiso: un `rol='usuario'` solo ve las empresas de
   * `empresa_usuario` (`obtenerEmpresas`), y cada listado del portal lo aplica con un
   * `.in('empresa_id', …)`.
   *
   * La exportación NO lo hacía: filtraba solo por `client_id`, de modo que un usuario
   * restringido a una empresa pulsaba «Descargar» y se llevaba las de todo el tenant. Que
   * la píldora de empresa no esté marcada no es permiso para traerlo todo.
   *
   * Se consume en `leer()` a partir del NOMBRE DE LA TABLA (`TABLAS_CON_EMPRESA`), no
   * entrada por entrada: una entrada nueva queda acotada sin que nadie se acuerde de
   * acotarla, que es justo el olvido que causó la fuga.
   */
  empresas_visibles?: string[]
}

/**
 * Tablas del tenant que llevan `empresa_id` y por tanto se acotan al alcance del usuario.
 *
 * Es una lista a mano, o sea que deriva sola con cada tabla nueva —el mismo problema que
 * `eliminar_cliente` y las políticas RLS—. Por eso `npm run audit:filtros` la compara
 * contra `information_schema`: si aparece una tabla con `empresa_id` que no esté aquí, lo
 * canta. Verificada contra la BD de producción el 2026-08-03.
 */
const TABLAS_CON_EMPRESA = new Set([
  'almacenes', 'caja_sesiones', 'caja_tickets', 'compras', 'conteos', 'cuentas',
  'empleados', 'facturas', 'gastos_cobros', 'movimientos_inventario',
  'movimientos_tesoreria', 'nominas', 'ofertas', 'suscripciones', 'third_parties',
  'turnos',
])

/**
 * El alcance, listo para un `.in()`.
 *
 * Sin empresas visibles se devuelve el centinela `__none__` y no un array vacío: un
 * `.in('empresa_id', [])` en PostgREST no filtra a cero, revienta la consulta entera.
 * Misma convención que `idsFiltro` en las acciones del portal.
 */
function alcance(filtro?: FiltroExport): string[] {
  const ids = filtro?.empresas_visibles ?? []
  return ids.length ? ids : ['__none__']
}

export interface TablaExportable {
  /** Clave estable: viaja del cliente a la server action. */
  clave:     string
  /** Nombre visible en el menú y base del nombre de fichero. */
  etiqueta:  string
  /**
   * Nombre del fichero cuando la clave no basta para distinguirlo. Una misma entrada
   * sirve a dos páginas —Inventario y Servicios comparten `productos` y sus
   * categorías—, y bajarse las categorías de Servicios en un fichero llamado
   * «categorias_productos» es un fichero mal etiquetado en la carpeta de descargas.
   */
  archivo?:  (filtro?: FiltroExport) => string
  /**
   * Módulos que dan derecho a descargarla: el de su listado. Basta con tener UNO
   * («Clientes y proveedores» vive en tres módulos distintos). Es el candado de esta
   * exportación — que el botón no se pinte no es control de acceso.
   */
  modulos:   string[]
  cabeceras: string[]
  cargar: (db: Db, client_id: string, filtro?: FiltroExport) => Promise<ValorCelda[][]>
}

/** `select` + filtro por tenant + orden, que es idéntico en todas. */
async function leer(
  db: Db, tabla: string, client_id: string, columnas: string, orden: string,
  filtro?: FiltroExport, campoFecha?: string, camposTexto?: string[],
  /** Igualdades de la vista (`{ empresa_id, estado… }`). Se ignora lo vacío. */
  iguales?: Record<string, string | boolean | undefined>,
  /** Pertenencias a un conjunto (una categoría y sus hijas). Se ignora lo vacío. */
  enLista?: Record<string, string[] | undefined>,
  /**
   * «Cualquiera de estos campos vale esto» (OR entre campos distintos). Existe por la
   * TRANSFERENCIA: un movimiento toca el almacén como origen (`almacen_id`) o como
   * destino (`almacen_destino_id`), así que filtrar por igualdad dejaba fuera de la
   * descarga las entradas por traspaso que la pantalla sí enseña. Se ignora lo vacío.
   */
  algunoIgual?: Record<string, string | undefined>,
  /**
   * Columnas que tienen que venir VACÍAS. Existe por «Sin categoría», que en la pantalla es
   * una opción del desplegable como cualquier otra: sin esto, el filtro se traducía a una
   * igualdad contra el centinela `__sin__` (cero filas) o se mandaba vacío (todas), y en los
   * dos casos el fichero no era lo que se estaba viendo.
   */
  esNulo?: string[],
  /**
   * Columna de importe que también casa cuando lo buscado es un NÚMERO.
   *
   * Los listados de Ventas, Gastos y Tesorería buscan por importe exacto además de por
   * texto (`importeBuscado`), así que teclear «150» encuentra el gasto de 150. La descarga
   * solo miraba los campos de texto: mismo filtro, menos filas en el fichero.
   */
  campoImporte?: string,
): Promise<Record<string, unknown>[]> {
  let query = db.from(tabla)
    .select(columnas)
    .eq('client_id', client_id)
  // El ALCANCE antes que cualquier filtro de pantalla: `client_id` dice de qué negocio son
  // las filas, pero no cuáles de sus empresas puede ver ESTE usuario. Va por nombre de
  // tabla para que no dependa de que cada entrada se acuerde (ver `empresas_visibles`).
  if (TABLAS_CON_EMPRESA.has(tabla)) query = query.in('empresa_id', alcance(filtro))
  for (const [campo, valor] of Object.entries(iguales ?? {})) {
    if (valor === undefined || valor === '') continue
    query = query.eq(campo, valor)
  }
  for (const [campo, valores] of Object.entries(enLista ?? {})) {
    if (!valores?.length) continue
    query = query.in(campo, valores)
  }
  for (const campo of esNulo ?? []) query = query.is(campo, null)
  // Un `.or()` por bloque: PostgREST los combina con AND entre sí, que es lo que se
  // quiere (este OR acota, no ensancha lo que ya filtran los demás).
  const alguno = Object.entries(algunoIgual ?? {}).filter(([, v]) => v !== undefined && v !== '')
  if (alguno.length) {
    query = query.or(alguno.map(([campo, valor]) => `${campo}.eq.${valor}`).join(','))
  }
  // El rango se aplica EN LA CONSULTA, igual que en los listados: exportar «las facturas
  // de este período» no puede significar traerse el histórico y recortarlo en memoria.
  if (campoFecha && filtro?.desde) query = query.gte(campoFecha, filtro.desde)
  if (campoFecha && filtro?.hasta) query = query.lte(campoFecha, filtro.hasta)
  const t = (filtro?.q ?? '').trim()
  if (t && camposTexto?.length) {
    // Se escapan los comodines del patrón: buscar «50%» no puede devolver media tabla.
    const patron = `%${t.replace(/[\\%_]/g, c => `\\${c}`)}%`
    const partes = camposTexto.map(c => `${c}.ilike.${patron}`)
    // Y por importe exacto si lo buscado es un número, igual que el listado.
    const importe = importeBuscado(t)
    if (campoImporte && importe != null) partes.push(`${campoImporte}.eq.${importe}`)
    query = query.or(partes.join(','))
  }
  const { data, error } = await query.order(orden, { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as Record<string, unknown>[]
}

/** Una categoría y todas las que cuelgan de ella (un nivel, que es lo que hay). */
async function conDescendientes(db: Db, client_id: string, categoria_id: string): Promise<string[]> {
  const { data } = await db.from('categorias_gastos')
    .select('categoria_id, parent_id').eq('client_id', client_id)
  const filas = (data ?? []) as { categoria_id: string; parent_id: string | null }[]
  return [categoria_id, ...filas.filter(c => c.parent_id === categoria_id).map(c => c.categoria_id)]
}

/**
 * Almacenes que el usuario puede ver, para acotar lo que cuelga de ellos.
 *
 * `stock_almacenes`, `conteo_lineas` y compañía **no tienen `empresa_id`**: su empresa es la
 * de su almacén. Sin esto, «Existencias» y la «Hoja de conteo» se bajaban el stock de todos
 * los almacenes del tenant —con el nombre de la empresa ajena en su columna— aunque la
 * pantalla solo enseñara los de una.
 *
 * Si el filtro de pantalla pide un almacén concreto, se cruza con el alcance: pedir uno que
 * no te toca devuelve cero filas, no el almacén.
 */
async function almacenesVisibles(
  db: Db, client_id: string, filtro?: FiltroExport,
): Promise<string[]> {
  const { data } = await db.from('almacenes')
    .select('almacen_id')
    .eq('client_id', client_id)
    .in('empresa_id', alcance(filtro))
  const ids = ((data ?? []) as { almacen_id: string }[]).map(a => a.almacen_id)
  const pedido = filtro?.almacen_id
  const visibles = pedido ? ids.filter(id => id === pedido) : ids
  return visibles.length ? visibles : ['__none__']
}

/** Mapa id → nombre, para que el CSV diga «Bar Manolo» y no «TER-9F2A11C4». */
async function diccionario(
  db: Db, tabla: string, client_id: string, clave: string, valor: string,
): Promise<Map<string, string>> {
  const { data } = await db.from(tabla).select(`${clave}, ${valor}`).eq('client_id', client_id)
  const m = new Map<string, string>()
  for (const f of (data ?? []) as Record<string, string>[]) m.set(f[clave], f[valor])
  return m
}

export const TABLAS_EXPORTABLES: TablaExportable[] = [
  {
    clave: 'terceros',
    etiqueta: 'Clientes y proveedores',
    // Vive en tres módulos: quien solo tiene Inventario o Servicios también tiene
    // clientes (su página se inyecta en el grupo anfitrión cuando no hay contabilidad).
    modulos: ['base', 'inventario', 'servicios'],
    cabeceras: ['Código', 'Tipo', 'Nombre', 'Nombre comercial', 'NIT', 'Email', 'Teléfono',
      'Dirección', 'Ciudad', 'País', 'Condición de pago', 'Límite de crédito',
      'Moneda por defecto', 'Activo', 'Notas'],
    cargar: async (db, cid, filtro) => {
      const filas = await leer(db, 'third_parties', cid,
        'tercero_id, tipo, nombre, nombre_comercial, nit, email, telefono, direccion, ciudad, pais, condicion_pago, limite_credito, moneda_defecto, activo, notas', 'nombre',
        filtro, undefined, ['nombre', 'nombre_comercial', 'nit', 'email', 'tercero_id'],
        // La lista enseña activos XOR archivados; el fichero, lo mismo.
        { tipo: filtro?.tipo, empresa_id: filtro?.empresa_id, activo: !filtro?.archivadas })
      return filas.map(f => [
        f.tercero_id as string, f.tipo as string, f.nombre as string,
        f.nombre_comercial as string, f.nit as string, f.email as string, f.telefono as string,
        f.direccion as string, f.ciudad as string, f.pais as string, f.condicion_pago as string,
        f.limite_credito as number, f.moneda_defecto as string, f.activo as boolean,
        f.notas as string,
      ])
    },
  },
  {
    clave: 'categorias_gastos',
    etiqueta: 'Categorías de gasto',
    modulos: ['base'],
    cabeceras: ['Código', 'Categoría', 'Subcategoría de', 'En el estado de resultados',
      'Estado', 'Del sistema', 'Concepto'],
    cargar: async (db, cid, filtro) => {
      const filas = await leer(db, 'categorias_gastos', cid,
        'categoria_id, nombre, parent_id, rol_pl, estado, es_sistema, descripcion', 'nombre',
        filtro, undefined, ['nombre', 'descripcion'])
      // El padre se resuelve contra las MISMAS filas ya leídas: no hace falta otra
      // consulta y así una madre archivada también aparece con su nombre.
      const porId = new Map(filas.map(f => [f.categoria_id as string, f.nombre as string]))
      return filas.map(f => [
        f.categoria_id as string, f.nombre as string,
        f.parent_id ? (porId.get(f.parent_id as string) ?? f.parent_id as string) : '',
        f.rol_pl as string, f.estado as string, f.es_sistema as boolean, f.descripcion as string,
      ])
    },
  },
  {
    clave: 'gastos_cobros',
    etiqueta: 'Gastos y cobros',
    modulos: ['base'],
    cabeceras: ['Código', 'Tipo', 'Fecha', 'Vencimiento', 'Tercero', 'Categoría', 'Concepto',
      'Etiqueta', 'Moneda', 'Importe', 'Estado', 'Empresa', 'Generado por', 'Notas'],
    cargar: async (db, cid, filtro) => {
      // Filtrar por «Suministros» tiene que traerse también sus subcategorías: los
      // gastos cuelgan de la hija, y con una igualdad simple el fichero saldría casi
      // vacío mientras la pantalla enseña decenas de líneas. Mismo criterio que
      // `hijasDe` en GastosView.
      const familia = filtro?.categoria ? await conDescendientes(db, cid, filtro.categoria) : undefined

      // **`estado` NO es una columna** (PENDIENTE/PARCIAL/LIQUIDADO se derivan de lo
      // liquidado en Tesorería, como en las facturas). Pedirla en el `select` hacía
      // fallar la consulta entera —PostgREST no ignora la columna que sobra— y `leer()`
      // lanza, así que el botón «Descargar» de Gastos y cobros reventaba SIEMPRE. Se
      // deriva aquí con `estadoDeRegistro`, la misma función que usa la pantalla, y por
      // eso el filtro por estado también se aplica después de calcularlo.
      const [filas, terceros, empresas] = await Promise.all([
        leer(db, 'gastos_cobros', cid,
          'registro_id, tipo, fecha, vencimiento, tercero_id, categoria, categoria_id, concepto, descripcion, moneda, monto, empresa_id, origen_tipo, naturaleza, notas', 'fecha',
          filtro, 'fecha', ['concepto', 'descripcion', 'notas', 'registro_id'],
          {
            empresa_id: filtro?.empresa_id,
            tipo:       filtro?.tipo,
            tercero_id: filtro?.tercero,
          },
          { categoria_id: familia }, undefined, undefined, 'monto'),
        diccionario(db, 'third_parties', cid, 'tercero_id', 'nombre'),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])

      // Lo liquidado de cada registro: movimientos de Tesorería que lo referencian, en
      // la moneda del registro (`monto_ref`), igual que `obtenerGastosCobros`.
      const liquidado = new Map<string, number>()
      if (filas.length) {
        const { data: movs } = await db.from('movimientos_tesoreria')
          .select('referencia_id, monto, monto_ref')
          .eq('client_id', cid)
          .in('origen', ['PAGO', 'COBRO'])
          .in('referencia_id', filas.map(f => f.registro_id as string))
        for (const m of (movs ?? []) as { referencia_id: string; monto: number; monto_ref: number | null }[]) {
          liquidado.set(m.referencia_id, (liquidado.get(m.referencia_id) ?? 0) + Number(m.monto_ref ?? m.monto))
        }
      }
      const estadoDe = (f: Record<string, unknown>): EstadoRegistro =>
        // Dos filas que nadie liquida nunca y que, sin excepción, saldrían PENDIENTE
        // para siempre. Mismas dos que en la pantalla (`obtenerGastosCobros`), para que
        // la descarga y el listado no digan estados distintos de la misma fila:
        //  · el resumen de un cierre de caja NACE cobrado (su dinero entró por el
        //    movimiento del cierre, que no referencia esta fila);
        //  · una fila de solo COSTE (mig. 166) no se le debe a nadie.
        cobroNaceLiquidado(f.origen_tipo as string | null)
          || !generaSaldo(f.naturaleza as string | null)
          ? 'LIQUIDADO'
          : estadoDeRegistro(Number(f.monto), liquidado.get(f.registro_id as string) ?? 0)

      return filas
        .filter(f => !filtro?.estado || estadoDe(f) === filtro.estado)
        .map(f => [
          f.registro_id as string, f.tipo as string, f.fecha as string, f.vencimiento as string,
          f.tercero_id ? (terceros.get(f.tercero_id as string) ?? '') : '',
          f.categoria as string,
          // «Concepto» era `descripcion`, que en un GASTO es la etiqueta de la categoría: el
          // CSV exportaba el mismo defecto que la tabla (D4). Ahora sale el concepto real
          // (mig. 152), con el histórico cayendo a la etiqueta, y la etiqueta derivada se
          // conserva en su propia columna porque es la que usan los informes.
          (f.concepto as string) || (f.descripcion as string),
          f.descripcion as string,
          f.moneda as string, f.monto as number, estadoDe(f),
          empresas.get(f.empresa_id as string) ?? '',
          (f.origen_tipo as string) ?? 'Manual', f.notas as string,
        ])
    },
  },
  {
    clave: 'facturas',
    etiqueta: 'Facturas',
    modulos: ['base'],
    // Lleva COBRADO y SALDO, que no están en la tabla `facturas`: una lista de facturas
    // sin decir qué queda por cobrar obliga a cruzarla a mano con Tesorería, que es
    // justo el trabajo que se quería evitar bajándola.
    cabeceras: ['Número', 'Fecha', 'Vencimiento', 'Cliente', 'Empresa', 'Moneda',
      'Subtotal', 'Total', 'Cobrado', 'Saldo', 'Estado', 'Condición de pago', 'Notas'],
    cargar: async (db, cid, filtro) => {
      const [filas, terceros, empresas] = await Promise.all([
        leer(db, 'facturas', cid,
          'factura_id, numero, fecha_emision, fecha_vencimiento, cliente_id, empresa_id, moneda, subtotal, total, estado, condicion_pago, notas, archivado', 'fecha_emision',
          filtro, 'fecha_emision', ['numero', 'notas'],
          {
            empresa_id: filtro?.empresa_id,
            estado:     filtro?.estado,
            cliente_id: filtro?.tercero,
            // El listado esconde lo archivado salvo que se pida verlo; el fichero igual.
            ...(filtro?.archivadas ? {} : { archivado: false }),
          },
          undefined, undefined, undefined, 'total'),
        diccionario(db, 'third_parties', cid, 'tercero_id', 'nombre'),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])

      // Cobros de ESAS facturas, sin filtro de fecha: una factura de julio cobrada en
      // agosto ya no se debe. Mismo criterio que el listado (`obtenerVentas`).
      const cobrado = new Map<string, number>()
      if (filas.length) {
        const { data: liqs } = await db.from('movimientos_tesoreria')
          .select('referencia_id, monto, monto_ref')
          .eq('client_id', cid)
          .eq('origen', 'COBRO')
          .in('referencia_id', filas.map(f => f.factura_id as string))
        for (const m of ((liqs ?? []) as { referencia_id: string; monto: number; monto_ref: number | null }[])) {
          cobrado.set(m.referencia_id, (cobrado.get(m.referencia_id) ?? 0) + Number(m.monto_ref ?? m.monto))
        }
      }
      const hoy = hoyEnTz()

      return filas
        .map(f => {
          // Una anulada o un borrador no deben nada: su saldo no es deuda.
          const viva = f.estado !== 'ANULADA' && f.estado !== 'BORRADOR'
          const e = viva
            ? estadoCobro(Number(f.total), cobrado.get(f.factura_id as string) ?? 0,
                          f.fecha_vencimiento as string | null, hoy)
            : { liquidado: 0, saldo: 0 }
          return { f, liquidado: e.liquidado, saldo: e.saldo }
        })
        // «Solo con saldo» se aplica aquí porque el saldo no es una columna: se deriva
        // de los cobros, igual que en la pantalla.
        .filter(({ saldo }) => !filtro?.con_saldo || saldo > 0.005)
        .map(({ f, liquidado, saldo }) => [
          f.numero as string, f.fecha_emision as string, f.fecha_vencimiento as string,
          f.cliente_id ? (terceros.get(f.cliente_id as string) ?? '') : '',
          empresas.get(f.empresa_id as string) ?? '',
          f.moneda as string, f.subtotal as number, f.total as number,
          liquidado, saldo, f.estado as string,
          f.condicion_pago as string, f.notas as string,
        ])
    },
  },
  {
    clave: 'ofertas',
    etiqueta: 'Ofertas y presupuestos',
    modulos: ['base'],
    cabeceras: ['Número', 'Fecha', 'Válida hasta', 'Cliente', 'Empresa', 'Moneda',
      'Subtotal', 'Total', 'Estado', 'Notas'],
    cargar: async (db, cid, filtro) => {
      const [filas, terceros, empresas] = await Promise.all([
        leer(db, 'ofertas', cid,
          'numero, fecha_emision, fecha_validez, cliente_id, empresa_id, moneda, subtotal, total, estado, notas', 'fecha_emision',
          filtro, 'fecha_emision', ['numero', 'notas'],
          {
            empresa_id: filtro?.empresa_id,
            estado:     filtro?.estado,
            cliente_id: filtro?.tercero,
            ...(filtro?.archivadas ? {} : { archivado: false }),
          },
          undefined, undefined, undefined, 'total'),
        diccionario(db, 'third_parties', cid, 'tercero_id', 'nombre'),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.numero as string, f.fecha_emision as string, f.fecha_validez as string,
        f.cliente_id ? (terceros.get(f.cliente_id as string) ?? '') : '',
        empresas.get(f.empresa_id as string) ?? '',
        f.moneda as string, f.subtotal as number, f.total as number, f.estado as string,
        f.notas as string,
      ])
    },
  },
  ...(['COBRAR', 'PAGAR'] as const).map<TablaExportable>(modo => ({
    clave:    modo === 'COBRAR' ? 'cuentas_cobrar' : 'cuentas_pagar',
    etiqueta: modo === 'COBRAR' ? 'Cuentas por cobrar' : 'Cuentas por pagar',
    modulos:  ['base'],
    cabeceras: ['Documento', 'Tipo', 'Tercero', 'Empresa', 'Fecha', 'Vencimiento',
      'Días vencido', 'Antigüedad', 'Moneda', 'Importe', 'Liquidado', 'Saldo'],
    // Se reutiliza la MISMA carga que pinta la pantalla en vez de rehacer la consulta:
    // lo que sale en CxC no es una tabla, es una derivación con reglas finas (fuera el
    // COBRO del cierre de caja, dentro el subsidio de nómina, saldo por encima del EPS,
    // tramo de antigüedad). Una segunda implementación aquí acabaría diciendo otra cosa
    // que la pantalla, que es el fallo que más caro se paga en un listado de deudas.
    cargar: async (_db, _cid, filtro) => {
      const data = modo === 'COBRAR'
        ? await obtenerCuentasPorCobrar()
        : await obtenerCuentasPorPagar()
      const t = (filtro?.q ?? '').trim().toLowerCase()
      return (data?.documentos ?? [])
        // Mismos filtros que `CuentasView`, con la misma semántica del «sin tercero».
        .filter(d => {
          if (filtro?.tramo      && d.tramo      !== filtro.tramo)      return false
          if (filtro?.empresa_id && d.empresa_id !== filtro.empresa_id) return false
          // Por FICHA, no por nombre: con una ficha por empresa, comparar nombres metía en
          // el fichero las deudas de los tres terceros homónimos.
          if (filtro?.tercero === SIN_TERCERO && d.tercero_id)          return false
          if (filtro?.tercero && filtro.tercero !== SIN_TERCERO
              && d.tercero_id !== filtro.tercero)                       return false
          if (t && !(
            d.numero.toLowerCase().includes(t)
            || (d.tercero_nombre ?? '').toLowerCase().includes(t)
            || d.saldo.toFixed(2) === t.replace(',', '.')
          )) return false
          return true
        })
        .map(d => [
          d.numero, d.doc_tipo === 'FACTURA' ? 'Factura' : 'Registro',
          d.tercero_nombre ?? '', data?.empresa_nombres[d.empresa_id] ?? '',
          d.fecha, d.vencimiento, d.dias_vencido, TRAMO_ETIQUETA[d.tramo] ?? d.tramo,
          d.moneda, d.monto, d.liquidado, d.saldo,
        ])
    },
  })),
  {
    clave: 'movimientos_tesoreria',
    etiqueta: 'Movimientos de tesorería',
    modulos: ['base'],
    cabeceras: ['Fecha', 'Tipo', 'Cuenta', 'Concepto', 'Categoría', 'Moneda', 'Importe',
      'Empresa', 'Origen', 'Notas'],
    cargar: async (db, cid, filtro) => {
      // La categoría se filtra por `categoria_id` CON SUS SUBCATEGORÍAS, igual que la
      // pantalla. Se filtraba por la columna `categoria`, que es la ETIQUETA de texto,
      // contra el id que manda el selector: no casaba nunca, así que filtrar por categoría
      // en Tesorería devolvía un fichero VACÍO — y «Sin categoría» también.
      const sinCategoria = filtro?.categoria === SIN_CATEGORIA
      const familia = filtro?.categoria && !sinCategoria
        ? await conDescendientes(db, cid, filtro.categoria)
        : undefined
      const [filas, cuentas, empresas] = await Promise.all([
        leer(db, 'movimientos_tesoreria', cid,
          'fecha, tipo, cuenta_id, concepto, categoria, moneda, monto, empresa_id, origen, notas', 'fecha',
          filtro, 'fecha', ['concepto', 'notas', 'movimiento_id'],
          {
            empresa_id: filtro?.empresa_id,
            cuenta_id:  filtro?.cuenta_id,
            tipo:       filtro?.tipo,
          },
          { categoria_id: familia },
          undefined,
          sinCategoria ? ['categoria_id'] : undefined,
          'monto'),
        diccionario(db, 'cuentas', cid, 'cuenta_id', 'nombre'),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.fecha as string, f.tipo as string, cuentas.get(f.cuenta_id as string) ?? '',
        f.concepto as string, f.categoria as string, f.moneda as string, f.monto as number,
        empresas.get(f.empresa_id as string) ?? '', f.origen as string, f.notas as string,
      ])
    },
  },
  {
    clave: 'productos',
    etiqueta: 'Productos y servicios',
    archivo: f => f?.tipo === 'SERVICIO' ? 'servicios' : 'productos',
    // Inventario y Servicios comparten la tabla `products` y la vista; cada página
    // cataloga un `tipo` y lo pasa en el filtro.
    modulos: ['inventario', 'servicios'],
    // OJO: la columna de estado es `estado` ('ACTIVO'/'INACTIVO'), NO `activo` — esta
    // entrada pedía `activo` y la exportación fallaba entera («no se pudieron leer los
    // datos») desde que se escribió. Ver `supabase/migrations/010_productos.sql`.
    cabeceras: ['Código', 'Tipo', 'Nombre', 'Descripción', 'Categoría', 'Proveedor',
      'Unidad', 'Stock actual', 'Stock mínimo', 'Estado'],
    cargar: async (db, cid, filtro) => {
      const [filas, categorias, terceros] = await Promise.all([
        leer(db, 'products', cid,
          'codigo, tipo, nombre, descripcion, categoria_id, proveedor_id, unidad, stock_actual, stock_minimo, estado, es_suscribible', 'nombre',
          filtro, undefined, ['nombre', 'codigo', 'descripcion'],
          {
            tipo:         filtro?.tipo,
            // «Solo suscribibles» SÍ es columna, así que va a la consulta.
            es_suscribible: filtro?.suscribibles ? true : undefined,
            // «Sin categoría» es una opción del desplegable como las demás: antes se
            // traducía a cadena vacía antes de mandarse, o sea que pedirla descargaba TODO
            // el catálogo.
            categoria_id: filtro?.categoria === SIN_CATEGORIA ? undefined : filtro?.categoria,
            proveedor_id: filtro?.tercero,
            // La lista enseña activos XOR archivados.
            estado:       filtro?.archivadas ? 'INACTIVO' : 'ACTIVO',
          },
          undefined, undefined,
          filtro?.categoria === SIN_CATEGORIA ? ['categoria_id'] : undefined),
        diccionario(db, 'product_categories', cid, 'categoria_id', 'nombre'),
        diccionario(db, 'third_parties', cid, 'tercero_id', 'nombre'),
      ])
      // «Solo bajo mínimo» compara DOS columnas entre sí, y eso PostgREST no lo expresa:
      // se aplica aquí, sobre las filas ya traídas. Un catálogo es corto —no es un
      // histórico— así que el coste es nulo, y sin esto marcar el filtro y descargar te
      // daba el catálogo entero.
      const visibles = filtro?.bajo_minimo
        ? filas.filter(f => Number(f.stock_minimo) > 0 && Number(f.stock_actual) <= Number(f.stock_minimo))
        : filas
      return visibles.map(f => [
        f.codigo as string, f.tipo as string, f.nombre as string, f.descripcion as string,
        f.categoria_id ? (categorias.get(f.categoria_id as string) ?? '') : '',
        f.proveedor_id ? (terceros.get(f.proveedor_id as string) ?? '') : '',
        f.unidad as string, f.stock_actual as number, f.stock_minimo as number,
        f.estado as string,
      ])
    },
  },
  {
    clave: 'categorias_productos',
    etiqueta: 'Categorías del catálogo',
    archivo: f => f?.tipo === 'SERVICIO' ? 'categorias-servicios' : 'categorias-productos',
    modulos: ['inventario', 'servicios'],
    cabeceras: ['Código', 'Categoría', 'Se usa en', 'Estado', 'Descripción'],
    cargar: async (db, cid, filtro) => {
      // Igual que la pestaña: las del tipo de la página MÁS las marcadas «Ambas»
      // (mig. 122) — en Servicios no se ofrece «Limpieza», pero «Ambas» sale en las dos.
      // Sin filtro de estado: la pestaña enseña activas y archivadas juntas (las
      // archivadas atenuadas), no una u otra como en el catálogo.
      const filas = await leer(db, 'product_categories', cid,
        'categoria_id, nombre, tipo, estado, descripcion', 'nombre',
        filtro, undefined, ['nombre', 'descripcion'], undefined,
        { tipo: filtro?.tipo ? [filtro.tipo, 'AMBAS'] : undefined })
      return filas.map(f => [
        f.categoria_id as string, f.nombre as string, f.tipo as string,
        f.estado as string, f.descripcion as string,
      ])
    },
  },
  {
    clave: 'movimientos_inventario',
    etiqueta: 'Movimientos de inventario',
    modulos: ['inventario'],
    cabeceras: ['Fecha', 'Tipo', 'Artículo', 'Almacén', 'Almacén destino', 'Cantidad',
      'Coste unitario', 'Motivo', 'Origen', 'Empresa'],
    cargar: async (db, cid, filtro) => {
      const [filas, productos, almacenes, empresas] = await Promise.all([
        leer(db, 'movimientos_inventario', cid,
          'fecha, tipo, producto_id, almacen_id, almacen_destino_id, cantidad, costo_unitario, motivo, origen, empresa_id', 'fecha',
          filtro, 'fecha', ['motivo', 'movimiento_id'],
          {
            empresa_id: filtro?.empresa_id,
            tipo:       filtro?.tipo,
            producto_id: filtro?.categoria,
            // El motivo del ajuste: el desplegable de la pantalla no viajaba, así que
            // filtrar «Rotura» y descargar traía también las ventas y las compras.
            motivo_tipo: filtro?.motivo,
          },
          undefined,
          // El almacén cuenta como ORIGEN o como DESTINO, igual que en la pantalla
          // (`obtenerAlmacenDetalle` y el filtro de Movimientos): con `.eq()` a secas, una
          // transferencia recibida salía en la tabla y faltaba en el fichero.
          { almacen_id: filtro?.almacen_id, almacen_destino_id: filtro?.almacen_id }),
        diccionario(db, 'products',  cid, 'producto_id', 'nombre'),
        diccionario(db, 'almacenes', cid, 'almacen_id',  'nombre'),
        diccionario(db, 'empresas',  cid, 'empresa_id',  'nombre'),
      ])
      return filas.map(f => [
        f.fecha as string, f.tipo as string,
        productos.get(f.producto_id as string) ?? '',
        almacenes.get(f.almacen_id as string) ?? '',
        f.almacen_destino_id ? (almacenes.get(f.almacen_destino_id as string) ?? '') : '',
        f.cantidad as number, f.costo_unitario as number,
        f.motivo as string, f.origen as string,
        empresas.get(f.empresa_id as string) ?? '',
      ])
    },
  },
  {
    // La foto del inventario, que era justo la que no se podía descargar: se
    // exportaban movimientos, productos, almacenes y compras, pero no «qué tengo y
    // cuánto vale», que es lo que se lleva uno al conteo físico.
    clave: 'stock',
    etiqueta: 'Existencias',
    modulos: ['inventario'],
    cabeceras: ['Código', 'Producto', 'Almacén', 'Empresa', 'Unidad', 'Cantidad',
      'Mínimo', 'Coste unitario', 'Moneda', 'Valor'],
    cargar: async (db, cid, filtro) => {
      // El stock no tiene empresa: la hereda de su almacén, así que el alcance se aplica
      // por almacén visible (y eso ya incluye el almacén pedido en el filtro).
      const almOk = await almacenesVisibles(db, cid, filtro)
      const [filas, prodRes, almRes, cfgRes, empresas, monRes] = await Promise.all([
        leer(db, 'stock_almacenes', cid, 'producto_id, almacen_id, cantidad', 'producto_id',
          filtro, undefined, undefined, undefined,
          { almacen_id: almOk }),
        db.from('products')
          .select('producto_id, codigo, nombre, unidad, stock_minimo, costos, tipo, estado')
          .eq('client_id', cid),
        db.from('almacenes').select('almacen_id, nombre, empresa_id').eq('client_id', cid),
        db.from('producto_almacen_config').select('producto_id, almacen_id, stock_minimo')
          .eq('client_id', cid),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
        db.from('monedas').select('codigo').eq('client_id', cid).eq('activa', true).order('codigo'),
      ])

      type Prd = { producto_id: string; codigo: string; nombre: string; unidad: string; stock_minimo: number; costos: Record<string, number> | null; tipo: string; estado: string }
      const prodDe = new Map(((prodRes.data ?? []) as Prd[]).map(p => [p.producto_id, p]))
      const almDe  = new Map(((almRes.data ?? []) as { almacen_id: string; nombre: string; empresa_id: string }[])
        .map(a => [a.almacen_id, a]))
      const minDe  = new Map(((cfgRes.data ?? []) as { producto_id: string; almacen_id: string; stock_minimo: number | null }[])
        .filter(c => c.stock_minimo != null)
        .map(c => [`${c.producto_id}@${c.almacen_id}`, Number(c.stock_minimo)]))
      // La moneda de valoración sale de las del CLIENTE, nunca de una lista fija.
      const monedas = ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo)

      const out: ValorCelda[][] = []
      for (const f of filas) {
        const p = prodDe.get(f.producto_id as string)
        const a = almDe.get(f.almacen_id as string)
        if (!p || p.tipo === 'SERVICIO') continue
        const cantidad = Number(f.cantidad)
        if (Math.abs(cantidad) <= 0.0005) continue
        const clave  = `${f.producto_id}@${f.almacen_id}`
        const minimo = minDe.get(clave) ?? Number(p.stock_minimo ?? 0)
        // Primera moneda del cliente con coste registrado; sin coste van vacías, no a 0
        // (un producto sin coste no vale 0, es que no se sabe).
        const moneda = monedas.find(m => p.costos?.[m] != null) ?? ''
        const coste  = moneda ? Number(p.costos![moneda]) : null
        out.push([
          p.codigo, p.nombre,
          a?.nombre ?? (f.almacen_id as string),
          a ? (empresas.get(a.empresa_id) ?? '') : '',
          p.unidad ?? '', cantidad, minimo,
          coste ?? '', moneda,
          coste != null && cantidad > 0 ? Math.round(cantidad * coste * 100) / 100 : '',
        ])
      }
      return out
    },
  },
  {
    // La hoja de conteo: lo mismo que «Existencias» pero SIN la cantidad, con la
    // casilla en blanco para apuntar a mano. Es una entrada aparte y no un `formato`
    // porque `formato` ya significa csv/xlsx en el motor; aquí lo que cambia es qué
    // columnas se llevan, que es exactamente lo que decide una entrada del registro.
    // El que cuenta con el papel delante llena la última columna y luego teclea el
    // resultado en /portal/almacenes/<id>/conteo.
    clave: 'hoja_conteo',
    etiqueta: 'Hoja de conteo',
    modulos: ['inventario'],
    cabeceras: ['Código', 'Producto', 'Almacén', 'Unidad', 'Contado'],
    cargar: async (db, cid, filtro) => {
      const almOk = await almacenesVisibles(db, cid, filtro)
      const [filas, prodRes, almRes] = await Promise.all([
        leer(db, 'stock_almacenes', cid, 'producto_id, almacen_id, cantidad', 'producto_id',
          filtro, undefined, undefined, undefined,
          { almacen_id: almOk }),
        db.from('products').select('producto_id, codigo, nombre, unidad, tipo, estado').eq('client_id', cid),
        db.from('almacenes').select('almacen_id, nombre').eq('client_id', cid),
      ])
      type Prd = { producto_id: string; codigo: string; nombre: string; unidad: string; tipo: string; estado: string }
      const prodDe = new Map(((prodRes.data ?? []) as Prd[]).map(p => [p.producto_id, p]))
      const almDe  = new Map(((almRes.data ?? []) as { almacen_id: string; nombre: string }[])
        .map(a => [a.almacen_id, a.nombre]))

      const out: ValorCelda[][] = []
      for (const f of filas) {
        const p = prodDe.get(f.producto_id as string)
        if (!p || p.tipo === 'SERVICIO' || p.estado !== 'ACTIVO') continue
        if (Math.abs(Number(f.cantidad)) <= 0.0005) continue
        out.push([
          p.codigo, p.nombre,
          almDe.get(f.almacen_id as string) ?? (f.almacen_id as string),
          p.unidad ?? '',
          '',   // la casilla que se llena a mano
        ])
      }
      // Por almacén y luego por nombre: es el orden en que se recorre un estante.
      return out.sort((a, b) =>
        String(a[2]).localeCompare(String(b[2]), 'es') || String(a[1]).localeCompare(String(b[1]), 'es'))
    },
  },
  {
    // El ACTA de un conteo: qué faltó, qué sobró, por qué y cuánto cuesta (mig. 159).
    // Es el documento que el dueño puede enseñar y guardar; la «hoja de conteo» de
    // arriba es lo contrario, el papel en blanco con el que se va a contar.
    //
    // La diferencia sale del LEDGER cuando el conteo ya se aplicó (`referencia_id`),
    // no de `contado − esperado`: el stock se movió mientras se contaba, así que la
    // única diferencia real es la que se ajustó. En un borrador todavía no hay ajuste,
    // así que se compara con el stock de ahora, que es lo que haría al aplicarse.
    //
    // LLEVA LA HOJA ENTERA, contado y sin contar. Solo traía las líneas contadas, y eso
    // convertía la descarga en un resumen de descuadres: el dueño no podía ver qué pasa
    // con TODOS sus productos ni, sobre todo, CUÁLES SE QUEDARON SIN CONTAR — que en un
    // conteo a medias es la información más útil que hay. Lo no contado sale con «Sin
    // contar» y sin diferencia: no es un cero, es que nadie fue a ese estante.
    clave: 'acta_conteo',
    etiqueta: 'Acta del conteo',
    archivo: f => `acta_conteo_${f?.conteo_id ?? ''}`,
    modulos: ['inventario'],
    cabeceras: ['Código', 'Producto', 'Unidad', 'Sistema', 'Contado', 'Diferencia', 'Causa', 'Explicación', 'Coste unitario', 'Valor de la diferencia'],
    cargar: async (db, cid, filtro) => {
      const conteo_id = filtro?.conteo_id
      if (!conteo_id) return []

      // El `conteo_id` llega del navegador, así que el acta se pide por id: hay que
      // comprobar que ese conteo es de una empresa que este usuario puede ver, o el id de
      // otra empresa bastaría para bajarse su acta.
      const { data: cab } = await db.from('conteos').select('almacen_id, estado')
        .eq('client_id', cid).eq('conteo_id', conteo_id)
        .in('empresa_id', alcance(filtro))
        .maybeSingle()
      if (!cab) return []

      const [lineasRes, prodRes, stockRes, movRes, monRes] = await Promise.all([
        db.from('conteo_lineas').select('producto_id, contado, motivo_tipo, nota')
          .eq('client_id', cid).eq('conteo_id', conteo_id),
        db.from('products').select('producto_id, codigo, nombre, unidad, costos').eq('client_id', cid),
        db.from('stock_almacenes').select('producto_id, cantidad')
          .eq('client_id', cid).eq('almacen_id', cab.almacen_id as string),
        db.from('movimientos_inventario').select('producto_id, cantidad')
          .eq('client_id', cid).eq('referencia_id', conteo_id).eq('tipo', 'AJUSTE'),
        db.from('monedas').select('codigo').eq('client_id', cid).eq('activa', true).order('codigo'),
      ])

      type Prd = { producto_id: string; codigo: string; nombre: string; unidad: string; costos: Record<string, number> | null }
      const prodDe = new Map(((prodRes.data ?? []) as Prd[]).map(p => [p.producto_id, p]))
      const vivoDe = new Map(((stockRes.data ?? []) as { producto_id: string; cantidad: number }[])
        .map(s => [s.producto_id, Number(s.cantidad)]))
      const aplicadoDe = new Map<string, number>()
      for (const m of (movRes.data ?? []) as { producto_id: string; cantidad: number }[]) {
        aplicadoDe.set(m.producto_id, (aplicadoDe.get(m.producto_id) ?? 0) + Number(m.cantidad))
      }

      type Lin = { producto_id: string; contado: number | null; motivo_tipo: string | null; nota: string | null }
      const lineas = (lineasRes.data ?? []) as Lin[]
      const moneda = ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo)
        .find(m => lineas.some(l => prodDe.get(l.producto_id)?.costos?.[m] != null)) ?? null

      const out: ValorCelda[][] = []
      for (const l of lineas) {
        const p = prodDe.get(l.producto_id)
        if (!p) continue
        const costo = moneda ? (p.costos?.[moneda] ?? null) : null
        const vivo  = vivoDe.get(l.producto_id) ?? 0

        // Sin contar: se dice con esas dos palabras y las columnas de diferencia van
        // VACÍAS. Un 0 en «Diferencia» diría «cuadra», que es la conclusión contraria.
        if (l.contado == null) {
          out.push([
            p.codigo, p.nombre, p.unidad ?? '',
            vivo, 'Sin contar', '', '', '',
            costo != null ? `${costo} ${moneda}` : '', '',
          ])
          continue
        }

        const contado = Number(l.contado)
        const dif     = aplicadoDe.get(l.producto_id) ?? (contado - vivo)
        out.push([
          p.codigo, p.nombre, p.unidad ?? '',
          Math.round((contado - dif) * 1000) / 1000,
          contado,
          Math.round(dif * 1000) / 1000,
          l.motivo_tipo ? (MOTIVO_LABEL[l.motivo_tipo as MotivoTipo] ?? l.motivo_tipo) : '',
          l.nota ?? '',
          costo != null ? `${costo} ${moneda}` : '',
          costo != null ? `${Math.round(dif * costo * 100) / 100} ${moneda}` : '',
        ])
      }
      // Orden: primero lo que descuadra (faltantes arriba, que es lo que hay que
      // explicar), luego lo que cuadra y AL FINAL lo que no se contó — que no es un
      // resultado del conteo, es una tarea pendiente. Dentro de cada grupo, por nombre.
      const rango = (f: ValorCelda[]) => f[5] === '' ? 2 : Number(f[5]) === 0 ? 1 : 0
      return out.sort((a, b) =>
        rango(a) - rango(b)
        || (rango(a) === 0 ? Number(a[5]) - Number(b[5]) : 0)
        || String(a[1]).localeCompare(String(b[1]), 'es'))
    },
  },
  {
    // El HISTORIAL de conteos de un almacén: cuándo se contó, quién y cómo salió. Es lo
    // que pide la pestaña «Conteos», y no lo cubría ninguna entrada: `acta_conteo` es UN
    // conteo (el detalle de sus líneas) y este es la lista. Sin él, el botón de descarga
    // de esa pestaña se llevaba los movimientos del almacén — otra cosa, y sin decirlo.
    clave: 'conteos',
    etiqueta: 'Conteos',
    modulos: ['inventario'],
    cabeceras: ['Fecha', 'Conteo', 'Almacén', 'Contado por', 'Contadas', 'Diferencias',
      'Estado', 'Aplicado', 'Notas'],
    cargar: async (db, cid, filtro) => {
      const [filas, almacenes] = await Promise.all([
        leer(db, 'conteos', cid,
          'conteo_id, almacen_id, fecha, estado, contado_por, notas, aplicado_at', 'fecha',
          filtro, 'fecha', ['contado_por', 'notas'],
          { almacen_id: filtro?.almacen_id }),
        diccionario(db, 'almacenes', cid, 'almacen_id', 'nombre'),
      ])
      if (!filas.length) return []

      // Contadas y descuadres, del mismo tirón para todos. Una línea CON CAUSA es, por
      // definición, una que descuadró (la causa solo se pide cuando hay diferencia), así
      // que no hay que reconstruir el descuadre de cada conteo viejo contra el stock de
      // hoy — que además ya no es el de entonces.
      const ids = filas.map(f => f.conteo_id as string)
      const { data: lineas } = await db.from('conteo_lineas')
        .select('conteo_id, motivo_tipo')
        .eq('client_id', cid).in('conteo_id', ids).not('contado', 'is', null)
      const contadas = new Map<string, number>()
      const difs     = new Map<string, number>()
      for (const l of (lineas ?? []) as { conteo_id: string; motivo_tipo: string | null }[]) {
        contadas.set(l.conteo_id, (contadas.get(l.conteo_id) ?? 0) + 1)
        if (l.motivo_tipo) difs.set(l.conteo_id, (difs.get(l.conteo_id) ?? 0) + 1)
      }

      return filas.map(f => [
        f.fecha as string,
        f.conteo_id as string,
        almacenes.get(f.almacen_id as string) ?? (f.almacen_id as string),
        (f.contado_por as string) ?? '',
        contadas.get(f.conteo_id as string) ?? 0,
        difs.get(f.conteo_id as string) ?? 0,
        f.estado === 'APLICADO' ? 'Aplicado' : 'Borrador',
        (f.aplicado_at as string)?.slice(0, 10) ?? '',
        (f.notas as string) ?? '',
      ])
    },
  },
  {
    clave: 'almacenes',
    etiqueta: 'Almacenes',
    modulos: ['inventario'],
    cabeceras: ['Nombre', 'Tipo', 'Descripción', 'Empresa', 'Activo'],
    cargar: async (db, cid, filtro) => {
      const [filas, empresas] = await Promise.all([
        leer(db, 'almacenes', cid, 'nombre, tipo, descripcion, empresa_id, activo', 'nombre',
          filtro, undefined, ['nombre', 'descripcion'],
          { empresa_id: filtro?.empresa_id, activo: !filtro?.archivadas }),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.nombre as string, f.tipo as string, f.descripcion as string,
        empresas.get(f.empresa_id as string) ?? '', f.activo as boolean,
      ])
    },
  },
  {
    clave: 'compras',
    etiqueta: 'Compras',
    modulos: ['inventario'],
    cabeceras: ['Número', 'Fecha', 'Proveedor', 'Almacén', 'Empresa', 'Moneda', 'Total',
      'Estado', 'Notas'],
    cargar: async (db, cid, filtro) => {
      const [filas, terceros, almacenes, empresas] = await Promise.all([
        leer(db, 'compras', cid,
          'numero, fecha, proveedor_id, almacen_id, empresa_id, moneda, total, estado, notas', 'fecha',
          filtro, 'fecha', ['numero', 'notas'],
          {
            empresa_id:   filtro?.empresa_id,
            estado:       filtro?.estado,
            proveedor_id: filtro?.tercero,
            almacen_id:   filtro?.almacen_id,
          }),
        diccionario(db, 'third_parties', cid, 'tercero_id', 'nombre'),
        diccionario(db, 'almacenes',     cid, 'almacen_id', 'nombre'),
        diccionario(db, 'empresas',      cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.numero as string, f.fecha as string,
        f.proveedor_id ? (terceros.get(f.proveedor_id as string) ?? '') : '',
        almacenes.get(f.almacen_id as string) ?? '',
        empresas.get(f.empresa_id as string) ?? '',
        f.moneda as string, f.total as number, f.estado as string, f.notas as string,
      ])
    },
  },
  {
    clave: 'empleados',
    etiqueta: 'Personal',
    modulos: ['rrhh'],
    cabeceras: ['Código', 'Nombre', 'Apellidos', 'Documento', 'Cargo', 'Departamento',
      'Tipo de contrato', 'Fecha de alta', 'Salario base', 'Moneda', 'Periodicidad',
      'Empresa', 'Fecha de baja', 'Email', 'Teléfono'],
    cargar: async (db, cid, filtro) => {
      const [filas, empresas] = await Promise.all([
        leer(db, 'empleados', cid,
          'empleado_id, nombre, apellidos, documento, cargo, departamento, tipo_contrato, fecha_alta, salario_base, moneda, periodicidad, empresa_id, fecha_baja, email, telefono', 'nombre',
          filtro, undefined, ['nombre', 'apellidos', 'documento', 'cargo', 'empleado_id'],
          { empresa_id: filtro?.empresa_id, departamento: filtro?.categoria }),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas
        // «Activo» y «Baja» no son una columna: se derivan de `fecha_baja`
        // (`estadoDe` en rrhh.ts). Por eso el filtro se aplica aquí y no en la consulta.
        .filter(f => !filtro?.estado
          || (filtro.estado === 'BAJA' ? !!f.fecha_baja : !f.fecha_baja))
        .map(f => [
        f.empleado_id as string, f.nombre as string, f.apellidos as string,
        f.documento as string, f.cargo as string, f.departamento as string,
        f.tipo_contrato as string, f.fecha_alta as string, f.salario_base as number,
        f.moneda as string, f.periodicidad as string,
        empresas.get(f.empresa_id as string) ?? '', f.fecha_baja as string,
        f.email as string, f.telefono as string,
      ])
    },
  },
  {
    clave: 'nominas',
    etiqueta: 'Nóminas',
    modulos: ['rrhh'],
    // El listado; el DETALLE de una nómina ya tiene su propio Excel con formato de
    // documento (`lib/rrhh/nomina-xlsx.ts`), que es otra cosa.
    cabeceras: ['Período', 'Fecha', 'Empresa', 'Moneda', 'Total', 'Estado', 'Notas'],
    cargar: async (db, cid, filtro) => {
      const [filas, empresas] = await Promise.all([
        leer(db, 'nominas', cid, 'periodo, fecha, empresa_id, moneda, total, estado, notas', 'periodo',
          filtro, 'fecha', ['periodo', 'notas'],
          { empresa_id: filtro?.empresa_id, estado: filtro?.estado }),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.periodo as string, f.fecha as string,
        empresas.get(f.empresa_id as string) ?? '',
        f.moneda as string, f.total as number, f.estado as string, f.notas as string,
      ])
    },
  },
  {
    clave: 'turnos',
    etiqueta: 'Turnos',
    modulos: ['rrhh'],
    cabeceras: ['Turno', 'Hora de inicio', 'Hora de fin', 'Empresa', 'Activo'],
    cargar: async (db, cid, filtro) => {
      const [filas, empresas] = await Promise.all([
        leer(db, 'turnos', cid, 'nombre, hora_inicio, hora_fin, empresa_id, activo', 'nombre',
          filtro, undefined, ['nombre'],
          { empresa_id: filtro?.empresa_id, activo: !filtro?.archivadas }),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.nombre as string, f.hora_inicio as string, f.hora_fin as string,
        empresas.get(f.empresa_id as string) ?? '', f.activo as boolean,
      ])
    },
  },
  {
    clave: 'suscripciones',
    etiqueta: 'Suscripciones',
    modulos: ['servicios'],
    // «Servicios» y «Cada cobro» no son adorno: una descarga de acuerdos que no dice qué
    // tiene contratado el cliente ni cuánto se le cobra no responde a la pregunta que la
    // motiva. El precio vive en las LÍNEAS desde la mig. 124 (`precio_pactado` se fue con
    // la 121/124), así que el importe se calcula con `calcularCobroAcuerdo` — la MISMA
    // función que la pantalla, nunca una copia local.
    cabeceras: ['Cliente', 'Empresa', 'Servicios', 'Moneda', 'Cada cobro', 'Periodicidad',
      'Inicio', 'Próximo cobro', 'Fin', 'Renovación automática', 'Estado', 'Notas'],
    cargar: async (db, cid, filtro) => {
      const [filas, terceros, empresas, servicios, { data: lins }] = await Promise.all([
        leer(db, 'suscripciones', cid,
          'suscripcion_id, cliente_id, empresa_id, moneda, periodicidad, fecha_inicio, fecha_proximo_cobro, fecha_fin, renovacion_automatica, estado, notas', 'fecha_proximo_cobro',
          filtro, 'fecha_proximo_cobro', ['notas'],
          // `estado` NO se filtra en la consulta: la pantalla ofrece «Vencida», que se
          // DERIVA (mig. 125) y no existe como valor guardado — pedirla a la BD devolvía
          // un fichero vacío. Se filtra abajo con la misma función que la vista.
          { empresa_id: filtro?.empresa_id, cliente_id: filtro?.tercero }),
        diccionario(db, 'third_parties', cid, 'tercero_id', 'nombre'),
        diccionario(db, 'empresas',      cid, 'empresa_id', 'nombre'),
        diccionario(db, 'products',      cid, 'producto_id', 'nombre'),
        db.from('suscripcion_lineas')
          .select('suscripcion_id, producto_id, precio_mensual, descuento_modo, descuento_valor')
          .eq('client_id', cid),
      ])
      const porAcuerdo = new Map<string, {
        producto_id: string; precio_mensual: number
        descuento_modo: DescuentoModo; descuento_valor: number
      }[]>()
      for (const l of (lins ?? []) as Record<string, unknown>[]) {
        const sid = l.suscripcion_id as string
        const arr = porAcuerdo.get(sid) ?? []
        arr.push({
          producto_id:     l.producto_id as string,
          precio_mensual:  Number(l.precio_mensual) || 0,
          descuento_modo:  (l.descuento_modo === 'MONTO_FIJO' ? 'MONTO_FIJO' : 'PORCENTAJE') as DescuentoModo,
          descuento_valor: Number(l.descuento_valor) || 0,
        })
        porAcuerdo.set(sid, arr)
      }
      // «Hoy» en la zona del NEGOCIO, no en UTC: con `toISOString()` el 31 por la noche ya
      // era el 1, y el estado efectivo de un acuerdo que vence ese día salía distinto en el
      // fichero y en la pantalla.
      const hoy = hoyEnTz()
      return filas.filter(f => !filtro?.estado || estadoEfectivo({
        estado:                f.estado as 'ACTIVA' | 'PAUSADA' | 'CANCELADA',
        fecha_fin:             (f.fecha_fin as string | null) ?? null,
        renovacion_automatica: Boolean(f.renovacion_automatica),
      }, hoy) === filtro.estado).map(f => {
        const lineas = porAcuerdo.get(f.suscripcion_id as string) ?? []
        const { total } = calcularCobroAcuerdo(lineas, f.periodicidad as PeriodicidadSub)
        return [
          terceros.get(f.cliente_id as string) ?? '',
          empresas.get(f.empresa_id as string) ?? '',
          lineas.map(l => servicios.get(l.producto_id) ?? l.producto_id).join(', '),
          f.moneda as string, total, f.periodicidad as string,
          f.fecha_inicio as string, f.fecha_proximo_cobro as string, f.fecha_fin as string,
          f.renovacion_automatica as boolean, f.estado as string, f.notas as string,
        ]
      })
    },
  },
  {
    clave: 'cuentas',
    etiqueta: 'Cuentas y cajas',
    modulos: ['base'],
    cabeceras: ['Nombre', 'Tipo', 'Moneda', 'Saldo inicial', 'Empresa', 'Activa', 'Notas'],
    cargar: async (db, cid, filtro) => {
      const [filas, empresas] = await Promise.all([
        // La pestaña enseña activas O archivadas, nunca las dos: el fichero, igual.
        leer(db, 'cuentas', cid, 'nombre, tipo, moneda, saldo_inicial, empresa_id, activa, notas', 'nombre',
          filtro, undefined, ['nombre', 'notas'],
          { empresa_id: filtro?.empresa_id, activa: !filtro?.archivadas }),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.nombre as string, f.tipo as string, f.moneda as string, f.saldo_inicial as number,
        empresas.get(f.empresa_id as string) ?? '', f.activa as boolean, f.notas as string,
      ])
    },
  },
  {
    clave: 'operaciones_caja',
    etiqueta: 'Ventas del punto de venta',
    modulos: ['caja'],
    cabeceras: ['Fecha', 'Punto de venta', 'Moneda', 'Total', 'Medio de pago', 'Estado'],
    cargar: async (db, cid, filtro) => {
      const [filas, cajas] = await Promise.all([
        leer(db, 'caja_tickets', cid, 'fecha, caja_id, moneda, total, medio_pago, estado', 'fecha',
          filtro, 'fecha', ['medio_pago', 'moneda'],
          { caja_id: filtro?.cuenta_id, estado: filtro?.estado }),
        diccionario(db, 'cajas', cid, 'caja_id', 'nombre'),
      ])
      return filas.map(f => [
        f.fecha as string, cajas.get(f.caja_id as string) ?? (f.caja_id as string),
        f.moneda as string, f.total as number, f.medio_pago as string, f.estado as string,
      ])
    },
  },
  {
    // Las LÍNEAS de las ventas del TPV: la pestaña «Movimientos de stock» de Operaciones.
    // No existía, así que el botón de esa pestaña se llevaba los TICKETS
    // (`operaciones_caja`), que es la otra pestaña: el mismo botón, otro archivo, y sin
    // decirlo en ninguna parte.
    clave: 'lineas_caja',
    etiqueta: 'Movimientos de stock del punto de venta',
    modulos: ['caja'],
    cabeceras: ['Fecha', 'Punto de venta', 'Producto', 'Cantidad', 'Precio unitario', 'Moneda'],
    cargar: async (db, cid, filtro) => {
      // Los tickets primero: la línea no tiene fecha ni punto de venta propios —los
      // hereda del suyo— y es el ticket el que sabe si se anuló.
      const [tickets, cajas] = await Promise.all([
        leer(db, 'caja_tickets', cid, 'ticket_uuid, fecha, caja_id, moneda, estado', 'fecha',
          filtro, 'fecha', undefined, { caja_id: filtro?.cuenta_id }),
        diccionario(db, 'cajas', cid, 'caja_id', 'nombre'),
      ])
      // Un ticket ANULADO no movió stock (se rectificó): sus líneas no son un movimiento.
      // Mismo criterio que la pantalla — si el archivo las trajera, no cuadraría con ella.
      const vigentes = tickets.filter(t => (t.estado as string) !== 'ANULADO')
      if (!vigentes.length) return []

      const tkDe = new Map(vigentes.map(t => [t.ticket_uuid as string, t]))
      const { data: lineas } = await db.from('caja_ticket_lineas')
        .select('ticket_uuid, descripcion, cantidad, precio_unitario')
        .eq('client_id', cid).in('ticket_uuid', [...tkDe.keys()])

      // La búsqueda se aplica AQUÍ y no en `leer`: en esta pantalla el texto busca en el
      // nombre del producto, que vive en la línea y no en el ticket.
      const q = (filtro?.q ?? '').trim().toLowerCase()
      type Lin = { ticket_uuid: string; descripcion: string; cantidad: number; precio_unitario: number }
      return ((lineas ?? []) as Lin[])
        .map(l => ({ l, tk: tkDe.get(l.ticket_uuid)! }))
        .filter(({ l, tk }) => !q
          || (l.descripcion ?? '').toLowerCase().includes(q)
          || (cajas.get(tk.caja_id as string) ?? '').toLowerCase().includes(q))
        .sort((a, b) => String(a.tk.fecha).localeCompare(String(b.tk.fecha)))
        .map(({ l, tk }) => [
          tk.fecha as string,
          cajas.get(tk.caja_id as string) ?? (tk.caja_id as string),
          l.descripcion ?? '',
          Number(l.cantidad),
          Number(l.precio_unitario),
          tk.moneda as string,
        ])
    },
  },
  {
    clave: 'cierres_caja',
    etiqueta: 'Cierres de caja',
    modulos: ['caja'],
    // Los totales son `jsonb` POR MONEDA: no caben en una columna «total» sin mentir
    // (sumar CUP con USD no es una cifra). Se vuelca una fila por cierre y moneda.
    cabeceras: ['Cierre nº', 'Punto de venta', 'Abierta', 'Cerrada', 'Estado', 'Moneda',
      'Fondo inicial', 'Ventas', 'Efectivo contado', 'Descuadre'],
    cargar: async (db, cid, filtro) => {
      const [filas, cajas] = await Promise.all([
        leer(db, 'caja_sesiones', cid,
          'numero_z, caja_id, abierta_at, cerrada_at, estado, fondo_inicial, total_por_moneda, efectivo_contado', 'abierta_at',
          filtro, 'abierta_at', undefined, { caja_id: filtro?.cuenta_id, estado: filtro?.estado }),
        diccionario(db, 'cajas', cid, 'caja_id', 'nombre'),
      ])
      const num = (v: unknown) => Number(v ?? 0) || 0
      return filas.flatMap(f => {
        const fondo    = (f.fondo_inicial    ?? {}) as Record<string, number>
        const ventas   = (f.total_por_moneda ?? {}) as Record<string, number>
        const contado  = (f.efectivo_contado ?? {}) as Record<string, number>
        const monedas  = [...new Set([...Object.keys(fondo), ...Object.keys(ventas), ...Object.keys(contado)])].sort()
        const base = [
          f.numero_z as number, cajas.get(f.caja_id as string) ?? (f.caja_id as string),
          f.abierta_at as string, f.cerrada_at as string, f.estado as string,
        ]
        // Un cierre sin ninguna moneda sigue saliendo: que no haya vendido nada es
        // información, y omitirlo dejaría un hueco en la serie de números Z.
        if (monedas.length === 0) return [[...base, '', 0, 0, 0, 0]] as ValorCelda[][]
        return monedas.map(m => [
          ...base, m, num(fondo[m]), num(ventas[m]), num(contado[m]),
          num(contado[m]) - (num(fondo[m]) + num(ventas[m])),
        ])
      })
    },
  },
  // ── Reservas y Citas: la MISMA tabla `reservas`, dos módulos ──────────────────
  // Una cita es una reserva con `recurso_id` (agenda de profesionales); una reserva de
  // mesa cuelga de una franja horaria. Se separan por eso, no por una columna «tipo».
  {
    clave: 'reservas',
    etiqueta: 'Reservas',
    modulos: ['reservas_citas'],
    cabeceras: ['Fecha', 'Hora', 'Cliente', 'Teléfono', 'Personas', 'Canal', 'Estado', 'Notas'],
    cargar: async (db, cid, filtro) => {
      // La búsqueda NO se delega a `leer`: en la pantalla el texto busca también en el
      // nombre del TURNO, que vive en otra tabla. Delegándola, el fichero traía MENOS filas
      // que la pantalla al buscar por turno — y una descarga que se queda corta es peor que
      // una que no filtra. Mismo patrón que `lineas_caja`.
      const [filas, franjas] = await Promise.all([
        leer(db, 'reservas', cid,
          'fecha, hora, nombre_cliente, telefono, personas, canal, estado, notas, recurso_id, franja_id', 'fecha',
          filtro, 'fecha', undefined,
          { estado: filtro?.estado, canal: filtro?.tipo, franja_id: filtro?.categoria }),
        diccionario(db, 'reserva_franjas', cid, 'franja_id', 'nombre'),
      ])
      const q = (filtro?.q ?? '').trim().toLowerCase()
      return filas
        .filter(f => !f.recurso_id)   // las que llevan recurso son citas, no reservas
        .filter(f => !q || [
          f.nombre_cliente, f.telefono, f.notas,
          f.franja_id ? franjas.get(f.franja_id as string) : '',
        ].filter(Boolean).join(' ').toLowerCase().includes(q))
        .map(f => [
          f.fecha as string, f.hora as string, f.nombre_cliente as string,
          f.telefono as string, f.personas as number, f.canal as string,
          f.estado as string, f.notas as string,
        ])
    },
  },
  {
    clave: 'citas',
    etiqueta: 'Citas',
    modulos: ['agenda'],
    cabeceras: ['Fecha', 'Hora', 'Hasta', 'Cliente', 'Teléfono', 'Profesional',
      'Servicio', 'Canal', 'Estado', 'Notas'],
    cargar: async (db, cid, filtro) => {
      // La búsqueda se aplica ABAJO y no en `leer`: en la agenda el texto busca también por
      // servicio y profesional, que son nombres de otras tablas. Delegándola, buscar «corte»
      // devolvía un fichero con menos citas de las que enseña la pantalla.
      const [filas, recursos, servicios] = await Promise.all([
        leer(db, 'reservas', cid,
          'fecha, hora, hora_fin, nombre_cliente, telefono, recurso_id, servicio_id, canal, estado, notas', 'fecha',
          filtro, 'fecha', undefined,
          { estado: filtro?.estado, recurso_id: filtro?.categoria, servicio_id: filtro?.tipo }),
        diccionario(db, 'recursos',  cid, 'recurso_id',  'nombre'),
        diccionario(db, 'servicios', cid, 'servicio_id', 'nombre'),
      ])
      const q = (filtro?.q ?? '').trim().toLowerCase()
      return filas
        .filter(f => !!f.recurso_id)
        .map(f => ({
          f,
          recurso:  recursos.get(f.recurso_id as string) ?? '',
          servicio: f.servicio_id ? (servicios.get(f.servicio_id as string) ?? '') : '',
        }))
        .filter(({ f, recurso, servicio }) => !q || [
          f.nombre_cliente, f.telefono, f.notas, servicio, recurso,
        ].filter(Boolean).join(' ').toLowerCase().includes(q))
        .map(({ f, recurso, servicio }) => [
          f.fecha as string, f.hora as string, f.hora_fin as string,
          f.nombre_cliente as string, f.telefono as string,
          recurso, servicio,
          f.canal as string, f.estado as string, f.notas as string,
        ])
    },
  },
  {
    clave: 'catalogo_items',
    etiqueta: 'Catálogo digital',
    modulos: ['catalogo_qr'],
    cabeceras: ['Artículo', 'Categoría', 'Descripción', 'Precio', 'Moneda',
      'Ingredientes', 'Alérgenos', 'Calorías', 'Disponible', 'Activo'],
    cargar: async (db, cid, filtro) => {
      const [filas, categorias] = await Promise.all([
        leer(db, 'catalogo_items', cid,
          'nombre, categoria_id, descripcion, precio, moneda, ingredientes, alergenos, calorias, disponible, activo', 'orden',
          filtro, undefined, ['nombre', 'descripcion', 'ingredientes'],
          { categoria_id: filtro?.categoria, activo: !filtro?.archivadas }),
        diccionario(db, 'catalogo_categorias', cid, 'categoria_id', 'nombre'),
      ])
      return filas.map(f => [
        f.nombre as string,
        f.categoria_id ? (categorias.get(f.categoria_id as string) ?? '') : '',
        f.descripcion as string, f.precio as number, f.moneda as string,
        f.ingredientes as string, f.alergenos as string, f.calorias as number,
        f.disponible as boolean, f.activo as boolean,
      ])
    },
  },
]

export function tablaPorClave(clave: string): TablaExportable | undefined {
  return TABLAS_EXPORTABLES.find(t => t.clave === clave)
}
