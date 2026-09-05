// ── El motor de la propuesta: datos crudos → presentación resuelta ──────────
//
// Función PURA. Entra todo lo que hace falta (la fila de la propuesta, sus
// textos, el lead, el presupuesto, el catálogo vivo, las capturas y los ajustes)
// y sale la lista de diapositivas ya decidida. Sin consultas, sin `Date.now()`,
// sin leer `settings`: eso lo hace quien la llama, y por eso esto se puede
// probar y se puede ejecutar igual en el servidor que en el navegador.
//
// NO ESCRIBE NI UN PRECIO. Los importes salen del presupuesto vinculado y del
// catálogo en cada render — es lo que hace que cambiar el presupuesto actualice
// la propuesta sin volver a tocarla, y lo que impide que el documento y la
// calculadora digan cifras distintas del mismo trato.
//
// REGLA DURA: si un dato no está, la diapositiva no se emite. Nunca un importe
// en blanco, nunca un «[completar]».

import { FASES_INSTALACION } from '@/lib/presupuesto/config'
import { normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'
import { normalizarNivel, precioModulo, type ModuloPrecios, type Nivel } from '@/lib/niveles'
import {
  MODULOS_POR_PAGINA, ORDEN_POR_DEFECTO, estaOculta, ordenar,
} from './secciones'
import {
  CONFIANZA_TARJETAS, CONFIANZA_TITULO, EMPECEMOS_PASOS, EMPECEMOS_TITULO,
  ENTENDIMOS_TITULO, PAGO_POR_DEFECTO, PROBLEMA_CLAUX, PROBLEMA_HOY,
  PROBLEMA_HOY_GENERICO, PROBLEMA_ROTULO_CLAUX, PROBLEMA_ROTULO_HOY,
  PROBLEMA_TITULO, QUE_ES_TARJETAS, QUE_ES_TITULO, rellenar,
} from './textos'
import type {
  BloqueModulo, Captura, Comercial, LineaFase, LineaModuloCotizado,
  OpcionModulo, Prefill, PropuestaResuelta, Slide, Tarjeta,
} from './tipos'

// ── Lo que entra ────────────────────────────────────────────────────────────

export interface FilaPropuesta {
  id:                number
  titulo:            string
  nombre_negocio:    string
  comercial_nombre:  string | null
  comercial_email:   string | null
  comercial_tel:     string | null
  nivel:             string | null
  moneda:            string | null
  modulos:           string[] | null
  publicada_at:      string | null
  token:             string | null
  /** Manda en la fecha de la portada: ver `fechaDelDocumento`. */
  updated_at:        string | null
  secciones_ocultas: string[] | null
  secciones_orden:   string[] | null
}

/** El catálogo vivo: lo que se vende hoy, con sus seis precios. */
export interface ModuloCatalogo extends ModuloPrecios {
  nombre:      string
  descripcion: string | null
  beneficio:   string | null
  /** La variante de dos líneas, la única que cabe en la ficha de precios. */
  resumen:     string | null
  activo:      boolean
  orden:       number | null
}

/** Del presupuesto vinculado solo se lee. Aquí no se recalcula nada. */
export interface FilaPresupuesto {
  modulos:            string[] | null
  desglose:           unknown
  horas_total:        number | string | null
  tarifa_hora:        number | string | null
  descuento_pct:      number | string | null
  coste_instalacion:  number | string | null
  total_final:        number | string | null
  cuota_mensual:      number | string | null
  moneda:             string | null
  /** Cuenta para la fecha de la portada: cambiar el precio cambia el documento. */
  updated_at:         string | null
}

/**
 * Lo que el diagnóstico dice del negocio, ya rotulado. Llega resuelto porque
 * traducir un `tamano` a «Entre 4 y 5 personas» necesita los límites vivos de
 * `nivel_limites`, y eso es una consulta: no cabe en una función pura.
 */
export interface LeadResumen {
  /** La clave de `plantillas_sector`, que es lo que casa con la biblioteca de
   *  capturas. Va aparte del nombre porque el nombre es para leerlo. */
  sectorClave:        string | null
  sectorNombre:       string | null
  bandaPersonas:      string | null
  modoActual:         string | null
  modoEtiqueta:       string | null
  necesidadPrincipal: string | null
}

export interface AjustesPropuesta {
  diasPrueba:        number
  descuentoAnualPct: number
  queEsTarjetas:     Tarjeta[]
  problemaClaux:     string[]
  confianzaTarjetas: Tarjeta[]
  empecemosPasos:    Tarjeta[]
  pago:              string
}

export const AJUSTES_POR_DEFECTO: AjustesPropuesta = {
  diasPrueba:        15,
  descuentoAnualPct: 10,
  queEsTarjetas:     QUE_ES_TARJETAS,
  problemaClaux:     PROBLEMA_CLAUX,
  confianzaTarjetas: CONFIANZA_TARJETAS,
  empecemosPasos:    EMPECEMOS_PASOS,
  pago:              PAGO_POR_DEFECTO,
}

export interface EntradaArmado {
  propuesta:   FilaPropuesta
  /** `propuesta_textos`: clave → cuerpo. Lo escrito por el comercial manda. */
  textos:      Record<string, string>
  lead:        LeadResumen | null
  presupuesto: FilaPresupuesto | null
  catalogo:    ModuloCatalogo[]
  capturas:    Captura[]
  /** El sector del negocio (clave de `plantillas_sector`), para elegir entre las
   *  variantes de la biblioteca. Null en la propuesta que no cuelga ni de un
   *  lead ni de un cliente: entonces se enseña la captura común. */
  sector:      string | null
  ajustes:     AjustesPropuesta
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const num = (v: unknown): number => Number(v) || 0
const limpio = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : null
}

function fechaLarga(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * La fecha de la portada: la MÁS RECIENTE entre la propuesta y su presupuesto.
 *
 * No es `publicada_at`, y el motivo es que esta propuesta está viva: si mañana
 * se renegocia el precio, el enlace enseña el nuevo y la portada seguiría
 * fechada el día que se publicó. Con el máximo de las dos, cada copia impresa
 * dice de cuándo es —que es lo único que distingue la del día 3 de la del 10—
 * y el presupuesto entra en la cuenta porque cambiarlo cambia el documento.
 *
 * Sin publicar tampoco se queda en blanco: `updated_at` existe desde el insert,
 * así que el PDF de un borrador también viene fechado.
 */
function fechaDelDocumento(propuesta: string | null, presupuesto: string | null): string | null {
  const fechas = [propuesta, presupuesto].filter((v): v is string => !!v)
  if (fechas.length === 0) return null
  return fechaLarga(fechas.reduce((a, b) => (a > b ? a : b)))
}

/**
 * Qué capturas entran, y en qué orden.
 *
 * La regla del sector se aplica por **pantalla** (módulo + vista), no por
 * módulo: si Caja tiene una variante de restaurante y Reportes solo la común,
 * decidir por módulo dejaría a este negocio sin Reportes. Dentro de cada
 * pantalla, la variante de su sector gana; si no hay, se enseña la común; y una
 * variante de OTRO sector no se enseña nunca —enseñarle a una consultora la
 * pantalla de un restaurante es peor que no enseñarle ninguna—.
 *
 * El orden lo marca la propuesta, no la biblioteca: las capturas salen en el
 * mismo orden en que se presentaron los módulos, y dentro de un módulo, en el
 * de la biblioteca (que es el que se ordena en el admin).
 */
function elegirCapturas(
  capturas: Captura[], posModulo: Map<string, number>, sector: string | null,
): Captura[] {
  const porPantalla = new Map<string, Captura[]>()
  for (const c of capturas) {
    if (!posModulo.has(c.modulo)) continue
    const k = `${c.modulo}|${c.vista}`
    const lista = porPantalla.get(k)
    if (lista) lista.push(c); else porPantalla.set(k, [c])
  }

  const elegidas: { c: Captura; i: number }[] = []
  for (const lista of porPantalla.values()) {
    const propias = sector ? lista.filter(c => c.sector.includes(sector)) : []
    const buenas = propias.length > 0 ? propias : lista.filter(c => c.sector.length === 0)
    for (const c of buenas) elegidas.push({ c, i: capturas.indexOf(c) })
  }

  return elegidas
    .sort((a, b) => posModulo.get(a.c.modulo)! - posModulo.get(b.c.modulo)! || a.i - b.i)
    .map(x => x.c)
}

/** El desglose guardado, defendido: es `jsonb` y puede traer cualquier cosa. */
function fasesDelDesglose(desglose: unknown): { etiqueta: string; horas: number; subtotal: number }[] {
  if (!Array.isArray(desglose)) return []
  return desglose
    .map((f) => {
      const o = (f ?? {}) as Record<string, unknown>
      const etiqueta = limpio(typeof o.fase === 'string' ? o.fase : null)
      return etiqueta ? { etiqueta, horas: num(o.horas), subtotal: num(o.subtotal) } : null
    })
    .filter((f): f is { etiqueta: string; horas: number; subtotal: number } => f !== null)
}

// ── Lo que se prellena solo ─────────────────────────────────────────────────
//
// Estas dos funciones son las que deciden qué sale en «Lo que entendimos» y en
// la columna de hoy cuando el comercial no escribe nada. Están aparte —y no
// dentro del armado— porque el editor necesita LO MISMO para enseñarlo como
// marca de agua en cada caja: calculado dos veces, se separa, y el comercial
// leería en la pantalla algo que el documento no dice.

/** Las cuatro viñetas de «Lo que entendimos», campo a campo y con sus huecos.
 *  `null` = ese punto no lo puede rellenar el diagnóstico (el mayor reto no
 *  está en ningún formulario: se escucha en la reunión). */
export function entendimosPrefill(lead: LeadResumen | null): (string | null)[] {
  const rubro = [lead?.sectorNombre, lead?.bandaPersonas].filter(Boolean).join(' · ')
  return [
    limpio(rubro),
    limpio(lead?.modoEtiqueta ?? null),
    limpio(lead?.necesidadPrincipal ?? null),
    null,
  ]
}

/** La columna «hoy» del problema. Va entera o no va —son tres líneas que se
 *  leen juntas—, así que es una lista y no un valor por caja. */
export function hoyPrefill(lead: LeadResumen | null): string[] {
  return (lead?.modoActual ? PROBLEMA_HOY[lead.modoActual] : null) ?? PROBLEMA_HOY_GENERICO
}

/**
 * Las capturas que le tocan a esta propuesta, ANTES de ocultar ninguna.
 *
 * El editor las necesita TODAS: una imagen escondida que no se listara no se
 * podría volver a enseñar, y hasta ahora la única forma de verlas era abrir la
 * presentación y contar.
 */
export function capturasDePropuesta(e: EntradaArmado): Captura[] {
  const activos = new Set(e.catalogo.filter(m => m.activo).map(m => m.clave))
  const presentados = (e.propuesta.modulos ?? []).filter(c => activos.has(c))
  return elegirCapturas(e.capturas, new Map(presentados.map((c, i) => [c, i])), e.sector)
}

/**
 * Lo que saldría con todas las cajas en blanco. Es lo que el editor pinta de
 * marca de agua: como el `placeholder` solo se ve cuando la caja está vacía,
 * enseñar el respaldo es enseñar exactamente lo que va a imprimirse.
 */
export function prefillPropuesta(e: EntradaArmado): Prefill {
  const modulos: Record<string, string> = {}
  for (const m of e.catalogo) {
    const cuerpo = limpio(m.beneficio) ?? limpio(m.descripcion)
    if (cuerpo) modulos[m.clave] = cuerpo
  }
  return {
    entendimos: entendimosPrefill(e.lead),
    hoy:        hoyPrefill(e.lead),
    modulos,
    pago:       e.ajustes.pago,
  }
}

// ── El armado ───────────────────────────────────────────────────────────────

export function armarPropuesta(e: EntradaArmado): PropuestaResuelta {
  const { propuesta: p, textos, lead, presupuesto, ajustes } = e

  const nivel: Nivel = normalizarNivel(p.nivel)
  // La moneda del presupuesto MANDA cuando lo hay: si la propuesta dijera euros
  // y el presupuesto estuviera en dólares, la diapositiva 13 pintaría cifras en
  // dólares bajo un símbolo de euro. Un número sin su moneda correcta es
  // exactamente el error que este trabajo viene a cerrar.
  const moneda: MonedaClaux = normalizarMonedaClaux(presupuesto?.moneda ?? p.moneda)

  const catalogo = e.catalogo.filter(m => m.activo)
  const porClave = new Map(catalogo.map(m => [m.clave, m]))

  const presentados = (p.modulos ?? []).filter(c => porClave.has(c))
  const cotizados = (presupuesto?.modulos ?? []).filter(c => porClave.has(c))
  // Arranca en lo propuesto: al abrir el configurador las dos cifras coinciden,
  // y solo se separan cuando alguien toca una casilla.
  const preseleccion = cotizados.length > 0 ? cotizados : presentados

  const comercial: Comercial | null = limpio(p.comercial_nombre)
    ? { nombre: limpio(p.comercial_nombre)!, email: limpio(p.comercial_email), tel: limpio(p.comercial_tel) }
    : null

  const fecha = fechaDelDocumento(p.updated_at, presupuesto?.updated_at ?? null)
  const vars = { dias: ajustes.diasPrueba, descuento: ajustes.descuentoAnualPct }

  const slides: Slide[] = []

  // 1 · Portada
  slides.push({
    clave: 'portada', tipo: 'portada',
    titulo: limpio(p.titulo) ?? `Propuesta para ${p.nombre_negocio}`,
    nombreNegocio: p.nombre_negocio, comercial, fecha,
  })

  // 2 · Lo que entendimos. Cuatro viñetas prellenadas del diagnóstico que el
  // comercial corrige con lo que oyó en la reunión — por eso lo escrito gana
  // siempre. Las bandas no son cifras: el diagnóstico guarda «Entre 4 y 5
  // personas», no «5», y así se enseña hasta que alguien lo concrete.
  const prefill = entendimosPrefill(lead)
  const entendimos = [
    limpio(textos.entendimos_1) ?? prefill[0],
    limpio(textos.entendimos_2) ?? prefill[1],
    limpio(textos.entendimos_3) ?? prefill[2],
    limpio(textos.entendimos_4) ?? prefill[3],
  ].filter((t): t is string => t !== null)
  if (entendimos.length > 0) {
    slides.push({ clave: 'entendimos', tipo: 'lista', titulo: ENTENDIMOS_TITULO, puntos: entendimos })
  }

  // 3 · Qué es CLAUX
  if (ajustes.queEsTarjetas.length > 0) {
    slides.push({ clave: 'que_es', tipo: 'tarjetas', titulo: QUE_ES_TITULO, tarjetas: ajustes.queEsTarjetas })
  }

  // 4 · El problema. La izquierda sale de cómo lleva hoy sus cuentas.
  const hoy = [textos.hoy_1, textos.hoy_2, textos.hoy_3]
    .map(limpio).filter((t): t is string => t !== null)
  const hoyFinal = hoy.length > 0 ? hoy : hoyPrefill(lead)
  if (hoyFinal.length > 0 && ajustes.problemaClaux.length > 0) {
    slides.push({
      clave: 'problema', tipo: 'problema', titulo: PROBLEMA_TITULO,
      rotuloHoy: PROBLEMA_ROTULO_HOY, rotuloClaux: PROBLEMA_ROTULO_CLAUX,
      hoy: hoyFinal, conClaux: ajustes.problemaClaux,
    })
  }

  // 5 · Pensado para tu negocio. Se REPITE de tres en tres mientras queden
  // módulos: Fangio la lleva dos veces con seis. Y son los PRESENTADOS, que
  // pueden ser más que los cotizados — ahí está la venta cruzada.
  const bloques: BloqueModulo[] = presentados.map(clave => {
    const m = porClave.get(clave)!
    const propio = limpio(textos[`modulo:${clave}`])
    return {
      clave, nombre: m.nombre, a_medida: propio !== null,
      cuerpo: propio ?? limpio(m.beneficio) ?? limpio(m.descripcion) ?? '',
    }
  }).filter(b => b.cuerpo.length > 0)

  const paginas = Math.ceil(bloques.length / MODULOS_POR_PAGINA)
  for (let i = 0; i < paginas; i++) {
    slides.push({
      clave: `pensado:${i + 1}`, tipo: 'pensado', titulo: 'Pensado para tu negocio',
      modulos: bloques.slice(i * MODULOS_POR_PAGINA, (i + 1) * MODULOS_POR_PAGINA),
      pagina: i + 1, paginas,
    })
  }

  // 6-11 · Los módulos por dentro: una captura por diapositiva, solo de los
  // módulos que esta propuesta presenta.
  // El orden lo marca la propuesta, no la biblioteca: las capturas salen en el
  // mismo orden en que se presentaron los módulos, y dentro de un módulo, en el
  // de la biblioteca (que es el que se ordena en el admin).
  const deEstaPropuesta = capturasDePropuesta(e)

  for (const c of deEstaPropuesta) {
    const m = porClave.get(c.modulo)
    slides.push({
      clave: `captura:${c.id}`, tipo: 'captura',
      titulo: m?.nombre ?? c.vista,
      pie: c.vista === m?.nombre ? null : c.vista,
      captura: c,
    })
  }

  // 12 · Precios, que es el configurador. El catálogo ACTIVO entero, con lo
  // propuesto premarcado: los módulos que no entran también se ven, con su
  // ventaja y su precio, y el cliente puede marcarlos y ver qué costarían.
  const opciones: OpcionModulo[] = catalogo
    .slice()
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.clave.localeCompare(b.clave))
    .map(m => ({
      clave: m.clave, nombre: m.nombre,
      // El `resumen`, no el `beneficio`: aquí el catálogo entero va en fichas de
      // cuatro por página y el texto de venta —dos frases— dejaba cada ficha en
      // cinco líneas. El «por qué le sirve» ya tiene su diapositiva; esta
      // contesta «qué es y cuánto cuesta», que es lo que se compara.
      descripcion: limpio(m.resumen) ?? limpio(m.descripcion) ?? '',
      precio: precioModulo(m, nivel, moneda),
      propuesto: preseleccion.includes(m.clave),
    }))
  const cuotaPropuesta = opciones.filter(o => o.propuesto).reduce((t, o) => t + o.precio, 0)
  if (opciones.length > 0) {
    slides.push({
      clave: 'precios', tipo: 'precios', titulo: 'Precios',
      opciones, moneda, cuotaPropuesta,
      diasPrueba: ajustes.diasPrueba, descuentoAnualPct: ajustes.descuentoAnualPct,
    })
  }

  // Las fases: las que trae el desglose, no las cuatro de la plantilla. AUGE
  // enseñó cuatro con dos cotizadas y la 13 diciendo «2 fases» al lado.
  //
  // El número es un ORDINAL DEL RELATO —primero esto, después esto—, así que sale
  // de la posición y no de la identidad de la fase. Deducirlo casando la etiqueta
  // guardada contra `FASES_INSTALACION` es lo que sacaba «0·» en la propuesta de
  // Elina: su presupuesto guardó «Migración de datos» y esa fase hoy se llama
  // «Puesta en marcha», así que no casaba con ninguna y salía a cero. Y aunque
  // casara, con una fase desmarcada el cliente vería 01 · 03 · 04.
  const delDesglose = fasesDelDesglose(presupuesto?.desglose)
  const fases: LineaFase[] = (delDesglose.length > 0
    ? delDesglose.map(f => ({ etiqueta: f.etiqueta, horas: f.horas, subtotal: f.subtotal }))
    : FASES_INSTALACION.map(f => ({ etiqueta: f.etiqueta, horas: null, subtotal: null })))
    .map((f, i) => ({ num: i + 1, ...f }))

  // 13 · Tu propuesta. SIN presupuesto vinculado no se pinta: es lo que ya hace
  // Fangio a mano, y es preferible a un importe en blanco.
  if (presupuesto) {
    const cuotaMensual = num(presupuesto.cuota_mensual)
    const pct = ajustes.descuentoAnualPct
    slides.push({
      clave: 'tu_propuesta', tipo: 'tu_propuesta', titulo: 'Tu propuesta', moneda,
      fases, horasTotal: num(presupuesto.horas_total), tarifaHora: num(presupuesto.tarifa_hora),
      costeInstalacion: num(presupuesto.coste_instalacion),
      descuentoPct: num(presupuesto.descuento_pct),
      totalFinal: num(presupuesto.total_final),
      modulos: cotizados.map<LineaModuloCotizado>(clave => {
        const m = porClave.get(clave)!
        return { clave, nombre: m.nombre, precio: precioModulo(m, nivel, moneda) }
      }),
      cuotaMensual,
      cuotaAnual: pct > 0 && cuotaMensual > 0 ? cuotaMensual * 12 * (1 - pct / 100) : null,
      descuentoAnualPct: pct,
    })
  }

  // 14 · Cómo se configura
  slides.push({
    clave: 'como_se_configura', tipo: 'fases', titulo: 'Cómo se configura',
    fases, pago: limpio(textos.pago) ?? ajustes.pago,
  })

  // 15 · Por qué confiar
  if (ajustes.confianzaTarjetas.length > 0) {
    slides.push({ clave: 'confianza', tipo: 'tarjetas', titulo: CONFIANZA_TITULO, tarjetas: ajustes.confianzaTarjetas })
  }

  // 16 · Empecemos
  slides.push({
    clave: 'empecemos', tipo: 'empecemos', titulo: EMPECEMOS_TITULO,
    pasos: ajustes.empecemosPasos.map(t => ({
      titulo: rellenar(t.titulo, vars), cuerpo: rellenar(t.cuerpo, vars),
    })),
    comercial,
  })

  const ocultas = p.secciones_ocultas ?? []
  const orden = (p.secciones_orden ?? []).length > 0 ? p.secciones_orden! : ORDEN_POR_DEFECTO

  return {
    id: p.id,
    token: p.token ?? null,
    titulo: limpio(p.titulo) ?? `Propuesta para ${p.nombre_negocio}`,
    nombreNegocio: p.nombre_negocio,
    nivel, moneda, comercial, fecha,
    slides: ordenar(slides.filter(s => !estaOculta(s.clave, ocultas)), orden),
  }
}
