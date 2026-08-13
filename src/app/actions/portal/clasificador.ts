'use server'

// ── La semilla del clasificador de cuentas por defecto ───────────────────────
//
// F1.3 del plan (docs/planes/clasificador-cuentas-feedback.md). El catálogo y los
// packs viven en `src/lib/catalogo/`; la atomicidad, en la RPC `cat_sembrar_pack`
// (mig. 186). Aquí solo queda decidir QUÉ pack le toca a este cliente y llamar.
//
// Dos pasadas siempre: `ensayarSemilla` primero —el ensayo previo es obligatorio,
// §12.1 b— y `sembrarPack` después. Una semilla no se deshace sola: enseñar antes
// lo que va a pasar es la única marcha atrás que hay.

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo } from './auth'
import { packDe, filasDelPack, PREGUNTA_SERVICIOS, PREGUNTA_C1, FASE_SEMBRABLE } from '@/lib/catalogo/packs'
import { ESTADOS_FACTURA_INGRESO } from '@/lib/contabilidad'
import { tieneModulo }  from '@/lib/modulos'
import { hoyEnTz }      from '@/lib/fecha-tz'
import { apuntesDeFilas, type FilaFacturaPL, type FilaGastoCobroPL } from '@/lib/pl/apuntes'
import { esRolPL, indexarCategorias, type CategoriaPL, type RolPL } from '@/lib/pl/estado'
import {
  candidatasPara, naceMarcada, duplicadosPropios,
  type Candidata, type Confianza, type CategoriaPropia,
} from '@/lib/catalogo/emparejar'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { impactoAgregado, type ImpactoEstructural, type OperacionEstructural } from '@/lib/pl/impacto'

export interface ResumenSemilla {
  ok: boolean
  error?:  string
  ensayo?: boolean
  /** Nombre del pack, para poder decir «pack de Gastronomía» y no «S1». */
  pack?:   string
  /** Se crearán / se crearon. */
  creadas?:   string[]
  /** Categorías principales suyas que pasan a ser el ancla del pack (variante C′). */
  ancladas?:  string[]
  /** Ya las tenía del pack: una segunda pasada no las toca. */
  yaTenia?:   string[]
  /** No se cargan porque ese nombre ya es suyo en ese nivel, activa o archivada. */
  ocupadas?:  string[]
  /** Se sembraron y las borró. No vuelven. */
  retiradas?: string[]
}

interface RespuestaRpc {
  ensayo: boolean
  creadas: string[]; ancladas: string[]
  ya_tenia: string[]; ocupadas: string[]; retiradas: string[]
}

/**
 * El sector del cliente y las dos respuestas que deciden qué se le siembra.
 *
 * `servicios` es la ruta de 4 de 6 clientes reales y no se resuelve solo: hay que
 * preguntar si trabaja con piezas o solo con su tiempo. La respuesta se guarda en
 * `clients.pack_servicios` para poder RE-preguntarla — equivocarse ahí sin marcha
 * atrás es un problema de adopción, no un fallo de una pantalla.
 *
 * `lleva_contador` es el interruptor del complemento C1 (fase 4, mig. 192), y es
 * ortogonal al sector: lo que enciende no depende del giro del negocio sino de
 * quién le lleva los libros. `null` = sin preguntar todavía, que no es «no».
 */
async function contextoDelPack(client_id: string) {
  const db = createAdminClient()
  const { data } = await db.from('clients')
    .select('sector, pack_servicios, lleva_contador')
    .eq('client_id', client_id)
    .maybeSingle()
  return {
    sector: (data?.sector as string | null) ?? null,
    respuestaServicios: (data?.pack_servicios as string | null) ?? null,
    llevaContador: (data?.lleva_contador as boolean | null) ?? null,
  }
}

