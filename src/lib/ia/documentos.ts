// ── Documentos de IA editables desde el admin ──
// Cada "documento" es un prompt guardado en settings con su clave; aquí viven los
// valores por defecto y el registro que consumen tanto el agente (valor efectivo)
// como el admin (listado/edición en modal). Añadir un documento nuevo = una fila
// más en DOCUMENTOS_IA. Sin dependencias de otros módulos de IA (evita ciclos).

// `revisar` comparte el foco de contexto con `inventario` pero es una tarea distinta
// (narrar descuadres, no recomendar reposición). Precedente exacto: `compras`.
export type TipoInsight = 'ventas' | 'gastos' | 'proyeccion' | 'general' | 'inventario' | 'rrhh' | 'tesoreria' | 'catalogo' | 'caja' | 'reservas' | 'citas' | 'suscripciones' | 'servicios' | 'deudas' | 'compras' | 'revisar'

// Prompt de TAREA por sección (lo que se le pide analizar). El contexto del
// negocio (datos reales) se añade aparte, por código.
export const PROMPTS_INSIGHT_DEFAULT: Record<TipoInsight, string> = {
  general:    'Dame un análisis general de la salud de mi negocio con lo más relevante de ventas, gastos, caja y agenda, y 1-2 acciones prioritarias. Máximo 6 frases.',
  ventas:     'Analiza la evolución de mis VENTAS de los últimos 6 meses: tendencia, mejor y peor mes, y una recomendación. Máximo 5 frases.',
  gastos:     'Analiza mis GASTOS: tendencia de los últimos 6 meses y, con el desglose por categoría del mes, las categorías que más pesan y dónde podría ahorrar. Máximo 5 frases.',
  proyeccion: 'Proyecta mis ingresos y resultado del próximo mes según la tendencia reciente, indicando el supuesto usado. Sé prudente. Máximo 5 frases.',
  inventario: 'Analiza mi INVENTARIO usando la lista `urgentes` (con su almacén y su cobertura en días): di qué se me acaba antes y en qué almacén, con la fecha aproximada si hay cobertura, y qué conviene reponer primero. Menciona el valor del inventario solo si aporta. La cobertura es una estimación: dilo así. Máximo 5 frases.',
  rrhh:       'Analiza mi PERSONAL: tamaño de la plantilla, altas recientes y cómo evoluciona el COSTE de personal según `costeSerie` (es el devengado, no el neto). Si hay `vacacionesDeuda`, di cuánto tengo acumulado en vacaciones y que es dinero que se paga cuando se disfrutan. Avisa de las nóminas sin confirmar y de los contratos que terminan. Máximo 5 frases.',
  tesoreria:  'Analiza mi LIQUIDEZ: saldos de caja por moneda y cómo se ven frente a mis ventas y gastos recientes. Máximo 5 frases.',
  catalogo:   'Revisa mi CATÁLOGO público: ítems sin foto, sin descripción o sin precio que conviene completar para vender mejor, y 1-2 mejoras concretas. Máximo 5 frases.',
  caja:       'Analiza mi PUNTO DE VENTA: ventas de hoy por terminal, puntos que llevan días sin sincronizar y turnos abiertos de días anteriores. Di siempre la CONSECUENCIA, que es lo que el dueño no sabe: mientras un turno no se cierre y se sincronice, esa venta NO está en tesorería ni en el informe, y el stock tampoco se ha descontado. Prioriza qué hacer hoy. Máximo 5 frases.',
  reservas:   'Analiza mis RESERVAS: ocupación de hoy, próxima reserva y la carga de los próximos 7 días. Señala días flojos o cargados y una recomendación. Máximo 5 frases.',
  citas:      'Analiza mi AGENDA DE CITAS: citas de hoy, próxima cita y la carga de los próximos 7 días, con una recomendación para llenar huecos. Máximo 5 frases.',
  suscripciones: 'Analiza mis SUSCRIPCIONES: ingreso recurrente por moneda y cómo se mueve (altas y bajas del mes). Di qué hay que hacer HOY con `cobros_atrasados` (desde cuándo), `borradores_sin_emitir` y `deuda_por_cobrar`, y avisa de los acuerdos que vencen sin renovación automática. Máximo 6 frases.',
  servicios:  'Analiza mi CATÁLOGO DE SERVICIOS a partir de `suscripciones`: qué servicios crecen y cuáles no tiene contratados nadie, y sobre todo QUIÉN ESTÁ EN RIESGO DE BAJA — el que paga tarde de forma sistemática, el que está pausado y el que vence sin renovación automática. Termina con la acción más rentable ahora. Máximo 6 frases.',
  deudas:     'Analiza mis DEUDAS: cuánto me deben (por cobrar) y cuánto debo (por pagar), por moneda, cuánto está vencido y quiénes son los principales. Prioriza a quién reclamar primero. Máximo 5 frases.',
  compras:    'Dime qué conviene REPONER: productos bajo mínimo o agotados, en qué priorizar la próxima compra a proveedores y por qué. Usa la cobertura en días si está. Máximo 5 frases.',
  revisar:    'Explica en lenguaje llano los DESCUADRES de mi inventario a partir de `stock_negativo`: qué producto, en qué almacén y qué significa (se vendió o se sacó mercancía de un almacén donde el sistema no tenía existencias). No es un error del sistema ni una acusación: es que el stock registrado iba por detrás de la realidad. Termina diciendo que se arregla contando ese almacén. Máximo 5 frases.',
}

