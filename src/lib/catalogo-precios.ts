// ─────────────────────────────────────────────────────────────────────────────
// Impacto de tocar el catálogo, y la caché que hay que rehacer después.
//
// Plan: docs/planes/niveles-comerciales.md §8.2
//
// POR QUÉ EXISTE. `clients.precio_mensual_usd` es una CACHÉ: la suma de los
// módulos contratados por la columna del nivel. Se calculaba al dar de alta al
// cliente y al cambiarle los módulos… y en ningún otro momento. Cambiar el precio
// de un módulo en /admin/modulos movía el catálogo y dejaba la caché de toda la
// cartera intacta: el cliente seguía pagando el precio viejo, la ficha enseñaba
// un número y el cobro otro, y nadie se enteraba.
//
// Aquí van las dos mitades del arreglo:
//
//   1. `impactoDeCambios` — QUÉ pasaría. Se enseña ANTES de guardar, con nombre y
//      apellidos: «esto le sube la cuota a Auge de 57 a 62». Es el botón más
//      peligroso del panel y no puede pulsarse a ciegas.
//   2. `recalcularCuotas` — rehacer la caché de los afectados en el mismo
//      movimiento del guardado.
//
// LA REGLA DE LA SUMA SE COPIA, NO SE INVENTA: solo cuentan los módulos con
// `activo = true`, igual que `calcularPrecioMensual` en `actions/clientes.ts`. Si
// las dos difieren, la previsualización miente.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizarNivel, sumarModulos, type ModuloPrecios, type Nivel } from '@/lib/niveles'

// El cliente de Supabase entra como parámetro para servir tanto al de servicio
// como al de sesión, que son tipos distintos y no comparten interfaz.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any

/** Precios nuevos de un módulo. Solo las columnas que cambian. */
export interface CambioPrecio {
  clave: string
  precios: Partial<Record<Nivel, number>>
}

export interface ImpactoCliente {
  client_id:      string
  nombre_empresa: string
  nivel:          Nivel
  /** Cuota de catálogo ANTES del cambio. */
  antes:          number
  /** Cuota de catálogo DESPUÉS. */
  despues:        number
  /** Lo que hay cacheado hoy en `clients`. Si no coincide con `antes`, la caché venía sucia. */
  cacheado:       number
  archivado:      boolean
}

const CAMPOS = 'clave, precio_inicial_usd, precio_empresa_usd, precio_pro_usd'

function aplicarCambios(catalogo: ModuloPrecios[], cambios: CambioPrecio[]): ModuloPrecios[] {
  const porClave = new Map(cambios.map(c => [c.clave, c.precios]))
  return catalogo.map(m => {
    const nuevo = porClave.get(m.clave)
    if (!nuevo) return m
    return {
      ...m,
      precio_inicial_usd: nuevo.inicial ?? m.precio_inicial_usd,
      precio_empresa_usd: nuevo.empresa ?? m.precio_empresa_usd,
      precio_pro_usd:     nuevo.pro     ?? m.precio_pro_usd,
    }
  })
}

/**
 * A quién le cambia la cuota si se guardan esos precios. Devuelve SOLO a los que
 * se mueven, de mayor a menor movimiento (en valor absoluto: una bajada de $12
 * merece tanta atención como una subida).
 *
 * Un módulo que se está CREANDO todavía no lo tiene nadie: impacto vacío, y es
 * correcto.
 */
export async function impactoDeCambios(db: Db, cambios: CambioPrecio[]): Promise<ImpactoCliente[]> {
  if (!cambios.length) return []

  const [{ data: catalogo }, { data: clientes }] = await Promise.all([
    db.from('modulos_catalogo').select(CAMPOS).eq('activo', true),
    db.from('clients')
      .select('client_id, nombre_empresa, nivel, modulos_activos, precio_mensual_usd, archivado_at')
      .overlaps('modulos_activos', cambios.map(c => c.clave)),
  ])

  const antesCat   = (catalogo ?? []) as ModuloPrecios[]
  const despuesCat = aplicarCambios(antesCat, cambios)

  const filas: ImpactoCliente[] = []
  for (const c of (clientes ?? []) as Record<string, any>[]) {
    const mods  = Array.isArray(c.modulos_activos) ? c.modulos_activos as string[] : []
    const nivel = normalizarNivel(c.nivel)
    const antes   = sumarModulos(antesCat,   mods, nivel)
    const despues = sumarModulos(despuesCat, mods, nivel)
    if (antes === despues) continue
    filas.push({
      client_id:      c.client_id,
      nombre_empresa: c.nombre_empresa ?? c.client_id,
      nivel,
      antes,
      despues,
      cacheado:       Number(c.precio_mensual_usd ?? 0) || 0,
      archivado:      Boolean(c.archivado_at),
    })
  }
  return filas.sort((a, b) => Math.abs(b.despues - b.antes) - Math.abs(a.despues - a.antes))
}

/**
 * Impacto de cambiar de nivel a UN cliente, sin tocar sus módulos: la misma cesta
 * costando lo de la otra columna. Es lo que hay que enseñar antes de subir a
 * alguien de Inicial a Empresa.
 */
export async function cuotaEnNivel(db: Db, modulos: string[], nivel: unknown): Promise<number> {
  const { data } = await db.from('modulos_catalogo').select(CAMPOS).eq('activo', true)
  return sumarModulos((data ?? []) as ModuloPrecios[], modulos, nivel)
}

/**
 * Rehace `clients.precio_mensual_usd` de todo el que tenga alguno de esos
 * módulos. Se llama DESPUÉS de guardar precios en el catálogo.
 *
 * Incluye a los archivados a propósito: el día que vuelvan, su cuota tiene que
 * estar bien, y dejar filas con un número viejo es exactamente cómo empieza una
 * deriva de datos.
 *
 * Devuelve cuántos clientes cambiaron de verdad.
 */
export async function recalcularCuotas(db: Db, claves: string[]): Promise<number> {
  if (!claves.length) return 0

  const [{ data: catalogo }, { data: clientes }] = await Promise.all([
    db.from('modulos_catalogo').select(CAMPOS).eq('activo', true),
    db.from('clients')
      .select('client_id, nivel, modulos_activos, precio_mensual_usd')
      .overlaps('modulos_activos', claves),
  ])

  const cat = (catalogo ?? []) as ModuloPrecios[]
  let tocados = 0
  for (const c of (clientes ?? []) as Record<string, any>[]) {
    const mods  = Array.isArray(c.modulos_activos) ? c.modulos_activos as string[] : []
    const nuevo = sumarModulos(cat, mods, c.nivel)
    if (nuevo === (Number(c.precio_mensual_usd ?? 0) || 0)) continue
    const { error } = await db.from('clients')
      .update({ precio_mensual_usd: nuevo })
      .eq('client_id', c.client_id)
    if (!error) tocados++
  }
  return tocados
}

/**
 * Siembra una columna de precios desde otra: `destino = origen × multiplicador`,
 * redondeado hacia arriba al múltiplo indicado (0 = sin redondeo, dos decimales).
 *
 * SIEMBRA, NO MANDA (D2). Es el punto de partida de la columna; después cada
 * celda se edita a mano y el multiplicador no vuelve a opinar.
 */
export function sembrarPrecio(origen: number, multiplicador: number, redondeoA: number): number {
  const bruto = (Number(origen) || 0) * (Number(multiplicador) || 0)
  if (bruto <= 0) return 0
  if (redondeoA > 0) return Math.ceil(bruto / redondeoA) * redondeoA
  return Math.round(bruto * 100) / 100
}
