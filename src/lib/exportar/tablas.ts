// Registro de tablas exportables — «sácame todos los X de este negocio».
//
// Es una herramienta de CONFIGURACIÓN, no una función del portal: solo la ve la
// sesión de impersonación (el equipo CLAUX dentro del portal del cliente). Sirve
// para llevarse los datos a Excel y revisarlos, migrarlos o dárselos a un asesor.
//
// ── POR QUÉ UN REGISTRO Y NO UN EXPORTADOR POR PANTALLA ───────────────────────
// Todas las exportaciones hacen lo mismo: leer una tabla del tenant, ponerle
// cabeceras legibles y volcarla. Escribirlo una vez por vista habría dado diez
// copias que divergen — que es exactamente lo que ya pasó con el CSV, del que hay
// cuatro generadores a mano en el repo, cada uno con su separador y uno de ellos
// sin BOM. Aquí: una entrada por entidad, y añadir una tabla nueva son ~10 líneas.
//
// Las columnas se eligen a mano en vez de volcar `select *` a propósito: se
// traducen a nombres que un humano entiende, se omiten los `client_id` (todas las
// filas son del mismo cliente) y no se filtra ningún dato por accidente.
//
// No es 'use server': lo consume la server action `exportarTabla`.

import type { ValorCelda } from './csv'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface TablaExportable {
  /** Clave estable: viaja del cliente a la server action. */
  clave:     string
  /** Nombre visible en el menú y base del nombre de fichero. */
  etiqueta:  string
  cabeceras: string[]
  cargar: (db: Db, client_id: string) => Promise<ValorCelda[][]>
}