async function correrSemilla(ensayo: boolean): Promise<ResumenSemilla> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  // Las categorías de gasto son del módulo `base`, igual que su alta manual
  // (`guardarCategoriaGasto`). Gatear la semilla más arriba dejaría al cliente
  // pudiendo crearlas a mano pero no de golpe, que es al revés de lo que hace
  // falta.
  if (!(await puedeEditarModulo('base'))) {
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  }

  const { sector, respuestaServicios, llevaContador } = await contextoDelPack(session.client_id)
  const pack  = packDe(sector, respuestaServicios)
  // Hasta donde el CHECK de `categorias_gastos.rol_pl` admite hoy: sembrar un rol
  // que no acepta no crea una fila mala, tira el insert entero. Ver FASE_SEMBRABLE.
  //
  // El complemento C1 solo va si el dueño dijo que sí. Sin preguntar (`null`) NO se
  // siembra: son diez categorías que quien lleva sus propias cuentas no va a usar
  // nunca, y una lista larga de cuentas que no entiende es justo lo que hace que
  // deje de clasificar.
  const filas = filasDelPack(pack, { hastaFase: FASE_SEMBRABLE, conC1: llevaContador === true })

  const db = createAdminClient()
  const { data, error } = await db.rpc('cat_sembrar_pack', {
    p_client_id: session.client_id,
    p_filas:     filas.map(f => ({
      clave: f.clave, nombre: f.nombre, padre: f.padre,
      rol:   f.rol,   descripcion: f.descripcion,
    })),
    p_ensayo:    ensayo,
  })
  if (error) return { ok: false, error: error.message }

  const r = data as RespuestaRpc
  if (!ensayo) {
    revalidatePath('/portal/gastos')
    revalidatePath('/portal/tesoreria')
  }

  return {
    ok: true, ensayo, pack: pack.nombre,
    creadas:   r.creadas   ?? [],
    ancladas:  r.ancladas  ?? [],
    yaTenia:   r.ya_tenia  ?? [],
    ocupadas:  r.ocupadas  ?? [],
    retiradas: r.retiradas ?? [],
  }
}

/** El ensayo previo. No escribe nada; dice exactamente lo que haría la de verdad. */
export async function ensayarSemilla(): Promise<ResumenSemilla> {
  return correrSemilla(true)
}

/** La pasada real. Solo tiene sentido después de enseñar el ensayo. */
export async function sembrarPack(): Promise<ResumenSemilla> {
  return correrSemilla(false)
}

/**
 * Las preguntas que hay que hacer ANTES de sembrar, con lo ya contestado.
 *
 * Van juntas en una sola acción porque se pintan en la misma pantalla y las dos
 * cambian lo que la semilla va a crear: preguntarlas por separado son dos viajes
 * al servidor para pintar un bloque. `aplica` en la de servicios porque solo tiene
 * sentido en ese sector; la del contador se le hace a todo el mundo.
 *
 * El texto viaja desde el servidor en lugar de importarlo el cliente para no
 * arrastrar el catálogo entero —seis packs y casi doscientas entradas— al bundle
 * del navegador por dos frases.
 */
export async function preguntasDeSemilla(): Promise<{
  servicios: {
    aplica: boolean
    texto: string
    opciones: { valor: string; etiqueta: string }[]
    respuesta: string | null
  }
  contador: {
    texto: string
    ejemplo: string
    opciones: { valor: boolean; etiqueta: string }[]
    respuesta: boolean | null
  }
}> {
  const session = await getPortalSession()
  const servicios = {
    aplica: false,
    texto: PREGUNTA_SERVICIOS.texto,
    opciones: PREGUNTA_SERVICIOS.opciones.map(o => ({ valor: o.valor, etiqueta: o.etiqueta })),
    respuesta: null as string | null,
  }
  const contador = {
    texto: PREGUNTA_C1.texto,
    ejemplo: PREGUNTA_C1.ejemplo,
    opciones: PREGUNTA_C1.opciones.map(o => ({ valor: o.valor as boolean, etiqueta: o.etiqueta })),
    respuesta: null as boolean | null,
  }
  if (!session) return { servicios, contador }

  const ctx = await contextoDelPack(session.client_id)
  return {
    servicios: { ...servicios, aplica: ctx.sector === 'servicios', respuesta: ctx.respuestaServicios },
    contador:  { ...contador, respuesta: ctx.llevaContador },
  }
}

/**
 * Guarda la respuesta a la pregunta de `servicios`.
 *
 * Cambiarla NO resiembra: las categorías que ya tiene son suyas. Solo cambia lo
 * que le ofrecerá la próxima semilla y —desde la fase 3— los conceptos del
 * dossier. Resembrar por un cambio de respuesta le llenaría la pantalla de filas
 * que no pidió.
 */
