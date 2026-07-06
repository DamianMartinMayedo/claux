import '@/app/globals.css'
import BrandFonts from '@/components/BrandFonts'

// Design system + fuentes de marca para TODO el árbol /portal: (app) (shell del
// dueño), /portal/login y /portal/pdf. globals.css ya NO va en el root layout
// (así las rutas públicas no cargan el CSS del ERP; regla de públicas, CONTEXTO §3).
export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
