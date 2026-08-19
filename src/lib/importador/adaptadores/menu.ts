// Adaptador de importación de la CARTA / CATÁLOGO PÚBLICO (módulo `catalogo_qr`):
// lo que ve el cliente final en el menú QR. Escribe en `catalogo_items`, NO en
// `products` — son cosas distintas: `products` es el catálogo del ERP (precios,
// costos, existencias), y `catalogo_items` es la carta de cara al público. Por eso
// este adaptador convive con el de productos/servicios sin pisarlo.
//
// Las SECCIONES de la carta (`catalogo_categorias`) se crean de paso, igual que
// las categorías del ERP: se resuelven por nombre y se dan de alta al escribir
// (§`categorias.ts`). Sin fotos: una imagen no cabe en una hoja de cálculo, se
// suben después desde la ficha del plato.

import { camposProvistos, idCorto, norm, parseBooleano, parseNumero } from '../util'
import { defCategoriaFaltante, defMoneda } from './comunes'
import { crearCategoriaMenu, resolverCategoriaMenu } from './categorias'
import type { Adaptador, CampoDef, CtxImport, Preparado } from '../tipos'

type DatosMenu = Record<string, unknown> & {
  nombre: string
  categoria_nueva?: string | null
}

/** Da de alta la sección que el ítem apuntó (política CREAR). Al escribir, no al validar. */
async function altaSeccion(nueva: string | null | undefined, ctx: CtxImport): Promise<string | null> {
  if (!nueva) return null
  return crearCategoriaMenu(nueva, ctx)
}

const CAMPOS: CampoDef[] = [
  { campo: 'nombre',       etiqueta: 'Nombre',       obligatorio: true,  alias: ['nombre', 'plato', 'producto', 'articulo', 'artículo', 'item', 'ítem'], ejemplo: 'Ropa vieja' },
  { campo: 'categoria',    etiqueta: 'Sección',      obligatorio: false, alias: ['seccion', 'sección', 'categoria', 'categoría', 'grupo', 'apartado'], ayuda: 'El apartado de la carta (Entrantes, Bebidas…). Si no existe, se crea.', ejemplo: 'Platos principales' },
  { campo: 'descripcion',  etiqueta: 'Descripción',  obligatorio: false, alias: ['descripcion', 'descripción', 'detalle'], ejemplo: 'Carne deshebrada con arroz y plátano' },
  { campo: 'precio',       etiqueta: 'Precio',       obligatorio: false, alias: ['precio', 'pvp', 'importe', 'valor'], ejemplo: '850' },
  { campo: 'moneda',       etiqueta: 'Moneda',       obligatorio: false, alias: ['moneda', 'divisa'], ejemplo: 'CUP' },
  { campo: 'ingredientes', etiqueta: 'Ingredientes', obligatorio: false, alias: ['ingredientes', 'contiene'], ejemplo: 'Carne de res, arroz, plátano' },
  { campo: 'alergenos',    etiqueta: 'Alérgenos',    obligatorio: false, alias: ['alergenos', 'alérgenos', 'alergias'], ejemplo: 'Gluten' },
  { campo: 'calorias',     etiqueta: 'Calorías',     obligatorio: false, alias: ['calorias', 'calorías', 'kcal'], ejemplo: '520' },
  { campo: 'disponible',   etiqueta: 'Disponible',   obligatorio: false, alias: ['disponible', 'activo', 'visible'], ayuda: 'Sí / No. Si se deja vacío, se muestra.', ejemplo: 'Sí' },
  { campo: 'orden',        etiqueta: 'Orden',        obligatorio: false, alias: ['orden', 'posicion', 'posición', 'nº', 'no'], ayuda: 'Para ordenar la carta. Menor primero. Si falta, va al final.', ejemplo: '1' },
]

