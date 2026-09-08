// ── Los sitios donde la IA nos ahorra trabajo A NOSOTROS ─────────────────────
// Importador, presupuestos, propuesta comercial, soporte y relleno de textos. Todos
// pasan por `chatInterno` (interruptor, bolsa interna, tope duro, medición por
// área) y todos cumplen la misma regla:
//
//   LAS DE ESTE FICHERO PROPONEN Y NO ESCRIBEN. Ninguna toca la base de datos:
//   devuelven texto o una propuesta que va a parar a un formulario, y guarda una
//   persona.
//
// Ojo: eso las describe a ELLAS, no es ya la doctrina del admin. Desde 2026-09-06
// (docs/planes/ia-claux-plataforma.md §1) en el admin la IA sí puede escribir, pero
// solo tras vista previa y un clic, y por el camino de `PropuestaIa` (./propuesta).
// En el PORTAL, de cara al cliente, sigue vigente «propone y nunca escribe».
//
// Cuando la IA no está configurada, falla o contesta algo que no se puede leer,
// devuelven `null` y la pantalla sigue funcionando a mano — que es como funciona
// hoy. Lo que sí sube son `IaBolsaAgotada` e `IaApagada`: no son averías, son
// decisiones nuestras —de presupuesto y de interruptor— y quien llama tiene que
// poder decirlo con esas palabras en vez de callarse y no hacer nada.

import { chatInterno, IaApagada, IaBolsaAgotada } from './interna'
import { IaNoConfigurada } from './provider'
import { aplicarReglas, catalogoParaIa, etiquetaRegla, normalizarRegla, type ReglaColumna } from '@/lib/importador/reglas'
import { listaConTecho, recortar } from './muestra'
import { esRolPL, ROLES_PL, ROL_PL_AYUDA, ROL_PL_LABEL, type RolPL } from '@/lib/pl/estado'
import type { Confianza, LineaPropuesta, PropuestaIa } from './propuesta'

/** Une el `try` de las cuatro: lo que decidimos nosotros sube, lo demás degrada a `null`. */
async function intentar<T>(que: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof IaBolsaAgotada || e instanceof IaApagada) throw e
    if (!(e instanceof IaNoConfigurada)) console.error(`[ia-interna] ${que}`, e)
    return null
  }
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** La confianza que declara el modelo, con «media» de duda razonable por defecto. */
const confianzaDe = (v: unknown): Confianza => {
  const f = String(v ?? '').toLowerCase()
  return f === 'alta' ? 'alta' : f === 'baja' ? 'baja' : 'media'
}

// ── 1 · Importador: emparejar columnas ───────────────────────────────────────

export interface CampoDestino { campo: string; etiqueta: string; obligatorio: boolean; ayuda?: string }

/**
 * Propone qué columna del archivo va a cada campo. Es donde más horas se van en
 * una migración pagada: el auto-mapeo de hoy solo acierta cuando la cabecera se
 * llama igual que el campo, y los archivos reales traen «Fec.», «IMPORTE CUP» o
 * «Prov.» — nombres que una persona empareja de un vistazo y un `includes` no.
 *
 * Devuelve SOLO los que sabe: un campo que no aparezca en la respuesta se queda
 * como esté. Nunca inventa una cabecera que no exista (se filtra al volver).
 */
export async function sugerirMapeoColumnas(args: {
  entidad:   string
  campos:    CampoDestino[]
  cabeceras: string[]
  /** Dos o tres filas del archivo, para desempatar por el CONTENIDO. */
  muestras:  string[][]
}): Promise<Record<string, string> | null> {
  if (!args.campos.length || !args.cabeceras.length) return null

  const sys = [
    'Eres un asistente que ayuda al equipo de una plataforma de gestión a importar el archivo de un cliente.',
    'Te doy las COLUMNAS del archivo (con filas de muestra) y los CAMPOS de destino.',
    'Devuelves SOLO un objeto JSON: cada clave es un campo de destino y su valor es el nombre EXACTO de la columna del archivo que le corresponde.',
    'Si para un campo no hay columna clara, NO lo incluyas. Es mejor dejarlo sin emparejar que emparejarlo mal: lo repasa una persona.',
    'Una columna no puede ir a dos campos. Fíjate en el contenido de las muestras, no solo en el nombre de la cabecera.',
    'Los datos son de Cuba: importes en CUP/USD/EUR y fechas en formato día/mes/año.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = [
    `Entidad que se importa: ${args.entidad}`,
    '',
    'CAMPOS DE DESTINO:',
    ...args.campos.map(c => `- ${c.campo}: ${c.etiqueta}${c.obligatorio ? ' (obligatorio)' : ''}${c.ayuda ? ` — ${c.ayuda}` : ''}`),
    '',
    `COLUMNAS DEL ARCHIVO: ${args.cabeceras.join(' | ')}`,
    '',
    'FILAS DE MUESTRA:',
    ...args.muestras.slice(0, 3).map(f => f.join(' | ')),
  ].join('\n')

  return intentar('mapeo', async () => {
    const { texto: out } = await chatInterno('importador_mapeo', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.1, maxTokens: 900,
    })
    const o = JSON.parse(out) as Record<string, unknown>

    // Filtro de vuelta: solo campos que existen, solo cabeceras que existen y
    // nunca dos campos a la misma columna. Una cabecera inventada no llegaría a
    // ningún `<select>` y dejaría el paso de mapeo con un valor imposible.
    const campos    = new Set(args.campos.map(c => c.campo))
    const cabeceras = new Set(args.cabeceras)
    const usadas    = new Set<string>()
    const limpio: Record<string, string> = {}
    for (const [campo, col] of Object.entries(o)) {
      const c = texto(col)
      if (!c || !campos.has(campo) || !cabeceras.has(c) || usadas.has(c)) continue
      limpio[campo] = c
      usadas.add(c)
    }
    return Object.keys(limpio).length ? limpio : null
  })
}

// ── 2 · Propuesta comercial ──────────────────────────────────────────────────

export interface BorradorPropuesta {
  /** Las cuatro viñetas de «Lo que entendimos». `null` donde no haya nada que decir. */
  entendimos: (string | null)[]
  /** Las tres líneas de «cómo lo lleva hoy». */
  hoy:        string[]
  /** Por qué le sirve cada módulo, por clave. */
  modulos:    Record<string, string>
}

/**
 * Redacta el borrador de la propuesta de UN lead a partir de su diagnóstico.
 *
 * Lo que aporta frente al «Traer lo del diagnóstico» que ya existe: aquel copia
 * los campos del formulario tal cual —«restaurante · 6-20 personas»—; esto los
 * escribe como se los va a leer el cliente, y llega a la cuarta viñeta y a los
 * textos por módulo, que el formulario no puede rellenar.
 */
export async function redactarPropuesta(args: {
  negocio:     string
  sector:      string | null
  tamano:      string | null
  modoActual:  string | null
  necesidad:   string | null
  notas:       string | null
  modulos:     { clave: string; nombre: string; beneficio: string | null }[]
}): Promise<BorradorPropuesta | null> {
  const sys = [
    'Eres un redactor comercial de CLAUX, una plataforma de gestión para negocios locales de Cuba.',
    'Escribes el borrador de una propuesta para UN negocio concreto, a partir de lo que dijo en el formulario de diagnóstico.',
    'Devuelves SOLO un objeto JSON con las claves: entendimos, hoy, modulos.',
    'entendimos: exactamente 4 frases (array). 1) qué negocio es. 2) cómo lleva hoy sus cuentas. 3) qué necesita. 4) su mayor reto, deducido de lo anterior; null si no hay base para deducirlo.',
    'hoy: exactamente 3 frases (array) que describan su forma de trabajar HOY y lo que le cuesta. En presente y sin dramatismo.',
    'modulos: un objeto con una frase por cada clave de módulo que te doy, diciendo por qué le sirve A ESTE negocio.',
    'Registro profesional, impersonal y conciso, en español de Cuba. Sin tutear. Frases cortas. Nada de superlativos ni lenguaje de folleto.',
    'No inventes datos del negocio que no te haya dado: si no sabes algo, escribe la frase sin ese dato.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = [
    `Negocio: ${args.negocio}`,
    args.sector     ? `Sector: ${args.sector}` : '',
    args.tamano     ? `Tamaño: ${args.tamano}` : '',
    args.modoActual ? `Cómo lo lleva hoy: ${args.modoActual}` : '',
    args.necesidad  ? `Lo que más le urge: ${args.necesidad}` : '',
    args.notas      ? `Notas del comercial: ${args.notas}` : '',
    '',
    'MÓDULOS DE LA PROPUESTA:',
    ...args.modulos.map(m => `- ${m.clave} (${m.nombre})${m.beneficio ? `: hoy el catálogo dice «${m.beneficio}»` : ''}`),
  ].filter(Boolean).join('\n')

  return intentar('propuesta', async () => {
    const { texto: out } = await chatInterno('propuesta_redactar', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.4, maxTokens: 1600,
    })
    const o = JSON.parse(out) as Record<string, unknown>
    const lista = (v: unknown, n: number): (string | null)[] =>
      Array.isArray(v) ? Array.from({ length: n }, (_, i) => texto(v[i])) : Array(n).fill(null)

    const claves = new Set(args.modulos.map(m => m.clave))
    const modulos: Record<string, string> = {}
    if (o.modulos && typeof o.modulos === 'object') {
      for (const [k, v] of Object.entries(o.modulos as Record<string, unknown>)) {
        const t = texto(v)
        if (t && claves.has(k)) modulos[k] = t
      }
    }

    const entendimos = lista(o.entendimos, 4)
    const hoy = lista(o.hoy, 3).filter((x): x is string => !!x)
    if (!entendimos.some(Boolean) && !hoy.length && !Object.keys(modulos).length) return null
    return { entendimos, hoy, modulos }
  })
}

