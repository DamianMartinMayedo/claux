import '@/app/globals.css'
import BrandFonts from '@/components/BrandFonts'

// Carga el design system del portal + fuentes de marca para TODO el árbol /admin
// (login incluido). globals.css ya NO se importa en el root layout: cada superficie
// interna lo carga aquí para que las rutas públicas queden libres de su peso
// (regla de públicas, CONTEXTO §3).
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