export const adaptadorCatalogoMenu: Adaptador = {
  entidad:   'catalogo',
  etiqueta:  'Carta / catálogo digital',
  modulos:   ['catalogo_qr'],
  revalidar: '/portal/catalogo',
  defaults: [
    defMoneda('moneda', false, 'Moneda de los precios de la carta, para las filas que no traigan otra.'),
    defCategoriaFaltante('sección'),
  ],
  campos: CAMPOS,

  // Cuántas secciones nuevas va a crear el archivo (por nombre: cien platos de
  // «Bebidas» son una sección), para verlo antes de escribir.
  resumen: filas => {
    const secs = new Set(filas.map(f => (f as DatosMenu).categoria_nueva).filter(Boolean))
    return secs.size > 0 ? [{ etiqueta: 'Secciones que se crearán', valor: secs.size, entero: true }] : []
  },

  async preparar(valores, ctx, deColumna): Promise<Preparado> {
    const nombre = (valores.nombre ?? '').trim()
    if (!nombre) return { ok: false, motivo: 'Falta el nombre.' }

    const precio = parseNumero(valores.precio)
    if (precio === undefined) return { ok: false, motivo: 'El precio no es un número.' }
    if (precio != null && precio < 0) return { ok: false, motivo: 'El precio no puede ser negativo.' }

    // La moneda solo importa si hay precio, y entonces tiene que ser una de las del
    // cliente: una moneda que no tiene no cotiza y rompe la carta (regla de Monedas).
    const moneda = (valores.moneda ?? '').trim().toUpperCase()
    if (precio != null && !ctx.monedas.includes(moneda))
      return { ok: false, motivo: moneda
        ? `La moneda "${moneda}" no está configurada en Monedas y Tasas.`
        : 'Indica la moneda del precio.' }

    const calorias = parseNumero(valores.calorias)
    if (calorias === undefined) return { ok: false, motivo: 'Las calorías no son un número.' }
    if (calorias != null && calorias < 0) return { ok: false, motivo: 'Las calorías no pueden ser negativas.' }

    const disponible = parseBooleano(valores.disponible)
    if (disponible === undefined) return { ok: false, motivo: 'Disponible debe ser Sí o No.' }

    const orden = parseNumero(valores.orden)
    if (orden === undefined) return { ok: false, motivo: 'El orden no es un número.' }

    // La sección se DECIDE aquí y se escribe al insertar (validar no toca la BD).
    let categoria_id:    string | null = null
    let categoria_nueva: string | null = null
    const categoria = (valores.categoria ?? '').trim()
    if (categoria) {
      const rc = await resolverCategoriaMenu(categoria, valores, ctx)
      if (!rc.ok) return rc
      categoria_id    = rc.categoria_id
      categoria_nueva = rc.crear
    }

    const provistos = camposProvistos(deColumna, {
      nombre:       'nombre',
      categoria:    'categoria_id',
      descripcion:  'descripcion',
      precio:       'precio',
      moneda:       'moneda',
      ingredientes: 'ingredientes',
      alergenos:    'alergenos',
      calorias:     'calorias',
      disponible:   'disponible',
      orden:        'orden',
    })
      // Una sección que no se pudo resolver no vacía la que el ítem ya tuviera.
      .filter(c => c !== 'categoria_id' || categoria_id || categoria_nueva)

    return {
      ok: true,
      datos: {
        nombre,
        categoria_id,
        categoria_nueva,
        descripcion:  (valores.descripcion ?? '').trim() || null,
        precio:       precio ?? null,
        moneda:       precio != null ? moneda : null,
        ingredientes: (valores.ingredientes ?? '').trim() || null,
        alergenos:    (valores.alergenos ?? '').trim() || null,
        calorias:     calorias == null ? null : Math.round(calorias),
        disponible:   disponible ?? true,
        orden:        orden == null ? 0 : Math.round(orden),
        updated_at:   new Date().toISOString(),
      },
      clave: `nom|${norm(nombre)}`,
      provistos: [...provistos, ...(categoria_nueva ? ['categoria_nueva'] : [])],
    }
  },

  async buscarExistente(datos, ctx) {
    const { nombre } = datos as DatosMenu
    const { data } = await ctx.db.from('catalogo_items').select('item_id')
      .eq('client_id', ctx.client_id).ilike('nombre', nombre).limit(1).maybeSingle()
    return (data?.item_id as string) ?? null
  },

  async insertar(datos, ctx) {
    const { categoria_nueva, ...campos } = datos as DatosMenu
    const item_id = `CATITM-${idCorto()}`
    const { error } = await ctx.db.from('catalogo_items').insert({
      item_id,
      client_id:    ctx.client_id,
      ...campos,
      categoria_id: campos.categoria_id ?? await altaSeccion(categoria_nueva, ctx),
    })
    if (error) throw new Error(error.message)
    return item_id
  },

  async actualizar(id, datos, ctx) {
    const campos: Partial<DatosMenu> = { ...datos }
    // La sección apuntada no es una columna: se convierte en id aquí.
    const nueva = campos.categoria_nueva
    delete campos.categoria_nueva
    if (nueva) campos.categoria_id = await altaSeccion(nueva, ctx)
    const { error } = await ctx.db.from('catalogo_items').update(campos)
      .eq('item_id', id).eq('client_id', ctx.client_id)
    if (error) throw new Error(error.message)
  },

  // Un ítem de la carta es una hoja: nadie cuelga de él, así que deshacer lo borra
  // sin más (la sección que creó de paso la deshace su propia traza).
  async deshacer(pk, ctx) {
    const { error } = await ctx.db.from('catalogo_items').delete()
      .eq('item_id', pk).eq('client_id', ctx.client_id)
    return error ? error.message : null
  },
}