export async function guardarRespuestaServicios(valor: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) {
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  }

  const valido = PREGUNTA_SERVICIOS.opciones.some(o => o.valor === valor)
  if (!valido) return { ok: false, error: 'Respuesta no reconocida.' }

  const db = createAdminClient()
  const { error } = await db.from('clients')
    .update({ pack_servicios: valor })
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  return { ok: true }
}

/**
 * Guarda si un contador le lleva los libros (interruptor del complemento C1).
 *
 * Como la de servicios: cambiarla NO resiembra ni retira nada. Lo ya creado es
 * suyo —puede tener apuntes— y apagar el interruptor no puede borrarle categorías
 * en uso. Solo cambia lo que le ofrecerá la próxima pasada de la semilla.
 */
export async function guardarLlevaContador(valor: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) {
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  }

  const db = createAdminClient()
  const { error } = await db.from('clients')
    .update({ lleva_contador: valor })
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  return { ok: true }
}

// ── F1.5 · El aviso ante una operación estructural ───────────────────────────
//
// Cambiar el `rol_pl` de una categoría, o mover una subcategoría a otra raíz, no
// toca ni un apunte y aun así reescribe el informe HACIA ATRÁS: el gasto de enero
// se recalcula con el catálogo de hoy. Antes de esto el dueño no podía verlo venir
// —ni entender después por qué su margen bruto había cambiado solo.
//
// La cuenta es barata: `construirResultadosPorMoneda` es pura y sin I/O, así que
// basta con correrla dos veces sobre los MISMOS apuntes (`@/lib/pl/impacto`). Lo
// único que cuesta una consulta es traer los apuntes del período.

/** Cuántos meses de historia entran en el aviso, contando el mes en curso. */
const MESES_DEL_AVISO = 12

/** El rango del aviso: los últimos doce meses del negocio, en su propia zona horaria. */
function rangoDelAviso(): { desde: string; hasta: string } {
  const hasta = hoyEnTz()
  const [a, m] = hasta.split('-').map(Number)
  // Meses absolutos desde el año 0: evita el `if (mes < 1)` y el fallo de fin de mes.
  const abs   = a * 12 + (m - 1) - (MESES_DEL_AVISO - 1)
  const desde = `${String(Math.floor(abs / 12)).padStart(4, '0')}-${String((abs % 12) + 1).padStart(2, '0')}-01`
  return { desde, hasta }
}

export interface ImpactoPrevio {
  ok: boolean
  error?: string
  /** El período sobre el que se ha calculado, para poder nombrarlo en el aviso. */
  desde?: string
  hasta?: string
  impacto?: ImpactoEstructural
}

/**
 * Lo que le pasaría al informe si se aplicaran estas operaciones.
 *
 * Acepta un lote y no una sola operación por el modo «mover hijas» del asistente:
 * dieciséis avisos seguidos no los lee nadie, así que se aplican todos sobre el
 * mismo catálogo y se enseña UNA comparación al final (§ requisito 4 de la ronda 5).
 *
 * No escribe. No necesita `puedeEditarModulo` —quien no pueda editar tampoco verá
 * el botón que lo aplica—, pero sí sesión: son cifras del negocio.
 */
