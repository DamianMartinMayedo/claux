import '@/app/styles/entrada-gestion.css'
import BrandFonts from '@/components/BrandFonts'

// Carga el design system de gestión + fuentes de marca para TODO el árbol /admin
// (login incluido). La hoja no se importa en el root layout: cada superficie carga
// la suya para que las rutas públicas queden libres de su peso (regla de públicas,
// CONTEXTO §3). El admin comparte hoja con el portal porque comparte casi todo:
// tablas, formularios, modales y la actividad.
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
