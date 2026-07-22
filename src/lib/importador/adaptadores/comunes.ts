// Defaults globales que comparten varias entidades (empresa, moneda). El
// asistente los pide una vez por lote y rellenan las celdas vacías del CSV.

import type { DefaultDef } from '../tipos'

/** Empresa a la que pertenece todo el archivo. Siempre obligatoria. */
export const defEmpresa: DefaultDef = {
  campo:       'empresa_id',
  etiqueta:    'Empresa',
  obligatorio: true,
  ayuda:       'Todas las filas del archivo se crean en esta empresa.',
  opciones:    async ctx => ctx.empresas.map(e => ({ valor: e.empresa_id, etiqueta: e.nombre })),
}

/** Moneda por defecto. `campo` cambia según la entidad (moneda / moneda_defecto). */
export function defMoneda(campo: string, obligatorio: boolean, ayuda?: string): DefaultDef {
  return {
    campo,
    etiqueta: 'Moneda',
    obligatorio,
    ayuda,
    opciones: async ctx => ctx.monedas.map(m => ({ valor: m, etiqueta: m })),
  }
}
