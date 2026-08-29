import type { Metadata } from 'next'
import '@/app/styles/entrada-academia.css'
import BrandFonts from '@/components/BrandFonts'
import { MARCA_LARGA } from '@/lib/academia/marca'

/**
 * Superficie propia de la Academia: se abre como «otra web», sin barra lateral,
 * sin cabecera de admin, sin botón de volver. Solo el design system de CLAUX, en
 * su hoja de contenido: base + la cabecera/pie públicos + la Academia.
 */

export const metadata: Metadata = {
  title: MARCA_LARGA,
  robots: { index: false, follow: false },
}

export default function AcademiaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
