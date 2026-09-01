// Qué categoría se PROPONE para cada línea de un mayor de gasto.
//
// El mayor exportado no trae ni `Tipo` ni `SubCuenta`: el clasificador ONAT no
// está en el archivo, y en el nomenclador las cuentas gordas (822, 826, 855)
// tienen una única subcuenta genérica. Los 15,9 M CUP de 822+826 —el 80 % del
// gasto de AUGE— no llevan NINGUNA clasificación estructurada. Todo depende del
// texto, así que aquí no hay diccionario cerrado: hay señales medidas.
//
// ── La señal buena es `Documento primario`, no la descripción ────────────────
//
// Medido sobre el 822 de AUGE: 533 de 614 líneas —el 92 % del importe— llevan
// ahí una ETIQUETA escrita por el contador (`Nómina`, `Depreciación`, `Parqueo`,
// `PRESTACIONES`…) en vez de una referencia de banco. Eso es clasificación
// explícita suya, no inferencia nuestra, y por eso se mira primero. En el 826 la
// señal cae al 46 % y manda la descripción; de ahí las dos pasadas.
//
// ── Proponen, no deciden (D4 del plan) ───────────────────────────────────────
//
// Ninguna regla escribe nada: cada una forma un GRUPO que el operador confirma o
// cambia en bloque en el paso de reconocimiento. Lo que no encaja en ninguna no
// se fuerza —cae en el resto de su cuenta, que también se confirma—, porque
// clasificar mal no da error: da un informe mensual mentiroso.
//
// Las reglas viven en CÓDIGO, como `catalogo.ts` y por lo mismo: son la
// definición global del perfil, no datos de un cliente.

import { ENTRADAS, RAIZ_POR_CLAVE, ENTRADA_POR_CLAVE } from '@/lib/catalogo/catalogo'
import type { LineaMayor } from './mayor'

export interface ReglaLiangApp {
  /** Identidad estable de la regla: es la clave del grupo en el asistente. */
  clave: string
  /** Cómo se llama el grupo para el operador. */
  etiqueta: string
  /** Clave del CATÁLOGO que se propone (nunca un nombre suelto: §4 del plan). */
  catalogo: string
  /** Otras claves razonables para el mismo texto, a un clic. */
  alternativas?: string[]
  /** Cuentas en las que la regla puede disparar. Vacío = cualquiera de gasto. */
  cuentas?: [number, number]
  /** Se busca en `Documento primario` (primera pasada). */
  documento?: RegExp
  /** Y si ahí no dijo nada, en la descripción (segunda pasada). */
  descripcion?: RegExp
}

/**
 * Ordenadas de más específica a más general: gana la primera que encaja. El
 * orden importa donde una línea puede encajar en dos («Gastos de Alimenación y
 * representación» es alimentación antes que representación; «Amortización
 * correspondiente a Desarrollo de WEB» es amortización antes que software).
 */
