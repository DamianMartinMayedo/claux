import '@/app/styles/entrada-gestion.css'
import BrandFonts from '@/components/BrandFonts'

// Design system + fuentes de marca para TODO el árbol /portal: (app) (shell del
// dueño), /portal/login y /portal/pdf. La hoja no va en el root layout (así las
// rutas públicas no cargan el CSS del ERP; regla de públicas, CONTEXTO §3), y es
// la de gestión: sin los parciales de la landing ni de la Academia, que el portal
// no pinta.
export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