// ── 3 · Soporte: borrador de respuesta ───────────────────────────────────────

/**
 * Escribe un borrador de respuesta a un mensaje de soporte. NUNCA lo envía: cae
 * en la caja de respuesta y lo manda una persona, que es donde está el criterio.
 *
 * Se le pasan las FAQ publicadas para que conteste con lo que ya decimos y no con
 * lo que se imagine; y se le prohíbe prometer plazos, precios o arreglos, que es
 * lo que un borrador amable promete solo.
 */
export async function borradorSoporte(args: {
  empresa:  string
  asunto:   string
  mensaje:  string
  faqs:     { pregunta: string; respuesta: string }[]
  /** Módulo del banner de captación: el mensaje es una venta, no una incidencia. */
  moduloVenta: string | null
}): Promise<string | null> {
  const sys = [
    'Eres del equipo de soporte de CLAUX, una plataforma de gestión para negocios locales de Cuba.',
    'Escribes el BORRADOR de una respuesta para que un compañero la revise y la envíe. No eres tú quien la manda.',
    'Devuelves SOLO un objeto JSON con la clave: respuesta (el texto, en español, tratando de usted al cliente).',
    'Registro profesional y conciso: saludo breve, la respuesta al grano, y cierre corto. Sin florituras.',
    'NO prometas plazos, precios, descuentos ni arreglos concretos: si hace falta comprometerse a algo, escribe que se revisará y se dará respuesta.',
    'Si la respuesta está en las preguntas frecuentes que te doy, contesta con eso. Si no sabes, dilo y pide el dato que falte.',
    'No inventes funciones de la plataforma que no aparezcan en lo que te doy.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = [
    `Negocio que escribe: ${args.empresa}`,
    args.moduloVenta ? `AVISO: no es una incidencia. Preguntó por contratar el módulo «${args.moduloVenta}» desde su panel.` : '',
    `Asunto: ${args.asunto}`,
    `Mensaje: ${args.mensaje}`,
    args.faqs.length ? '\nPREGUNTAS FRECUENTES PUBLICADAS:' : '',
    ...args.faqs.slice(0, 20).map(f => `- ${f.pregunta} → ${f.respuesta}`),
  ].filter(Boolean).join('\n')

  return intentar('soporte', async () => {
    const { texto: out } = await chatInterno('soporte_borrador', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.3, maxTokens: 1200,
    })
    const o = JSON.parse(out) as Record<string, unknown>
    return texto(o.respuesta)
  })
}

// ── 4 · Relleno: los tres textos del catálogo ────────────────────────────────

export interface TextosModulo {
  descripcion: string | null
  beneficio:   string | null
  resumen:     string | null
}

/**
 * Propone los tres textos de un módulo del catálogo. Son tres a propósito y no
 * uno repetido: uno DESCRIBE (landing y factura), otro VENDE (la diapositiva de
 * la propuesta) y el tercero CABE (la ficha de precios, cuatro por página).
 */
export async function sugerirTextosModulo(args: {
  clave:       string
  nombre:      string
  paginas:     string[]
  descripcion: string | null
  beneficio:   string | null
  resumen:     string | null
}): Promise<TextosModulo | null> {
  const sys = [
    'Eres redactor de producto de CLAUX, una plataforma de gestión para negocios locales de Cuba.',
    'Te doy un módulo del catálogo y devuelves SOLO un objeto JSON con las claves: descripcion, beneficio, resumen.',
    'descripcion: qué ES el módulo, en una frase llana (máx. 120 caracteres). Sale en la web y en la factura.',
    'beneficio: por qué le sirve al negocio, en una o dos frases (máx. 220 caracteres). Sale en la propuesta comercial.',
    'resumen: la misma idea en unos 55 caracteres, nunca más de 80. Sale en una ficha de precios donde no cabe más.',
    'Los tres dicen cosas distintas: uno describe, otro vende y el tercero cabe. No repitas la misma frase recortada.',
    'Registro profesional, impersonal y conciso. Sin tutear. Sin superlativos ni lenguaje de folleto.',
    'No inventes funciones que no se deduzcan del nombre y de las pantallas que te doy.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = [
    `Módulo: ${args.nombre} (clave interna: ${args.clave})`,
    args.paginas.length ? `Pantallas que trae: ${args.paginas.join(', ')}` : '',
    args.descripcion ? `Descripción actual: ${args.descripcion}` : '',
    args.beneficio   ? `Beneficio actual: ${args.beneficio}` : '',
    args.resumen     ? `Resumen actual: ${args.resumen}` : '',
  ].filter(Boolean).join('\n')

  return intentar('relleno', async () => {
    const { texto: out } = await chatInterno('relleno_textos', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.4, maxTokens: 900,
    })
    const o = JSON.parse(out) as Record<string, unknown>
    const r = {
      descripcion: texto(o.descripcion),
      beneficio:   texto(o.beneficio),
      // El de 80 se recorta aquí y no se confía al prompt: es un tope de MAQUETA
      // (la ficha crece y descuadra la página), no una preferencia de estilo.
      resumen:     texto(o.resumen)?.slice(0, 80) ?? null,
    }
    return (r.descripcion || r.beneficio || r.resumen) ? r : null
  })
}

// ── 5 · Importador: la cola de pendientes, resuelta en lote ──────────────────

/** Un pendiente, con lo justo para decidirlo. Sin filas del archivo. */
export interface PendienteIa {
  clave:        string
  texto:        string
  etiquetaTipo: string
  ambito?:      string
  causa:        'VARIAS' | 'NINGUNA'
  filas:        number
  /** Las fichas candidatas, las más parecidas primero. */
  opciones:     { valor: string; etiqueta: string }[]
  creable:      boolean
  omitible:     boolean
}

export interface ResolucionIa { accion: 'USAR' | 'CREAR' | 'OMITIR' | 'RECHAZAR'; destino?: string }

/** Pendientes por llamada. Ver la nota de `resolverPendientes`. */
const LOTE_PENDIENTES = 40
/** Techo de llamadas por pulsación: 240 pendientes de una vez ya es una migración entera. */
const TOPE_LOTES = 6
/** Candidatas que se le enseñan de cada pendiente. Van ordenadas por parecido. */
const TOPE_OPCIONES = 8

/**
 * Resuelve la cola de pendientes del importador: «Cárnicos SA» del archivo contra
 * «Carnicos S.A.» de la base, y así decenas o cientos en una migración real.
 *
 * POR LOTE, NUNCA POR FILA. Una llamada por pendiente sería el patrón que arruina
 * esto: mismo trabajo, cien veces el coste y cien veces la espera. Con 40 por
 * llamada el modelo además VE el conjunto, que es justo lo que permite no dar dos
 * respuestas contradictorias al mismo nombre escrito de dos formas.
 *
 * Devuelve una propuesta supervisada: la aplica una persona desde el panel, y lo
 * dudoso nace desmarcado. La IA no toca `mapeo.resoluciones` — lo escribe el
 * wizard por el mismo camino de siempre, así que no puede meter un estado que el
 * motor no sepa leer.
 */
export async function resolverPendientes(args: {
  entidad:    string
  pendientes: PendienteIa[]
}): Promise<PropuestaIa<ResolucionIa> | null> {
  const todos = args.pendientes.filter(p => p.opciones.length > 0 || p.creable || p.omitible)
  if (!todos.length) return null

  const lotes: PendienteIa[][] = []
  for (let i = 0; i < todos.length && lotes.length < TOPE_LOTES; i += LOTE_PENDIENTES) {
    lotes.push(todos.slice(i, i + LOTE_PENDIENTES))
  }
  const fuera = todos.length - lotes.reduce((n, l) => n + l.length, 0)

  const sys = [
    'Eres un asistente que ayuda al equipo de una plataforma de gestión a migrar los datos de un cliente.',
    'Te doy NOMBRES que vienen en el archivo del cliente y no casan exactamente con ninguna ficha de su base, con las fichas candidatas.',
    'Para cada uno decides una acción: USAR (es esta ficha que ya existe, escrita de otra forma), CREAR (es una ficha nueva de verdad), OMITIR (déjalo en blanco) o RECHAZAR (deja sus filas fuera).',
    'Devuelves SOLO un objeto JSON con la clave "r": un array de objetos {i, a, d, f, m}.',
    'i = el número del nombre. a = la acción. d = el id de la ficha elegida (SOLO si a es USAR, copiado literal del id que te doy). f = tu confianza: "alta", "media" o "baja". m = el motivo en una frase corta, en español.',
    'Pon "alta" solo si es evidente (misma palabra con otra puntuación, tildes, abreviatura obvia, singular/plural del mismo término).',
    'Dos nombres PARECIDOS pueden ser cosas distintas del negocio: "Alquiler" y "Alquileres" pueden ser un dedazo o dos partidas reales. Ante la duda, "baja" y explica por qué.',
    'Si no puedes decidir con lo que te doy, usa la acción que menos daño hace y confianza "baja". Lo revisa una persona antes de aplicarse.',
    'Los datos son de Cuba: nombres de empresas con SURL, S.A., TRD, MIPYME, y cuentas contables.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  return intentar('pendientes', async () => {
    const lineas: LineaPropuesta<ResolucionIa>[] = []

    for (const lote of lotes) {
      const usuario = [
        `Se está importando: ${args.entidad}`,
        '',
        'NOMBRES SIN RESOLVER:',
        ...lote.map((p, i) => [
          `${i + 1}. «${p.texto}» — ${p.etiquetaTipo}${p.ambito ? ` ${p.ambito}` : ''}`,
          `   afecta a ${p.filas} ${p.filas === 1 ? 'fila' : 'filas'}`,
          p.causa === 'VARIAS' ? '   hay más de una ficha con ese nombre' : '',
          p.opciones.length
            ? `   candidatas: ${p.opciones.slice(0, TOPE_OPCIONES).map(o => `${o.etiqueta} [id:${o.valor}]`).join(' · ')}`
            : '   sin candidatas',
          `   permitido: ${[p.opciones.length ? 'USAR' : '', p.creable ? 'CREAR' : '', p.omitible ? 'OMITIR' : '', 'RECHAZAR'].filter(Boolean).join(', ')}`,
        ].filter(Boolean).join('\n')),
      ].join('\n')

      const { texto: out } = await chatInterno('importador_pendientes', {
        mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
        json: true, temperature: 0.1, maxTokens: 2000,
      })
      const o = JSON.parse(out) as { r?: unknown }
      if (!Array.isArray(o.r)) continue

      for (const bruto of o.r) {
        const linea = leerResolucion(bruto, lote)
        if (linea) lineas.push(linea)
      }
    }

    if (!lineas.length) return null
    return {
      lineas,
      nota: fuera > 0
        ? `Quedan ${fuera} nombres sin mirar: se revisan en otra pasada para no gastar la bolsa de una vez.`
        : undefined,
    }
  })
}

