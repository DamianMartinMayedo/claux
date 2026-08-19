// ── Datos legales del proveedor (la parte firmante por CLAUX) ──
//
// Claudia Cuevas Alarcón firma como autónoma en nombre propio (titular del
// proyecto CLAUX). Sus datos legales rellenan el contrato y el NDA. Viven en
// `settings` (editables desde /admin/configuración) y NO en código: el día que
// se constituya CLAUX S.L. o cambie el domicilio, se edita ahí sin desplegar.
//
// El único valor por defecto con contenido es el nombre y el email de contacto,
// que ya son estables; NIF, domicilio, teléfono e IAE arrancan vacíos y la UI de
// configuración los marca como "pendientes de completar" hasta que Claudia los
// rellene.

import { leerSetting } from '@/lib/settings'
import type { DatosProveedor } from './render'

/** Claves de `settings` que guardan los datos del proveedor. */
export const CLAVES_PROVEEDOR = {
  nombre:    'proveedor_nombre',
  nif:       'proveedor_nif',
  domicilio: 'proveedor_domicilio',
  email:     'proveedor_email',
  telefono:  'proveedor_telefono',
  iae:       'proveedor_iae',
} as const

export async function obtenerDatosProveedor(): Promise<DatosProveedor> {
  const [nombre, nif, domicilio, email, telefono, iae] = await Promise.all([
    leerSetting(CLAVES_PROVEEDOR.nombre,    'Claudia Cuevas Alarcón'),
    leerSetting(CLAVES_PROVEEDOR.nif,       ''),
    leerSetting(CLAVES_PROVEEDOR.domicilio, ''),
    leerSetting(CLAVES_PROVEEDOR.email,     'contacto@claux.es'),
    leerSetting(CLAVES_PROVEEDOR.telefono,  ''),
    leerSetting(CLAVES_PROVEEDOR.iae,       ''),
  ])
  return { nombre, nif, domicilio, email, telefono, iae }
}

/** Frase de identificación del proveedor para la cláusula "Partes". Solo incluye
 *  los datos que estén completos, para no dejar "con NIF" seguido de un hueco. */
export function identificacionProveedor(p: DatosProveedor): string {
  const extras: string[] = []
  if (p.nif)       extras.push(`con NIF ${p.nif}`)
  if (p.domicilio) extras.push(`y domicilio en ${p.domicilio}`)
  const cola = extras.length ? `, ${extras.join(' ')}` : ''
  return `${p.nombre}, actuando en nombre propio como profesional autónoma en España${cola}, `
    + 'titular del proyecto CLAUX (en adelante, «CLAUX» o «el Proveedor»), y que en el futuro '
    + 'podrá ceder su posición contractual a CLAUX S.L. una vez constituida dicha sociedad, '
    + 'mediante simple notificación al Cliente.'
}
