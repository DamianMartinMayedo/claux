// ── Catálogo de funciones de la IA interna (la que paga CLAUX) ───────────────
// Una función = un sitio del panel donde la IA hace algo. Es la unidad con la que
// se trabaja en TODA la cadena:
//
//   · el INTERRUPTOR de /admin/ia se pone por función (y hay uno general encima),
//   · `chatInterno(fn, …)` recibe la función, no el origen,
//   · y de la función sale el ORIGEN contra el que se mide el gasto.
//
// Por qué la medición va por área y no por función: la pregunta que uno se hace
// mirando la factura es «¿en qué se nos va?», y ocho filas se leen de un vistazo.
// El detalle por función lo da este catálogo, que es código y no cuesta una tabla.
//
// AÑADIR UNA FUNCIÓN es añadir una línea aquí: nace ENCENDIDA (lo apagado se
// guarda por lista, no lo encendido) y aparece sola en el panel con su interruptor.

import type { OrigenIa } from './modelo'

export type FnIa =
  // Importador del equipo (corre en el portal, por impersonación)
  | 'importador_mapeo'
  | 'importador_pendientes'
  | 'importador_reglas'
  | 'importador_errores'
  // Ventas
  | 'presupuesto_lead'
  | 'presupuesto_revisor'
  | 'propuesta_redactar'
  // Soporte
  | 'soporte_clasificar'
  | 'soporte_borrador'
  | 'soporte_faq'
  // Panel
  | 'parte_equipo'
  | 'cliente_resumen'
  | 'contabilidad_cuentas'
  | 'relleno_textos'

export interface FuncionIa {
  clave:  FnIa
  origen: OrigenIa
  /** Área a la que pertenece, para agrupar la lista del panel. */
  area:   string
  label:  string
  /** Qué hace, en una frase. Es lo que se lee junto al interruptor. */
  descripcion: string
  /**
   * `true` = deja algo escrito en la base cuando una persona aplica la propuesta.
   * `false` = solo lee y cuenta lo que ve. El panel lo dice, porque no es lo mismo
   * apagar un resumen que apagar algo que toca datos.
   */
  escribe: boolean
}

export const FUNCIONES_IA: FuncionIa[] = [
  { clave: 'importador_mapeo',      origen: 'importador',   area: 'Importador', label: 'Emparejar columnas',
    descripcion: 'Propone qué columna del archivo va a cada campo.', escribe: true },
  { clave: 'importador_pendientes', origen: 'importador',   area: 'Importador', label: 'Resolver pendientes',
    descripcion: 'Resuelve en lote las referencias que no casan (proveedores, cuentas, productos).', escribe: true },
  { clave: 'importador_reglas',     origen: 'importador',   area: 'Importador', label: 'Reglas de columna',
    descripcion: 'Escribe la regla que limpia una columna sucia; la aplica el motor.', escribe: true },
  { clave: 'importador_errores',    origen: 'importador',   area: 'Importador', label: 'Explicar los errores',
    descripcion: 'Agrupa las filas rechazadas por causa y dice qué arreglar.', escribe: false },

  { clave: 'presupuesto_lead',      origen: 'presupuesto',  area: 'Ventas',     label: 'Rellenar desde el lead',
    descripcion: 'Saca volúmenes y módulos de lo que el lead declaró.', escribe: true },
  { clave: 'presupuesto_revisor',   origen: 'presupuesto',  area: 'Ventas',     label: 'Revisar antes de emitir',
    descripcion: 'Compara el borrador con lo ya cerrado y avisa de lo que chirría.', escribe: false },
  { clave: 'propuesta_redactar',    origen: 'propuesta',    area: 'Ventas',     label: 'Redactar la propuesta',
    descripcion: 'Escribe el borrador de la propuesta a partir del diagnóstico.', escribe: true },

  { clave: 'soporte_clasificar',    origen: 'soporte',      area: 'Soporte',    label: 'Clasificar al entrar',
    descripcion: 'Etiqueta cada mensaje con su tema, tipo y urgencia al llegar.', escribe: true },
  { clave: 'soporte_borrador',      origen: 'soporte',      area: 'Soporte',    label: 'Borrador de respuesta',
    descripcion: 'Redacta la respuesta con las preguntas frecuentes publicadas.', escribe: true },
  { clave: 'soporte_faq',           origen: 'soporte',      area: 'Soporte',    label: 'Qué pregunta frecuente falta',
    descripcion: 'Propone entradas nuevas con lo que ya se ha respondido tres veces.', escribe: true },

  { clave: 'parte_equipo',          origen: 'parte',        area: 'Panel',      label: 'El parte del equipo',
    descripcion: 'Lee los avisos y las cifras del panel y dice qué toca hoy.', escribe: false },
  { clave: 'cliente_resumen',       origen: 'cliente',      area: 'Panel',      label: 'Resumen de cliente',
    descripcion: 'Cómo va un cliente y cuál es el siguiente paso, en su ficha.', escribe: false },
  { clave: 'contabilidad_cuentas',  origen: 'contabilidad', area: 'Panel',      label: 'Clasificar cuentas migradas',
    descripcion: 'Coloca en el plan contable las cuentas nuevas de una migración.', escribe: true },
  { clave: 'relleno_textos',        origen: 'relleno',      area: 'Panel',      label: 'Textos del catálogo',
    descripcion: 'Propone descripción, beneficio y resumen de un módulo.', escribe: true },
]

const POR_CLAVE = new Map(FUNCIONES_IA.map(f => [f.clave, f]))

export function funcionIa(clave: FnIa): FuncionIa {
  const f = POR_CLAVE.get(clave)
  // No puede fallar con un `FnIa` real; el `throw` es para el día que alguien
  // teclee una clave desde fuera del tipo (una acción, un JSON de settings).
  if (!f) throw new Error(`Función de IA desconocida: ${clave}`)
  return f
}

export function esFuncionIa(v: unknown): v is FnIa {
  return typeof v === 'string' && POR_CLAVE.has(v as FnIa)
}

/** El origen contra el que se mide una función. */
export function origenDe(clave: FnIa): OrigenIa {
  return funcionIa(clave).origen
}

/** En qué se gasta la bolsa, dicho como se dice en el panel. */
export const ETIQUETA_ORIGEN: Record<OrigenIa, string> = {
  importador:   'Importador',
  propuesta:    'Propuestas',
  soporte:      'Soporte',
  relleno:      'Relleno de textos',
  presupuesto:  'Presupuestos',
  parte:        'El parte',
  cliente:      'Fichas de cliente',
  contabilidad: 'Contabilidad',
}

/** El mismo nombre, en minúscula y dentro de una frase («Se fue sobre todo en …»). */
export const ETIQUETA_ORIGEN_FRASE: Record<OrigenIa, string> = {
  importador:   'el importador',
  propuesta:    'las propuestas',
  soporte:      'soporte',
  relleno:      'el relleno de textos',
  presupuesto:  'los presupuestos',
  parte:        'el parte del equipo',
  cliente:      'las fichas de cliente',
  contabilidad: 'la contabilidad',
}