/** Traduce UNA respuesta del modelo a una línea de la propuesta, o la descarta. */
function leerResolucion(bruto: unknown, lote: PendienteIa[]): LineaPropuesta<ResolucionIa> | null {
  if (!bruto || typeof bruto !== 'object') return null
  const o = bruto as Record<string, unknown>
  const p = lote[Number(o.i) - 1]
  if (!p) return null

  const accion = String(o.a ?? '').toUpperCase()
  if (accion !== 'USAR' && accion !== 'CREAR' && accion !== 'OMITIR' && accion !== 'RECHAZAR') return null
  // Lo que el motor no permite no se propone, lo diga el modelo o no: proponerlo
  // dejaría al operador aplicando algo que después se rechaza sin explicación.
  if (accion === 'CREAR'  && !p.creable)  return null
  if (accion === 'OMITIR' && !p.omitible) return null

  let destino: string | undefined
  let etiqueta = ''
  if (accion === 'USAR') {
    // El id se comprueba contra las candidatas REALES. Un id inventado es el único
    // error de esta función que podría escribir en la ficha equivocada.
    const op = p.opciones.find(x => x.valor === String(o.d ?? ''))
    if (!op) return null
    destino  = op.valor
    etiqueta = op.etiqueta
  }

  const confianza = confianzaDe(o.f)

  const despues =
    accion === 'USAR'   ? `es «${etiqueta}»`
  : accion === 'CREAR'  ? 'crear ficha nueva'
  : accion === 'OMITIR' ? 'dejarlo en blanco'
  :                       'dejar sus filas fuera'

  return {
    clave:  p.clave,
    titulo: `«${p.texto}» · ${p.etiquetaTipo}${p.ambito ? ` ${p.ambito}` : ''}`,
    antes:  null,
    despues,
    confianza,
    motivo: texto(o.m) ?? undefined,
    valor:  { accion: accion as ResolucionIa['accion'], destino },
  }
}

// ── 5 · Importador: la regla de columna ──────────────────────────────────────

export interface ColumnaSucia {
  columna:  string
  /** A qué campo va, para que el modelo sepa qué se espera de ella. */
  campo:    string
  /** Hasta tres valores de la columna, ya recortados por `lib/ia/muestra`. */
  muestras: string[]
}

/** Un pendiente de esta función: la regla más su vista previa ya calculada. */
export interface ReglaPropuesta extends ReglaColumna { etiqueta: string }

/**
 * Propone cómo arreglar las columnas que vienen sucias de forma sistemática: la
 * fecha con el mes en letra, el importe con el separador cambiado, el código con
 * un prefijo que sobra.
 *
 * LA IA NO TRANSFORMA NINGÚN DATO. Escribe una regla del catálogo cerrado
 * (`lib/importador/reglas`) y el «después» que se enseña lo calcula el MOTOR
 * ejecutándola sobre las mismas muestras. Es lo que hace la diferencia entre una
 * migración reproducible —la regla queda guardada con el lote— y un archivo
 * retocado a mano que ya nadie puede volver a explicar.
 *
 * Una regla por columna: el panel enseña «este valor pasa a este otro», y con dos
 * reglas encadenadas sobre la misma columna esa vista previa dejaría de ser
 * verdad en cuanto se desmarcara una de las dos.
 */
export async function proponerReglasColumna(args: {
  entidad:  string
  columnas: ColumnaSucia[]
}): Promise<PropuestaIa<ReglaPropuesta> | null> {
  const cols = args.columnas.filter(c => c.muestras.some(m => m.trim()))
  if (!cols.length) return null

  const sys = [
    'Eres un asistente que ayuda al equipo de una plataforma de gestión a importar el archivo de un cliente.',
    'Te doy columnas del archivo con valores de muestra y el campo de destino de cada una.',
    'Propones, SOLO donde haga falta, una regla de limpieza de un catálogo cerrado. La ejecuta el sistema, no tú: no transformes valores.',
    'Devuelves SOLO un objeto JSON con la clave "r": un array de objetos {i, t, p, f, m}.',
    'i = el número de la columna. t = la clave de la transformación. p = objeto con sus parámetros. f = tu confianza: "alta", "media" o "baja". m = por qué, en una frase corta en español.',
    'Como mucho UNA regla por columna, y solo si el valor está claramente mal para su destino. Una columna que ya se entiende NO lleva regla: proponer de más obliga a revisar de más.',
    'El sistema ya entiende por su cuenta las fechas dd/mm/aaaa y aaaa-mm-dd, y los importes tipo 1.234,56 y 1,234.56: no propongas reglas para eso.',
    'Los datos son de Cuba: importes en CUP/USD/EUR, fechas en día/mes/año y nombres de empresa con S.A., SURL, TRD o MIPYME.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = recortar([
    `Se está importando: ${args.entidad}`,
    '',
    'CATÁLOGO DE TRANSFORMACIONES:',
    catalogoParaIa(),
    '',
    'COLUMNAS DEL ARCHIVO:',
    ...listaConTecho(
      cols.map((c, i) => `${i + 1}. «${c.columna}» → ${c.campo}\n   muestras: ${c.muestras.map(m => `"${m}"`).join(' · ')}`),
      40,
    ),
  ].join('\n'))

  return intentar('reglas', async () => {
    const { texto: out } = await chatInterno('importador_reglas', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.1, maxTokens: 1500,
    })
    const o = JSON.parse(out) as { r?: unknown }
    if (!Array.isArray(o.r)) return null

    const lineas: LineaPropuesta<ReglaPropuesta>[] = []
    const yaPuestas = new Set<string>()
    for (const bruto of o.r) {
      const linea = leerRegla(bruto, cols)
      if (!linea || yaPuestas.has(linea.valor.columna)) continue
      yaPuestas.add(linea.valor.columna)
      lineas.push(linea)
    }
    return lineas.length ? { lineas } : null
  })
}

/**
 * Traduce UNA regla del modelo, la valida contra el catálogo y CALCULA su efecto
 * sobre las muestras. Descarta lo que no se sostiene:
 *
 *  · una transformación o un parámetro que no existen (`normalizarRegla`);
 *  · una regla que no cambia nada — es ruido que obliga a leer una línea de más;
 *  · una que vacía un valor que traía dato: eso no es limpiar, es perder.
 *
 * Y la confianza no es solo la que declara el modelo: si la regla solo funciona
 * en parte de las muestras, baja. Lo que se ve en tres filas es lo único
 * comprobado, y el resto del archivo tiene cientos.
 */
function leerRegla(bruto: unknown, cols: ColumnaSucia[]): LineaPropuesta<ReglaPropuesta> | null {
  if (!bruto || typeof bruto !== 'object') return null
  const o = bruto as Record<string, unknown>
  const col = cols[Number(o.i) - 1]
  if (!col) return null

  const regla = normalizarRegla(
    { columna: col.columna, transformacion: o.t, parametros: o.p },
    cols.map(c => c.columna),
  )
  if (!regla) return null

  const muestras = col.muestras.filter(m => m.trim())
  const despues  = muestras.map(m => aplicarReglas(m, [regla]))
  const cambian  = muestras.filter((m, i) => m !== despues[i]).length
  if (!cambian) return null
  if (despues.some((d, i) => !d.trim() && muestras[i].trim())) return null

  const confianza: Confianza = cambian === muestras.length ? confianzaDe(o.f) : 'baja'

  const etiqueta = etiquetaRegla(regla)
  return {
    clave:   `${regla.columna}::${regla.transformacion}`,
    titulo:  `Columna «${regla.columna}» · ${etiqueta}`,
    antes:   muestras.join(' · '),
    despues: despues.join(' · '),
    confianza,
    motivo:  texto(o.m) ?? undefined,
    valor:   { ...regla, etiqueta },
  }
}

