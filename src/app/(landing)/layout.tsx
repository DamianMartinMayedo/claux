import '@/app/globals.css'
import BrandFonts from '@/components/BrandFonts'

// La landing de CLAUX usa el design system (tokens, .btn, degradado de marca) y las
// fuentes de marca. globals.css ya NO va en el root layout: se carga aquí (regla de
// públicas por-negocio, CONTEXTO §3 — la landing es marketing propio, no una mini-web
// de negocio, y sí puede usar el sistema completo).
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
