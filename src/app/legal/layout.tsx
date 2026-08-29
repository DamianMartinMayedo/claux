import '@/app/styles/entrada-marca.css'
import BrandFonts from '@/components/BrandFontsSinCursiva'

// Las páginas legales son marketing propio de CLAUX (como la landing y el
// diagnóstico), así que usan el design system completo y las fuentes de marca.
// La hoja no va en el root layout: la carga cada superficie.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
