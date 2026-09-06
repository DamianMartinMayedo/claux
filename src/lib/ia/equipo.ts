// ── Los cuatro sitios donde la IA nos ahorra trabajo A NOSOTROS ──────────────
// Importador, propuesta, soporte y relleno de textos. Todos pasan por
// `chatInterno` (bolsa interna, tope duro, medición por origen) y todos cumplen
// la misma regla, que es la que los hace seguros de enchufar:
//
//   PROPONEN Y NUNCA ESCRIBEN. Ninguna de estas funciones toca la base de datos.
//   Devuelven texto que va a parar a un formulario, y guarda una persona.
//
// Cuando la IA no está configurada, falla o contesta algo que no se puede leer,
// devuelven `null` y la pantalla sigue funcionando a mano — que es como funciona
// hoy. Lo único que sí sube es `IaBolsaAgotada`: eso no es una avería, es una
// decisión de presupuesto, y quien llama tiene que poder decirlo con esas palabras.

import { chatInterno, IaBolsaAgotada } from './interna'
import { IaNoConfigurada } from './provider'

/** Une el `try` de las cuatro: la bolsa agotada sube, lo demás degrada a `null`. */
async function intentar<T>(que: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof IaBolsaAgotada) throw e
    if (!(e instanceof IaNoConfigurada)) console.error(`[ia-interna] ${que}`, e)
    return null
  }
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

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
    const { texto: out } = await chatInterno('importador', {
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
    'Registro profesional y conciso, en español de Cuba, tratando de tú. Frases cortas. Nada de superlativos ni lenguaje de folleto.',
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
    const { texto: out } = await chatInterno('propuesta', {
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
    'NO prometas plazos, precios, descuentos ni arreglos concretos: si hace falta comprometerse a algo, escribe que lo revisamos y contestamos.',
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
    const { texto: out } = await chatInterno('soporte', {
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
    'Registro profesional y conciso, tratando de tú al dueño del negocio. Sin superlativos ni lenguaje de folleto.',
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
    const { texto: out } = await chatInterno('relleno', {
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
