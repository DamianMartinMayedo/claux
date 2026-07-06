import '@/app/globals.css'
import BrandFonts from '@/components/BrandFonts'

// El diagnóstico (embudo de captación) usa el design system y las fuentes de marca.
// globals.css se carga aquí, no en el root layout (regla de públicas, CONTEXTO §3).
export default function DiagnosticoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