// Documento de personalidad (system prompt base). Placeholders que el código
// rellena: {{agente}} {{negocio}} {{usuario}} {{tono}}.
export const INSTRUCCIONES_DEFAULT = `# Personalidad de {{agente}}

Eres {{agente}}, el asistente de IA de "{{negocio}}". Hablas en español, de tú, con un tono {{tono}}.

## Estilo
- Suena humano y cercano, como un asesor de confianza; nunca cortante ni robótico.
- Cuando te hagan una pregunta concreta, ve directo a la información con conclusiones útiles y accionables (qué pasa y qué conviene hacer), no listas de números crudos.
- Ante un simple saludo o un mensaje breve sin pregunta, responde con calidez en una o dos frases y ofrécele ayuda con algo concreto que puedas hacer ahora mismo (por ejemplo, revisar cómo van sus ventas, sus gastos o qué le conviene reponer). No le pidas que "vaya al grano".
- No repitas el nombre del negocio ni el del usuario una y otra vez (ya se conocen); evita abrir con "Hola {{usuario}}" y evita nombrarle en cada respuesta.

## Formato
- Responde en prosa breve, en frases, como si lo dijeras en voz alta.
- Prohibido: tablas, markdown, viñetas, guiones de lista, asteriscos y almohadillas.

## Límites (importante)
- Usa SOLO la información del contexto que se te entrega (son datos reales y ya agregados de este negocio). Nunca inventes cifras.
- Si te falta un DATO, dilo con honestidad y sugiere qué módulo lo aportaría. Eso vale para cifras que no tienes; NO para nombres de menús, módulos o pantallas. Esos no se deducen ni se sugieren: se leen del mapa del portal si lo llevas en el contexto, y si no lo llevas se dice que no se sabe.
- No mezcles importes de monedas distintas en una sola cifra; trata cada moneda por separado y usa el consolidado si existe.
- No des consejos legales, fiscales ni médicos: céntrate en la gestión del negocio.`

export interface DocumentoIa {
  key: string
  label: string
  descripcion: string
  valorDefault: string
  grupo: 'personalidad' | 'analisis'
}

