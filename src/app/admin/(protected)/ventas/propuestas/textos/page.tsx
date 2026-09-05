import { requireAccesoPagina } from '@/lib/admin-guard'
import { getSetting } from '@/app/actions/settings'
import { AJUSTES_POR_DEFECTO } from '@/lib/propuesta/armar'
import {
  CLAVES_AJUSTES, lineasDesde, tarjetasDesde, textoDesde,
} from '@/lib/propuesta/ajustes'
import TextosView from './TextosView'

export const dynamic = 'force-dynamic'

/**
 * Los textos que salen igual en todas las propuestas.
 *
 * Viven dentro de la presentación, que es donde se buscan, y no en
 * Configuración: allí eran una pestaña de estado de React, así que ni el enlace
 * del editor podía apuntarlas. El permiso, en cambio, sigue siendo el de
 * Configuración —es un ajuste general, no material de una reunión—, y de ahí
 * sale que el comercial entre a presentar sin poder tocarlos.
 */
export default async function TextosPropuestaPage() {
  const ctx = await requireAccesoPagina('configuracion')

  // Ya resueltos: lo guardado o, si no hay nada, lo del código. El formulario
  // arranca con lo que la propuesta enseña ahora mismo, que es la única forma de
  // editar un texto sabiendo qué cambias.
  const [rawQueEs, rawProblema, rawConfianza, rawEmpecemos, rawPago] = await Promise.all([
    getSetting(CLAVES_AJUSTES.queEs,     ''),
    getSetting(CLAVES_AJUSTES.problema,  ''),
    getSetting(CLAVES_AJUSTES.confianza, ''),
    getSetting(CLAVES_AJUSTES.empecemos, ''),
    getSetting(CLAVES_AJUSTES.pago,      ''),
  ])

  return (
    <TextosView
      textos={{
        queEs:     tarjetasDesde(rawQueEs,     AJUSTES_POR_DEFECTO.queEsTarjetas),
        problema:  lineasDesde(rawProblema,    AJUSTES_POR_DEFECTO.problemaClaux),
        confianza: tarjetasDesde(rawConfianza, AJUSTES_POR_DEFECTO.confianzaTarjetas),
        empecemos: tarjetasDesde(rawEmpecemos, AJUSTES_POR_DEFECTO.empecemosPasos),
        pago:      textoDesde(rawPago,         AJUSTES_POR_DEFECTO.pago),
      }}
      rol={ctx.rol}
      permisos={ctx.permisos}
    />
  )
}