export const REGLAS: ReglaLiangApp[] = [
  { clave: 'nomina', etiqueta: 'Nómina', catalogo: 'salarios',
    documento: /n[oó]mina/i, descripcion: /n[oó]mina/i },

  { clave: 'prestaciones', etiqueta: 'Prestaciones al personal', catalogo: 'gas_estimulacion',
    alternativas: ['salarios'],
    documento: /prestacion/i, descripcion: /prestacion/i },

  { clave: 'depreciacion', etiqueta: 'Depreciación', catalogo: 'dep_equipos',
    alternativas: ['dep_vehiculos', 'dep_obras'],
    documento: /depreciaci/i, descripcion: /depreciaci/i },

  { clave: 'amortizacion', etiqueta: 'Amortización', catalogo: 'dep_intangibles',
    alternativas: ['dep_obras'],
    documento: /amortizaci/i, descripcion: /amortizaci/i },

  { clave: 'parqueo', etiqueta: 'Parqueo y peajes', catalogo: 'gas_parqueo',
    documento: /parqueo|peaje/i, descripcion: /parqueo|peaje/i },

  { clave: 'transporte', etiqueta: 'Transporte del personal', catalogo: 'gas_transporte_personal',
    alternativas: ['gas_combustible', 'gas_reparto'],
    documento: /transporte|transportaci/i, descripcion: /transporte|transportaci|\btaxi\b/i },

  { clave: 'combustible', etiqueta: 'Combustible', catalogo: 'gas_combustible',
    alternativas: ['gas_respaldo_energia'],
    documento: /combustible|gasolina|di[eé]sel/i, descripcion: /combustible|gasolina|di[eé]sel|cupet/i },

  { clave: 'telefonia', etiqueta: 'Telefonía, internet y datos', catalogo: 'gas_telecom',
    documento: /recarga|etecsa/i,
    // `TS:10-RecargaSaldo` y `TS:92-Compra de paquetes de datos` son los códigos
    // de la banca móvil cubana: los escribe el banco, no el contador.
    descripcion: /recarga|recargo de saldo|etecsa|saldo m[oó]vil|paquetes? de datos|ts:\s*(10|92)|nauta|internet/i },

  { clave: 'electricidad', etiqueta: 'Electricidad', catalogo: 'gas_electricidad',
    descripcion: /ts:\s*02|el[eé]ctrica|electricidad/i },

  { clave: 'agua', etiqueta: 'Agua', catalogo: 'gas_agua',
    descripcion: /\bagua\b/i },

  // «Alimenación» sin la t está en el archivo real de AUGE 14 veces: el error de
  // tecleo del contador es parte del dato, no algo que él vaya a corregir.
  { clave: 'alimentacion', etiqueta: 'Alimentación del personal', catalogo: 'gas_alimentacion_personal',
    alternativas: ['gas_atenciones'],
    documento: /aliment|alimena/i, descripcion: /aliment|alimena|almuerzo|merienda/i },

  { clave: 'representacion', etiqueta: 'Atenciones y representación', catalogo: 'gas_atenciones',
    alternativas: ['gas_alimentacion_personal'],
    documento: /representaci/i, descripcion: /representaci|degustaci|cortes[ií]a/i },

  { clave: 'impresion', etiqueta: 'Diseño, impresión y rotulación', catalogo: 'gas_diseno_impresion',
    alternativas: ['gas_maquila', 'gas_publicidad'],
    documento: /impres|kit documentos/i,
    descripcion: /impres|vinilo|merchandising|sticker|cartel|plegable|cat[aá]logo|pullover|gr[aá]fica|rotulaci|sustrato/i },

  { clave: 'creativos', etiqueta: 'Servicios creativos de terceros', catalogo: 'gas_maquila',
    alternativas: ['gas_profesionales', 'gas_publicidad'],
    descripcion: /fotograf|locuci[oó]n|dise[nñ]o gr[aá]fico|\bvideo\b/i },

  { clave: 'profesionales', etiqueta: 'Servicios profesionales', catalogo: 'gas_profesionales',
    documento: /traducci|consultor/i,
    descripcion: /traducci|consultor|tenedur[ií]a|contador|auditor|abogad|notar[ií]|asesor/i },

  { clave: 'limpieza', etiqueta: 'Limpieza e higiene', catalogo: 'gas_limpieza',
    documento: /limpieza/i, descripcion: /limpieza|higiene|fumigaci/i },

  { clave: 'papeleria', etiqueta: 'Papelería y útiles de oficina', catalogo: 'gas_papeleria',
    documento: /papeler/i, descripcion: /papeler|[uú]tiles de oficina|t[oó]ner/i },

  { clave: 'alquiler', etiqueta: 'Alquiler del local', catalogo: 'gas_alquiler',
    documento: /alquiler|arrendamiento/i, descripcion: /alquiler|arrendamiento/i },

  { clave: 'software', etiqueta: 'Software y suscripciones', catalogo: 'gas_software',
    documento: /software|suscripci/i, descripcion: /software|suscripci|hosting|dominio web/i },

  { clave: 'contrib_territorial', etiqueta: 'Contribución territorial', catalogo: 'gas_contrib_territorial',
    documento: /desarrollo local/i, descripcion: /desarrollo local|contribuci[oó]n territorial/i },

  { clave: 'imp_ventas', etiqueta: 'Impuesto sobre las ventas', catalogo: 'gas_imp_ventas',
    alternativas: ['gas_imp_servicios'],
    documento: /impuesto (sobre |por )?(las )?venta/i, descripcion: /impuestos? sobre las ventas/i },

  { clave: 'multas', etiqueta: 'Multas, recargos y sanciones', catalogo: 'gas_multas',
    documento: /\bmulta|recargo por/i, descripcion: /\bmulta|sanci[oó]n/i },

  // Las tres siguientes solo en las cuentas financieras: «comisión» en el 822 es
  // una comisión de venta, y «interés» en un gasto general no es de préstamo.
  { clave: 'comisiones', etiqueta: 'Comisiones bancarias', catalogo: 'comisiones_bancarias',
    cuentas: [835, 838],
    documento: /comisi[oó]n|apertura (de )?tarjeta/i,
    descripcion: /comisi[oó]n|estado de cuenta|banca m[oó]vil|apertura (de )?tarjeta/i },

  { clave: 'intereses', etiqueta: 'Intereses de préstamos', catalogo: 'gas_intereses',
    cuentas: [835, 838],
    documento: /inter[eé]s|intereses/i, descripcion: /inter[eé]s|intereses/i },

  { clave: 'dif_cambio', etiqueta: 'Diferencias de cambio', catalogo: 'gas_dif_cambio',
    cuentas: [835, 849],
    documento: /tasa de cambio|variaci[oó]n/i, descripcion: /tasa de cambio|diferencia cambiaria/i },
]