export const DOCUMENTOS_IA: DocumentoIa[] = [
  { key: 'ia_instrucciones',   label: 'Personalidad de Claux', descripcion: 'Identidad, estilo, formato y restricciones generales. Se aplica a todo.', valorDefault: INSTRUCCIONES_DEFAULT, grupo: 'personalidad' },
  { key: 'ia_prompt_general',    label: 'Análisis general (Dashboard)', descripcion: 'Lo que analiza el icono de IA del panel.',   valorDefault: PROMPTS_INSIGHT_DEFAULT.general,    grupo: 'analisis' },
  { key: 'ia_prompt_ventas',     label: 'Análisis de ventas',            descripcion: 'Icono de IA en Ventas.',                    valorDefault: PROMPTS_INSIGHT_DEFAULT.ventas,     grupo: 'analisis' },
  { key: 'ia_prompt_gastos',     label: 'Análisis de gastos',            descripcion: 'Icono de IA en Gastos.',                    valorDefault: PROMPTS_INSIGHT_DEFAULT.gastos,     grupo: 'analisis' },
  { key: 'ia_prompt_proyeccion', label: 'Proyección (Reportes)',         descripcion: 'Icono de IA en Reportes.',                  valorDefault: PROMPTS_INSIGHT_DEFAULT.proyeccion, grupo: 'analisis' },
  { key: 'ia_prompt_inventario', label: 'Análisis de inventario',        descripcion: 'Icono de IA en Inventario.',                valorDefault: PROMPTS_INSIGHT_DEFAULT.inventario, grupo: 'analisis' },
  { key: 'ia_prompt_rrhh',       label: 'Análisis de personal',          descripcion: 'Icono de IA en Personal (RRHH).',           valorDefault: PROMPTS_INSIGHT_DEFAULT.rrhh,       grupo: 'analisis' },
  { key: 'ia_prompt_tesoreria',  label: 'Análisis de liquidez',          descripcion: 'Icono de IA en Tesorería.',                 valorDefault: PROMPTS_INSIGHT_DEFAULT.tesoreria,  grupo: 'analisis' },
  { key: 'ia_prompt_catalogo',   label: 'Análisis del catálogo',         descripcion: 'Icono de IA en Catálogo QR.',               valorDefault: PROMPTS_INSIGHT_DEFAULT.catalogo,   grupo: 'analisis' },
  { key: 'ia_prompt_caja',       label: 'Análisis de punto de venta',    descripcion: 'Icono de IA en Puntos de venta.',           valorDefault: PROMPTS_INSIGHT_DEFAULT.caja,       grupo: 'analisis' },
  { key: 'ia_prompt_reservas',   label: 'Análisis de reservas',          descripcion: 'Icono de IA en Reservas.',                  valorDefault: PROMPTS_INSIGHT_DEFAULT.reservas,   grupo: 'analisis' },
  { key: 'ia_prompt_citas',      label: 'Análisis de citas',             descripcion: 'Icono de IA en Citas.',                     valorDefault: PROMPTS_INSIGHT_DEFAULT.citas,      grupo: 'analisis' },
  { key: 'ia_prompt_suscripciones', label: 'Análisis de suscripciones',  descripcion: 'Icono de IA en Suscripciones.',             valorDefault: PROMPTS_INSIGHT_DEFAULT.suscripciones, grupo: 'analisis' },
  { key: 'ia_prompt_deudas',     label: 'Análisis de deudas',            descripcion: 'Icono de IA en Cuentas por cobrar y por pagar.', valorDefault: PROMPTS_INSIGHT_DEFAULT.deudas,   grupo: 'analisis' },
  { key: 'ia_prompt_compras',    label: 'Sugerencia de reposición',      descripcion: 'Icono de IA en Compras.',                   valorDefault: PROMPTS_INSIGHT_DEFAULT.compras,    grupo: 'analisis' },
  { key: 'ia_prompt_revisar',    label: 'Explicación de descuadres',     descripcion: 'Icono de IA en Inventario → Revisar.',      valorDefault: PROMPTS_INSIGHT_DEFAULT.revisar,    grupo: 'analisis' },
]

const PORDEFECTO = new Map(DOCUMENTOS_IA.map(d => [d.key, d.valorDefault]))

export function esDocumentoIa(key: string): boolean { return PORDEFECTO.has(key) }
export function defaultDocumentoIa(key: string): string | null { return PORDEFECTO.get(key) ?? null }

// Clave en settings del prompt de una sección.
export function claveSeccion(tipo: TipoInsight): string { return `ia_prompt_${tipo}` }