/** `select` + filtro por tenant + orden, que es idéntico en todas. */
async function leer(
  db: Db, tabla: string, client_id: string, columnas: string, orden: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await db.from(tabla)
    .select(columnas)
    .eq('client_id', client_id)
    .order(orden, { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as Record<string, unknown>[]
}

/** Mapa id → nombre, para que el CSV diga «Bar Manolo» y no «TER-9F2A11C4». */
async function diccionario(
  db: Db, tabla: string, client_id: string, clave: string, valor: string,
): Promise<Map<string, string>> {
  const { data } = await db.from(tabla).select(`${clave}, ${valor}`).eq('client_id', client_id)
  const m = new Map<string, string>()
  for (const f of (data ?? []) as Record<string, string>[]) m.set(f[clave], f[valor])
  return m
}

export const TABLAS_EXPORTABLES: TablaExportable[] = [
  {
    clave: 'terceros',
    etiqueta: 'Clientes y proveedores',
    cabeceras: ['Código', 'Tipo', 'Nombre', 'Nombre comercial', 'NIT', 'Email', 'Teléfono',
      'Dirección', 'Ciudad', 'País', 'Condición de pago', 'Límite de crédito',
      'Moneda por defecto', 'Activo', 'Notas'],
    cargar: async (db, cid) => {
      const filas = await leer(db, 'third_parties', cid,
        'tercero_id, tipo, nombre, nombre_comercial, nit, email, telefono, direccion, ciudad, pais, condicion_pago, limite_credito, moneda_defecto, activo, notas', 'nombre')
      return filas.map(f => [
        f.tercero_id as string, f.tipo as string, f.nombre as string,
        f.nombre_comercial as string, f.nit as string, f.email as string, f.telefono as string,
        f.direccion as string, f.ciudad as string, f.pais as string, f.condicion_pago as string,
        f.limite_credito as number, f.moneda_defecto as string, f.activo as boolean,
        f.notas as string,
      ])
    },
  },
  {
    clave: 'categorias_gastos',
    etiqueta: 'Categorías de gasto',
    cabeceras: ['Código', 'Categoría', 'Subcategoría de', 'En el estado de resultados',
      'Estado', 'Del sistema', 'Concepto'],
    cargar: async (db, cid) => {
      const filas = await leer(db, 'categorias_gastos', cid,
        'categoria_id, nombre, parent_id, rol_pl, estado, es_sistema, descripcion', 'nombre')
      // El padre se resuelve contra las MISMAS filas ya leídas: no hace falta otra
      // consulta y así una madre archivada también aparece con su nombre.
      const porId = new Map(filas.map(f => [f.categoria_id as string, f.nombre as string]))
      return filas.map(f => [
        f.categoria_id as string, f.nombre as string,
        f.parent_id ? (porId.get(f.parent_id as string) ?? f.parent_id as string) : '',
        f.rol_pl as string, f.estado as string, f.es_sistema as boolean, f.descripcion as string,
      ])
    },
  },
  {
    clave: 'gastos_cobros',
    etiqueta: 'Gastos y cobros',
    cabeceras: ['Código', 'Tipo', 'Fecha', 'Vencimiento', 'Tercero', 'Categoría', 'Concepto',
      'Etiqueta', 'Moneda', 'Importe', 'Empresa', 'Generado por', 'Notas'],
    cargar: async (db, cid) => {
      const [filas, terceros, empresas] = await Promise.all([
        leer(db, 'gastos_cobros', cid,
          'registro_id, tipo, fecha, vencimiento, tercero_id, categoria, concepto, descripcion, moneda, monto, empresa_id, origen_tipo, notas', 'fecha'),
        diccionario(db, 'third_parties', cid, 'tercero_id', 'nombre'),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.registro_id as string, f.tipo as string, f.fecha as string, f.vencimiento as string,
        f.tercero_id ? (terceros.get(f.tercero_id as string) ?? '') : '',
        f.categoria as string,
        // «Concepto» era `descripcion`, que en un GASTO es la etiqueta de la categoría: el
        // CSV exportaba el mismo defecto que la tabla (D4). Ahora sale el concepto real
        // (mig. 152), con el histórico cayendo a la etiqueta, y la etiqueta derivada se
        // conserva en su propia columna porque es la que usan los informes.
        (f.concepto as string) || (f.descripcion as string),
        f.descripcion as string,
        f.moneda as string, f.monto as number,
        empresas.get(f.empresa_id as string) ?? '',
        (f.origen_tipo as string) ?? 'Manual', f.notas as string,
      ])
    },
  },
  {
    clave: 'facturas',
    etiqueta: 'Facturas',
    cabeceras: ['Número', 'Fecha', 'Vencimiento', 'Cliente', 'Empresa', 'Moneda',
      'Subtotal', 'Total', 'Estado', 'Condición de pago', 'Notas'],
    cargar: async (db, cid) => {
      const [filas, terceros, empresas] = await Promise.all([
        leer(db, 'facturas', cid,
          'numero, fecha_emision, fecha_vencimiento, cliente_id, empresa_id, moneda, subtotal, total, estado, condicion_pago, notas', 'fecha_emision'),
        diccionario(db, 'third_parties', cid, 'tercero_id', 'nombre'),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.numero as string, f.fecha_emision as string, f.fecha_vencimiento as string,
        f.cliente_id ? (terceros.get(f.cliente_id as string) ?? '') : '',
        empresas.get(f.empresa_id as string) ?? '',
        f.moneda as string, f.subtotal as number, f.total as number, f.estado as string,
        f.condicion_pago as string, f.notas as string,
      ])
    },
  },
  {
    clave: 'ofertas',
    etiqueta: 'Ofertas y presupuestos',
    cabeceras: ['Número', 'Fecha', 'Válida hasta', 'Cliente', 'Empresa', 'Moneda',
      'Subtotal', 'Total', 'Estado', 'Notas'],
    cargar: async (db, cid) => {
      const [filas, terceros, empresas] = await Promise.all([
        leer(db, 'ofertas', cid,
          'numero, fecha_emision, fecha_validez, cliente_id, empresa_id, moneda, subtotal, total, estado, notas', 'fecha_emision'),
        diccionario(db, 'third_parties', cid, 'tercero_id', 'nombre'),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.numero as string, f.fecha_emision as string, f.fecha_validez as string,
        f.cliente_id ? (terceros.get(f.cliente_id as string) ?? '') : '',
        empresas.get(f.empresa_id as string) ?? '',
        f.moneda as string, f.subtotal as number, f.total as number, f.estado as string,
        f.notas as string,
      ])
    },
  },
  {
    clave: 'movimientos_tesoreria',
    etiqueta: 'Movimientos de tesorería',
    cabeceras: ['Fecha', 'Tipo', 'Cuenta', 'Concepto', 'Categoría', 'Moneda', 'Importe',
      'Empresa', 'Origen', 'Notas'],
    cargar: async (db, cid) => {
      const [filas, cuentas, empresas] = await Promise.all([
        leer(db, 'movimientos_tesoreria', cid,
          'fecha, tipo, cuenta_id, concepto, categoria, moneda, monto, empresa_id, origen, notas', 'fecha'),
        diccionario(db, 'cuentas', cid, 'cuenta_id', 'nombre'),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.fecha as string, f.tipo as string, cuentas.get(f.cuenta_id as string) ?? '',
        f.concepto as string, f.categoria as string, f.moneda as string, f.monto as number,
        empresas.get(f.empresa_id as string) ?? '', f.origen as string, f.notas as string,
      ])
    },
  },
  {
    clave: 'productos',
    etiqueta: 'Productos y servicios',
    cabeceras: ['Código', 'Tipo', 'Nombre', 'Descripción', 'Unidad', 'Stock actual',
      'Stock mínimo', 'Activo'],
    cargar: async (db, cid) => {
      const filas = await leer(db, 'products', cid,
        'codigo, tipo, nombre, descripcion, unidad, stock_actual, stock_minimo, activo', 'nombre')
      return filas.map(f => [
        f.codigo as string, f.tipo as string, f.nombre as string, f.descripcion as string,
        f.unidad as string, f.stock_actual as number, f.stock_minimo as number,
        f.activo as boolean,
      ])
    },
  },
  {
    clave: 'empleados',
    etiqueta: 'Personal',
    cabeceras: ['Código', 'Nombre', 'Apellidos', 'Documento', 'Cargo', 'Departamento',
      'Tipo de contrato', 'Fecha de alta', 'Salario base', 'Moneda', 'Periodicidad',
      'Empresa', 'Fecha de baja', 'Email', 'Teléfono'],
    cargar: async (db, cid) => {
      const [filas, empresas] = await Promise.all([
        leer(db, 'empleados', cid,
          'empleado_id, nombre, apellidos, documento, cargo, departamento, tipo_contrato, fecha_alta, salario_base, moneda, periodicidad, empresa_id, fecha_baja, email, telefono', 'nombre'),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.empleado_id as string, f.nombre as string, f.apellidos as string,
        f.documento as string, f.cargo as string, f.departamento as string,
        f.tipo_contrato as string, f.fecha_alta as string, f.salario_base as number,
        f.moneda as string, f.periodicidad as string,
        empresas.get(f.empresa_id as string) ?? '', f.fecha_baja as string,
        f.email as string, f.telefono as string,
      ])
    },
  },
  {
    clave: 'cuentas',
    etiqueta: 'Cuentas y cajas',
    cabeceras: ['Nombre', 'Tipo', 'Moneda', 'Saldo inicial', 'Empresa', 'Activa', 'Notas'],
    cargar: async (db, cid) => {
      const [filas, empresas] = await Promise.all([
        leer(db, 'cuentas', cid, 'nombre, tipo, moneda, saldo_inicial, empresa_id, activa, notas', 'nombre'),
        diccionario(db, 'empresas', cid, 'empresa_id', 'nombre'),
      ])
      return filas.map(f => [
        f.nombre as string, f.tipo as string, f.moneda as string, f.saldo_inicial as number,
        empresas.get(f.empresa_id as string) ?? '', f.activa as boolean, f.notas as string,
      ])
    },
  },
]

export function tablaPorClave(clave: string): TablaExportable | undefined {
  return TABLAS_EXPORTABLES.find(t => t.clave === clave)
}