export async function previsualizarImpacto(
  ops: OperacionEstructural[],
): Promise<ImpactoPrevio> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!ops.length) return { ok: false, error: 'No hay ningún cambio que previsualizar.' }

  const { desde, hasta } = rangoDelAviso()
  const db = createAdminClient()

  // Sin filtro de empresa a propósito: el catálogo de categorías es del CLIENTE,
  // así que un cambio en él mueve el informe de todas sus empresas a la vez.
  const [facRes, gcRes, catRes, cliRes] = await Promise.all([
    // `factura_id` va aunque este aviso no clasifique el ingreso: es la identidad
    // que `apuntesDeFilas` usa para buscar las líneas, y sin ella el tipo mentiría.
    db.from('facturas').select('factura_id, moneda, total, fecha_emision')
      .eq('client_id', session.client_id)
      .in('estado', ESTADOS_FACTURA_INGRESO)
      .gte('fecha_emision', desde).lte('fecha_emision', hasta),
    db.from('gastos_cobros').select('tipo, moneda, monto, categoria, categoria_id, fecha, origen_tipo, naturaleza')
      .eq('client_id', session.client_id)
      .gte('fecha', desde).lte('fecha', hasta),
    db.from('categorias_gastos').select('categoria_id, nombre, parent_id, rol_pl')
      .eq('client_id', session.client_id),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle(),
  ])

  const categorias: CategoriaPL[] = ((catRes.data ?? []) as {
    categoria_id: string; nombre: string; parent_id: string | null; rol_pl: string | null
  }[]).map(c => ({
    categoria_id: c.categoria_id,
    nombre:       c.nombre,
    parent_id:    c.parent_id,
    rol_pl:       esRolPL(c.rol_pl) ? c.rol_pl : 'OPERATIVO',
  }))

  const { ingresos, gastos } = apuntesDeFilas(
    (facRes.data ?? []) as FilaFacturaPL[],
    (gcRes.data  ?? []) as FilaGastoCobroPL[],
    desde, hasta,
  )

  const impacto = impactoAgregado(ingresos, gastos, categorias,
    { hayInventario: tieneModulo(cliRes.data?.modulos_activos, 'inventario') }, ops)

  return { ok: true, desde, hasta, impacto }
}

// ── F1.4 · El asistente de adopción ──────────────────────────────────────────
//
// Dos clientes de producción llegaron con el catálogo hecho a mano. La semilla
// sola no les sirve: empareja por nombre EXACTO, y «Comisión bancaria» no es
// «Comisiones bancarias» para un índice único. Sin asistente, a esos dos les
// duplicamos media pantalla el día que un módulo escriba por clave.
//
// Lo que hace: propone. Lo que NO hace: mover nada por su cuenta. Ante la duda
// gana la del cliente — duplicar es visible y se arregla en un toque; fundir mal
// es invisible y permanente.

/** Una categoría del cliente vista por el asistente. */
export interface FichaAdopcion {
  categoria_id: string
  nombre:       string
  /** Gastos + movimientos que la usan. Es lo que hay en juego en cada decisión. */
  usos:         number
}

export interface OpcionDestino {
  /** `categoria_id` REAL de la raíz destino en el árbol del cliente. */
  categoria_id: string
  nombre:       string
  rol:          string
  confianza:    Confianza
}

/** Una raíz suya que puede pasar a SER una entrada del pack. */
export interface PropuestaRaiz extends FichaAdopcion {
  rol_pl:      string
  hijas:       number
  /** Si ya está anclada, la clave; el asistente no la vuelve a ofrecer. */
  anclada:     string | null
  candidatas:  Candidata[]
  /** Nace marcada solo si es idéntica tras normalizar Y conserva el rol. */
  marcada:     boolean
}

/** Una hija suya que quizá vive bajo la raíz equivocada. */
export interface PropuestaHija extends FichaAdopcion {
  padre_id:     string
  padreNombre:  string
  /** El rol que tiene HOY, que es el de su madre. */
  rolActual:    string
  destinos:     OpcionDestino[]
  /** El destino propuesto, o '' cuando no hay candidata clara. */
  propuesto:    string
  marcada:      boolean
  /** Falso ⇒ mover cambia el renglón del informe: pasarela aparte, sin «marcar todo». */
  conservaRol:  boolean
}

export interface PropuestaFusion {
  queda:     FichaAdopcion
  absorbe:   FichaAdopcion
  /** Fundirlas mueve importes de renglón: se enseña el impacto y nace desmarcada. */
  cambiaRol: boolean
  rolQueda:  string
  rolAbsorbe: string
}

/**
 * Un apunte de depreciación que está generando deuda (§1.9 del plan).
 *
 * La depreciación es un gasto que NO mueve dinero: nadie te lo cobra. Con
 * `naturaleza` distinta de `COSTE` la fila entra en Cuentas por pagar y en el
 * saldo de tesorería, así que el negocio arrastra una deuda con nadie y un saldo
 * que no cuadra con lo que hay en la caja. Es un error real y encontrado en
 * producción, no una hipótesis.
 */
export interface ApunteDepreciacion {
  registro_id: string
  fecha:       string
  monto:       number
  moneda:      string
  categoria:   string
  descripcion: string
}

