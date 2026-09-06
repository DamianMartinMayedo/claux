// Registro de listados exportables DEL ADMIN — «sácame todos los X de la plataforma».
//
// Hermano de `tablas.ts`, que hace lo mismo para el portal. Son dos registros y no uno
// porque lo único que comparten es la forma: las tablas del portal son de UN cliente y
// se cierran con su módulo contratado; éstas son de la plataforma entera y se cierran
// con la SECCIÓN del admin (`SeccionKey`) — un vendedor con permiso de Solicitudes no
// puede descargarse la lista de pagos por escribir otra clave en la petición.
//
// Antes de esto había dos CSV escritos a mano —clientes y pagos— que compartían el
// mismo defecto: separador COMA. El destino real de estos ficheros es Excel en español,
// donde la coma es el separador decimal, así que el fichero se abría con todo metido en
// una sola columna. `lib/exportar/csv.ts` ya sabía hacerlo bien (punto y coma, BOM,
// decimal con coma) y no lo usaba nadie de este lado.
//
// Las columnas se eligen a mano en vez de volcar `select *`: se traducen a nombres que
// un humano entiende y no se filtra ningún dato por accidente.
//
// No es 'use server': lo consume la server action `exportarListadoAdmin`.

import type { SeccionKey } from '@/lib/roles'
import {
  cicloLabel, esSocioHoy, monedaDelCliente, precioMensualEfectivo, METODO_PAGO_LABEL,
  type CondicionesCliente,
} from '@/lib/billing'
import { normalizarMonedaClaux } from '@/lib/moneda-claux'
import { hoyEnTz } from '@/lib/fecha-tz'
import type { ValorCelda } from './csv'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * Filtros que puede recibir una exportación del admin.
 *
 * Los aplica cada entrada que los entienda y los ignora la que no: ninguna exporta
 * MENOS de lo que debería por no implementar uno.
 */
export interface FiltroAdmin {
  desde?:     string
  hasta?:     string
  q?:         string
  estado?:    string
  client_id?: string
  /** Pagos: forma de pago (`payments.metodo`). */
  metodo?:    string
  /** Pagos: `configuracion` (el cobro único del alta) o `suscripcion` (todo lo demás). */
  concepto?:  string
  /** Clientes: los archivados no salen salvo que se pidan, igual que en la pantalla. */
  archivados?: boolean
  /** Actividad: sobre qué se actuó (`audit_log.entity`). */
  entidad?:   string
}

export interface TablaAdminExportable {
  /** Clave estable: viaja del navegador a la server action. */
  clave:     string
  /** Nombre visible en el menú y base del nombre de fichero. */
  etiqueta:  string
  /**
   * Sección que da derecho a descargarlo. Es EL candado de esta exportación: que el
   * botón no se pinte no es control de acceso.
   */
  seccion:   SeccionKey
  cabeceras: string[]
  cargar:    (db: Db, filtro?: FiltroAdmin) => Promise<ValorCelda[][]>
}

