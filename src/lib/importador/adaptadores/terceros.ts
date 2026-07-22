// Adaptador de importación de Terceros (clientes/proveedores). Reutiliza el
// núcleo `construirCamposTercero`/`generarTerceroId` de `@/lib/terceros-core`
// (misma validación y normalización que el alta manual, sin duplicar reglas).

import { construirCamposTercero, generarTerceroId } from '@/lib/terceros-core'
import { camposProvistos, parseNumero, primeraDependencia } from '../util'
import { defEmpresa, defMoneda } from './comunes'
import type { Adaptador, Preparado } from '../tipos'

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
      clave: `${empresa_id}|${nombre.toLowerCase()}`,
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
    const { data } = await ctx.db.from('third_parties')
      .select('tercero_id')
      .eq('client_id', ctx.client_id)
      .eq('empresa_id', datos.empresa_id as string)
      .ilike('nombre', datos.nombre as string)
      .limit(1).maybeSingle()
    return (data?.tercero_id as string) ?? null
  },

  async insertar(datos, ctx) {
    const tercero_id = generarTerceroId()
    const { error } = await ctx.db.from('third_parties').insert({
      tercero_id, client_id: ctx.client_id, activo: true, created_at: new Date().toISOString(), ...datos,
    })
    if (error) throw new Error(error.message)
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
