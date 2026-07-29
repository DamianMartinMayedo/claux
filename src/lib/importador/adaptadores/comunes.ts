// Defaults globales que comparten varias entidades (empresa, moneda). El
// asistente los pide una vez por lote y rellenan las celdas vacías del CSV.

import { ROLES_PL, ROL_PL_AYUDA, ROL_PL_LABEL, esRolPL, type RolPL } from '@/lib/pl/estado'
import type { AccionResolucion, DefaultDef } from '../tipos'

/** Empresa a la que pertenece todo el archivo. Siempre obligatoria. */
export const defEmpresa: DefaultDef = {
  campo:       'empresa_id',
  etiqueta:    'Empresa',
  obligatorio: true,
  ayuda:       'Todas las filas del archivo se crean en esta empresa.',
  opciones:    async ctx => ctx.empresas.map(e => ({ valor: e.empresa_id, etiqueta: e.nombre })),
}

/**
 * Qué hacer con el cliente/proveedor que el archivo nombra y no existe todavía
 * como tercero. El archivo del cliente casi nunca viene en el orden en que se
 * importa, así que rechazar la fila por eso tiraba un histórico entero por una
 * ficha que falta.
 */
export const CAMPO_TERCERO_FALTANTE = 'tercero_faltante'

/**
 * Lee la política del lote; sin ella, crear (es lo que hace avanzar el trabajo).
 * Es el DEFECTO del resolutor: solo se aplica a los nombres que no se parecen a
 * nada, porque con un candidato al lado se pregunta (§`resolver.ts`).
 */
export function politicaTercero(valores: Record<string, string>): AccionResolucion {
  const v = (valores[CAMPO_TERCERO_FALTANTE] ?? '').trim().toUpperCase()
  return v === 'VACIO' ? 'OMITIR' : v === 'RECHAZAR' ? 'RECHAZAR' : 'CREAR'
}

/**
 * El desplegable de esa política. `etiqueta` = «proveedor» o «cliente»; `notas`
 * dice si la entidad puede guardar el nombre perdido en sus notas (los gastos y
 * cobros sí, una ficha de producto no).
 */
export function defTerceroFaltante(etiqueta: string, notas = false): DefaultDef {
  return {
    campo:       CAMPO_TERCERO_FALTANTE,
    etiqueta:    `Si el ${etiqueta} no existe`,
    obligatorio: true,
    valor:       'CREAR',
    ayuda:       'La ficha nueva se crea solo con el nombre; lo demás se completa después en Clientes y proveedores. Deshacer la importación también se las lleva.',
    opciones:    async () => [
      { valor: 'CREAR',    etiqueta: 'Crear su ficha' },
      { valor: 'VACIO',    etiqueta: `Dejar el ${etiqueta} vacío${notas ? ' (el nombre queda en las notas)' : ''}` },
      { valor: 'RECHAZAR', etiqueta: 'Rechazar la fila' },
    ],
  }
}

// ── Categorías que el archivo nombra y no existen ─────────────────────────────
// Misma política que el tercero, y por el mismo motivo: el archivo del cliente
// trae las categorías escritas a su manera y rechazar la fila por eso tira un
// histórico de 400 gastos. Con la categoría es peor que con el tercero, además,
// porque es OBLIGATORIA: sin ella la fila no entra de ninguna forma.

export const CAMPO_CATEGORIA_FALTANTE = 'categoria_faltante'
export const CAMPO_ROL_NUEVAS         = 'rol_nuevas'

/** Política del lote para la categoría que falta; sin ella, crearla. */
export function politicaCategoria(valores: Record<string, string>): AccionResolucion {
  return (valores[CAMPO_CATEGORIA_FALTANTE] ?? '').trim().toUpperCase() === 'RECHAZAR'
    ? 'RECHAZAR' : 'CREAR'
}

/** Papel en el estado de resultados con el que nacen las categorías del lote. */
export function rolNuevas(valores: Record<string, string>): RolPL {
  const v = (valores[CAMPO_ROL_NUEVAS] ?? '').trim().toUpperCase()
  return esRolPL(v) ? v : 'OPERATIVO'
}

export function defCategoriaFaltante(etiqueta = 'categoría'): DefaultDef {
  return {
    campo:       CAMPO_CATEGORIA_FALTANTE,
    etiqueta:    `Si la ${etiqueta} no existe`,
    obligatorio: true,
    valor:       'CREAR',
    ayuda:       'Si el nombre se parece a una que ya tienes, no se crea nada: se te pregunta en el paso de revisar.',
    opciones:    async () => [
      { valor: 'CREAR',    etiqueta: `Crear la ${etiqueta}` },
      { valor: 'RECHAZAR', etiqueta: 'Rechazar la fila' },
    ],
  }
}

/**
 * Dónde caen en el informe las categorías de gasto que cree el lote. Se pregunta
 * porque no preguntarlo era decidirlo a la espalda del dueño: nacían todas como
 * «Gastos operativos», así que un histórico de compras importado se salía del
 * coste de ventas y el margen bruto del estado de resultados quedaba inflado.
 */
export const defRolNuevas: DefaultDef = {
  campo:       CAMPO_ROL_NUEVAS,
  etiqueta:    'Las categorías nuevas cuentan como',
  obligatorio: false,
  valor:       'OPERATIVO',
  ayuda:       `${ROL_PL_AYUDA.OPERATIVO} Se puede cambiar después en Gastos → Categorías.`,
  opciones:    async () => ROLES_PL.map(r => ({ valor: r, etiqueta: ROL_PL_LABEL[r] })),
}

// ── Servicio que el archivo nombra y no existe ────────────────────────────────
// Misma idea que el tercero, pero sin la opción de dejarlo vacío: una línea de
// suscripción sin servicio no tiene sentido (a diferencia del proveedor de un
// producto, que es opcional).

export const CAMPO_SERVICIO_FALTANTE = 'servicio_faltante'

/** Política del lote para el servicio que falta; sin ella, crearlo. */
export function politicaServicio(valores: Record<string, string>): AccionResolucion {
  return (valores[CAMPO_SERVICIO_FALTANTE] ?? '').trim().toUpperCase() === 'RECHAZAR'
    ? 'RECHAZAR' : 'CREAR'
}

export function defServicioFaltante(): DefaultDef {
  return {
    campo:       CAMPO_SERVICIO_FALTANTE,
    etiqueta:    'Si el servicio no existe',
    obligatorio: true,
    valor:       'CREAR',
    ayuda:       'La ficha nueva se crea solo con el nombre y el precio de esa línea; lo demás se completa después en Servicios.',
    opciones:    async () => [
      { valor: 'CREAR',    etiqueta: 'Crear el servicio' },
      { valor: 'RECHAZAR', etiqueta: 'Rechazar la fila' },
    ],
  }
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
