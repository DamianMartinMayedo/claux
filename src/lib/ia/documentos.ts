// ── Documentos de IA editables desde el admin ──
// Cada "documento" es un prompt guardado en settings con su clave; aquí viven los
// valores por defecto y el registro que consumen tanto el agente (valor efectivo)
// como el admin (listado/edición en modal). Añadir un documento nuevo = una fila
// más en DOCUMENTOS_IA. Sin dependencias de otros módulos de IA (evita ciclos).

export type TipoInsight = 'ventas' | 'gastos' | 'proyeccion' | 'general' | 'inventario' | 'rrhh' | 'tesoreria'

// Prompt de TAREA por sección (lo que se le pide analizar). El contexto del
// negocio (datos reales) se añade aparte, por código.
export const PROMPTS_INSIGHT_DEFAULT: Record<TipoInsight, string> = {
  general:    'Dame un análisis general de la salud de mi negocio con lo más relevante de ventas, gastos, caja y agenda, y 1-2 acciones prioritarias. Máximo 6 frases.',
  ventas:     'Analiza la evolución de mis VENTAS de los últimos 6 meses: tendencia, mejor y peor mes, y una recomendación. Máximo 5 frases.',
  gastos:     'Analiza mis GASTOS de los últimos 6 meses: tendencia, posibles anomalías y dónde podría ahorrar. Máximo 5 frases.',
  proyeccion: 'Proyecta mis ingresos y resultado del próximo mes según la tendencia reciente, indicando el supuesto usado. Sé prudente. Máximo 5 frases.',
  inventario: 'Analiza mi INVENTARIO: productos bajo mínimo, riesgo de quedarme sin stock y qué conviene reponer primero. Máximo 5 frases.',
  rrhh:       'Analiza mi PERSONAL: tamaño de la plantilla, altas recientes y lo más relevante del coste de personal. Máximo 5 frases.',
  tesoreria:  'Analiza mi LIQUIDEZ: saldos de caja por moneda y cómo se ven frente a mis ventas y gastos recientes. Máximo 5 frases.',
}

// Documento de personalidad (system prompt base). Placeholders que el código
// rellena: {{agente}} {{negocio}} {{usuario}} {{tono}}.
export const INSTRUCCIONES_DEFAULT = `# Personalidad de {{agente}}

Eres {{agente}}, el asistente de IA de "{{negocio}}". Hablas en español, de tú, con un tono {{tono}}.

## Estilo
- Ve DIRECTO a la información. No saludes con el nombre del usuario ni lo repitas en tus respuestas: evita "Hola {{usuario}}" y evita nombrarle una y otra vez. Como mucho, usa su nombre de forma muy esporádica y solo si de verdad aporta.
- Suena humano y cercano, como un asesor de confianza. Nada de sonar robótico.
- No repitas el nombre del negocio una y otra vez (ya saben cuál es).
- Da conclusiones útiles y accionables (qué pasa y qué conviene hacer), no listas de números crudos.

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
]

const PORDEFECTO = new Map(DOCUMENTOS_IA.map(d => [d.key, d.valorDefault]))

export function esDocumentoIa(key: string): boolean { return PORDEFECTO.has(key) }
export function defaultDocumentoIa(key: string): string | null { return PORDEFECTO.get(key) ?? null }

// Clave en settings del prompt de una sección.
export function claveSeccion(tipo: TipoInsight): string { return `ia_prompt_${tipo}` }
