// Iconos compartidos de la capa pública (landing + diagnóstico).
// Los SVG NO viven en la BD: aquí mapeamos clave de sector / módulo → icono,
// con un FALLBACK para claves nuevas (un módulo recién creado en el catálogo
// aparece con icono genérico hasta que se le asigne uno). Así el embudo sigue
// siendo flexible al contenido sin acoplar arte a los datos.
import type { ComponentType, ReactNode } from 'react'

export interface IconProps {
  size?: number
}

function Svg({ size = 24, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/* ── Sectores ── */
export const UtensilsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
    <path d="M7 2v20" />
    <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
  </Svg>
)
export const CoffeeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h12Z" />
    <path d="M16 8h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2" />
  </Svg>
)
export const WineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 22h8M12 15v7M5 3h14l-1 6a6 6 0 0 1-12 0L5 3Z" />
    <path d="M5.5 6h13" />
  </Svg>
)
export const ScissorsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="3" />
    <path d="M8.12 8.12 12 12" />
    <path d="M20 4 8.12 15.88" />
    <circle cx="6" cy="18" r="3" />
    <path d="M14.8 14.8 20 20" />
  </Svg>
)
export const SparklesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" />
    <path d="M19 14l.8 2L22 16.8l-2.2.8L19 20l-.8-2.4L16 16.8l2.2-.8L19 14Z" />
  </Svg>
)
export const HeartPulseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7 2.5-2.5" />
    <path d="M3.5 12h3l2-3 2.5 5 1.5-2.5h3" />
  </Svg>
)
export const DumbbellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 6.5h11v11H6.5z" />
    <path d="M3 7.5h3.5v9H3zM17.5 7.5H21v9h-3.5z" />
  </Svg>
)
export const KeyIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="M10.7 12.3 21 2M16 7l3 3M14 9l2 2" />
  </Svg>
)
export const StoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4M2 7h20" />
  </Svg>
)
export const BriefcaseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </Svg>
)

/* ── Módulos ── */
export const CalculatorIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h4M8 18h.01M12 18h.01" />
  </Svg>
)
export const PackageIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
  </Svg>
)
export const UsersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
)
export const AiChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    <path d="M12 8l.7 1.8 1.8.7-1.8.7L12 13l-.7-1.8-1.8-.7 1.8-.7L12 8Z" />
  </Svg>
)
export const BuildingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 21h18M5 21V7l6-4v18M19 21V11l-6-4" />
    <path d="M8 9h.01M8 12h.01M8 15h.01" />
  </Svg>
)
export const QrIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM21 14v7M17 21h4M14 21h0" />
  </Svg>
)
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </Svg>
)
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </Svg>
)
export const FileTextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" />
  </Svg>
)
export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 2 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
  </Svg>
)

/* ── Mapas clave → icono (con fallback) ── */
type IconCmp = ComponentType<IconProps>

const SECTOR_ICONS: Record<string, IconCmp> = {
  restaurante: UtensilsIcon,
  cafeteria: CoffeeIcon,
  bar: WineIcon,
  peluqueria: ScissorsIcon,
  barberia: ScissorsIcon,
  estetica: SparklesIcon,
  clinica: HeartPulseIcon,
  gimnasio: DumbbellIcon,
  alquiler: KeyIcon,
  tienda: StoreIcon,
  servicios: BriefcaseIcon,
}

const MODULO_ICONS: Record<string, IconCmp> = {
  base: CalculatorIcon,
  inventario: PackageIcon,
  rrhh: UsersIcon,
  asistente_ia: AiChatIcon,
  multiempresa: BuildingsIcon,
  catalogo_qr: QrIcon,
  reservas_citas: CalendarIcon,
  agenda: ClockIcon,
  documentos_imprenta: FileTextIcon,
}

/** Color de la tarjeta de módulo en la landing (clases del design system). */
const MODULO_COLOR: Record<string, string> = {
  base: 'ld-module-icon-teal',
  inventario: 'ld-module-icon-amber',
  rrhh: 'ld-module-icon-indigo',
  asistente_ia: 'ld-module-icon-purple',
  multiempresa: 'ld-module-icon-indigo',
  catalogo_qr: 'ld-module-icon-green',
  reservas_citas: 'ld-module-icon-purple',
  agenda: 'ld-module-icon-rose',
  documentos_imprenta: 'ld-module-icon-amber',
}

export function iconoSector(sector: string): IconCmp {
  return SECTOR_ICONS[sector] ?? BriefcaseIcon
}

export function iconoModulo(clave: string): IconCmp {
  return MODULO_ICONS[clave] ?? LayersIcon
}

export function colorModulo(clave: string): string {
  return MODULO_COLOR[clave] ?? 'ld-module-icon-teal'
}

/* ── Necesidades del diagnóstico ──
   La clave de icono se elige desde /admin/diagnostico; aquí la resolvemos a un
   SVG, con fallback genérico para claves desconocidas. */
const NECESIDAD_ICONS: Record<string, IconCmp> = {
  inventario: PackageIcon,
  reservas: CalendarIcon,
  agenda: ClockIcon,
  catalogo: QrIcon,
  empleados: UsersIcon,
  chat: AiChatIcon,
  documentos: FileTextIcon,
  contabilidad: CalculatorIcon,
  generico: LayersIcon,
}

/** Opciones de icono que el admin puede asignar a una necesidad. */
export const ICONOS_NECESIDAD: { clave: string; label: string }[] = [
  { clave: 'inventario', label: 'Inventario / paquete' },
  { clave: 'reservas', label: 'Calendario' },
  { clave: 'agenda', label: 'Reloj / citas' },
  { clave: 'catalogo', label: 'Código QR' },
  { clave: 'empleados', label: 'Personas' },
  { clave: 'chat', label: 'Chat / IA' },
  { clave: 'documentos', label: 'Documento' },
  { clave: 'contabilidad', label: 'Calculadora' },
  { clave: 'generico', label: 'Genérico' },
]

export function iconoNecesidad(icono: string | null | undefined): IconCmp {
  return (icono && NECESIDAD_ICONS[icono]) || LayersIcon
}