// ── 6 · Importador: el muro rojo, en una frase ───────────────────────────────

export interface GrupoErrores { clave: string; motivo: string; filas: number }

export interface ExplicacionErrores {
  lineas: { clave: string; filas: number; motivo: string; causa: string; arreglo: string }[]
}

/** Grupos que se le enseñan. Por debajo de la cola larga ya no explica nada nuevo. */
const TOPE_GRUPOS = 12

/**
 * Explica el muro de filas rojas. Trescientas filas con su motivo técnico se
 * leen en media hora; agrupadas y dichas en una frase, en diez segundos: «212
 * filas: la columna Fecha viene con el mes en letra. 41: el proveedor está
 * vacío».
 *
 * ES LECTURA PURA: no escribe nada, ni propone aplicar nada. Por eso no devuelve
 * una `PropuestaIa` —no hay nada que marcar— sino texto para leer.
 *
 * El agrupado NO lo hace la IA: llega ya hecho por el asistente, que tiene los
 * motivos delante. Pedirle al modelo que cuente filas sería pagar por una suma
 * que ya está hecha, y encima admitiendo que se equivoque en el número.
 */
export async function explicarErrores(args: {
  entidad: string
  grupos:  GrupoErrores[]
  total:   number
}): Promise<ExplicacionErrores | null> {
  const grupos = [...args.grupos].sort((a, b) => b.filas - a.filas).slice(0, TOPE_GRUPOS)
  if (!grupos.length) return null

  const sys = [
    'Eres un asistente que ayuda al equipo de una plataforma de gestión a migrar los datos de un cliente.',
    'Te doy los motivos por los que el importador rechazó filas del archivo, ya agrupados y contados.',
    'Para cada grupo explicas en cristiano qué está pasando y qué hay que arreglar en el archivo de origen.',
    'Devuelves SOLO un objeto JSON con la clave "g": un array de objetos {i, c, a}.',
    'i = el número del grupo. c = qué pasa, una frase corta. a = qué hacer, una frase corta y concreta (qué columna tocar y cómo).',
    'No repitas el motivo técnico palabra por palabra: tradúcelo. No inventes números de fila ni cantidades: las pone el sistema.',
    'Si un grupo no se puede explicar mejor que su propio motivo, no lo incluyas.',
    'Escribe en español de España, en registro impersonal y sin tecnicismos. No tutees. Los datos son de Cuba.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = recortar([
    `Se está importando: ${args.entidad} · ${args.total} filas en el archivo`,
    '',
    'MOTIVOS DE RECHAZO:',
    ...grupos.map((g, i) => `${i + 1}. (${g.filas} ${g.filas === 1 ? 'fila' : 'filas'}) ${g.motivo}`),
  ].join('\n'))

  return intentar('errores', async () => {
    const { texto: out } = await chatInterno('importador_errores', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.2, maxTokens: 1200,
    })
    const o = JSON.parse(out) as { g?: unknown }
    if (!Array.isArray(o.g)) return null

    const lineas: ExplicacionErrores['lineas'] = []
    const vistos = new Set<string>()
    for (const bruto of o.g) {
      if (!bruto || typeof bruto !== 'object') continue
      const x = bruto as Record<string, unknown>
      const g = grupos[Number(x.i) - 1]
      const causa = texto(x.c)
      if (!g || !causa || vistos.has(g.clave)) continue
      vistos.add(g.clave)
      lineas.push({ clave: g.clave, filas: g.filas, motivo: g.motivo, causa, arreglo: texto(x.a) ?? '' })
    }
    return lineas.length ? { lineas } : null
  })
}

// ── 7 · Ventas: rellenar el presupuesto con lo que dijo el lead ──────────────

/** Lo que se puede rellenar del formulario: un volumen o un módulo marcado. */
export type EntradaLead =
  | { tipo: 'volumen'; clave: string; valor: number }
  | { tipo: 'modulo';  clave: string }

export interface LineaVolumenLead { clave: string; etiqueta: string; actual: number }
export interface ModuloCotizable  { clave: string; nombre: string; descripcion: string; marcado: boolean }

/** Un número mayor que esto en un formulario de presupuesto es un dedazo, no un dato. */
const TOPE_VOLUMEN = 1_000_000

/**
 * Propone las ENTRADAS del presupuesto a partir del diagnóstico del lead: cuántos
 * de cada cosa habrá que configurar y qué módulos entran.
 *
 * NI UN PRECIO NI UNA HORA. El presupuesto lo sigue calculando
 * `calcularInstalacion()` con los volúmenes ya aplicados, igual que si los
 * hubiera tecleado el comercial. Y el NIVEL tampoco se le pregunta: sale solo de
 * los volúmenes (`nivelMinimoPorVolumenes`), y pedírselo a un modelo sería dejar
 * que discuta con una cuenta que ya está hecha.
 *
 * Lo que aporta de verdad no son las tres bandas —esas ya vienen precargadas sin
 * IA (§6.1 del plan)—, sino las OTRAS once líneas: cuántos puntos de venta,
 * cuántos almacenes, cuántas categorías de carta tiene un negocio así. Eso es una
 * estimación, y por eso nace desmarcada salvo que se deduzca de algo declarado.
 *
 * Del lead sale lo que declaró del NEGOCIO. Su nombre, su teléfono y su correo no
 * se mandan: no ayudan a estimar nada.
 */
export async function proponerEntradasLead(args: {
  sector:      string
  modoActual:  string | null
  necesidades: string[]
  /** El paso de tamaño, ya en palabras: «Personas en el equipo: Entre 4 y 5». */
  declarado:   string[]
  lineas:      LineaVolumenLead[]
  modulos:     ModuloCotizable[]
}): Promise<PropuestaIa<EntradaLead> | null> {
  if (!args.lineas.length && !args.modulos.length) return null

  const sys = [
    'Eres un asistente del equipo comercial de una plataforma de gestión para negocios de Cuba.',
    'Te doy lo que un negocio declaró en un formulario de diagnóstico y el formulario de presupuesto que hay que rellenar.',
    'Propones dos cosas: cuántos de cada cosa habrá que configurar y qué módulos entran.',
    'NO propones precios, ni horas, ni nivel: eso lo calcula el sistema con los números que tú propongas.',
    'Devuelves SOLO un objeto JSON con dos claves: {"v": [{"i","n","f","m"}], "mo": [{"c","f","m"}]}.',
    'v = volúmenes: i el número de la línea, n el número entero que propones. mo = módulos a marcar: c su clave exacta.',
    'f = tu confianza: "alta" solo si sale de algo que el lead declaró; "media" o "baja" si es una estimación por el tipo de negocio.',
    'm = por qué, en una frase corta en español; si viene de algo que el lead dijo, cítalo.',
    'Propón solo lo que aporte: una línea que ya tiene un número razonable se deja como está, y un módulo que no le hace falta no se marca.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = recortar([
    'NEGOCIO',
    `Sector: ${args.sector}`,
    args.modoActual ? `Cómo lo lleva hoy: ${args.modoActual}` : null,
    args.necesidades.length ? `Lo que pidió: ${args.necesidades.join(', ')}` : null,
    ...(args.declarado.length ? ['Tamaño declarado:', ...args.declarado.map(d => `  · ${d}`)] : []),
    '',
    'LÍNEAS DE VOLUMEN (número · qué se cuenta · lo que hay puesto ahora)',
    ...listaConTecho(args.lineas.map((l, i) => `${i + 1}. ${l.etiqueta} · ${l.actual}`), 30),
    '',
    'MÓDULOS COTIZABLES',
    ...listaConTecho(
      args.modulos.map(m => `${m.marcado ? '[marcado]' : '[ ]'} ${m.clave} · ${m.nombre}${m.descripcion ? ` — ${m.descripcion}` : ''}`),
      40,
    ),
  ].filter((l): l is string => l !== null).join('\n'))

  return intentar('entradas-lead', async () => {
    const { texto: out } = await chatInterno('presupuesto_lead', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.2, maxTokens: 1500,
    })
    const o = JSON.parse(out) as { v?: unknown; mo?: unknown }

    const lineas: LineaPropuesta<EntradaLead>[] = []
    const puestas = new Set<string>()

    for (const bruto of Array.isArray(o.v) ? o.v : []) {
      const linea = leerVolumenLead(bruto, args.lineas)
      if (!linea || puestas.has(linea.clave)) continue
      puestas.add(linea.clave)
      lineas.push(linea)
    }
    for (const bruto of Array.isArray(o.mo) ? o.mo : []) {
      const linea = leerModuloLead(bruto, args.modulos)
      if (!linea || puestas.has(linea.clave)) continue
      puestas.add(linea.clave)
      lineas.push(linea)
    }
    return lineas.length ? { lineas } : null
  })
}

/**
 * Un volumen propuesto. Se cae si no es un número usable o si no cambia nada:
 * repetir lo que ya está puesto solo obliga a leer una línea más.
 */
function leerVolumenLead(bruto: unknown, lineas: LineaVolumenLead[]): LineaPropuesta<EntradaLead> | null {
  if (!bruto || typeof bruto !== 'object') return null
  const o = bruto as Record<string, unknown>
  const l = lineas[Number(o.i) - 1]
  if (!l) return null

  const n = Math.floor(Number(o.n))
  if (!Number.isFinite(n) || n < 0 || n > TOPE_VOLUMEN || n === l.actual) return null

  return {
    clave:     `vol:${l.clave}`,
    titulo:    l.etiqueta,
    antes:     l.actual > 0 ? String(l.actual) : null,
    despues:   String(n),
    confianza: confianzaDe(o.f),
    motivo:    texto(o.m) ?? undefined,
    valor:     { tipo: 'volumen', clave: l.clave, valor: n },
  }
}

