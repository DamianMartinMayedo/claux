// Adaptador de importación de Personal (trabajadores). Reutiliza el núcleo
// `construirCamposEmpleado`/`generarEmpleadoId` de `@/lib/rrhh-core`.
//
// Alcance deliberado: IDENTIDAD y contacto. El contrato/salario se mapean si
// vienen, pero en ligero — el rework de Nómina para Cuba está en camino y no se
// carga lo que habrá que rehacer. La nómina histórica NO se importa aquí: entra
// como gasto de categoría «Salarios» (plan del importador, D-D).
//
// Un empleado es una relación laboral POR EMPRESA (la misma persona en dos
// empresas son dos registros, como hace `copiarEmpleadoAEmpresa`), así que la
// clave natural incluye la empresa.

import {
  construirCamposEmpleado, generarEmpleadoId, TIPOS_CONTRATO, PERIODICIDADES,
} from '@/lib/rrhh-core'
import { camposProvistos, norm, parseBooleano, parseFecha, parseNumero, primeraDependencia } from '../util'
import { defEmpresa, defMoneda } from './comunes'
import type { Adaptador, Preparado } from '../tipos'

export const adaptadorPersonal: Adaptador = {
  entidad:   'personal',
  etiqueta:  'Personal',
  modulos:   ['rrhh'],
  revalidar: '/portal/rrhh',
  defaults: [
    defEmpresa,
    defMoneda('moneda', true, 'Moneda en la que se le paga a quien no traiga otra.'),
  ],
  campos: [
    { campo: 'nombre',       etiqueta: 'Nombre',        obligatorio: true,  alias: ['nombre', 'nombres', 'trabajador', 'empleado'], ejemplo: 'Ana María' },
    { campo: 'apellidos',    etiqueta: 'Apellidos',     obligatorio: false, alias: ['apellidos', 'apellido'], ejemplo: 'Pérez Rodríguez' },
    { campo: 'documento',    etiqueta: 'Documento',     obligatorio: false, alias: ['documento', 'ci', 'carnet', 'identidad', 'dni', 'nif'], ayuda: 'Carné de identidad. Si viene, es la clave para no duplicar.', ejemplo: '85042012345' },
    { campo: 'fecha_nacimiento', etiqueta: 'Fecha de nacimiento', obligatorio: false, alias: ['fecha nacimiento', 'nacimiento', 'f nacimiento', 'fec nac'], ejemplo: '20/04/1985' },
    { campo: 'telefono',     etiqueta: 'Teléfono',      obligatorio: false, alias: ['telefono', 'teléfono', 'tel', 'movil', 'móvil', 'celular'], ejemplo: '+53 5 123 4567' },
    { campo: 'email',        etiqueta: 'Correo',        obligatorio: false, alias: ['email', 'correo', 'e-mail'], ejemplo: 'ana@ejemplo.cu' },
    { campo: 'direccion',    etiqueta: 'Dirección',     obligatorio: false, alias: ['direccion', 'dirección', 'domicilio'], ejemplo: 'Calle 23 #456 e/ 10 y 12' },
    { campo: 'cargo',        etiqueta: 'Cargo',         obligatorio: false, alias: ['cargo', 'puesto', 'ocupacion', 'ocupación'], ejemplo: 'Dependienta' },
    { campo: 'departamento', etiqueta: 'Departamento',  obligatorio: false, alias: ['departamento', 'area', 'área', 'dpto'], ejemplo: 'Salón' },
    { campo: 'turno',        etiqueta: 'Turno',         obligatorio: false, alias: ['turno', 'horario'], ejemplo: 'Mañana' },
    { campo: 'fecha_alta',   etiqueta: 'Fecha de alta', obligatorio: false, alias: ['fecha alta', 'alta', 'ingreso', 'fecha ingreso', 'antiguedad', 'antigüedad'], ayuda: 'Si falta, se pone la fecha de hoy.', ejemplo: '01/03/2024' },
    { campo: 'tipo_contrato', etiqueta: 'Tipo de contrato', obligatorio: false, alias: ['tipo contrato', 'contrato'], ayuda: TIPOS_CONTRATO.join(', '), ejemplo: TIPOS_CONTRATO[0] },
    { campo: 'salario_base', etiqueta: 'Salario',       obligatorio: false, alias: ['salario', 'sueldo', 'salario base', 'remuneracion', 'remuneración'], ejemplo: '18000' },
    { campo: 'periodicidad', etiqueta: 'Periodicidad',  obligatorio: false, alias: ['periodicidad', 'frecuencia pago'], ayuda: PERIODICIDADES.join(', '), ejemplo: PERIODICIDADES[0] },
    { campo: 'moneda',       etiqueta: 'Moneda',        obligatorio: false, alias: ['moneda', 'divisa'], ejemplo: 'CUP' },
    // Vacaciones ya acumuladas ANTES de usar CLAUX (mig. 167). Es un IMPORTE, no días:
    // el sistema deriva y muestra el importe (9,09 % del salario percibido), y convertir
    // días exigiría un valor-día del pasado que nadie conoce. Entra como punto de
    // partida de la derivación, no como un total editable.
    { campo: 'vacaciones_apertura', etiqueta: 'Vacaciones acumuladas', obligatorio: false,
      alias: ['vacaciones acumuladas', 'vacaciones', 'saldo vacaciones', 'vacaciones pendientes'],
      ayuda: 'Importe ya acumulado antes de usar CLAUX. Si el trabajador empieza de cero, déjalo vacío.',
      ejemplo: '1363.50' },
    // Los dos del modelo cubano (mig. 142). Solo se aplican si su empresa usa
    // MIPYME_CUBA; en el General se importan igual y no molestan.
    { campo: 'es_socio', etiqueta: 'Es socio', obligatorio: false,
      alias: ['es socio', 'socio', 'es_socio'],
      ayuda: 'Sí / No. Un socio no paga la Contribución Especial (CESS). En blanco, No.',
      ejemplo: 'No' },
    { campo: 'dias_laborables', etiqueta: 'Días laborables', obligatorio: false,
      alias: ['dias laborables', 'días laborables', 'jornada', 'dias mes'],
      ayuda: 'Su jornada del mes. En blanco, los de su empresa.', ejemplo: '24' },
    { campo: 'notas',        etiqueta: 'Notas',         obligatorio: false, alias: ['notas', 'observaciones', 'comentarios'], ejemplo: 'Fila de ejemplo: puedes dejarla, no se importa' },
  ],

  async preparar(valores, ctx, deColumna): Promise<Preparado> {
    const nombre = (valores.nombre ?? '').trim()
    if (!nombre) return { ok: false, motivo: 'Falta el nombre.' }

    const empresa_id = (valores.empresa_id ?? '').trim()
    if (!empresa_id || !ctx.empresas.some(e => e.empresa_id === empresa_id))
      return { ok: false, motivo: 'Empresa no válida o no indicada.' }

    // `empleados.moneda` es NOT NULL: sin moneda no hay alta posible.
    const moneda = (valores.moneda ?? '').trim().toUpperCase()
    if (!moneda) return { ok: false, motivo: 'Falta la moneda del salario.' }
    if (!ctx.monedas.includes(moneda))
      return { ok: false, motivo: `La moneda "${moneda}" no está configurada en Monedas y Tasas.` }

    const fecha_alta = parseFecha(valores.fecha_alta)
    if (fecha_alta === undefined) return { ok: false, motivo: 'La fecha de alta no se entiende (usa dd/mm/aaaa).' }
    const fecha_nacimiento = parseFecha(valores.fecha_nacimiento)
    if (fecha_nacimiento === undefined) return { ok: false, motivo: 'La fecha de nacimiento no se entiende (usa dd/mm/aaaa).' }

    const salario = parseNumero(valores.salario_base)
    if (salario === undefined) return { ok: false, motivo: 'El salario no es un número.' }

    const vacaciones = parseNumero(valores.vacaciones_apertura)
    if (vacaciones === undefined) return { ok: false, motivo: 'Las vacaciones acumuladas no son un número.' }
    if (vacaciones !== null && vacaciones < 0) {
      return { ok: false, motivo: 'Las vacaciones acumuladas no pueden ser negativas.' }
    }

    // Los dos del modelo cubano. `undefined` = la columna no venía en el archivo, y
    // entonces NO se toca: es la regla «ACTUALIZAR no vacía» aplicada al núcleo
    // compartido, que es donde ahora vive la decisión.
    // `parseBooleano` ya distingue los tres casos: `null` = celda vacía, `undefined` =
    // texto que no se entiende, y el booleano cuando sí.
    const socioRaw = parseBooleano(valores.es_socio)
    if (socioRaw === undefined) {
      return { ok: false, motivo: 'El campo «Es socio» no se entiende (usa Sí o No).' }
    }
    const diasRaw = parseNumero(valores.dias_laborables)
    if (diasRaw === undefined) return { ok: false, motivo: 'Los días laborables no son un número.' }
    if (diasRaw !== null && (diasRaw <= 0 || diasRaw > 31)) {
      return { ok: false, motivo: 'Los días laborables deben estar entre 1 y 31.' }
    }

    const campos = construirCamposEmpleado({
      nombre,
      es_socio:        socioRaw === null ? undefined : socioRaw,
      dias_laborables: deColumna.has('dias_laborables') ? diasRaw : undefined,
      apellidos:        valores.apellidos,
      documento:        valores.documento,
      fecha_nacimiento,
      telefono:         valores.telefono,
      email:            valores.email,
      direccion:        valores.direccion,
      cargo:            valores.cargo,
      departamento:     valores.departamento,
      turno:            valores.turno,
      tipo_contrato:    (valores.tipo_contrato ?? '').trim().toUpperCase(),
      fecha_alta,
      salario_base:     salario,
      periodicidad:     (valores.periodicidad ?? '').trim().toUpperCase(),
      notas:            valores.notas,
    })

    // `vacaciones_apertura` se añade AQUÍ y no en `construirCamposEmpleado`, que lo
    // comparte el formulario de Personal: si viviera ahí, guardar la ficha a mano
    // mandaría un 0 y borraría en silencio el saldo que trajo el archivo.
    const datos = {
      ...campos, empresa_id, moneda,
      vacaciones_apertura: vacaciones ?? 0,
    }
    const documento = campos.documento
    return {
      ok: true,
      datos,
      clave: documento
        ? `${empresa_id}|doc|${norm(documento)}`
        : `${empresa_id}|nom|${norm(nombre)} ${norm(campos.apellidos ?? '')}`.trim(),
      // `empresa_id` no está: es el ámbito con el que se encontró la ficha, no
      // un dato a reescribir. Un archivo que solo trae el cargo no puede dejar
      // el salario a 0 ni mover la fecha de alta a hoy.
      provistos: camposProvistos(deColumna, {
        nombre:           'nombre',
        apellidos:        'apellidos',
        documento:        'documento',
        fecha_nacimiento: 'fecha_nacimiento',
        telefono:         'telefono',
        email:            'email',
        direccion:        'direccion',
        cargo:            'cargo',
        departamento:     'departamento',
        turno:            'turno',
        tipo_contrato:    'tipo_contrato',
        fecha_alta:       'fecha_alta',
        salario_base:     'salario_base',
        periodicidad:     'periodicidad',
        notas:            'notas',
        moneda:           'moneda',
        // Sin esta entrada, reimportar Personal con solo el nombre y el cargo pondría a
        // 0 el saldo de apertura de toda la plantilla: es la regla «ACTUALIZAR no vacía
        // — solo se escriben las columnas que trae el archivo».
        vacaciones_apertura: 'vacaciones_apertura',
        es_socio:            'es_socio',
        dias_laborables:     'dias_laborables',
      }),
    }
  },

  async buscarExistente(datos, ctx) {
    const d = datos as { empresa_id: string; documento: string | null; nombre: string; apellidos: string | null }
    let q = ctx.db.from('empleados').select('empleado_id')
      .eq('client_id', ctx.client_id).eq('empresa_id', d.empresa_id)
    if (d.documento) {
      q = q.eq('documento', d.documento)
    } else {
      q = q.ilike('nombre', d.nombre)
      q = d.apellidos ? q.ilike('apellidos', d.apellidos) : q.is('apellidos', null)
    }
    const { data } = await q.limit(1).maybeSingle()
    return (data?.empleado_id as string) ?? null
  },

  async insertar(datos, ctx) {
    const empleado_id = generarEmpleadoId()
    const { error } = await ctx.db.from('empleados').insert({
      empleado_id, client_id: ctx.client_id, created_at: new Date().toISOString(), ...datos,
    })
    if (error) throw new Error(error.message)
    return empleado_id
  },

  async actualizar(id, datos, ctx) {
    const { error } = await ctx.db.from('empleados').update(datos)
      .eq('empleado_id', id).eq('client_id', ctx.client_id)
    if (error) throw new Error(error.message)
  },

  // Se borra la ficha solo si nadie la usa: con una nómina, un contrato o un
  // turno detrás, deshacer dejaría huérfano el histórico laboral.
  async deshacer(pk, ctx) {
    const dep = await primeraDependencia(ctx, pk, [
      { tabla: 'nomina_lineas',      columna: 'empleado_id', etiqueta: 'líneas de nómina' },
      { tabla: 'contratos',          columna: 'empleado_id', etiqueta: 'contratos' },
      { tabla: 'conceptos_empleado', columna: 'empleado_id', etiqueta: 'conceptos fijos' },
      { tabla: 'turno_asignaciones', columna: 'empleado_id', etiqueta: 'turnos asignados' },
      { tabla: 'recursos',           columna: 'empleado_id', etiqueta: 'fichas de agenda' },
    ])
    if (dep) return dep
    const { error } = await ctx.db.from('empleados').delete()
      .eq('empleado_id', pk).eq('client_id', ctx.client_id)
    return error ? error.message : null
  },
}
