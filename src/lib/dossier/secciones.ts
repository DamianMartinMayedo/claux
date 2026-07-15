// ── Secciones del relato — plantilla única del deck ─────────────────────────
//
// Vocabulario de INVERSOR, no de sector: "Problema / Solución / Tracción" se
// leen igual en un paladar que en una barbería, y `etiquetasDe` (src/lib/sector)
// no tiene ninguna clave financiera que aplicar aquí. El sector entra en el
// PROMPT de la IA (F6), nunca en estas etiquetas.
//
// `portada`, `traccion` y `proyeccion` NO se preguntan: salen de los números.
// Colar una tracción escrita a mano al lado de una serie real es justo la
// contradicción que un inversor detecta primero.
//
// La comparten el paso del wizard, la pestaña «Mi dossier» y el deck público.

export type ClaveSeccion =
  | 'portada' | 'problema' | 'solucion' | 'mercado' | 'traccion'
  | 'modelo' | 'proyeccion' | 'equipo' | 'cierre'

export interface EspecSeccion {
  clave: ClaveSeccion
  /** Título por defecto de la sección en el deck. */
  etiqueta: string
  /** La pregunta guía, en lenguaje llano: es lo único que el dueño lee. */
  pregunta: string
  ayuda: string
  orden: number
}

/** Las secciones que el dueño escribe, en el orden en que aparecen en el deck. */
export const SECCIONES_RELATO: EspecSeccion[] = [
  {
    clave: 'problema', etiqueta: 'El problema', orden: 10,
    pregunta: '¿Qué problema le resuelves a tus clientes?',
    ayuda: 'Lo que le pasaba al cliente antes de existir tú. Concreto, no grandilocuente.',
  },
  {
    clave: 'solucion', etiqueta: 'La solución', orden: 20,
    pregunta: '¿Cómo lo resuelves?',
    ayuda: 'Qué haces exactamente y por qué funciona.',
  },
  {
    clave: 'mercado', etiqueta: 'El mercado', orden: 30,
    pregunta: '¿Quiénes son tus clientes y cuántos hay?',
    ayuda: 'A quién le vendes y cuánta gente así hay cerca de ti.',
  },
  {
    clave: 'modelo', etiqueta: 'El modelo de negocio', orden: 50,
    pregunta: '¿Cómo ganas dinero?',
    ayuda: 'De dónde sale cada peso: qué vendes, a qué precio, cada cuánto.',
  },
  {
    clave: 'equipo', etiqueta: 'El equipo', orden: 70,
    pregunta: '¿Quién está detrás?',
    ayuda: 'Quiénes sois y por qué vosotros podéis sacar esto adelante.',
  },
  {
    clave: 'cierre', etiqueta: 'Qué busco', orden: 80,
    pregunta: '¿Cuánto necesitas y para qué?',
    ayuda: 'La cifra y en qué la vas a gastar. Un inversor lee esto primero.',
  },
]

/** Orden de la sección en el deck; las no preguntadas se intercalan por su hueco. */
export const ORDEN_SECCION: Record<ClaveSeccion, number> = {
  portada: 0, problema: 10, solucion: 20, mercado: 30, traccion: 40,
  modelo: 50, proyeccion: 60, equipo: 70, cierre: 80,
}
