import '@/app/styles/entrada-marca.css'
import BrandFonts from '@/components/BrandFontsSinCursiva'

// La landing de CLAUX usa el design system (tokens, .btn, degradado de marca) y las
// fuentes de marca. La hoja se carga aquí y no en el root layout (regla de públicas
// por-negocio, CONTEXTO §3 — la landing es marketing propio, no una mini-web de
// negocio, y sí puede usar el sistema). Es la hoja de marca: base + landing, sin el
// CSS del portal, del admin ni de la Academia.
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
