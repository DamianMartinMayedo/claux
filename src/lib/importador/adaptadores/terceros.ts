// Adaptador de importación de Terceros (clientes/proveedores). Reutiliza el
// núcleo `construirCamposTercero`/`generarTerceroId` de `@/lib/terceros-core`
// (misma validación y normalización que el alta manual, sin duplicar reglas).
//
// Aquí vive además la búsqueda de terceros POR NOMBRE que usan las otras
// entidades (el proveedor de un gasto, el de un producto): una sola forma de
// decidir si «Comercial S.A.» del archivo es una ficha que ya existe.

import { construirCamposTercero, generarTerceroId, type TipoTercero } from '@/lib/terceros-core'
import { camposProvistos, indicePorNombre, norm, parseNumero, primeraDependencia } from '../util'
import { registrarAuxiliar } from '../motor'
import { resolverRef } from '../resolver'
import { defEmpresa, defMoneda, politicaTercero } from './comunes'
import type { Adaptador, CtxImport, Preparado } from '../tipos'

type FichaTercero = { tercero_id: string; nombre: string; empresa_id: string }

/** Todos los terceros del cliente, indexados por nombre. Se carga una vez. */
async function indiceTerceros(ctx: CtxImport) {
  return indicePorNombre(ctx, 'terceros', async () => {
    const { data } = await ctx.db.from('third_parties')
      .select('tercero_id, nombre, empresa_id').eq('client_id', ctx.client_id)
    return (data ?? []) as FichaTercero[]
  }, t => t.nombre)
}

/**
 * Tercero por nombre, o null. `empresa_id` acota la búsqueda —un tercero
 * pertenece a una empresa—; con null vale cualquiera del cliente (el catálogo
 * de productos no es por empresa).
 */
export async function buscarTerceroPorNombre(
  nombre: string, empresa_id: string | null, ctx: CtxImport,
): Promise<string | null> {
  const idx = await indiceTerceros(ctx)
  const encontradas = idx.buscar(nombre, t => !empresa_id || t.empresa_id === empresa_id)
  return encontradas[0]?.tercero_id ?? null
}

/** El tercero de una fila, resuelto y sin escribir nada. */
export interface TerceroDeFila {
  /** Ficha que ya existe (o la que señaló el operador). */
  tercero_id: string | null
  /** Nombre de la ficha mínima que hay que crear al escribir. */
  crear:      string | null
  /**
   * El operador eligió dejar el campo vacío: el nombre no se tira, lo guarda
   * quien pueda (las notas de un gasto sí; una ficha de producto no).
   */
  sin_ficha:  string | null
}

/**
 * Empareja el cliente/proveedor que nombra una fila. Con una sola coincidencia
 * se usa; si el nombre se PARECE a una ficha que ya existe, la fila espera que el
 * operador diga si son la misma («Comercial SA» / «Comercial S.A.») en vez de
 * duplicarla; y si no se parece a nada, manda la política del lote
 * (`defTerceroFaltante`), que es lo que permite meter 400 filas con 80
 * proveedores nuevos sin 80 clics.
 */
export async function resolverTerceroDeFila(
  nombre: string, empresa_id: string | null, etiqueta: string,
  valores: Record<string, string>, ctx: CtxImport,
): Promise<{ ok: true; tercero: TerceroDeFila } | Extract<Preparado, { ok: false }>> {
  const idx  = await indiceTerceros(ctx)
  const dela = (t: FichaTercero) => !empresa_id || t.empresa_id === empresa_id
  const opcion = (t: FichaTercero) => ({ valor: t.tercero_id, etiqueta: t.nombre })

  const r = resolverRef({
    tipo:          'tercero',
    etiqueta_tipo: etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1),
    texto:         nombre,
    ambito:        empresa_id ?? '',
    coincidencias: idx.buscar(nombre, dela).map(opcion),
    parecidos:     idx.sugerir(nombre, dela).map(opcion),
    otras:         idx.todas(dela).map(opcion),
    creable:       true,
    omitible:      true,
    aviso:         'La ficha nueva se crea solo con el nombre; el resto se completa en Clientes y proveedores.',
    defecto:       politicaTercero(valores),
  }, ctx)

  if (r.estado === 'DECIDIR') return { ok: false, motivo: r.motivo, decidir: true }
  if (r.estado === 'ERROR')   return { ok: false, motivo: r.motivo }
  return {
    ok: true,
    tercero: {
      tercero_id: r.estado === 'USAR'   ? r.id   : null,
      crear:      r.estado === 'CREAR'  ? nombre : null,
      sin_ficha:  r.estado === 'OMITIR' ? nombre : null,
    },
  }
}

