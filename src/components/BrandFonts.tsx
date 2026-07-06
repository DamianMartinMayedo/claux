// Fuentes de marca: Bricolage Grotesque (display) + IBM Plex Sans (body).
// Se cargan SOLO en las superficies internas (admin/portal) y de marketing
// (landing/diagnóstico). NUNCA en las rutas públicas por-negocio (menú/reservar/
// citas): esas usan system-ui para no descargar fuentes web (regla de públicas,
// CONTEXTO §3 / skills/ui/SKILL.md §6). React 19 sube estos <link> al <head>.
export default function BrandFonts() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=IBM+Plex+Sans:ital,wght@0,100..700;1,100..700&display=swap"
        rel="stylesheet"
      />
    </>
  )
}
