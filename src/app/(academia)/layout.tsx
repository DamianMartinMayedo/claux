import type { Metadata } from 'next'
import '@/app/globals.css'
import BrandFonts from '@/components/BrandFonts'
import { MARCA_LARGA } from '@/lib/academia/marca'

/**
 * Superficie propia de la Academia: se abre como «otra web», sin barra lateral,
 * sin cabecera de admin, sin botón de volver. Solo el design system de CLAUX.
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