export interface AnalisisAdopcion {
  ok: boolean
  error?: string
  pack?: string
  /** Raíces suyas sin ancla, con lo que el pack les propone. */
  raices?:     PropuestaRaiz[]
  /** Subcategorías suyas con un destino mejor que su madre actual. */
  hijas?:      PropuestaHija[]
  /** Dos filas suyas que son la misma cuenta escrita de dos maneras. */
  fusiones?:   PropuestaFusion[]
  /** Archivadas, para poder reactivarlas: una archivada bloquea el nombre igual. */
  archivadas?: { categoria_id: string; nombre: string; padreNombre: string | null }[]
  /** Gastos propios de cada raíz: mover sus hijas NO la vacía, y hay que decirlo. */
  gastosPropios?: Record<string, number>
  /** Apuntes de depreciación que hoy generan deuda y no deberían (§1.9). */
  depreciacion?: ApunteDepreciacion[]
  /**
   * Los que NO se ofrecen porque ya tienen un pago aplicado en Tesorería. Se dicen
   * igual: callarlos daría un recuento que no coincide con lo que el dueño ve en
   * su lista de gastos, y el que no aparece es justo el que hay que mirar a mano.
   */
  depreciacionConPagos?: number
  /**
   * De los anteriores, los que el importador saldó él mismo contra la cuenta
   * técnica de «Apertura». Van aparte porque la acción del dueño es distinta: ahí
   * no hay dinero que buscar ni deuda que arreglar —esa cuenta no es dinero real—
   * y lo único que quedaría por hacer es cosmético.
   */
  depreciacionSaldadaEnMigracion?: number
}

/**
 * Cuántos apuntes usa cada categoría (gastos + movimientos), contados en SQL.
 *
 * El conteo va en la base y no aquí (mig. 189) por dos razones que van juntas:
 * tiene que ser EXACTO sobre toda la historia —el asistente decide fusiones
 * permanentes con este número, y un conteo acotado por rango sería creíble y
 * falso— y contarlo en el cliente obligaba a traerse una fila por apunte de las
 * dos tablas enteras del inquilino para producir dos docenas de enteros.
 */
async function usosPorCategoria(
  db: ReturnType<typeof createAdminClient>, client_id: string,
): Promise<Map<string, number>> {
  const { data } = await db.rpc('cat_usos_por_categoria', { p_client_id: client_id })
  const usos = new Map<string, number>()
  for (const fila of (data ?? []) as { categoria_id: string; usos: number }[]) {
    usos.set(fila.categoria_id, Number(fila.usos) || 0)
  }
  return usos
}

/**
 * Los apuntes de depreciación que hoy generan deuda (§1.9).
 *
 * La categoría se resuelve por su RAÍZ, como en todo el resto: el rol vive arriba
 * y las hijas lo heredan (mig. 134), así que «Depreciación de equipos» cuenta
 * porque su madre es la que lleva el papel.
 *
 * Los que ya tienen un pago aplicado en Tesorería NO se ofrecen. Marcarlos como
 * `COSTE` los saca de Cuentas por pagar y dejaría el movimiento que los pagó
 * apuntando a un registro que ya no tiene saldo: un pago huérfano es peor que la
 * deuda falsa que venía a arreglar, y ese caso hay que mirarlo de una en una.
 *
 * Los apartados se cuentan en dos montones porque no son el mismo problema. El
 * importador salda TODO lo que migra contra la cuenta técnica de «Apertura», que
 * no es dinero real: al cliente que llegó importando, la deuda falsa ya se la
 * neutralizó la migración, y ahí no queda nada que arreglar. Un pago contra una
 * cuenta de verdad sí es un caso a mirar.
 */
