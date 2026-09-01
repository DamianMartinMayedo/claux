// Una migración de LiangApp de punta a punta, en memoria.
//
// Entran los archivos que el operador subió de golpe y sale el reparto: qué es
// cada uno, de qué cuenta, a qué entidad de CLAUX va, con qué filas, y el cuadre
// contra el Estado de rendimiento financiero. Nada de esto escribe en la base:
// es cálculo puro sobre los archivos, para que el asistente pueda enseñar el
// reconocimiento ANTES de crear ningún lote y para poder probarlo sin BD.
//
// Quien crea los lotes es la acción (`actions/portal/importar.ts`); quien los
// valida y los aplica sigue siendo el motor de siempre, sin enterarse de que
// esto existe.

import { leerHojas, MAX_FILAS } from '../../archivo'
import { detectarArchivo } from './detectar'
import { leerMayor, type MayorLeido } from './mayor'
import { importeOficial, leerEstado, type EstadoLeido } from './estado'
import { reglaDe } from './reglas'
import {
  camposDe, filaCanonica, mapeoColumnas, numeroFactura, rutaDeCuenta,
  COL_ORDEN, type EntidadDestino,
} from './rutas'

const dosDec = (n: number) => Math.round(n * 100) / 100

/**
 * El período reducido a sus dos fechas. LiangApp escribe el mismo rango con
 * coletillas distintas según el reporte —los mayores llevan «(acumulado)» y el
 * estado no—, así que comparar el rótulo entero daría un aviso falso en todas
 * las migraciones.
 */