/** Un módulo a marcar. Solo del catálogo cotizable, y solo si no está ya marcado. */
function leerModuloLead(bruto: unknown, modulos: ModuloCotizable[]): LineaPropuesta<EntradaLead> | null {
  if (!bruto || typeof bruto !== 'object') return null
  const o = bruto as Record<string, unknown>
  const m = modulos.find(x => x.clave === texto(o.c))
  if (!m || m.marcado) return null

  return {
    clave:     `mod:${m.clave}`,
    titulo:    `Módulo · ${m.nombre}`,
    antes:     null,
    despues:   'Entra en el presupuesto',
    confianza: confianzaDe(o.f),
    motivo:    texto(o.m) ?? undefined,
    valor:     { tipo: 'modulo', clave: m.clave },
  }
}

// ── 8 · Ventas: el revisor de antes de emitir ────────────────────────────────

export interface BorradorPresupuesto {
  nivel:  string
  moneda: string
  /** Los módulos marcados, con su nombre de catálogo. */
  modulos: string[]
  /** Las líneas de volumen con número puesto: «Trabajadores: 12». */
  volumenes: string[]
  /** Fases que este cliente no contrata, si hay alguna. */
  fasesFuera: string[]
  formato: string
  migracion: string | null
  horas: number
  /** Las horas por fase, tal como las calculó el motor. */
  porFase: { fase: string; horas: number }[]
  tarifaHora: number
  descuentoPct: number
  descuentoMotivo: string | null
  total: number
  cuota: number
  /** Lo que el propio motor ya marcó como «revisar», para no repetirlo. */
  revisiones: string[]
}

/** Una instalación ya cerrada, con lo que costó de verdad. */
export interface CasoCerrado {
  ref:         string
  nivel:       string
  modulos:     string[]
  volumenes:   string[]
  horas:       number
  horasReales: number
  /** El desvío ya calculado por nosotros: «+70 %». */
  desvio:      string
}

export interface AvisoPresupuesto {
  clave:    string
  gravedad: 'alta' | 'media' | 'baja'
  /** Qué chirría, en una frase. */
  titulo:   string
  /** Qué mirar antes de emitir. */
  arreglo:  string
  /** En qué se apoya: el caso real o el dato del propio borrador. */
  apoyo:    string
}

export interface RevisionPresupuesto {
  avisos: AvisoPresupuesto[]
  /** El contexto que ponemos NOSOTROS, no el modelo: cuántos casos y cómo salieron. */
  nota?:  string
}

/** Casos cerrados que se le enseñan. Más allá, se repite el mismo patrón. */
const TOPE_CASOS = 8

/** Avisos que devuelve. Una lista más larga que esto no se lee: se cierra. */
const TOPE_AVISOS = 6

const GRAVEDADES = new Set(['alta', 'media', 'baja'])

/**
 * Revisa un presupuesto ANTES de emitirlo y devuelve avisos. Compara el borrador
 * con las instalaciones ya cerradas —`horas_reales` incluido, que se rellena al
 * cerrar y hoy no lo mira nadie— y con la coherencia interna de lo cotizado.
 *
 * ES LA ÚNICA QUE NO ESCRIBE, y a propósito (plan §Fase 4). Aquí quien decide es
 * quien vende: un aviso que se aplicara solo sería un precio cambiado por una
 * máquina. Por eso no devuelve una `PropuestaIa` —no hay nada que marcar ni que
 * aplicar— sino texto para leer y decidir.
 *
 * La aritmética no es suya: el desvío de cada caso y la mediana van calculados
 * desde fuera. Al modelo se le pide el juicio —qué chirría y por qué—, no la
 * cuenta, que ya está hecha y no admite que se equivoque.
 *
 * Del borrador NO viaja quién es el cliente: ni el nombre del negocio, ni el
 * contacto, ni el comercial. Nada de eso ayuda a saber si las horas se quedan
 * cortas.
 */
export async function revisarPresupuesto(args: {
  borrador: BorradorPresupuesto
  casos:    CasoCerrado[]
  /** Lo que decimos nosotros del histórico: «7 cerradas, la mediana se pasó un 25 %». */
  nota?:    string | null
}): Promise<RevisionPresupuesto | null> {
  const b = args.borrador
  if (!b.modulos.length && !b.horas) return null

  const casos = args.casos.slice(0, TOPE_CASOS)

  const sys = [
    'Eres un asistente del equipo comercial de una plataforma de gestión para negocios de Cuba.',
    'Te doy un presupuesto de instalación en borrador y las instalaciones que ya se cerraron, con las horas que costaron de verdad.',
    'Tu trabajo es avisar de lo que chirría ANTES de enviárselo al cliente. No corriges nada: avisas.',
    'Busca sobre todo: horas por debajo de lo que costó un caso parecido, un módulo cotizado sin aquello en lo que se apoya,',
    'volúmenes que no cuadran entre sí, un descuento grande con un motivo flojo, y lo que se cotiza sin ningún volumen detrás.',
    'Devuelves SOLO un objeto JSON con la clave "a": un array de objetos {g, t, q, e}.',
    'g = gravedad: "alta" si emitirlo así cuesta dinero o credibilidad, "media" si conviene mirarlo, "baja" si es un detalle.',
    't = qué chirría, una frase corta. q = qué revisar antes de emitir, una frase corta y concreta.',
    'e = en qué te apoyas: cita el caso cerrado por su referencia y sus horas, o el dato del borrador. Sin inventar cifras.',
    'No propongas precios ni horas nuevas: el precio lo calcula el sistema y lo decide quien vende.',
    'No repitas lo que ya está avisado en el borrador. Si no ves nada que señalar, devuelve la lista vacía: es una respuesta buena.',
    'Como mucho seis avisos, los que más importen. Escribe en español de España, sin tecnicismos.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = recortar([
    'BORRADOR',
    `Nivel: ${b.nivel} · Moneda: ${b.moneda} · Datos de partida: ${b.formato}`,
    `Módulos cotizados: ${b.modulos.length ? b.modulos.join(', ') : 'ninguno'}`,
    ...(b.volumenes.length ? ['Volúmenes:', ...listaConTecho(b.volumenes.map(v => `  · ${v}`), 30)] : ['Volúmenes: ninguno tecleado']),
    b.fasesFuera.length ? `Fases que NO se contratan: ${b.fasesFuera.join(', ')}` : null,
    b.migracion ? `Migración de histórico: ${b.migracion}` : null,
    `Horas totales: ${b.horas} · Tarifa: ${b.tarifaHora}/h`,
    ...(b.porFase.length ? ['Horas por fase:', ...b.porFase.map(f => `  · ${f.fase}: ${f.horas} h`)] : []),
    b.descuentoPct > 0
      ? `Descuento: ${b.descuentoPct} % · Motivo: ${b.descuentoMotivo || '(sin escribir)'}`
      : 'Sin descuento',
    `Total instalación: ${b.total} · Cuota mensual: ${b.cuota}`,
    ...(b.revisiones.length ? ['Ya avisado en pantalla (NO lo repitas):', ...b.revisiones.map(r => `  · ${r}`)] : []),
    '',
    ...(casos.length
      ? [
          'INSTALACIONES YA CERRADAS (presupuestadas → reales)',
          ...casos.map(c => [
            `· ${c.ref} · nivel ${c.nivel} · ${c.horas} h presupuestadas → ${c.horasReales} h reales (${c.desvio})`,
            c.modulos.length   ? `    módulos: ${c.modulos.join(', ')}` : null,
            c.volumenes.length ? `    volúmenes: ${c.volumenes.join(' · ')}` : null,
          ].filter((l): l is string => l !== null).join('\n')),
        ]
      : ['INSTALACIONES YA CERRADAS: ninguna todavía. Juzga solo la coherencia del borrador.']),
    args.nota ? `\n${args.nota}` : null,
  ].filter((l): l is string => l !== null).join('\n'))

  return intentar('revisor-presupuesto', async () => {
    const { texto: out } = await chatInterno('presupuesto_revisor', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.2, maxTokens: 1200,
    })
    const o = JSON.parse(out) as { a?: unknown }
    if (!Array.isArray(o.a)) return null

    const avisos: AvisoPresupuesto[] = []
    for (const bruto of o.a) {
      if (!bruto || typeof bruto !== 'object') continue
      const x = bruto as Record<string, unknown>
      const titulo = texto(x.t)
      if (!titulo) continue
      const g = String(x.g ?? '').toLowerCase()
      avisos.push({
        clave:    `av${avisos.length + 1}`,
        gravedad: (GRAVEDADES.has(g) ? g : 'media') as AvisoPresupuesto['gravedad'],
        titulo,
        arreglo:  texto(x.q) ?? '',
        apoyo:    texto(x.e) ?? '',
      })
      if (avisos.length >= TOPE_AVISOS) break
    }
    // Sin avisos NO es un fallo: es la respuesta buena. Por eso devuelve el objeto
    // igual (y la pantalla dice «no ve nada»), en vez de degradar a `null` como
    // hacen las que proponen, donde una lista vacía sí es no tener nada que decir.
    return { avisos, nota: args.nota ?? undefined }
  })
}

