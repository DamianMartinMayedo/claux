// Adaptador de importación de PROFESIONALES (módulo `agenda`, las citas): la
// persona o el recurso al que se le pide cita (un barbero, una estilista, una
// sala). Escribe en `recursos`.
//
// Alcance deliberado: solo IDENTIDAD (nombre y tipo). El resto de la ficha
// —servicios que da, horarios, ausencias, vínculo con un empleado de RRHH— se
// configura a mano después: son relaciones (otras tablas) que una hoja de cálculo
// no expresa bien, y montarlas mal aquí sería peor que dejarlas para la ficha.
// `recursos` no tiene columnas de contacto, así que no se piden.

import { camposProvistos, idCorto, norm, parseBooleano, primeraDependencia } from '../util'
import type { Adaptador, Preparado } from '../tipos'

type DatosProfesional = { nombre: string; tipo: string | null; activo: boolean; updated_at: string }

export const adaptadorProfesionales: Adaptador = {
  entidad:   'profesionales',
  etiqueta:  'Profesionales',
  modulos:   ['agenda'],
  revalidar: '/portal/citas',
  defaults: [],
  campos: [
    { campo: 'nombre', etiqueta: 'Nombre', obligatorio: true,  alias: ['nombre', 'profesional', 'recurso', 'persona', 'empleado'], ejemplo: 'Yodalis Pérez' },
    { campo: 'tipo',   etiqueta: 'Tipo',   obligatorio: false, alias: ['tipo', 'rol', 'puesto', 'especialidad', 'cargo'], ayuda: 'Qué es: barbero, estilista, sala… Libre.', ejemplo: 'Barbero' },
    { campo: 'activo', etiqueta: 'Activo', obligatorio: false, alias: ['activo', 'disponible', 'alta'], ayuda: 'Sí / No. Si se deja vacío, se da de alta activo.', ejemplo: 'Sí' },
  ],

  async preparar(valores, ctx, deColumna): Promise<Preparado> {
    const nombre = (valores.nombre ?? '').trim()
    if (!nombre) return { ok: false, motivo: 'Falta el nombre.' }

    const activo = parseBooleano(valores.activo)
    if (activo === undefined) return { ok: false, motivo: 'Activo debe ser Sí o No.' }

    const datos: DatosProfesional = {
      nombre,
      tipo:       (valores.tipo ?? '').trim() || null,
      activo:     activo ?? true,
      updated_at: new Date().toISOString(),
    }
    return {
      ok: true,
      datos,
      clave: `nom|${norm(nombre)}`,
      provistos: camposProvistos(deColumna, { nombre: 'nombre', tipo: 'tipo', activo: 'activo' }),
    }
  },

  async buscarExistente(datos, ctx) {
    const { nombre } = datos as DatosProfesional
    const { data } = await ctx.db.from('recursos').select('recurso_id')
      .eq('client_id', ctx.client_id).ilike('nombre', nombre).limit(1).maybeSingle()
    return (data?.recurso_id as string) ?? null
  },

  async insertar(datos, ctx) {
    const recurso_id = `REC-${idCorto()}`
    const { error } = await ctx.db.from('recursos').insert({
      recurso_id, client_id: ctx.client_id, ...(datos as DatosProfesional),
    })
    if (error) throw new Error(error.message)
    return recurso_id
  },

  async actualizar(id, datos, ctx) {
    const { error } = await ctx.db.from('recursos').update(datos)
      .eq('recurso_id', id).eq('client_id', ctx.client_id)
    if (error) throw new Error(error.message)
  },

  // Se borra solo si nadie lo usa ya: con una cita, una reserva o su agenda ya
  // configurada (servicios, horarios, ausencias) detrás, deshacer dejaría huérfano
  // lo que el usuario montó encima. Igual criterio que el borrado manual.
  async deshacer(pk, ctx) {
    const dep = await primeraDependencia(ctx, pk, [
      { tabla: 'citas',              columna: 'recurso_id', etiqueta: 'citas' },
      { tabla: 'reservas',           columna: 'recurso_id', etiqueta: 'reservas' },
      { tabla: 'recurso_servicios',  columna: 'recurso_id', etiqueta: 'servicios asignados' },
      { tabla: 'recurso_horarios',   columna: 'recurso_id', etiqueta: 'horarios' },
      { tabla: 'recurso_ausencias',  columna: 'recurso_id', etiqueta: 'ausencias' },
    ])
    if (dep) return dep
    const { error } = await ctx.db.from('recursos').delete()
      .eq('recurso_id', pk).eq('client_id', ctx.client_id)
    return error ? error.message : null
  },
}