async function depreciacionQueGeneraDeuda(
  db: ReturnType<typeof createAdminClient>,
  client_id: string,
  categorias: CategoriaPropia[],
): Promise<{ apuntes: ApunteDepreciacion[]; conPagos: number; saldadosEnMigracion: number }> {
  const idx = indexarCategorias(categorias.map(c => ({
    categoria_id: c.categoria_id,
    nombre:       c.nombre,
    parent_id:    c.parent_id,
    rol_pl:       esRolPL(c.rol_pl) ? c.rol_pl : 'OPERATIVO',
  })))
  const ids = categorias
    .map(c => c.categoria_id)
    .filter(id => idx.raizDe.get(id)?.rol_pl === 'DEPRECIACION')
  if (!ids.length) return { apuntes: [], conPagos: 0, saldadosEnMigracion: 0 }

  const { data } = await db.from('gastos_cobros')
    .select('registro_id, fecha, monto, moneda, categoria, descripcion, naturaleza')
    .eq('client_id', client_id).eq('tipo', 'GASTO')
    .in('categoria_id', ids)
    .order('fecha', { ascending: false })

  const candidatos = ((data ?? []) as {
    registro_id: string; fecha: string; monto: number; moneda: string
    categoria: string | null; descripcion: string | null; naturaleza: string | null
  }[]).filter(r => r.naturaleza !== 'COSTE')
  if (!candidatos.length) return { apuntes: [], conPagos: 0, saldadosEnMigracion: 0 }

  const [{ data: movs }, { data: cuentas }] = await Promise.all([
    db.from('movimientos_tesoreria')
      .select('referencia_id, cuenta_id')
      .eq('client_id', client_id)
      .in('origen', ['PAGO', 'COBRO'])
      .in('referencia_id', candidatos.map(c => c.registro_id)),
    db.from('cuentas').select('cuenta_id, es_apertura').eq('client_id', client_id),
  ])
  const tecnicas = new Set(((cuentas ?? []) as { cuenta_id: string; es_apertura: boolean | null }[])
    .filter(c => c.es_apertura).map(c => c.cuenta_id))

  const pagados   = new Set<string>()
  const deVerdad  = new Set<string>()
  for (const m of (movs ?? []) as { referencia_id: string; cuenta_id: string }[]) {
    pagados.add(m.referencia_id)
    if (!tecnicas.has(m.cuenta_id)) deVerdad.add(m.referencia_id)
  }

  return {
    apuntes: candidatos
      .filter(r => !pagados.has(r.registro_id))
      .map(r => ({
        registro_id: r.registro_id,
        fecha:       r.fecha,
        monto:       Number(r.monto) || 0,
        moneda:      r.moneda,
        categoria:   r.categoria?.trim() || 'Sin categoría',
        descripcion: r.descripcion?.trim() || '',
      })),
    conPagos:            candidatos.filter(r => deVerdad.has(r.registro_id)).length,
    saldadosEnMigracion: candidatos.filter(r =>
      pagados.has(r.registro_id) && !deVerdad.has(r.registro_id)).length,
  }
}

/**
 * Lo que el asistente propone. No escribe: es todo lectura y cálculo puro.
 *
 * Corre DESPUÉS de la semilla a propósito. Los destinos de una hija son raíces
 * que el cliente TIENE, no entradas de un catálogo que aún no existe en su árbol:
 * ofrecer un destino inexistente sería ofrecerle otra fila, no una adopción.
 */