// ── 9 · Soporte: clasificar el mensaje al entrar ─────────────────────────────

export type TipoSoporte      = 'duda' | 'fallo' | 'peticion'
export type PrioridadSoporte = 'alta' | 'media' | 'baja'

export interface ClasificacionSoporte {
  /** Clave de `modulos_catalogo` o 'general'. Nunca una inventada. */
  tema:      string
  tipo:      TipoSoporte
  prioridad: PrioridadSoporte
  /** El mensaje en una línea, para leer la bandeja sin abrir cada fila. */
  resumen:   string
}

const TIPOS_SOPORTE       = new Set<string>(['duda', 'fallo', 'peticion'])
const PRIORIDADES_SOPORTE = new Set<string>(['alta', 'media', 'baja'])

/** Lo que cabe en una celda de la bandeja. Más largo no se lee: se abre el mensaje. */
const TOPE_RESUMEN = 160

/**
 * Etiqueta un mensaje de soporte: de qué módulo habla, si es duda, fallo o
 * petición, cuánto corre y una línea de resumen.
 *
 * Es la ÚNICA que escribe sin que nadie pulse nada, y la excepción está razonada
 * en el plan (§Fase 5): no altera ningún dato del cliente ni nada que él vea —
 * pone una etiqueta en una fila NUESTRA para poder ordenar la bandeja. La
 * etiqueta se corrige a mano y la pantalla dice que la puso la IA.
 *
 * El tema se valida contra el catálogo de módulos: un tema inventado dejaría al
 * borrador de respuesta buscando FAQs de un módulo que no existe, que es
 * exactamente el problema que esta función viene a resolver.
 */
export async function clasificarSoporte(args: {
  asunto:  string
  mensaje: string
  modulos: { clave: string; nombre: string }[]
}): Promise<ClasificacionSoporte | null> {
  const asunto  = (args.asunto ?? '').trim()
  const mensaje = (args.mensaje ?? '').trim()
  if (!asunto && !mensaje) return null

  const sys = [
    'Eres el clasificador de la bandeja de soporte de una plataforma de gestión para negocios de Cuba.',
    'Te doy un mensaje que ha escrito un cliente y la lista de módulos de la plataforma.',
    'Devuelves SOLO un objeto JSON: {"t": clave del módulo del que habla o "general", "k": "duda"|"fallo"|"peticion", "p": "alta"|"media"|"baja", "r": resumen}.',
    't tiene que ser una de las claves que te doy, o "general" si no va de un módulo concreto ni lo tienes claro.',
    'k: "fallo" si algo no funciona o da error, "peticion" si pide algo nuevo o un cambio, "duda" si pregunta cómo se hace algo.',
    'p: "alta" si le impide trabajar o hay dinero o datos en juego, "media" si le estorba, "baja" si puede esperar.',
    'r: una sola frase corta, en español de España, que diga qué necesita. Sin saludos ni cortesías.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = recortar([
    'MÓDULOS (clave · nombre)',
    ...listaConTecho(args.modulos.map(m => `${m.clave} · ${m.nombre}`), 40),
    '',
    'MENSAJE',
    `Asunto: ${asunto}`,
    mensaje,
  ].join('\n'), 3000)

  return intentar('clasificar-soporte', async () => {
    const { texto: out } = await chatInterno('soporte_clasificar', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.1, maxTokens: 300,
    })
    const o = JSON.parse(out) as Record<string, unknown>

    const tema = texto(o.t)
    const tipo = String(o.k ?? '').toLowerCase()
    const prio = String(o.p ?? '').toLowerCase()

    return {
      // Un tema que no está en el catálogo vale menos que ninguno: 'general' es
      // lo que ya se hacía y no manda a nadie a buscar FAQs que no existen.
      tema:      tema && args.modulos.some(m => m.clave === tema) ? tema : 'general',
      tipo:      (TIPOS_SOPORTE.has(tipo) ? tipo : 'duda') as TipoSoporte,
      prioridad: (PRIORIDADES_SOPORTE.has(prio) ? prio : 'media') as PrioridadSoporte,
      resumen:   (texto(o.r) ?? '').slice(0, TOPE_RESUMEN),
    }
  })
}

// ── 10 · Soporte: la pregunta frecuente que falta ────────────────────────────

/** Un mensaje ya respondido: la materia prima de una FAQ. */
export interface MensajeResuelto {
  id:        number
  /** El tema de la mig. 237. Nulo en los de antes, y no pasa nada: agrupa igual. */
  tema:      string | null
  asunto:    string
  mensaje:   string
  respuesta: string
}

/** La entrada de FAQ que se guardaría si alguien la marca. */
export interface FaqPropuesta {
  modulo_clave: string
  pregunta:     string
  respuesta:    string
  /** Los mensajes en que se apoya. Se pintan para poder comprobarla. */
  apoyo:        number[]
}

/** Mensajes que caben en una llamada. Cuarenta es media bandeja y no revienta el prompt. */
const TOPE_MENSAJES_FAQ = 40
/** Entradas por tanda. Más de seis no se revisan: se aprueban en bloque. */
const TOPE_FAQS_NUEVAS  = 6
/**
 * Mensajes que tienen que sostener una entrada. El plan pedía tres —«lo que se ha
 * respondido tres veces»— y esa sigue siendo la instrucción al modelo. Aquí se
 * exigen DOS porque el modelo cita los mensajes más claros, no todos los que
 * miró: tirar una FAQ buena por haber citado dos de las cuatro veces que se
 * preguntó sería peor. Los mensajes citados se ven en el panel, y quien decide
 * publicar es una persona.
 */
const TOPE_APOYO_MINIMO = 2
const TOPE_PREGUNTA_FAQ  = 160
const TOPE_RESPUESTA_FAQ = 700
/** Lo que viaja de cada mensaje: lo suficiente para ver de qué iba. */
const TOPE_TEXTO_MENSAJE = 280

/** Un texto de varias líneas, en una sola y con techo, para que la lista se lea. */
const enUnaLinea = (s: string, max: number): string =>
  (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * Propone entradas de FAQ nuevas leyendo lo que ya se respondió. La pregunta que
 * contesta es «¿qué estamos contestando una y otra vez?», que es la única razón
 * por la que una FAQ merece existir.
 *
 * Lo que sale de aquí NO se publica: se guarda inactivo (`activo: false`) y lo
 * publica una persona desde la lista. Una respuesta de FAQ la leen todos los
 * clientes, y eso no es un lote.
 *
 * De cada mensaje viaja el texto y su respuesta, sin el cliente que lo escribió:
 * para saber qué se repite no hace falta saber quién preguntó.
 */
export async function proponerFaqs(args: {
  mensajes: MensajeResuelto[]
  /** Las publicadas —y las ocultas—, para no volver a proponer lo mismo. */
  faqs:     { modulo_clave: string; pregunta: string }[]
  modulos:  { clave: string; nombre: string }[]
}): Promise<PropuestaIa<FaqPropuesta> | null> {
  const mensajes = args.mensajes.slice(0, TOPE_MENSAJES_FAQ)
  if (mensajes.length < TOPE_APOYO_MINIMO) return null

  const sys = [
    'Eres quien mantiene las preguntas frecuentes de una plataforma de gestión para negocios de Cuba.',
    'Te doy mensajes de soporte YA RESPONDIDOS y las preguntas frecuentes que ya existen.',
    'Buscas lo que se repite: una pregunta frecuente sale de algo que se ha respondido TRES VECES O MÁS, no de un caso suelto.',
    'Devuelves SOLO un objeto JSON: {"f": [{"t","q","a","ids","c","m"}]}.',
    't = la clave del módulo del que va, o "general". q = la pregunta, tal y como la haría un cliente.',
    'a = la respuesta, en español de España, tratando de usted, sin saludos ni despedidas, cinco frases como mucho.',
    'ids = los números de los mensajes en los que te apoyas.',
    'c = tu confianza: "alta" si se preguntó varias veces y se respondió siempre lo mismo; "baja" si lo deduces de un caso o las respuestas no coinciden.',
    'm = por qué hace falta, en una frase corta.',
    'No repitas una pregunta que ya exista, ni propongas nada que dependa de los datos de un cliente concreto.',
    'No cites empresas, personas ni cifras de nadie: la respuesta la leerán todos los clientes.',
    'Si no se repite nada, devuelve {"f": []}.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = recortar([
    'MÓDULOS (clave · nombre)',
    ...listaConTecho(args.modulos.map(m => `${m.clave} · ${m.nombre}`), 40),
    '',
    args.faqs.length ? 'PREGUNTAS QUE YA EXISTEN' : 'NO HAY NINGUNA PREGUNTA FRECUENTE TODAVÍA',
    ...listaConTecho(args.faqs.map(f => `[${f.modulo_clave}] ${enUnaLinea(f.pregunta, 160)}`), 40),
    '',
    'MENSAJES RESPONDIDOS',
    ...mensajes.flatMap(m => [
      `#${m.id}${m.tema ? ` · ${m.tema}` : ''} · ${enUnaLinea(m.asunto, 120)}`,
      `  Preguntó: ${enUnaLinea(m.mensaje, TOPE_TEXTO_MENSAJE)}`,
      `  Respondimos: ${enUnaLinea(m.respuesta, TOPE_TEXTO_MENSAJE)}`,
    ]),
  ].join('\n'))

  return intentar('faqs-soporte', async () => {
    const { texto: out } = await chatInterno('soporte_faq', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.3, maxTokens: 2000,
    })
    const o = JSON.parse(out) as { f?: unknown }

    const vistos = new Set(args.faqs.map(f => enUnaLinea(f.pregunta, 160).toLowerCase()))
    const ids    = new Set(mensajes.map(m => m.id))
    const lineas: LineaPropuesta<FaqPropuesta>[] = []

    for (const bruto of Array.isArray(o.f) ? o.f : []) {
      if (lineas.length >= TOPE_FAQS_NUEVAS) break
      const linea = leerFaqPropuesta(bruto, args.modulos, ids, lineas.length + 1)
      if (!linea) continue
      const firma = linea.titulo.toLowerCase()
      if (vistos.has(firma)) continue
      vistos.add(firma)
      lineas.push(linea)
    }
    // Una lista vacía no es un fallo: es que no se repite nada. Se devuelve la
    // propuesta igual para que el panel lo diga en vez de parecer una avería.
    return {
      lineas,
      nota: lineas.length
        ? 'Las que guardes nacen ocultas: repásalas y publícalas desde la lista.'
        : undefined,
    }
  })
}

