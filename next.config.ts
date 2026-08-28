import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '12mb',
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
    return ['menu', 'carta', 'servicios'].map((vista) => ({
      source: `/:slug/${vista}`,
      destination: '/:slug/catalogo',
    }))
  },
};

export default nextConfig;