/**
 * Da de alta la ficha MÍNIMA del tercero que el archivo nombra y no existía
 * (nombre, empresa y tipo; el resto se completa luego en su ficha), y la traza
 * en el lote para que Deshacer se la lleve. Idempotente dentro del lote: si otra
 * fila ya lo creó, se reutiliza.
 */
export async function crearTerceroImportado(
  nombre: string, empresa_id: string, tipo: TipoTercero, ctx: CtxImport,
): Promise<string> {
  const idx = await indiceTerceros(ctx)
  const ya  = idx.buscar(nombre, t => t.empresa_id === empresa_id)[0]
  if (ya) return ya.tercero_id

  const tercero_id = generarTerceroId()
  const { error } = await ctx.db.from('third_parties').insert({
    tercero_id, client_id: ctx.client_id, activo: true, created_at: new Date().toISOString(),
    ...construirCamposTercero({ empresa_id, tipo, nombre }),
  })
  if (error) throw new Error(error.message)
  idx.anotar(nombre, { tercero_id, nombre: nombre.trim(), empresa_id })
  await registrarAuxiliar(ctx, 'terceros', tercero_id)
  return tercero_id
}

export const adaptadorTerceros: Adaptador = {
  entidad:   'terceros',
  etiqueta:  'Clientes y proveedores',
  modulos:   ['base', 'inventario', 'servicios'],
  revalidar: '/portal/terceros',
  defaults: [
    defEmpresa,
    defMoneda('moneda_defecto', false, 'Se aplica a los que no traigan moneda en el archivo.'),
  ],
  campos: [
    { campo: 'nombre',         etiqueta: 'Nombre',            obligatorio: true,  alias: ['nombre', 'razon social', 'razón social', 'cliente', 'proveedor', 'tercero'], ejemplo: 'Comercial Ejemplo S.A.' },
    { campo: 'tipo',           etiqueta: 'Tipo',              obligatorio: false, alias: ['tipo'], ayuda: 'CLIENTE, PROVEEDOR o AMBOS (por defecto CLIENTE)', ejemplo: 'PROVEEDOR' },
    { campo: 'identificacion', etiqueta: 'Identificación',    obligatorio: false, alias: ['identificacion', 'identificación', 'nif', 'cif', 'ci', 'carnet', 'rnc'], ejemplo: '85042012345' },
    { campo: 'telefono',       etiqueta: 'Teléfono',          obligatorio: false, alias: ['telefono', 'teléfono', 'tel', 'movil', 'móvil', 'celular'], ejemplo: '+53 5 123 4567' },
    { campo: 'email',          etiqueta: 'Correo',            obligatorio: false, alias: ['email', 'correo', 'e-mail'], ejemplo: 'contacto@ejemplo.cu' },
    { campo: 'direccion',      etiqueta: 'Dirección',         obligatorio: false, alias: ['direccion', 'dirección', 'domicilio'], ejemplo: 'Calle 23 #456 e/ 10 y 12' },
    { campo: 'ciudad',         etiqueta: 'Ciudad',            obligatorio: false, alias: ['ciudad', 'municipio'], ejemplo: 'La Habana' },
    { campo: 'pais',           etiqueta: 'País',              obligatorio: false, alias: ['pais', 'país'], ejemplo: 'Cuba' },
    { campo: 'condicion_pago', etiqueta: 'Condición de pago', obligatorio: false, alias: ['condicion', 'condición', 'condicion de pago', 'pago'], ayuda: 'CONTADO, 15, 30, 60 o 90', ejemplo: '30' },
    { campo: 'limite_credito', etiqueta: 'Límite de crédito', obligatorio: false, alias: ['limite', 'límite', 'limite credito', 'credito', 'crédito'], ejemplo: '5000' },
    { campo: 'moneda_defecto', etiqueta: 'Moneda',            obligatorio: false, alias: ['moneda', 'divisa'], ejemplo: 'CUP' },
    { campo: 'num_contrato',   etiqueta: 'Nº de contrato',    obligatorio: false, alias: ['contrato', 'num contrato', 'nº contrato'], ejemplo: 'C-2026-001' },
    { campo: 'notas',          etiqueta: 'Notas',             obligatorio: false, alias: ['notas', 'observaciones', 'comentarios'], ejemplo: 'Fila de ejemplo: puedes dejarla, no se importa' },
  ],

  async preparar(valores, ctx, deColumna): Promise<Preparado> {
    const nombre = (valores.nombre ?? '').trim()
    if (!nombre) return { ok: false, motivo: 'Falta el nombre.' }

    const empresa_id = (valores.empresa_id ?? '').trim()
    if (!empresa_id || !ctx.empresas.some(e => e.empresa_id === empresa_id))
      return { ok: false, motivo: 'Empresa no válida o no indicada.' }

    const moneda = (valores.moneda_defecto ?? '').trim() || null
    if (moneda && !ctx.monedas.includes(moneda))
      return { ok: false, motivo: `La moneda "${moneda}" no está configurada.` }

    const limite = parseNumero(valores.limite_credito)
    if (limite === undefined) return { ok: false, motivo: 'El límite de crédito no es un número.' }

    const datos = construirCamposTercero({
      empresa_id,
      tipo:           (valores.tipo ?? '').trim().toUpperCase(),
      nombre,
      identificacion: valores.identificacion,
      telefono:       valores.telefono,
      email:          valores.email,
      direccion:      valores.direccion,
      ciudad:         valores.ciudad,
      pais:           valores.pais,
      condicion_pago: (valores.condicion_pago ?? '').trim().toUpperCase(),
      limite_credito: limite,
      moneda_defecto: moneda,
      num_contrato:   valores.num_contrato,
      notas:          valores.notas,
    })
    return {
      ok: true,
      datos,
      clave: `${empresa_id}|${norm(nombre)}`,
      // `empresa_id` no está: es el ámbito con el que se encontró la ficha. Un
      // archivo de solo teléfonos no puede vaciar direcciones ni devolver el
      // tipo a CLIENTE y la condición de pago a CONTADO.
      provistos: camposProvistos(deColumna, {
        nombre:         'nombre',
        tipo:           'tipo',
        identificacion: 'identificacion',
        telefono:       'telefono',
        email:          'email',
        direccion:      'direccion',
        ciudad:         'ciudad',
        pais:           'pais',
        condicion_pago: 'condicion_pago',
        limite_credito: 'limite_credito',
        moneda_defecto: 'moneda_defecto',
        num_contrato:   'num_contrato',
        notas:          'notas',
      }),
    }
  },

  async buscarExistente(datos, ctx) {
    return buscarTerceroPorNombre(datos.nombre as string, datos.empresa_id as string, ctx)
  },

  async insertar(datos, ctx) {
    const tercero_id = generarTerceroId()
    const empresa_id = datos.empresa_id as string
    const nombre     = datos.nombre as string
    const { error } = await ctx.db.from('third_parties').insert({
      tercero_id, client_id: ctx.client_id, activo: true, created_at: new Date().toISOString(), ...datos,
    })
    if (error) throw new Error(error.message)
    // El índice del lote tiene que enterarse: si no, otra fila con el mismo
    // nombre escrito de otra forma lo daría por inexistente y lo duplicaría.
    ;(await indiceTerceros(ctx)).anotar(nombre, { tercero_id, nombre, empresa_id })
    return tercero_id
  },

  async actualizar(id, datos, ctx) {
    const { error } = await ctx.db.from('third_parties').update(datos)
      .eq('tercero_id', id).eq('client_id', ctx.client_id)
    if (error) throw new Error(error.message)
  },

  // El portal no borra terceros nunca (se archivan, porque los referencian los
  // documentos). Aquí se borra solo lo que trajo el lote Y no usa nadie todavía.
  async deshacer(pk, ctx) {
    const dep = await primeraDependencia(ctx, pk, [
      { tabla: 'facturas',      columna: 'cliente_id',   etiqueta: 'facturas' },
      { tabla: 'ofertas',       columna: 'cliente_id',   etiqueta: 'ofertas' },
      { tabla: 'suscripciones', columna: 'cliente_id',   etiqueta: 'suscripciones' },
      { tabla: 'compras',       columna: 'proveedor_id', etiqueta: 'compras' },
      { tabla: 'products',      columna: 'proveedor_id', etiqueta: 'fichas de producto' },
      { tabla: 'gastos_cobros', columna: 'tercero_id',   etiqueta: 'gastos o cobros' },
    ])
    if (dep) return dep
    const { error } = await ctx.db.from('third_parties').delete()
      .eq('tercero_id', pk).eq('client_id', ctx.client_id)
    return error ? error.message : null
  },
}