/**
 * ¿El `Documento primario` es una ETIQUETA del contador o una referencia del
 * banco? Importa distinguirlas: sin este filtro, una referencia que por azar
 * contenga «AGUA» o «…INTERES…» clasificaría una línea entera por una
 * coincidencia de letras dentro de un identificador.
 *
 * Medido sobre los mayores reales de AUGE, la frontera no es la longitud sino la
 * forma: una referencia es UN token sin espacios con una ristra de dígitos
 * dentro (`MM502GCV22987`, `AP500CSR2V987`, `TX1739157523852474`,
 * `41012511963505`), y una etiqueta o lleva espacios («Comisión mlc»,
 * «Contribución Desarrollo Local», «Contrato No. 31/2025») o casi no lleva
 * números («Nómina», «PRESTACIONES», «TRADUCCION»).
 */
export function esEtiquetaContable(documento: string): boolean {
  const d = documento.trim()
  if (!d || d.length > 60) return false
  return /\s/.test(d) || (d.match(/\d/g) ?? []).length < 5
}

const enRango = (r: ReglaLiangApp, cuenta: number) =>
  !r.cuentas || (cuenta >= r.cuentas[0] && cuenta <= r.cuentas[1])

/**
 * La regla que clasifica una línea, o `null` si ninguna la reconoce.
 *
 * Dos pasadas y no una: TODAS las reglas miran primero el `Documento primario`
 * —la señal escrita a mano por el contador— y solo después se mira la
 * descripción. Recorrer regla a regla mirando los dos campos a la vez dejaría
 * que una coincidencia floja en el texto libre le ganase a la etiqueta explícita
 * de otra regla.
 */
export function reglaDe(cuenta: number, l: Pick<LineaMayor, 'documento' | 'descripcion'>): ReglaLiangApp | null {
  if (esEtiquetaContable(l.documento)) {
    const porDoc = REGLAS.find(r => r.documento && enRango(r, cuenta) && r.documento.test(l.documento))
    if (porDoc) return porDoc
  }
  return REGLAS.find(r => r.descripcion && enRango(r, cuenta) && r.descripcion.test(l.descripcion)) ?? null
}

// ── Del catálogo a las dos columnas de la plantilla ──────────────────────────

/** Las raíces que son GASTO del resultado: las únicas que el perfil puede usar. */
const ROLES_GASTO = new Set(['COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'OTRO', 'DEPRECIACION', 'IMPUESTO_UTILIDAD'])

/**
 * Nombre de la raíz y de la subcategoría de una clave del catálogo, que es lo
 * que entienden las columnas `categoria` y `subcategoria` de la plantilla.
 *
 * El perfil NO inventa raíces (§4 del plan): lo que escribe en `categoria` es
 * siempre el nombre de una raíz del catálogo, y el detalle va de subcategoría.
 */
export function nombresDe(clave: string): { categoria: string; subcategoria: string } | null {
  const e = ENTRADA_POR_CLAVE.get(clave)
  if (!e) return null
  const raiz = RAIZ_POR_CLAVE.get(e.padre)
  if (!raiz) return null
  return { categoria: raiz.nombre, subcategoria: e.nombre }
}

/** Una opción del selector de categoría del asistente. */
export interface OpcionCatalogo {
  clave: string
  /** «Personal · Salarios»: la raíz manda, y sin ella el nombre suelto se repite. */
  etiqueta: string
  raiz: string
  /** La escribe un módulo (`nuncaSembrar`): se pide, no se crea. */
  sistema?: boolean
}

/**
 * Todas las subcategorías de GASTO del catálogo, para el desplegable del paso de
 * reconocimiento. Se calcula una vez al cargar el módulo: es una constante.
 */
export const OPCIONES_GASTO: OpcionCatalogo[] = ENTRADAS
  .filter(e => ROLES_GASTO.has(RAIZ_POR_CLAVE.get(e.padre)?.rol ?? ''))
  .map(e => ({
    clave:    e.clave,
    etiqueta: `${RAIZ_POR_CLAVE.get(e.padre)!.nombre} · ${e.nombre}`,
    raiz:     RAIZ_POR_CLAVE.get(e.padre)!.nombre,
    ...(e.nuncaSembrar ? { sistema: true as const } : {}),
  }))
  .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'))
