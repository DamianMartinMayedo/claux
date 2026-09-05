// ── Los textos que no dependen del cliente ──────────────────────────────────
//
// Las diapositivas 3, 4 (columna derecha), 15 y 16 dicen lo mismo en todas las
// propuestas: son el producto, no el negocio del lead. Están aquí como VALOR POR
// DEFECTO —el dueño los edita en /admin/ventas/propuestas/textos y lo editado manda—,
// para no volver a desplegar por cambiar una coma.
//
// Lo que sí depende del lead es la columna izquierda de la 4: «cómo lo manejas
// hoy» sale de `modo_actual`, que es una de las cuatro cosas que el diagnóstico
// pregunta. El comercial la corrige después con lo que oyó en la reunión.

import type { Tarjeta } from './tipos'

/** `{dias}` y `{descuento}` se sustituyen con los valores vivos de `settings`. */
export function rellenar(texto: string, vars: Record<string, string | number>): string {
  return texto.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

// ── Diapositiva 3: ¿Qué es CLAUX? ──
export const QUE_ES_TITULO = '¿Qué es CLAUX?'

export const QUE_ES_TARJETAS: Tarjeta[] = [
  { titulo: 'Varios negocios',   cuerpo: 'Todos tus locales en la misma cuenta, cada uno con sus cuentas y el total sumado.' },
  { titulo: 'Varias monedas',    cuerpo: 'Pesos, dólares y euros a la vez, con la tasa del día. Cada cifra sabe en qué moneda está.' },
  { titulo: 'IA incorporada',    cuerpo: 'Un asistente que atiende a tus clientes y te responde sobre tu propio negocio.' },
  { titulo: 'Módulos a la carta', cuerpo: 'Pagas por lo que usas. Se añade y se quita según cambie el negocio.' },
  { titulo: 'Hecho para aquí',   cuerpo: 'Funciona en el móvil y con mala conexión. Lo que se cobra sin línea se sincroniza al volver.' },
]

// ── Diapositiva 4: el problema ──
export const PROBLEMA_TITULO = 'El problema que resuelve'
export const PROBLEMA_ROTULO_HOY = 'Cómo lo manejas hoy'
export const PROBLEMA_ROTULO_CLAUX = 'Cómo lo ves con CLAUX'

/** La columna izquierda, según cómo lleve hoy sus cuentas (`modos.ts`). */
export const PROBLEMA_HOY: Record<string, string[]> = {
  papel: [
    'Las cuentas viven en una libreta.',
    'Saber lo que se ganó el mes pasado es sentarse a sumar.',
    'Si la libreta se pierde, no hay otra copia.',
  ],
  excel: [
    'Cada cosa en un archivo distinto.',
    'Los números se copian de una hoja a otra a mano.',
    'Nadie sabe con seguridad cuál es la versión buena.',
  ],
  nada: [
    'Los números están en la cabeza.',
    'No hay con qué comparar un mes con otro.',
    'Cada decisión se toma a ojo.',
  ],
  otra: [
    'El sistema de ahora no hace lo que el negocio necesita.',
    'Sacar un dato cuesta pedírselo a alguien.',
    'Lo que falta se completa a mano, por fuera.',
  ],
}

/** Respaldo cuando el lead no dijo cómo lo lleva —o no hay lead—. */
export const PROBLEMA_HOY_GENERICO: string[] = [
  'Las cuentas están repartidas entre libretas, hojas de cálculo y mensajes.',
  'Cada cifra hay que buscarla, y dos sitios dicen cosas distintas.',
  'Cerrar el mes es un trabajo aparte.',
]

export const PROBLEMA_CLAUX: string[] = [
  'Cada venta y cada gasto quedan registrados en el momento.',
  'El resultado del mes está hecho, sin sumar nada.',
  'Lo mismo desde el móvil del local que desde casa.',
]

// ── Diapositiva 15: por qué confiar ──
export const CONFIANZA_TITULO = 'Por qué confiar en CLAUX'

export const CONFIANZA_TARJETAS: Tarjeta[] = [
  { titulo: 'Tus datos son tuyos', cuerpo: 'Solo los ve quien tú autorices. No se comparten con nadie ni se venden.' },
  { titulo: 'Cada negocio, aparte', cuerpo: 'La información de un cliente no se cruza con la de otro.' },
  { titulo: 'Puedes llevártelos',  cuerpo: 'Todo lo que entra se puede exportar. Si un día te vas, te vas con tus datos.' },
]

// ── Diapositiva 16: empecemos ──
export const EMPECEMOS_TITULO = 'Empecemos'

export const EMPECEMOS_PASOS: Tarjeta[] = [
  { titulo: 'Eliges lo que activas', cuerpo: 'Los módulos que necesitas hoy. El resto queda para cuando haga falta.' },
  { titulo: 'Lo pruebas {dias} días', cuerpo: 'Con tus propios datos y sin pagar. Si no encaja, no hay nada firmado.' },
  { titulo: 'Firmamos',              cuerpo: 'Contrato y presupuesto, desde el propio sistema.' },
  { titulo: 'Te acompañamos',        cuerpo: 'La puesta en marcha la hacemos nosotros, y después seguimos ahí.' },
]

// ── Diapositiva 14: el reparto del pago ──
export const PAGO_POR_DEFECTO = '50 % al empezar y 50 % al entregar.'

// ── Diapositiva 2: lo que entendimos ──
export const ENTENDIMOS_TITULO = 'Lo que entendimos de tu negocio'
