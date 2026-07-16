import '@/app/globals.css'
import BrandFonts from '@/components/BrandFonts'

// Las páginas legales son marketing propio de CLAUX (como la landing y el
// diagnóstico), así que usan el design system completo y las fuentes de marca.
// globals.css no va en el root layout: lo carga cada superficie interna.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
