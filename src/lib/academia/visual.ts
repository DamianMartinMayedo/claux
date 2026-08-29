import { Bell, Building2, DollarSign, Layers, LayoutDashboard, Users, type LucideIcon } from 'lucide-react'
import { iconoModulo, colorModulo, type ColorModulo } from '@/components/publico/iconos'

/**
 * Cara visible de cada ficha del catálogo: su icono y su acento de color.
 *
 * No se inventa nada aquí. Las doce fichas que se venden tienen `clave` en
 * `modulos_catalogo`, así que su icono y su color salen del **mismo mapa que la
 * landing y el menú del portal** (`components/publico/iconos.tsx`): quien vio un
 * módulo en la web pública lo reconoce en el manual y luego en el producto. Si
 * mañana cambia el icono de un módulo, cambia en los tres sitios a la vez.
 *
 * Lo único propio son las fichas SIN clave: las cuatro transversales (no se
 * contratan) y las dos de capacidad (fueron los addons Multiempresa y
 * Multidossier, y hoy las da el nivel). Su icono se copia del menú del portal
 * —donde el lector las ha visto— y las dos de capacidad conservan el que tenían
 * de addon, para que la ficha no cambie de cara al cambiar de categoría.
 */

type Cara = { Icono: LucideIcon; acento: ColorModulo }

/** Sin clave de catálogo, pero con sitio en el portal. */
const SIN_CLAVE: Record<string, Cara> = {
  'monedas-y-tasas':        { Icono: DollarSign,      acento: 'green' },
  'clientes-y-proveedores': { Icono: Users,           acento: 'indigo' },
  dashboard:                { Icono: LayoutDashboard, acento: 'teal' },
  notificaciones:           { Icono: Bell,            acento: 'amber' },
  'varias-empresas':        { Icono: Building2,       acento: 'indigo' },
  'varios-dossiers':        { Icono: Layers,          acento: 'rose' },
}

export function caraDe(slug: string, clave?: string): Cara {
  if (clave) return { Icono: iconoModulo(clave), acento: colorModulo(clave) }
  return SIN_CLAVE[slug] ?? { Icono: LayoutDashboard, acento: 'teal' }
}
