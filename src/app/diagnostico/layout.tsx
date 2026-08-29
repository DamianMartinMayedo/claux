import '@/app/styles/entrada-marca.css'
import BrandFonts from '@/components/BrandFontsSinCursiva'

// El diagnóstico (embudo de captación) usa el design system y las fuentes de marca.
// La hoja se carga aquí, no en el root layout (regla de públicas, CONTEXTO §3); es la
// de marca, que es donde vive el formulario (.dg-*), junto a la landing y los legales.
export default function DiagnosticoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
