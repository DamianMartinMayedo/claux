// Núcleo de creación de facturas, SIN sesión. Lo comparten la server action del portal
// (`actions/portal/ventas.ts`, que resuelve la sesión y valida permisos antes) y el cron
// diario de facturación automática de suscripciones, que corre sin usuario.
//
// **Por qué vive aquí y no en el fichero de acciones:** en un módulo `'use server'` toda
// exportación es un endpoint HTTP. Una función exportada que recibe `client_id` por
// parámetro dejaría que cualquiera con el bundle pidiera facturas en el tenant que
// quisiera. Aquí no es invocable desde el navegador: solo desde código de servidor que
// ya ha decidido de qué cliente habla.

import { calcularTotales, numeroProvisional, type AjusteInput, type DocumentoTipo, type LineaInput } from '@/app/portal/(app)/ventas/_ventas-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export function generarIdDocumento(prefijo: 'OFE' | 'FAC'): string {
  return `${prefijo}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

// ── Numeración fiscal ─────────────────────────────────────────────────────────
//
// El correlativo se reserva al EMITIR, nunca al crear el borrador. Un borrador es un
// papel de trabajo: se corrige, se descarta, lo genera el cron cada mañana. Si cada uno
// se llevara un número fiscal, borrarlo dejaría un salto permanente en la serie —y un
// salto en la numeración de facturas es justo lo primero que pregunta una inspección.
// Antes pasaba: `eliminarFacturasEnLote` borra la factura pero nunca devolvió el
// consecutivo, y en producción faltaban ya la 9 y la 15 de 2026.
//
// Mientras es borrador lleva un identificador PROVISIONAL, único y que no se puede
// confundir con un número fiscal ni en un PDF ni en un correo.

// `numeroProvisional` / `esNumeroProvisional` viven en `_ventas-helpers` (junto a
// `formatoNumero`) porque también los necesita la UI para pintarlos.

/**
 * Reserva y devuelve el siguiente correlativo para (empresa, tipo, año).
 *
 * Es read-modify-write NO atómica: la unicidad real la da el índice único
 * `(client_id, numero)` de cada tabla. Quien lo use debe tolerar el choque y reintentar
 * en vez de asumir.
 */
export async function siguienteCorrelativo(
  db: Db, client_id: string, empresa_id: string, tipo: DocumentoTipo, anio: number,
): Promise<number> {
  const { data: existente } = await db
    .from('consecutivos_venta')
    .select('ultimo_numero')
    .eq('client_id', client_id).eq('empresa_id', empresa_id)
    .eq('tipo', tipo).eq('anio', anio)
    .maybeSingle()

  const nuevo = (existente?.ultimo_numero ?? 0) + 1

  const { error } = await db
    .from('consecutivos_venta')
    .upsert({
      client_id, empresa_id, tipo, anio,
      ultimo_numero: nuevo,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'client_id,empresa_id,tipo,anio' })

  if (error) throw new Error(`No se pudo reservar consecutivo: ${error.message}`)
  return nuevo
}

/**
 * Foto del coste del catálogo en la moneda del documento, por producto.
 *
 * Se congela en la línea al guardar porque `products.costos` guarda el ÚLTIMO coste:
 * sin la foto, subirle la tarifa al proveedor en marzo reescribiría el margen de enero.
 * Solo se busca lo que tiene `producto_id` (una línea de texto libre no tiene coste).
 */
export async function fotoDeCostes(
  db: Db, client_id: string, moneda: string, lineas: LineaInput[],
): Promise<Map<string, number | null>> {
  const ids = [...new Set(lineas.map(l => l.producto_id).filter((id): id is string => !!id))]
  const mapa = new Map<string, number | null>()
  if (!ids.length) return mapa

  const { data } = await db.from('products')
    .select('producto_id, costos').eq('client_id', client_id).in('producto_id', ids)
  for (const p of (data ?? []) as { producto_id: string; costos: Record<string, number> | null }[]) {
    const c = p.costos?.[moneda]
    mapa.set(p.producto_id, typeof c === 'number' && c > 0 ? c : null)
  }
  return mapa
}

export async function escribirLineasYAjustes(
  db: Db,
  documento_tipo: DocumentoTipo,
  documento_id:   string,
  lineas:         LineaInput[],
  ajustes:        AjusteInput[],
  totales:        ReturnType<typeof calcularTotales>,
  client_id:      string,
  moneda:         string,
): Promise<void> {
  if (lineas.length > 0) {
    const costos = await fotoDeCostes(db, client_id, moneda, lineas)
    await db.from('documento_lineas').insert(
      lineas.map((l, i) => ({
        documento_tipo,
        documento_id,
        orden:             i,
        producto_id:       l.producto_id,
        descripcion:       l.descripcion,
        cantidad:          l.cantidad,
        precio_unitario:   l.precio_unitario,
        descuento_pct:     l.descuento_pct ?? 0,
        descuento_importe: totales.lineas_descuentos[i] ?? 0,
        total:             totales.lineas_totales[i],
        suscripcion_id:    l.suscripcion_id ?? null,
        costo_unitario:    l.producto_id ? costos.get(l.producto_id) ?? null : null,
      })),
    )
  }
  if (ajustes.length > 0) {
    await db.from('documento_ajustes').insert(
      ajustes.map((a, i) => ({
        documento_tipo,
        documento_id,
        orden:           i,
        tipo:            a.tipo,
        nombre:          a.nombre,
        modo:            a.modo,
        valor:           a.valor,
        monto_calculado: totales.ajustes_calculados[i],
      })),
    )
  }
}

export interface FacturaBorradorInput {
  client_id:      string
  empresa_id:     string
  cliente_id:     string
  moneda:         string
  fecha_emision:  string
  condicion_pago?: string
  notas?:          string | null
  notas_internas?: string | null
  lineas:          LineaInput[]
  ajustes?:        AjusteInput[]
}

/** Crea una factura en BORRADOR (sin número fiscal) con sus líneas. No emite nada. */
export async function crearFacturaBorrador(
  db: Db, input: FacturaBorradorInput,
): Promise<{ ok: true; factura_id: string; numero: string } | { ok: false; error: string }> {
  const lineas  = input.lineas
  const ajustes = input.ajustes ?? []
  if (lineas.length === 0) return { ok: false, error: 'Añade al menos una línea.' }

  const totales    = calcularTotales(lineas, ajustes)
  const factura_id = generarIdDocumento('FAC')
  const numero     = numeroProvisional(factura_id)   // el fiscal se reserva al emitir

  const { error } = await db.from('facturas').insert({
    factura_id,
    numero,
    client_id:      input.client_id,
    empresa_id:     input.empresa_id,
    cliente_id:     input.cliente_id,
    fecha_emision:  input.fecha_emision,
    moneda:         input.moneda,
    estado:         'BORRADOR',
    condicion_pago: input.condicion_pago ?? 'CONTADO',
    subtotal:       totales.subtotal,
    total:          totales.total,
    notas:          input.notas ?? null,
    notas_internas: input.notas_internas ?? null,
  })
  if (error) return { ok: false, error: error.message }

  await escribirLineasYAjustes(
    db, 'FACTURA', factura_id, lineas, ajustes, totales, input.client_id, input.moneda,
  )
  return { ok: true, factura_id, numero }
}
