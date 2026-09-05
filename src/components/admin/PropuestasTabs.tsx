'use client'

import SubTabs from '@/components/SubTabs'
import type { RolAdmin, SeccionKey } from '@/lib/roles'

/**
 * La segunda fila de Propuestas: la presentación es un ENTORNO, no una lista.
 *
 * Dentro viven las tres cosas que la componen —las propuestas, la biblioteca de
 * capturas y los textos que salen igual en todas—, y no repartidas entre el hub
 * de ventas y Configuración, que es donde estaban y por qué no se encontraban.
 *
 * La separación que pide el negocio («el comercial entra a presentar, no a los
 * ajustes generales») no se inventa aquí: sale del permiso que ya tenían los
 * textos —`configuracion`—, que el comercial no lleva.
 *
 * Solo declara rutas y permisos: pintar el segundo nivel es de `<SubTabs>`.
 */
const TABS: { href: string; label: string; key: SeccionKey }[] = [
  { href: '/admin/ventas/propuestas',          label: 'Propuestas', key: 'propuestas' },
  { href: '/admin/ventas/propuestas/capturas', label: 'Capturas',   key: 'propuestas' },
  { href: '/admin/ventas/propuestas/textos',   label: 'Textos',     key: 'configuracion' },
]

export default function PropuestasTabs({ rol, permisos }: { rol: RolAdmin; permisos: SeccionKey[] }) {
  const visibles = TABS.filter(t => rol === 'super_admin' || permisos.includes(t.key))
  return <SubTabs tabs={visibles} ariaLabel="Secciones de la presentación" />
}