export async function analizarAdopcion(): Promise<AnalisisAdopcion> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  const db = createAdminClient()
  const [{ data }, usos, { sector, respuestaServicios, llevaContador }] = await Promise.all([
    db.from('categorias_gastos')
      .select('categoria_id, nombre, parent_id, rol_pl, estado, es_sistema, clave_catalogo')
      .eq('client_id', session.client_id),
    usosPorCategoria(db, session.client_id),
    contextoDelPack(session.client_id),
  ])

  const todas = (data ?? []) as CategoriaPropia[]
  const pack  = packDe(sector, respuestaServicios)
  const porId = new Map(todas.map(c => [c.categoria_id, c]))
  const uso   = (id: string) => usos.get(id) ?? 0

  const raices = todas.filter(c => !c.parent_id)
  const hijasDe = new Map<string, CategoriaPropia[]>()
  for (const c of todas) {
    if (!c.parent_id) continue
    const ya = hijasDe.get(c.parent_id)
    if (ya) ya.push(c); else hijasDe.set(c.parent_id, [c])
  }

  // Las claves del pack que TODAVÍA no tiene nadie: son las únicas que se pueden
  // ofrecer como ancla sin crear dos filas diciendo ser la misma entrada.
  const ancladas = new Set(todas.map(c => c.clave_catalogo).filter(Boolean) as string[])
  // Con el MISMO complemento que la semilla: ofrecerle «Depreciación de equipos»
  // como ancla a quien contestó que no lleva contador le mete por la puerta de
  // atrás la categoría que la semilla no le sembró por la de delante.
  const delPack  = filasDelPack(pack, { hastaFase: FASE_SEMBRABLE, conC1: llevaContador === true })
  const libres   = new Set(delPack.filter(f => !f.padre && !ancladas.has(f.clave)).map(f => f.clave))

  const propuestasRaiz: PropuestaRaiz[] = raices
    .filter(r => r.estado === 'ACTIVO' && !r.clave_catalogo)
    .map(r => {
      const candidatas = candidatasPara(r.nombre, libres)
      return {
        categoria_id: r.categoria_id, nombre: r.nombre, usos: uso(r.categoria_id),
        rol_pl: r.rol_pl, hijas: (hijasDe.get(r.categoria_id) ?? []).length,
        anclada: r.clave_catalogo,
        candidatas,
        marcada: !!candidatas[0] && naceMarcada(candidatas[0], r.rol_pl),
      }
    })
    .filter(p => p.candidatas.length > 0)

  // ── Modo «mover hijas» ──
  // El destino se propone por el nombre de CADA HIJA contra el catálogo entero,
  // nunca heredando el de su raíz: heredar da cero propuestas en «Impuestos y
  // Otros Gastos» y diez plausibles —siete malas— en «Servicios Comprados».
  const raizPorClave = new Map(
    raices.filter(r => r.clave_catalogo && r.estado === 'ACTIVO')
      .map(r => [r.clave_catalogo as string, r]))
  const destinosPosibles = new Set(raizPorClave.keys())

  const propuestasHija: PropuestaHija[] = []
  for (const h of todas) {
    if (!h.parent_id || h.estado !== 'ACTIVO') continue
    const madre = porId.get(h.parent_id)
    if (!madre) continue

    const destinos = candidatasPara(h.nombre, destinosPosibles)
      .map(c => {
        const raiz = raizPorClave.get(c.clave)!
        return {
          categoria_id: raiz.categoria_id, nombre: raiz.nombre,
          rol: raiz.rol_pl, confianza: c.confianza,
        }
      })
      .filter(d => d.categoria_id !== h.parent_id)   // ya está donde toca
    if (!destinos.length) continue

    // Sin candidata idéntica NO hay sugerencia: el selector sale vacío. Más vale
    // vacío que una propuesta plausible y mala, que es la que se acepta sin mirar.
    const mejor     = destinos[0]
    const identica  = mejor.confianza === 'identico'
    const conservaRol = mejor.rol === madre.rol_pl

    propuestasHija.push({
      categoria_id: h.categoria_id, nombre: h.nombre, usos: uso(h.categoria_id),
      padre_id: madre.categoria_id, padreNombre: madre.nombre, rolActual: madre.rol_pl,
      destinos,
      propuesto: identica ? mejor.categoria_id : '',
      marcada:   identica && conservaRol,
      conservaRol,
    })
  }

  const fusiones: PropuestaFusion[] = duplicadosPropios(todas, uso).map(p => ({
    queda:   { categoria_id: p.queda.categoria_id,   nombre: p.queda.nombre,   usos: uso(p.queda.categoria_id) },
    absorbe: { categoria_id: p.absorbe.categoria_id, nombre: p.absorbe.nombre, usos: uso(p.absorbe.categoria_id) },
    cambiaRol: p.cambiaRol,
    rolQueda: p.queda.rol_pl, rolAbsorbe: p.absorbe.rol_pl,
  }))

  const gastosPropios: Record<string, number> = {}
  for (const r of raices) gastosPropios[r.categoria_id] = uso(r.categoria_id)

  const dep = await depreciacionQueGeneraDeuda(db, session.client_id, todas)

  return {
    ok: true, pack: pack.nombre,
    raices: propuestasRaiz,
    hijas:  propuestasHija,
    fusiones,
    archivadas: todas.filter(c => c.estado !== 'ACTIVO').map(c => ({
      categoria_id: c.categoria_id, nombre: c.nombre,
      padreNombre: c.parent_id ? (porId.get(c.parent_id)?.nombre ?? null) : null,
    })),
    gastosPropios,
    depreciacion: dep.apuntes,
    depreciacionConPagos: dep.conPagos,
    depreciacionSaldadaEnMigracion: dep.saldadosEnMigracion,
  }
}

