// ── Documentos de IA editables desde el admin ──
// Cada "documento" es un prompt guardado en settings con su clave; aquí viven los
// valores por defecto y el registro que consumen tanto el agente (valor efectivo)
// como el admin (listado/edición en modal). Añadir un documento nuevo = una fila
// más en DOCUMENTOS_IA. Sin dependencias de otros módulos de IA (evita ciclos).

export type TipoInsight = 'ventas' | 'gastos' | 'proyeccion' | 'general' | 'inventario' | 'rrhh' | 'tesoreria' | 'catalogo' | 'caja' | 'reservas' | 'citas' | 'suscripciones' | 'deudas' | 'compras'

// Prompt de TAREA por sección (lo que se le pide analizar). El contexto del
// negocio (datos reales) se añade aparte, por código.
export const PROMPTS_INSIGHT_DEFAULT: Record<TipoInsight, string> = {
  general:    'Dame un análisis general de la salud de mi negocio con lo más relevante de ventas, gastos, caja y agenda, y 1-2 acciones prioritarias. Máximo 6 frases.',
  ventas:     'Analiza la evolución de mis VENTAS de los últimos 6 meses: tendencia, mejor y peor mes, y una recomendación. Máximo 5 frases.',
  gastos:     'Analiza mis GASTOS: tendencia de los últimos 6 meses y, con el desglose por categoría del mes, las categorías que más pesan y dónde podría ahorrar. Máximo 5 frases.',
  proyeccion: 'Proyecta mis ingresos y resultado del próximo mes según la tendencia reciente, indicando el supuesto usado. Sé prudente. Máximo 5 frases.',
  inventario: 'Analiza mi INVENTARIO: productos bajo mínimo, riesgo de quedarme sin stock y qué conviene reponer primero. Máximo 5 frases.',
  rrhh:       'Analiza mi PERSONAL: tamaño de la plantilla, altas recientes y lo más relevante del coste de personal. Máximo 5 frases.',
  tesoreria:  'Analiza mi LIQUIDEZ: saldos de caja por moneda y cómo se ven frente a mis ventas y gastos recientes. Máximo 5 frases.',
  catalogo:   'Revisa mi CATÁLOGO público: ítems sin foto, sin descripción o sin precio que conviene completar para vender mejor, y 1-2 mejoras concretas. Máximo 5 frases.',
  caja:       'Analiza mi PUNTO DE VENTA: ventas de hoy por terminal, puntos sin sincronizar y turnos que sigan abiertos de días anteriores. Señala qué requiere atención. Máximo 5 frases.',
  reservas:   'Analiza mis RESERVAS: ocupación de hoy, próxima reserva y la carga de los próximos 7 días. Señala días flojos o cargados y una recomendación. Máximo 5 frases.',
  citas:      'Analiza mi AGENDA DE CITAS: citas de hoy, próxima cita y la carga de los próximos 7 días, con una recomendación para llenar huecos. Máximo 5 frases.',
  suscripciones: 'Analiza mis SUSCRIPCIONES: ingreso recurrente por moneda, suscripciones activas y las que se renuevan en los próximos 30 días. Señala el dinero por cobrar y posibles riesgos. Máximo 5 frases.',
  deudas:     'Analiza mis DEUDAS: cuánto me deben (por cobrar) y cuánto debo (por pagar), por moneda, cuánto está vencido y quiénes son los principales. Prioriza a quién reclamar primero. Máximo 5 frases.',
  compras:    'Dime qué conviene REPONER: productos bajo mínimo o agotados, en qué priorizar la próxima compra a proveedores y por qué. Máximo 5 frases.',
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
- Usa SOLO la información del contexto que se te entrega (son datos reales y ya agregados de este negocio). Si falta un dato, dilo con honestidad y sugiere qué módulo lo aportaría. Nunca inventes cifras.
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
]

const PORDEFECTO = new Map(DOCUMENTOS_IA.map(d => [d.key, d.valorDefault]))

export function esDocumentoIa(key: string): boolean { return PORDEFECTO.has(key) }
export function defaultDocumentoIa(key: string): string | null { return PORDEFECTO.get(key) ?? null }

// Clave en settings del prompt de una sección.
export function claveSeccion(tipo: TipoInsight): string { return `ia_prompt_${tipo}` }