/** Una entrada propuesta. Se cae si no trae pregunta, respuesta o mensajes que la sostengan. */
function leerFaqPropuesta(
  bruto:   unknown,
  modulos: { clave: string; nombre: string }[],
  ids:     Set<number>,
  /** Su sitio en la tanda: es la clave de la línea en el panel, y tiene que ser única. */
  orden:   number,
): LineaPropuesta<FaqPropuesta> | null {
  if (!bruto || typeof bruto !== 'object') return null
  const o = bruto as Record<string, unknown>

  const pregunta  = texto(o.q)
  const respuesta = texto(o.a)
  if (!pregunta || !respuesta) return null

  // Solo los mensajes que le dimos: un id inventado no se puede comprobar, y sin
  // poder comprobarla la entrada no es revisable.
  const apoyo = [...new Set((Array.isArray(o.ids) ? o.ids : [])
    .map(v => Math.floor(Number(v)))
    .filter(n => Number.isFinite(n) && ids.has(n)))]
  if (apoyo.length < TOPE_APOYO_MINIMO) return null

  const clave = texto(o.t)
  const mod   = modulos.find(m => m.clave === clave)

  return {
    clave:     `faq:${orden}`,
    titulo:    enUnaLinea(pregunta, TOPE_PREGUNTA_FAQ),
    antes:     null,
    despues:   enUnaLinea(respuesta, TOPE_RESPUESTA_FAQ),
    confianza: confianzaDe(o.c),
    motivo:    [texto(o.m), `Sale de ${apoyo.length} mensajes: ${apoyo.map(n => `#${n}`).join(', ')}`]
      .filter(Boolean).join(' · '),
    valor: {
      modulo_clave: mod ? mod.clave : 'general',
      pregunta:     enUnaLinea(pregunta, TOPE_PREGUNTA_FAQ),
      respuesta:    enUnaLinea(respuesta, TOPE_RESPUESTA_FAQ),
      apoyo,
    },
  }
}

// ── 11 · Panel: el parte del equipo ──────────────────────────────────────────

/** Un número del día, ya en palabras: «Pagos de la semana · 4». */
export interface CifraParte { etiqueta: string; valor: string }

/** Un aviso REAL, de los que genera el catálogo. La IA no puede inventar otro. */
export interface AvisoParte {
  /** Su número en la lista. Es como lo cita el modelo, y como se le pone el enlace. */
  n:         number
  severidad: string
  titulo:    string
  cuerpo:    string
  /** «hoy», «ayer», «hace 6 días». */
  edad:      string
}

export interface LineaParte {
  texto: string
  /** El aviso del que sale, si sale de uno. `null` = sale de las cifras. */
  aviso: number | null
}

/** Líneas del parte. Cinco es lo que se lee de pie antes de empezar el día. */
const TOPE_LINEAS_PARTE = 5

/**
 * Escribe el parte de la mañana: qué se movió, qué se ha quedado parado y qué
 * toca hacer ahora.
 *
 * DETECTAR SIGUE SIENDO DETERMINISTA. Los problemas los encuentra el catálogo de
 * avisos, que es código; la IA solo decide qué contar primero y con qué palabras.
 * Por eso el modelo cita los avisos POR NÚMERO y el enlace no lo escribe él: lo
 * pone quien llama, sacándolo del aviso citado. Un aviso que el catálogo no haya
 * generado no puede aparecer aquí, y una línea que cite un número que no existe
 * se cae.
 */
export async function escribirParte(args: {
  fecha:  string
  cifras: CifraParte[]
  avisos: AvisoParte[]
}): Promise<LineaParte[] | null> {
  if (!args.cifras.length && !args.avisos.length) return null

  const sys = [
    'Eres quien escribe el parte de la mañana del equipo de CLAUX, una plataforma de gestión para negocios de Cuba.',
    'Te doy las cifras del día y los avisos que el sistema ha detectado. Los avisos los detecta el sistema, no tú.',
    'NO puedes señalar un problema que no esté en la lista de avisos, ni dar por hecho nada que no esté en las cifras.',
    'Devuelves SOLO un objeto JSON: {"l": [{"t","a"}]}, cinco líneas como mucho, en el orden en que hay que atenderlas.',
    't = la línea, una sola frase en español de España. Sin saludos, sin «parece que», con el número delante cuando lo haya.',
    'a = el número del aviso del que sale la línea, o null si sale solo de las cifras.',
    'Una de las líneas tiene que decir QUÉ HACER AHORA, en concreto y con lo que hay.',
    'Agrupa lo que se repite: cinco avisos del mismo tipo son una línea, no cinco.',
    'Si no hay nada que contar, devuelve {"l": []}.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = recortar([
    `HOY ES ${args.fecha}`,
    '',
    args.cifras.length ? 'CIFRAS' : 'NO HAY CIFRAS',
    ...args.cifras.map(c => `· ${c.etiqueta}: ${c.valor}`),
    '',
    args.avisos.length ? 'AVISOS PENDIENTES (número · gravedad · qué es · cuándo)' : 'NO HAY NINGÚN AVISO PENDIENTE',
    ...listaConTecho(
      args.avisos.map(a => `${a.n}. [${a.severidad}] ${enUnaLinea(a.titulo, 120)} — ${enUnaLinea(a.cuerpo, 160)} (${a.edad})`),
      25,
    ),
  ].join('\n'))

  return intentar('parte-equipo', async () => {
    const { texto: out } = await chatInterno('parte_equipo', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.3, maxTokens: 800,
    })
    const o = JSON.parse(out) as { l?: unknown }

    const numeros = new Set(args.avisos.map(a => a.n))
    const lineas: LineaParte[] = []
    for (const bruto of Array.isArray(o.l) ? o.l : []) {
      if (lineas.length >= TOPE_LINEAS_PARTE) break
      if (!bruto || typeof bruto !== 'object') continue
      const b = bruto as Record<string, unknown>
      const t = texto(b.t)
      if (!t) continue
      const n = Math.floor(Number(b.a))
      lineas.push({ texto: t, aviso: Number.isFinite(n) && numeros.has(n) ? n : null })
    }
    return lineas
  })
}

// ── 12 · Panel: la ficha de cliente, antes de la llamada ─────────────────────

/** Lo que se sabe de UN cliente, ya en palabras. Nunca entra aquí otro cliente. */
export interface FichaClienteIa {
  empresa:   string
  estado:    string
  nivel:     string
  /** Cuánto lleva con nosotros, en palabras: «desde hace 7 meses». */
  antiguedad: string
  vence:     string | null
  socio:     boolean
  modulos:   string[]
  cuota:     string
  /** Una línea por cobro: «2026-08-01 · 45,00 USD · confirmado». */
  pagos:     string[]
  presupuestos: string[]
  /** Los últimos mensajes de soporte: fecha, asunto y si está resuelto. */
  soporte:   string[]
  /** Cuándo entró alguien de ese negocio por última vez. */
  actividad: string
  /** Avisos abiertos de este cliente. Los detecta el catálogo, no la IA. */
  avisos:    string[]
}

export interface ResumenCliente {
  /** Cómo va, en tres frases. */
  estado:    string[]
  /** Qué hacer ahora. Es a lo que se viene. */
  siguiente: string
}

const TOPE_FRASES_FICHA = 3

/**
 * El minuto antes de la llamada: cómo va este cliente y qué toca hacer con él.
 *
 * No se guarda en ninguna parte y no escribe nada: es una lectura de lo que ya
 * está en la pantalla, ordenada para poder hablar. Si el siguiente paso merece
 * quedarse, se apunta a mano donde corresponda.
 *
 * SOLO ESTE CLIENTE. Nunca se le pasan otros en el mismo prompt: un modelo al que
 * le enseñas la cartera acaba comparando negocios que no se parecen en nada, y de
 * paso saca datos de un cliente en la conversación de otro. Tampoco viajan el
 * teléfono ni el correo del contacto: para decir qué toca hacer no hacen falta.
 */