/** `select` + rango de fechas + búsqueda + orden, que es idéntico en todas. */
async function leer(
  db: Db, tabla: string, columnas: string, orden: string,
  filtro?: FiltroAdmin, campoFecha?: string, camposTexto?: string[],
  iguales?: Record<string, string | undefined>,
  /** Techo de filas. Solo lo pone quien puede crecer sin fin (el registro de actividad). */
  limite?: number,
  /** Pertenencias a un conjunto (los clientes que casan con la búsqueda). Restringen. */
  enLista?: Record<string, string[] | undefined>,
  /**
   * Pertenencia que se SUMA a la búsqueda de texto en vez de restringirla: entra en el
   * mismo `or`. Es lo que hace falta cuando la pantalla busca a la vez en campos de la
   * tabla y en el nombre del cliente, que vive en otra —un mismo texto puede casar con el
   * asunto de un mensaje Y con la empresa de otro, y los dos tienen que salir—.
   */
  enListaO?: { columna: string; valores: string[] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  let q = db.from(tabla).select(columnas)
  if (campoFecha && filtro?.desde) q = q.gte(campoFecha, filtro.desde)
  if (campoFecha && filtro?.hasta) q = q.lte(campoFecha, `${filtro.hasta}T23:59:59.999Z`)
  for (const [col, val] of Object.entries(iguales ?? {})) if (val) q = q.eq(col, val)
  for (const [col, val] of Object.entries(enLista ?? {})) if (val?.length) q = q.in(col, val)
  if (filtro?.q && (camposTexto?.length || enListaO?.valores.length)) {
    const t = filtro.q.replace(/[%,()]/g, ' ').trim()
    const cond = t ? (camposTexto ?? []).map(c => `${c}.ilike.%${t}%`) : []
    if (t && enListaO?.valores.length) {
      cond.push(`${enListaO.columna}.in.(${enListaO.valores.map(v => `"${v}"`).join(',')})`)
    }
    if (cond.length) q = q.or(cond.join(','))
  }
  if (limite) q = q.limit(limite)
  const { data, error } = await q.order(orden, { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Nombre de empresa por `client_id`, en UNA consulta y no una por fila. */
async function nombresDeClientes(db: Db, ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)].filter(Boolean)
  if (!unicos.length) return new Map()
  const { data } = await db.from('clients').select('client_id, nombre_empresa').in('client_id', unicos)
  return new Map((data ?? []).map((c: { client_id: string; nombre_empresa: string }) =>
    [c.client_id, c.nombre_empresa]))
}

/**
 * Techo del registro de actividad. Es la única de estas tablas que crece sin freno —una
 * fila por cada cosa que hace el equipo— y el .xlsx se construye ENTERO en memoria en un
 * serverless: sin techo, el día que haya 200.000 líneas la descarga no falla, se queda
 * colgada. Con las últimas 5.000 y el rango de fechas se llega a cualquier sitio.
 */
const LIMITE_ACTIVIDAD = 5000

const si = (v: unknown) => (v ? 'Sí' : '')
const fechaSola = (v: unknown) => (v ? String(v).slice(0, 10) : '')

export const TABLAS_ADMIN: TablaAdminExportable[] = [
  {
    clave: 'clientes',
    etiqueta: 'Clientes',
    seccion: 'clientes',
    // La moneda va en columna propia, no pegada al número ni en la cabecera: con dos
    // monedas en la misma hoja, «Precio mensual USD» mintiendo en la mitad de las filas
    // es peor que no traerla, y quien abra el fichero va a sumar la columna sin mirar.
    cabeceras: ['ID Cliente', 'Empresa', 'Contacto', 'Email', 'Estado', 'Nivel',
      'Precio mensual', 'Moneda', 'Ciclo', 'Socio CLAUX', 'Prueba', 'Expiración',
      'Alta', 'Archivado', 'Notas'],
    async cargar(db, filtro) {
      const filas = await leer(
        db, 'clients',
        'client_id, nombre_empresa, nombre_contacto, email_admin, estado, nivel, '
        + 'precio_mensual_usd, precio_mensual_eur, moneda_facturacion, ciclo_facturacion, '
        + 'es_socio, socio_desde, socio_hasta, descuento_pct, descuento_desde, descuento_hasta, '
        + 'es_prueba, fecha_expiracion, fecha_inicio, created_at, notas, archivado_at',
        'created_at', filtro, 'created_at',
        // Los mismos tres campos que busca la pantalla, ni uno más: un fichero que
        // trae filas que el listado no enseñaba es un fichero que no se puede cotejar.
        ['nombre_empresa', 'email_admin', 'client_id'],
        { estado: filtro?.estado },
      )
      const hoy = hoyEnTz()
      // Por defecto fuera los archivados, como el listado.
      const vivos = filtro?.archivados ? filas : filas.filter(c => !c.archivado_at)
      return vivos.map(c => [
        c.client_id, c.nombre_empresa, c.nombre_contacto ?? '', c.email_admin,
        c.estado, c.nivel,
        // El precio EFECTIVO —con socio, descuento y ciclo aplicados—, que es el que
        // se cobra. El cacheado en bruto ya está en la columna y no dice lo mismo.
        precioMensualEfectivo(c as CondicionesCliente, hoy),
        monedaDelCliente(c as CondicionesCliente),
        cicloLabel(c.ciclo_facturacion),
        si(esSocioHoy(c as CondicionesCliente, hoy)), si(c.es_prueba),
        fechaSola(c.fecha_expiracion), fechaSola(c.fecha_inicio ?? c.created_at),
        fechaSola(c.archivado_at), c.notas ?? '',
      ])
    },
  },
  {
    clave: 'pagos',
    etiqueta: 'Pagos',
    seccion: 'pagos',
    cabeceras: ['ID Pago', 'Fecha', 'Cliente', 'Empresa', 'Concepto', 'Estado', 'Método',
      'Monto', 'Moneda', 'Inicio período', 'Fin período', 'Notas'],
    async cargar(db, filtro) {
      // La pantalla busca por NOMBRE DE EMPRESA, y `payments` no lo tiene: se resuelven
      // antes los clientes que casan y se filtra por sus ids. Sin esto, escribir el
      // nombre de un cliente y darle a descargar devolvía cero filas.
      let idsBuscados: string[] | undefined
      if (filtro?.q?.trim()) {
        const t = filtro.q.replace(/[%,()]/g, ' ').trim()
        const { data } = await db.from('clients')
          .select('client_id').or(`nombre_empresa.ilike.%${t}%,client_id.ilike.%${t}%`)
        idsBuscados = (data ?? []).map((c: { client_id: string }) => c.client_id)
        if (!idsBuscados!.length) return []
      }
      const filas = await leer(
        db, 'payments',
        'pago_id, client_id, concepto, estado, metodo, monto, moneda, fecha, '
        + 'fecha_inicio_periodo, fecha_fin_periodo, notas',
        'fecha', { ...filtro, q: undefined }, 'fecha', undefined,
        { metodo: filtro?.metodo, client_id: filtro?.client_id },
        undefined, idsBuscados ? { client_id: idsBuscados } : undefined,
      )
      // Estado y concepto NO son igualdades: en la pantalla «Confirmado» significa
      // «todo lo que no está por confirmar» y «Suscripción», «todo lo que no es
      // configuración». Un `.eq()` habría dejado fuera las filas con el campo vacío,
      // que existen y que el listado sí enseña.
      const conConcepto = (p: { concepto: string | null }) =>
        p.concepto === 'configuracion' ? 'configuracion' : 'suscripcion'
      const conEstado = (p: { estado: string | null }) =>
        p.estado === 'por_confirmar' ? 'por_confirmar' : 'confirmado'
      const visibles = filas.filter(p =>
        (!filtro?.estado   || conEstado(p)   === filtro.estado) &&
        (!filtro?.concepto || conConcepto(p) === filtro.concepto))

      const nombre = await nombresDeClientes(db, visibles.map(p => p.client_id))
      return visibles.map(p => [
        p.pago_id, fechaSola(p.fecha), p.client_id, nombre.get(p.client_id) ?? '',
        conConcepto(p) === 'configuracion' ? 'Configuración' : 'Suscripción',
        conEstado(p) === 'por_confirmar' ? 'Por confirmar' : 'Confirmado',
        METODO_PAGO_LABEL[p.metodo] ?? p.metodo,
        Number(p.monto ?? 0), normalizarMonedaClaux(p.moneda),
        fechaSola(p.fecha_inicio_periodo), fechaSola(p.fecha_fin_periodo), p.notas ?? '',
      ])
    },
  },
  {
    clave: 'presupuestos',
    etiqueta: 'Presupuestos',
    seccion: 'presupuestos',
    cabeceras: ['Número', 'Fecha', 'Negocio', 'Contacto', 'Comercial', 'Estado', 'Nivel',
      'Horas est.', 'Horas reales', 'Tarifa/h', 'Instalación', 'Descuento %', 'Total',
      'Cuota/mes', 'Moneda', 'Cliente'],
    async cargar(db, filtro) {
      const filas = await leer(
        db, 'presupuestos_instalacion',
        'id, created_at, comercial_nombre, nombre_negocio, contacto, nivel, moneda, '
        + 'horas_total, coste_instalacion, cuota_mensual, horas_reales, estado, client_id, '
        + 'tarifa_hora, descuento_pct, total_final',
        'created_at', filtro, 'created_at', ['nombre_negocio', 'contacto', 'comercial_nombre'],
        { estado: filtro?.estado, client_id: filtro?.client_id },
      )
      return filas.map(p => [
        `PRE-${String(p.id).padStart(4, '0')}`, fechaSola(p.created_at),
        p.nombre_negocio, p.contacto ?? '', p.comercial_nombre ?? '', p.estado, p.nivel,
        Number(p.horas_total ?? 0), p.horas_reales == null ? '' : Number(p.horas_reales),
        Number(p.tarifa_hora ?? 0), Number(p.coste_instalacion ?? 0),
        Number(p.descuento_pct ?? 0), Number(p.total_final ?? p.coste_instalacion ?? 0),
        Number(p.cuota_mensual ?? 0), normalizarMonedaClaux(p.moneda), p.client_id ?? '',
      ])
    },
  },
  {
    clave: 'solicitudes',
    etiqueta: 'Solicitudes',
    seccion: 'solicitudes',
    cabeceras: ['Fecha', 'Nombre', 'Teléfono', 'Email', 'Sector', 'Cómo lo lleva hoy',
      'Necesidades', 'Módulos recomendados', 'Nivel recomendado', 'Estado', 'Pidió contacto'],
    async cargar(db, filtro) {
      const filas = await leer(
        db, 'diagnosticos',
        'id, created_at, nombre, telefono, email, sector, modo_actual, necesidades, '
        + 'modulos_rec, nivel_rec, estado, contacto_solicitado_at',
        'created_at', filtro, 'created_at', ['nombre', 'telefono', 'email'],
        { estado: filtro?.estado },
      )
      // Las claves se quedan como claves a propósito: traducirlas pide el catálogo
      // público entero, y quien se baja este fichero lo cruza con el catálogo, no lo lee.
      return filas.map(l => [
        fechaSola(l.created_at), l.nombre, l.telefono, l.email ?? '', l.sector,
        l.modo_actual ?? '', (l.necesidades ?? []).join(' · '),
        (l.modulos_rec ?? []).join(' · '), l.nivel_rec ?? '', l.estado,
        fechaSola(l.contacto_solicitado_at),
      ])
    },
  },
  {
    clave: 'soporte',
    etiqueta: 'Soporte',
    seccion: 'soporte',
    cabeceras: ['Fecha', 'Cliente', 'Empresa', 'Email', 'Asunto', 'Mensaje', 'Estado',
      'Módulo (oportunidad)', 'Respondido el', 'Respuesta'],
    async cargar(db, filtro) {
      // La bandeja busca también por NOMBRE DE EMPRESA —es lo primero que se lee en la
      // tabla— y `soporte_mensajes` solo guarda el `client_id`: se resuelven antes los
      // clientes que casan y su búsqueda se suma a la de los campos de texto.
      let idsBuscados: string[] | undefined
      if (filtro?.q?.trim()) {
        const t = filtro.q.replace(/[%,()]/g, ' ').trim()
        const { data } = await db.from('clients')
          .select('client_id').ilike('nombre_empresa', `%${t}%`)
        idsBuscados = (data ?? []).map((c: { client_id: string }) => c.client_id)
      }
      const filas = await leer(
        db, 'soporte_mensajes',
        'id, created_at, client_id, email, asunto, mensaje, estado, modulo_clave, '
        + 'respuesta, respuesta_at',
        'created_at', filtro, 'created_at',
        // Los mismos cuatro campos que busca la pantalla. La empresa entra por el `or` de
        // abajo, que suma sus ids a la condición en vez de sustituirla: un texto puede
        // casar con el asunto de un cliente Y con el nombre de otro.
        ['asunto', 'mensaje', 'email'],
        { estado: filtro?.estado, client_id: filtro?.client_id },
        undefined, undefined,
        idsBuscados?.length ? { columna: 'client_id', valores: idsBuscados } : undefined,
      )
      const nombre = await nombresDeClientes(db, filas.map(m => m.client_id))
      return filas.map(m => [
        fechaSola(m.created_at), m.client_id, nombre.get(m.client_id) ?? '', m.email ?? '',
        m.asunto, m.mensaje, m.estado, m.modulo_clave ?? '',
        fechaSola(m.respuesta_at), m.respuesta ?? '',
      ])
    },
  },
  {
    clave: 'actividad',
    etiqueta: 'Actividad',
    seccion: 'actividad',
    cabeceras: ['Fecha', 'Quién', 'Acción', 'Entidad', 'ID', 'Descripción'],
    async cargar(db, filtro) {
      const filas = await leer(
        db, 'audit_log',
        'id, created_at, user_email, entity, entity_id, action, description',
        'created_at', filtro, 'created_at', ['user_email', 'entity', 'entity_id', 'description'],
        { entity: filtro?.entidad }, LIMITE_ACTIVIDAD,
      )
      return filas.map(a => [
        a.created_at, a.user_email ?? '', a.action, a.entity, a.entity_id ?? '',
        a.description ?? '',
      ])
    },
  },
]

export function tablaAdminPorClave(clave: string): TablaAdminExportable | undefined {
  return TABLAS_ADMIN.find(t => t.clave === clave)
}
