// Tipos compartidos de la capa pública (landing + diagnóstico).
// Sin imports de servidor: los puede usar tanto un Server Component como el
// formulario cliente (el loader real vive en catalogo.ts).
import type { EtiquetasSector } from '@/lib/sector'

export type { EtiquetasSector }

export interface ModuloPublico {
  clave: string
  nombre: string
  descripcion: string
  tipo: string // modulo | addon | funcionalidad (la contabilidad es un modulo, clave 'base')
  mostrarEnLanding: boolean // se muestra en la grilla "Módulos" de la landing
}

export interface SectorPublico {
  sector: string
  nombre: string
  modulos: string[] // claves de módulo sugeridas para el sector
  etiquetas: EtiquetasSector
}

// Necesidad del diagnóstico: opción en lenguaje del cliente (curada desde
// /admin/diagnostico) que mapea a uno o varios módulos del catálogo.
export interface NecesidadPublica {
  clave: string
  etiqueta: string
  descripcion: string
  icono: string
  modulos: string[] // claves de modulos_catalogo que cubre esta necesidad
}

// Un nivel comercial tal y como se enseña fuera: nombre y descripción editables
// desde /admin/niveles, y sus topes ya resueltos. `null` en un límite = sin tope.
// Las claves de `limites` son las dimensiones (`empresas`, `productos`…); se deja
// como Record<string, …> a propósito, para que este fichero siga sin importar
// nada del motor de límites.
export interface NivelPublico {
  clave: string
  nombre: string
  descripcion: string
  limites: Record<string, number | null>
}

export interface CatalogoPublico {
  modulos: ModuloPublico[]
  sectores: SectorPublico[]
  necesidades: NecesidadPublica[]
  niveles: NivelPublico[]
}