export async function resumirCliente(args: { ficha: FichaClienteIa }): Promise<ResumenCliente | null> {
  const f = args.ficha
  if (!f.empresa) return null

  const sys = [
    'Eres del equipo de CLAUX, una plataforma de gestión para negocios de Cuba, y preparas la ficha de un cliente para la llamada de ahora.',
    'Te doy TODO lo que sabemos de ese cliente. No sabes nada más: no supongas, y si un dato no está, no lo inventes.',
    'Devuelves SOLO un objeto JSON: {"e": ["frase","frase","frase"], "s": "el siguiente paso"}.',
    'e = cómo va, en tres frases como mucho: lo que paga, cómo lo usa y qué le está pasando. Español de España, sin adjetivos de vendedor.',
    's = QUÉ HACER AHORA con él, en una frase concreta y accionable con lo que hay.',
    'No compares con otros clientes: no los conoces.',
    'No prometas plazos, precios ni descuentos.',
    'No añadas texto fuera del JSON.',
  ].join(' ')

  const usuario = recortar([
    `NEGOCIO: ${f.empresa}`,
    `Estado: ${f.estado} · Nivel: ${f.nivel} · ${f.antiguedad}`,
    f.socio ? 'Es Socio CLAUX: no se le cobra ni se le corta el acceso.' : null,
    f.vence ? `Vence el ${f.vence}` : null,
    `Cuota: ${f.cuota}`,
    `Módulos: ${f.modulos.length ? f.modulos.join(', ') : 'ninguno'}`,
    `Actividad: ${f.actividad}`,
    '',
    f.pagos.length ? 'ÚLTIMOS PAGOS' : 'NO HAY NINGÚN PAGO REGISTRADO',
    ...listaConTecho(f.pagos, 8),
    '',
    f.presupuestos.length ? 'PRESUPUESTOS' : 'NO HAY PRESUPUESTOS',
    ...listaConTecho(f.presupuestos, 5),
    '',
    f.soporte.length ? 'ÚLTIMOS MENSAJES DE SOPORTE' : 'NO HA ESCRITO A SOPORTE',
    ...listaConTecho(f.soporte, 6),
    '',
    f.avisos.length ? 'AVISOS ABIERTOS SOBRE ESTE CLIENTE' : 'NO HAY AVISOS ABIERTOS SOBRE ESTE CLIENTE',
    ...listaConTecho(f.avisos, 8),
  ].filter((l): l is string => l !== null).join('\n'))

  return intentar('resumen-cliente', async () => {
    const { texto: out } = await chatInterno('cliente_resumen', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.3, maxTokens: 700,
    })
    const o = JSON.parse(out) as { e?: unknown; s?: unknown }

    const estado = (Array.isArray(o.e) ? o.e : [])
      .map(v => texto(v))
      .filter((v): v is string => !!v)
      .slice(0, TOPE_FRASES_FICHA)
    const siguiente = texto(o.s)
    // Sin siguiente paso esto es un resumen de lo que ya se está viendo: la ficha
    // entera está en la pantalla de detrás.
    if (!siguiente) return null
    return { estado, siguiente }
  })
}

// ── 13 · Migración: colocar en nuestro plan las cuentas del cliente ──────────

export interface CuentaAClasificar {
  categoria_id: string
  nombre:       string
  descripcion:  string | null
  /** Las subcategorías dicen del renglón más que el nombre de la madre. */
  hijas:        string[]
  rol_actual:   RolPL
}

/** Lo que se aplica: el papel nuevo de una categoría RAÍZ. */
export interface RolPropuesto {
  categoria_id: string
  rol:          RolPL
  /** Para el registro de auditoría, que se escribe con nombres y no con ids. */
  nombre:       string
}

const TOPE_CUENTAS   = 40
const TOPE_HIJAS_IA  = 6
const TOPE_YA_PUESTAS = 25

/**
 * Las categorías que llegaron con una migración, colocadas en nuestro plan.
 *
 * Cuando migramos un negocio, sus categorías entran con el papel que el operador
 * eligió PARA TODO EL LOTE (`rolNuevas`, un desplegable del importador), así que
 * el histórico entero aterriza en el mismo renglón del estado de resultados. Esto
 * lee los nombres —y sobre todo las subcategorías, que delatan el renglón mucho
 * mejor que la madre— y propone dónde va cada una.
 *
 * DOS COSAS QUE NO HACE, y son la fase entera:
 *
 *  1. No escribe. Devuelve la propuesta y la aplica una persona en lote, con el
 *     panel de siempre. Aquí el criterio del contador manda de verdad: las
 *     materias primas de un cliente real van a operativos POR DECISIÓN, no por
 *     error, y un modelo que no lo sabe las mandaría a coste de ventas.
 *  2. Lo dudoso NO se ofrece. La confianza baja no llega al panel siquiera
 *     desmarcada: sale por `nota`, en la lista de «estas las miras tú». Marcar
 *     sin querer una casilla dudosa mueve dinero de renglón en el informe de un
 *     negocio, y eso no se arregla mirando otra vez.
 *
 * Una sola llamada por lote, nunca una por categoría (§9 del plan).
 */
export async function clasificarCuentas(args: {
  negocio:        string
  cuentas:        CuentaAClasificar[]
  /** Las que ya tienen papel puesto: es nuestro plan aplicado a ESTE cliente. */
  yaClasificadas: { nombre: string; rol: RolPL }[]
}): Promise<PropuestaIa<RolPropuesto> | null> {
  const cuentas = args.cuentas.slice(0, TOPE_CUENTAS)
  if (!cuentas.length) return null

  const sys = [
    'Eres contable y colocas las categorías de gasto e ingreso de un negocio cubano en el plan de CLAUX.',
    'Devuelves SOLO un objeto JSON: {"c": [{"n": 1, "r": "OPERATIVO", "m": "por qué", "f": "alta"}]}.',
    'n = el número de la categoría, tal cual te lo doy. r = una de las claves de la lista de renglones, EXACTA.',
    'm = por qué, en una frase corta y sin jerga. f = tu confianza: alta, media o baja.',
    'Si no lo tienes claro pon f = "baja": lo dudoso lo revisa una persona y no cuesta nada decir que no lo sabes.',
    'La mayoría de los gastos de un negocio son OPERATIVO. No busques excepciones donde no las hay.',
    'Una categoría por número, y solo números de la lista. No añadas texto fuera del JSON.',
  ].join(' ')

  const renglones = ROLES_PL.map(r => `${r} — ${ROL_PL_LABEL[r]}: ${ROL_PL_AYUDA[r]}`)

  const usuario = recortar([
    `NEGOCIO: ${args.negocio}`,
    '',
    'RENGLONES DEL PLAN (usa la clave en mayúsculas)',
    ...renglones,
    '',
    args.yaClasificadas.length ? 'YA COLOCADAS EN ESTE NEGOCIO (para que sigas el mismo criterio)' : '',
    ...listaConTecho(
      args.yaClasificadas.map(c => `${c.nombre} → ${c.rol}`),
      TOPE_YA_PUESTAS,
    ),
    '',
    'CATEGORÍAS POR COLOCAR',
    ...cuentas.map((c, i) => {
      const hijas = c.hijas.slice(0, TOPE_HIJAS_IA)
      return [
        `${i + 1}. ${c.nombre}`,
        c.descripcion && c.descripcion !== c.nombre ? ` (${c.descripcion})` : '',
        hijas.length ? ` · dentro: ${hijas.join(', ')}` : '',
        ` · ahora está en ${c.rol_actual}`,
      ].join('')
    }),
  ].filter(Boolean).join('\n'))

  return intentar('clasificar-cuentas', async () => {
    const { texto: out } = await chatInterno('contabilidad_cuentas', {
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: usuario }],
      json: true, temperature: 0.2, maxTokens: 2000,
    })
    const o = JSON.parse(out) as { c?: unknown }
    const brutos = Array.isArray(o.c) ? o.c : []

    const lineas: LineaPropuesta<RolPropuesto>[] = []
    const dudosas: string[] = []
    const vistas   = new Set<number>()
    let confirmadas = 0

    for (const b of brutos) {
      const r = b as { n?: unknown; r?: unknown; m?: unknown; f?: unknown }
      const n = Number(r.n)
      if (!Number.isInteger(n) || n < 1 || n > cuentas.length || vistas.has(n)) continue
      vistas.add(n)
      const cuenta = cuentas[n - 1]

      // Un renglón que no existe es un fallo del modelo, no una duda del contable:
      // no se ofrece y se manda a mirar a mano.
      const rol = String(r.r ?? '').trim().toUpperCase()
      if (!esRolPL(rol)) { dudosas.push(cuenta.nombre); continue }

      if (confianzaDe(r.f) === 'baja') { dudosas.push(cuenta.nombre); continue }
      // Confirmar lo que ya está puesto no es un cambio: se cuenta y no se pinta.
      if (rol === cuenta.rol_actual) { confirmadas++; continue }

      lineas.push({
        clave:     cuenta.categoria_id,
        titulo:    cuenta.nombre,
        antes:     ROL_PL_LABEL[cuenta.rol_actual],
        despues:   ROL_PL_LABEL[rol],
        confianza: confianzaDe(r.f),
        motivo:    texto(r.m) ?? undefined,
        valor:     { categoria_id: cuenta.categoria_id, rol, nombre: cuenta.nombre },
      })
    }

    // Las que no contestó se miran igual que las dudosas: callarse no es dejarlas bien.
    for (const [i, c] of cuentas.entries()) if (!vistas.has(i + 1)) dudosas.push(c.nombre)

    const nota = [
      confirmadas ? `${confirmadas} se quedan donde están.` : '',
      dudosas.length ? `Estas no las sabe colocar, hay que revisarlas: ${dudosas.join(', ')}.` : '',
    ].filter(Boolean).join(' ')

    return { lineas, ...(nota ? { nota } : {}) }
  })
}