function rangoPeriodo(p: string): string {
  const m = /(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(p)
  return m ? `${m[1]} - ${m[2]}` : p.trim()
}

/** Un archivo tal y como llega del asistente. */
export interface ArchivoLiangApp {
  nombre: string
  /** El .xlsx en base64 (así viaja en la server action). */
  base64: string
}

/** Qué resultó ser cada archivo. Una tarjeta del paso de reconocimiento. */
export interface FichaArchivo {
  nombre: string
  tipo: 'mayor' | 'estado' | 'no-reconocido'
  cuenta: number | null
  /** Cómo llama LiangApp a la cuenta, de la fila 4 del propio archivo. */
  nombreCuenta: string
  /** Cómo la llamamos nosotros (`rutas.ts`), que es lo que entiende el operador. */
  etiqueta: string
  entidad: EntidadDestino | null
  /** Líneas de movimiento leídas (sin el asiento de cierre). */
  lineas: number
  /** Σ de esas líneas: lo que tiene que cuadrar contra el estado. */
  importe: number
  /** De ahí, lo que entra como filas del lote. */
  importadas: number
  /** Y lo que se aparta por llevar `F…`: eso es una factura, no un cobro. */
  facturas: number
  fechasCorregidas: number
  /** Por qué esta cuenta no se importa (`rutas.ts`), si es el caso. */
  motivo: string | null
  avisos: string[]
}

/** Una línea de venta con número de factura: no entra, se lista (plan, D3). */
export interface FacturaDetectada {
  numero: string
  fecha: string
  importe: number
  descripcion: string
  archivo: string
  /** Fila dentro de la hoja, para poder ir a mirarla. */
  fila: number
}

/**
 * Un GRUPO de líneas que se clasifican juntas: lo que propone una regla, lo que
 * decide la propia cuenta, o el resto de una cuenta que nadie ha reconocido.
 *
 * Es la unidad con la que trabaja el operador: confirmar «Nómina → Personal ·
 * Salarios» de una vez es lo que hace viable clasificar 744 líneas (D4 del plan).
 */
export interface GrupoPropuesto {
  /** `regla:<clave>` · `cuenta:<n>` · `resto:<n>`. Va en cada fila del lote. */
  grupo: string
  etiqueta: string
  /** De qué cuentas salen sus líneas: una regla puede cruzar varias. */
  cuentas: number[]
  lineas: number
  importe: number
  /** Clave del catálogo propuesta; `null` = nadie ha propuesto nada. */
  propuesta: string | null
  /** Otras claves razonables, a un clic. */
  alternativas: string[]
  /** La decide la cuenta, no una regla: no es una propuesta, es el enrutado. */
  porCuenta?: true
  /** Un ejemplo real del archivo: sin él, confirmar en bloque es firmar a ciegas. */
  ejemplo: string
}

/** Un lote listo para crear: una entidad, las filas de todos sus mayores. */
export interface LotePropuesto {
  entidad: EntidadDestino
  cabeceras: string[]
  filas: Record<string, string>[]
  /** El mapeo 1:1 (aquí el operador no mapea columnas). */
  columnas: Record<string, string>
  /** De qué archivo y qué cuenta salió cada trozo: la huella de la migración. */
  cuentas: { archivo: string; cuenta: number; lineas: number; importe: number }[]
}

/** Una cuenta enfrentada a su línea del estado oficial. */
export interface FilaCuadre {
  cuenta: number
  etiqueta: string
  /** Lo que suma el mayor. */
  leido: number
  /** Lo que dice el estado de rendimiento; `null` si no la recoge. */
  oficial: number | null
  diferencia: number | null
  cuadra: boolean
  /** Lo que entra en el lote… */
  importado: number
  /** …y lo que se va al importador de facturas. */
  aFacturas: number
}

export interface MigracionLeida {
  empresa: string
  periodo: string
  fichas: FichaArchivo[]
  lotes: LotePropuesto[]
  /** Las clasificaciones propuestas, de más importe a menos. Solo de gasto. */
  grupos: GrupoPropuesto[]
  cuadre: FilaCuadre[]
  facturas: FacturaDetectada[]
  /**
   * El resultado del ejercicio reconstruido desde los mayores, contra el que
   * firma el cliente. `completa` es la letra pequeña: solo se puede comparar si
   * están subidos TODOS los mayores que el estado recoge con importe.
   */
  utilidad: { reconstruida: number; oficial: number | null; cuadra: boolean; completa: boolean }
  /** Líneas del estado con importe para las que no hay mayor subido. */
  sinArchivo: { concepto: string; importe: number }[]
  avisos: string[]
  /** Lo que impide seguir. Con algo aquí, no se crean lotes. */
  errores: string[]
}

/** El orden en que se abren, se aplican y (al revés) se deshacen los lotes. */
export const ORDEN: EntidadDestino[] = ['gastos', 'cobros']

/**
 * Lee y reparte todos los archivos de una migración.
 *
 * Un archivo que no sea de LiangApp NO es un error: se marca «no reconocido» y
 * se deja fuera. El operador arrastra la carpeta entera y ahí dentro va lo que
 * sea; decírselo es mejor que rechazarle la subida.
 */
export async function leerMigracion(archivos: ArchivoLiangApp[]): Promise<MigracionLeida> {
  const fichas: FichaArchivo[] = []
  const facturas: FacturaDetectada[] = []
  const avisos: string[] = []
  const errores: string[] = []
  const mayores: { archivo: string; mayor: MayorLeido }[] = []
  const porEntidad = new Map<EntidadDestino, LotePropuesto>()
  const grupos = new Map<string, GrupoPropuesto>()
  let estado: EstadoLeido | null = null

  for (const a of archivos) {
    const ficha: FichaArchivo = {
      nombre: a.nombre, tipo: 'no-reconocido', cuenta: null, nombreCuenta: '', etiqueta: '',
      entidad: null, lineas: 0, importe: 0, importadas: 0, facturas: 0, fechasCorregidas: 0,
      motivo: null, avisos: [],
    }
    fichas.push(ficha)

    let rep
    try {
      rep = detectarArchivo(await leerHojas(a.base64))
    } catch (e) {
      ficha.avisos.push((e as Error).message)
      continue
    }
    if (!rep) continue

    if (rep.tipo === 'estado') {
      ficha.tipo = 'estado'
      ficha.etiqueta = 'Estado de rendimiento financiero'
      const leido = leerEstado(rep)
      ficha.avisos = leido.avisos
      // Es la única validación externa que tenemos (plan, D2): dos estados en la
      // misma migración serían dos cierres distintos y no sabríamos cuál manda.
      if (estado) errores.push('Has subido dos estados de rendimiento. Sube solo el del período que estás migrando.')
      estado = leido
      continue
    }

    const mayor = leerMayor(rep)
    const ruta  = rutaDeCuenta(mayor.cuenta)
    mayores.push({ archivo: a.nombre, mayor })

    ficha.tipo = 'mayor'
    ficha.cuenta = mayor.cuenta
    ficha.nombreCuenta = mayor.nombreCuenta
    ficha.etiqueta = ruta.etiqueta
    ficha.entidad = ruta.entidad
    ficha.lineas = mayor.lineas.length
    ficha.importe = mayor.total
    ficha.fechasCorregidas = mayor.fechas.corregidas
    ficha.motivo = ruta.motivo ?? null
    ficha.avisos = mayor.avisos
    if (mayor.cierre.lineas) {
      ficha.avisos.push(`Se ha dejado fuera el asiento de cierre del ejercicio (${mayor.cierre.lineas} línea(s)).`)
    }
    if (!ruta.entidad) continue

    const lote = porEntidad.get(ruta.entidad) ?? {
      entidad: ruta.entidad,
      cabeceras: camposDe(ruta.entidad),
      filas: [],
      columnas: mapeoColumnas(ruta.entidad),
      cuentas: [],
    }
    porEntidad.set(ruta.entidad, lote)

    let importadas = 0
    for (const l of mayor.lineas) {
      const factura = ruta.facturable ? numeroFactura(l) : null
      if (factura) {
        facturas.push({
          numero: factura, fecha: l.fecha, importe: l.importe,
          descripcion: l.descripcion || l.documento, archivo: a.nombre, fila: l.fila,
        })
        ficha.facturas = dosDec(ficha.facturas + l.importe)
        continue
      }
      // Un COBRO lleva concepto libre y no se clasifica (mig. 126): no forma grupo.
      const regla = ruta.entidad === 'gastos' && !ruta.catalogo ? reglaDe(mayor.cuenta, l) : null
      const clave = ruta.catalogo ?? regla?.catalogo ?? null
      const grupo = ruta.entidad !== 'gastos' ? ''
        : ruta.catalogo ? `cuenta:${mayor.cuenta}`
        : regla         ? `regla:${regla.clave}`
        : `resto:${mayor.cuenta}`
      if (grupo) {
        const g = grupos.get(grupo) ?? {
          grupo,
          etiqueta: regla?.etiqueta ?? (ruta.catalogo ? ruta.etiqueta : `Resto de la cuenta ${mayor.cuenta}`),
          cuentas: [], lineas: 0, importe: 0,
          propuesta: clave, alternativas: regla?.alternativas ?? [],
          ...(ruta.catalogo ? { porCuenta: true as const } : {}),
          ejemplo: l.descripcion || l.documento || '',
        }
        if (!g.cuentas.includes(mayor.cuenta)) g.cuentas.push(mayor.cuenta)
        g.lineas += 1
        g.importe = dosDec(g.importe + l.importe)
        grupos.set(grupo, g)
      }
      lote.filas.push({ ...filaCanonica(mayor.cuenta, ruta, l, grupo, clave), [COL_ORDEN]: String(lote.filas.length) })
      importadas = dosDec(importadas + l.importe)
    }
    ficha.importadas = importadas
    lote.cuentas.push({ archivo: a.nombre, cuenta: mayor.cuenta, lineas: mayor.lineas.length, importe: importadas })
  }

  // Un archivo por cuenta: dos mayores de la misma cuenta serían el mismo período
  // duplicado (o dos períodos mezclados), y en los dos casos el cuadre mentiría.
  const vistas = new Map<number, string>()
  for (const { archivo, mayor } of mayores) {
    const antes = vistas.get(mayor.cuenta)
    if (antes) errores.push(`La cuenta ${mayor.cuenta} viene en dos archivos («${antes}» y «${archivo}»). Sube uno solo por cuenta.`)
    else vistas.set(mayor.cuenta, archivo)
  }

  // Empresa y período: el lote lleva UNA empresa, así que mezclar dos archivos de
  // empresas distintas metería la contabilidad de una en la otra sin avisar.
  const empresas = [...new Set([...mayores.map(m => m.mayor.empresa), ...(estado ? [estado.empresa] : [])].filter(Boolean))]
  const periodos = [...new Set(
    [...mayores.map(m => m.mayor.periodo), ...(estado ? [estado.periodo] : [])].filter(Boolean).map(rangoPeriodo),
  )]
  if (empresas.length > 1) errores.push(`Los archivos son de empresas distintas (${empresas.join(', ')}). Haz una migración por empresa.`)
  if (periodos.length > 1) avisos.push(`Los archivos no cubren el mismo período (${periodos.join(' · ')}). Compruébalo antes de aplicar.`)

  // Cada lote pasa por el motor entero, que trabaja por tandas con un tope de
  // filas POR LOTE. Se comprueba aquí porque estas filas no vienen de
  // `leerArchivo`, que es donde se mira normalmente.
  for (const lote of porEntidad.values()) {
    if (lote.filas.length > MAX_FILAS) {
      errores.push(`Las cuentas de ${lote.entidad} suman ${lote.filas.length} líneas y el máximo por lote es ${MAX_FILAS}. Migra menos cuentas a la vez.`)
    }
  }

  const cuadre: FilaCuadre[] = mayores.map(({ mayor }) => {
    const ruta    = rutaDeCuenta(mayor.cuenta)
    const oficial = estado ? importeOficial(estado, mayor.cuenta) : null
    const aFacturas = dosDec(mayor.lineas.reduce(
      (s, l) => s + (ruta.facturable && numeroFactura(l) ? l.importe : 0), 0,
    ))
    return {
      cuenta: mayor.cuenta,
      etiqueta: ruta.etiqueta,
      leido: mayor.total,
      oficial,
      diferencia: oficial === null ? null : dosDec(mayor.total - oficial),
      // Al céntimo: son las dos caras del mismo cierre, no una estimación.
      cuadra: oficial !== null && Math.abs(mayor.total - oficial) < 0.005,
      importado: dosDec(mayor.total - aFacturas),
      aFacturas,
    }
  }).sort((a, b) => a.cuenta - b.cuenta)

  // El resultado del ejercicio, reconstruido: ingresos − gastos de lo leído.
  const suma = (e: EntidadDestino) => mayores
    .filter(m => rutaDeCuenta(m.mayor.cuenta).entidad === e)
    .reduce((s, m) => s + m.mayor.total, 0)
  const reconstruida = dosDec(suma('cobros') - suma('gastos'))

  // Las líneas del estado que tienen importe y no tienen mayor subido. Sin ellas
  // la utilidad no puede cuadrar, y no es un fallo de la migración: es que falta
  // un archivo. Decir cuál es más útil que decir «no cuadra».
  const sinArchivo = (estado?.filas ?? [])
    .filter(f => f.desde !== null && f.hasta !== null && Math.abs(f.importe) >= 0.005)
    .filter(f => !mayores.some(m => m.mayor.cuenta >= f.desde! && m.mayor.cuenta <= f.hasta!))
    .map(f => ({ concepto: f.concepto, importe: f.importe }))

  const oficialUtilidad = estado?.utilidadAntesDeImpuesto ?? null
  const completa = !!estado && !sinArchivo.length

  if (!estado) {
    avisos.push('Falta el Estado de rendimiento financiero: añádelo a los archivos, o la migración no se podrá aplicar.')
  }
  if (!mayores.length) errores.push('Entre los archivos no hay ningún libro mayor de LiangApp. Añade los del período.')

  // Decir CUÁLES: con diez archivos, «uno no es de LiangApp» no dice cuál quitar.
  const noReconocidos = fichas.filter(f => f.tipo === 'no-reconocido')
  if (noReconocidos.length) {
    avisos.push(`No son reportes de LiangApp y se han dejado fuera: ${noReconocidos.map(f => f.nombre).join(', ')}.`)
  }

  const corregidas = mayores.reduce((s, m) => s + m.mayor.fechas.corregidas, 0)
  if (corregidas) avisos.push(`${corregidas} fecha(s) traían el día y el mes cambiados en el propio archivo y se han corregido.`)

  return {
    empresa: empresas[0] ?? '',
    periodo: periodos[0] ?? '',
    fichas,
    lotes: ORDEN.map(e => porEntidad.get(e)).filter((l): l is LotePropuesto => !!l),
    // De más importe a menos: es el orden en que conviene revisarlos, porque una
    // equivocación en el grupo gordo desplaza el informe entero.
    grupos: [...grupos.values()].sort((a, b) => b.importe - a.importe),
    cuadre,
    facturas,
    utilidad: {
      reconstruida,
      oficial: oficialUtilidad,
      cuadra: oficialUtilidad !== null && completa && Math.abs(reconstruida - oficialUtilidad) < 0.005,
      completa,
    },
    sinArchivo,
    avisos,
    errores,
  }
}

/** El cuadre reducido a lo que decide si la migración se puede aplicar (D2). */
export interface ResumenCuadre {
  /** Sin estado de rendimiento no hay cuadre posible, y sin cuadre no se aplica. */
  con_estado: boolean
  ok: boolean
  filas: FilaCuadre[]
  /** Cuentas que el operador ha apartado: no se importan, no cuadran nada. */
  excluidas: number[]
}

/**
 * Enfrenta lo leído con el estado oficial y dice si se puede aplicar.
 *
 * Una cuenta APARTADA por el operador no descuadra: no se importa, así que
 * exigirle que cuadre sería impedir la única salida que tiene cuando el
 * reconocimiento se equivoca. Lo que no se admite es aplicar sin estado: es la
 * única validación externa que tenemos (plan, D2).
 */
export function resumenCuadre(
  filas: FilaCuadre[], conEstado: boolean, excluidas: number[] = [],
): ResumenCuadre {
  const fuera = new Set(excluidas)
  const cuentan = filas.filter(f => !fuera.has(f.cuenta))
  return {
    con_estado: conEstado,
    ok: conEstado && cuentan.length > 0 && cuentan.every(f => f.cuadra),
    filas,
    excluidas: [...fuera],
  }
}

/**
 * Lo que el perfil deja escrito en `import_lotes.mapping.origen`.
 *
 * Es la memoria de la migración entre pantallazos: el asistente no puede
 * guardar nada en el navegador —una migración se hace desde Cuba, y recargar
 * la página no puede costar volver a subir 10 MB—, así que todo lo que el
 * operador decide (qué categoría lleva cada grupo, qué cuenta se aparta) se
 * escribe aquí y se ajusta con llamadas de unos pocos bytes.
 */
export interface OrigenLiangApp {
  perfil: 'liangapp'
  migracion_id: string
  empresa: string
  periodo: string
  cuentas: LotePropuesto['cuentas']
  /** Lo que decide si se puede aplicar (D2). */
  cuadre: ResumenCuadre
  /** Solo en el lote de gastos: la clasificación propuesta, grupo a grupo. */
  grupos?: GrupoPropuesto[]
  /** Filas fuera por tener la cuenta apartada. Vuelven enteras si se readmite. */
  apartadas?: Record<string, string>[]
  /** Solo en el lote de cobros: lo facturado, para la plantilla de facturas. */
  facturas?: FacturaDetectada[]
}
