import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Techo de plataforma para TODA server action. Tiene que quedar por ENCIMA del
    // archivo legítimo más grande, porque salta ANTES que la validación de cada
    // acción: pasarse aquí no da «el PDF no puede superar 4 MB», da un error genérico.
    //
    // El peor payload legítimo de hoy es el importador: 5 MB de archivo en xlsx, que
    // viaja en base64 (≈ 4/3 del tamaño real) → 6,7 MB. PDFs e imágenes topan a 4 MB
    // y van en FormData, 1:1. Con 8 MB no queda ningún hueco por el que un archivo
    // aceptado muera con el error genérico en vez de con su aviso.
    // Si algún día sube un tope de esos, sube este primero.
    serverActions: {
      bodySizeLimit: '8mb',
    },
  },
  // Chromium headless (PDF del deck en móvil): binarios nativos que NO deben
  // pasar por el bundler; se cargan desde node_modules en runtime Node.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  // El binario de Chromium (bin/*.br) lo lee @sparticuz por FS en runtime, no con
  // import, así que el tracer de Vercel NO lo empaqueta y executablePath() peta con
  // 500. Hay que forzar su inclusión en la función de la ruta del PDF.
  outputFileTracingIncludes: {
    '/d/[token]/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    // El manual de la Academia son .md que se leen por FS en runtime (no con
    // import), así que el tracer tampoco los empaqueta: en Vercel las fichas
    // saldrían «en preparación» y en local no se nota, porque hay disco real.
    // El glob cubre también las rutas hijas —la pieza suelta y el manual
    // entero—, que los leen igual.
    '/academia': ['./content/academia/**'],
    '/academia/**': ['./content/academia/**'],
    // El centro de ayuda público lee LOS MISMOS .md (es el manual filtrado por la
    // capa `cliente`), así que necesita el mismo trazado. El sitemap también: sale
    // de los archivos que sí tienen texto para un cliente, y sin ellos anunciaría
    // cero URLs — o peor, unas que dan 404.
    '/ayuda': ['./content/academia/**'],
    '/ayuda/**': ['./content/academia/**'],
    '/sitemap.xml': ['./content/academia/**'],
  },
  images: {
    // Logos de empresas servidos desde Supabase Storage (bucket público).
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async rewrites() {
    // El menú/catálogo público usa una URL acorde al negocio (/menu, /carta,
    // /servicios) que sirve la misma página que /catalogo (ruta física canónica).
    // Los enlaces y QR de /catalogo ya compartidos siguen funcionando igual.
    //
    // El `:slug` es el del NEGOCIO, así que hay que decirle cuáles no lo son:
    // sin este filtro `/academia/servicios` —la ficha del módulo Servicios— se
    // reescribía a `/academia/catalogo`, que no existe, y daba un 404 que no
    // salía de la Academia sino de aquí. Se compara el segmento ENTERO (de ahí
    // la barra dentro del lookahead) para no dejar fuera a un negocio que se
    // llame `academia-de-baile`. Toda sección nueva de primer nivel que pueda
    // tener un hijo `menu`, `carta` o `servicios` se añade a esta lista.
    const RESERVADOS = [
      'academia', 'ayuda', 'partners', 'admin', 'api', 'diagnostico', 'legal', 'd', 'punto-de-venta',
    ]
    const negocio = `((?!(?:${RESERVADOS.join('|')})/)[^/]+)`
    return ['menu', 'carta', 'servicios'].map((vista) => ({
      source: `/:slug${negocio}/${vista}`,
      destination: '/:slug/catalogo',
    }))
  },
};

export default nextConfig;