/** Una operación marcada por el dueño, tal cual la come la RPC. */
export type OpAdopcion =
  | { tipo: 'reactivar'; id: string }
  | { tipo: 'anclar';    id: string; clave: string }
  | { tipo: 'mover';     id: string; padre: string }
  | { tipo: 'fundir';    id: string; en: string }
  | { tipo: 'rol';       id: string; rol: RolPL }

export interface ResultadoAdopcion {
  ok: boolean
  error?: string
  ensayo?: boolean
  hechas?:   { tipo: string; nombre?: string; destino?: string; apuntes?: number; hijas?: number; rol?: string; rol_antes?: string }[]
  omitidas?: { tipo: string; nombre?: string; motivo: string; destino?: string }[]
}

/**
 * Aplica lo marcado. `ensayo` recorre el MISMO camino y lo deshace (mig. 187).
 *
 * El ensayo no es un lujo: hasta que no se intenta, no se sabe que una archivada
 * con ese nombre bloquea el destino. Una validación aparte se olvidaría de eso
 * justo el día que importa.
 */
export async function aplicarAdopcion(
  ops: OpAdopcion[], ensayo = true,
): Promise<ResultadoAdopcion> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) {
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  }
  if (!ops.length) return { ok: false, error: 'No has marcado ningún cambio.' }

  const { data, error } = await createAdminClient().rpc('cat_aplicar_adopcion', {
    p_client_id: session.client_id,
    p_ops:       ops,
    p_ensayo:    ensayo,
  })
  if (error) return { ok: false, error: error.message }

  if (!ensayo) {
    revalidatePath('/portal/gastos')
    revalidatePath('/portal/tesoreria')
    revalidarFinanzas()
  }

  const r = data as { hechas?: unknown[]; omitidas?: unknown[] }
  return {
    ok: true, ensayo,
    hechas:   (r.hechas   ?? []) as ResultadoAdopcion['hechas'],
    omitidas: (r.omitidas ?? []) as ResultadoAdopcion['omitidas'],
  }
}

/**
 * Marca como `COSTE` los apuntes de depreciación que el dueño haya elegido (§1.9).
 *
 * La lista que llega del navegador NO se toca directamente: se vuelve a calcular
 * aquí la de apuntes ofrecibles y se cruza con ella. Entre que se pintó la
 * pantalla y que el dueño pulsa pueden haber pasado minutos, y en esos minutos
 * alguien puede haber pagado uno de esos gastos desde Tesorería; aplicarlo por su
 * id a ciegas dejaría el pago apuntando a un registro sin saldo. Lo que no
 * sobreviva al cruce se cuenta y se dice, no se aplica en silencio.
 */
export async function marcarDepreciacionComoCoste(
  ids: string[],
): Promise<{ ok: boolean; error?: string; hechos?: number; omitidos?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) {
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  }
  const pedidos = [...new Set(ids.filter(Boolean))]
  if (!pedidos.length) return { ok: false, error: 'No has marcado ningún apunte.' }

  const db = createAdminClient()
  const { data } = await db.from('categorias_gastos')
    .select('categoria_id, nombre, parent_id, rol_pl, estado, es_sistema, clave_catalogo')
    .eq('client_id', session.client_id)

  const { apuntes } = await depreciacionQueGeneraDeuda(
    db, session.client_id, (data ?? []) as CategoriaPropia[])
  const ofrecibles = new Set(apuntes.map(a => a.registro_id))
  const aplicables = pedidos.filter(id => ofrecibles.has(id))
  if (!aplicables.length) {
    return { ok: false, error: 'Ninguno de esos apuntes se puede reclasificar ya. Vuelve a abrir el asistente.' }
  }

  const { error } = await db.from('gastos_cobros')
    .update({ naturaleza: 'COSTE' })
    .eq('client_id', session.client_id)
    .in('registro_id', aplicables)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  revalidatePath('/portal/tesoreria')
  revalidarFinanzas()

  return { ok: true, hechos: aplicables.length, omitidos: pedidos.length - aplicables.length }
}
