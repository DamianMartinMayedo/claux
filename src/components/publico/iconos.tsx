// Iconos compartidos de la capa pública (landing + diagnóstico).
// Los SVG NO viven en la BD: aquí mapeamos clave de sector / módulo → icono,
// con un FALLBACK para claves nuevas (un módulo recién creado en el catálogo
// aparece con icono genérico hasta que se le asigne uno). Así el embudo sigue
// siendo flexible al contenido sin acoplar arte a los datos.
//
// Los iconos son de lucide-react, no dibujados a mano: antes eran paths propios
// —algunos mal trazados— y ya teníamos lucide como dependencia. El mapa de
// iconos del portal (`PortalSidebar.tsx`) es la fuente de verdad: si un módulo
// ya tiene icono allí, aquí se usa el MISMO, para que el usuario reconozca en el
// portal lo que vio en la landing.
import {
  ArrowRight, Boxes, Briefcase, Building2, Calculator, Calendar, Check,
  ChevronDown, Clock, Coffee, Dumbbell, FileText, Flower2, HeartPulse, Key,
  Layers, MessageSquare, Presentation, Printer, Puzzle, QrCode, Scissors,
  Sparkles, Store, Users, UtensilsCrossed, Wine,
  type LucideIcon,
} from 'lucide-react'

export type IconCmp = LucideIcon

/* ── Reexport con los nombres que ya usaba la capa pública ──
   Evita renombrar en los consumidores y deja el mapeo semántico a la vista. */
export const SparklesIcon      = Sparkles
export const CalendarIcon      = Calendar
export const CalculatorIcon    = Calculator
export const AiChatIcon        = MessageSquare
export const ArrowRightIcon    = ArrowRight
export const PuzzleIcon        = Puzzle
export const CheckIcon         = Check
export const ChevronIcon       = ChevronDown
export const CajaIcon          = Store
export const DossierIcon       = Presentation
export const InventarioIcon    = Boxes

/* ── Mapas clave → icono (con fallback) ── */

const SECTOR_ICONS: Record<string, IconCmp> = {
  restaurante: UtensilsCrossed,
  cafeteria:   Coffee,
  bar:         Wine,
  peluqueria:  Scissors,
  barberia:    Scissors,
  estetica:    Flower2,
  clinica:     HeartPulse,
  gimnasio:    Dumbbell,
  alquiler:    Key,
  tienda:      Store,
  servicios:   Briefcase,
}

// Mismos iconos que el sidebar del portal (ver nota de cabecera).
const MODULO_ICONS: Record<string, IconCmp> = {
  base:                Calculator,
  inventario:          Boxes,
  rrhh:                Users,
  asistente_ia:        Sparkles,
  multiempresa:        Building2,
  catalogo_qr:         QrCode,
  reservas_citas:      Calendar,
  agenda:              Clock,
  documentos_imprenta: Printer,
  caja:                Store,
  dossier:             Presentation,
}

/** Acento de color del design system (clases .ld-ac-*). */
export type ColorModulo = 'teal' | 'amber' | 'green' | 'indigo' | 'purple' | 'rose'

/** Acento por sector: que los 11 iconos no sean todos del mismo teal. */
const SECTOR_COLOR: Record<string, ColorModulo> = {
  restaurante: 'amber',
  cafeteria:   'amber',
  bar:         'rose',
  peluqueria:  'purple',
  barberia:    'indigo',
  estetica:    'rose',
  clinica:     'teal',
  gimnasio:    'green',
  alquiler:    'indigo',
  tienda:      'green',
  servicios:   'teal',
}

// El orden de la rejilla (3 col) importa: los colores se eligen para que dos
// tarjetas vecinas no repitan acento.
const MODULO_COLOR: Record<string, ColorModulo> = {
  base:                'teal',
  inventario:          'amber',
  rrhh:                'indigo',
  asistente_ia:        'purple',
  multiempresa:        'indigo',
  catalogo_qr:         'green',
  reservas_citas:      'purple',
  agenda:              'rose',
  documentos_imprenta: 'amber',
  caja:                'teal',
  dossier:             'amber',
}

export function iconoSector(sector: string): IconCmp {
  return SECTOR_ICONS[sector] ?? Briefcase
}

export function iconoModulo(clave: string): IconCmp {
  return MODULO_ICONS[clave] ?? Layers
}

/** Devuelve el nombre del acento; el llamante compone la clase `ld-ac-*`. */
export function colorModulo(clave: string): ColorModulo {
  return MODULO_COLOR[clave] ?? 'teal'
}

export function colorSector(sector: string): ColorModulo {
  return SECTOR_COLOR[sector] ?? 'teal'
}

/* ── Necesidades del diagnóstico ──
   La clave de icono se elige desde /admin/diagnostico; aquí la resolvemos a un
   SVG, con fallback genérico para claves desconocidas. */
const NECESIDAD_ICONS: Record<string, IconCmp> = {
  inventario:   Boxes,
  reservas:     Calendar,
  agenda:       Clock,
  catalogo:     QrCode,
  empleados:    Users,
  chat:         MessageSquare,
  documentos:   FileText,
  contabilidad: Calculator,
  generico:     Layers,
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
  return (icono && NECESIDAD_ICONS[icono]) || Layers
}
