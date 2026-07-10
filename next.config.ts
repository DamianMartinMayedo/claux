import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp se usa vía import() dinámico en src/lib/imagen/optimizar.ts (server-only,
  // catálogo). Sin esto, el bundler intenta empaquetarlo y su binario nativo /
  // los Buffer que devuelve llegan corruptos en producción (Vercel): el WebP
  // resultante queda con bytes inválidos sustituidos por el carácter de
  // reemplazo UTF-8 (confirmado con sharp corriendo fuera del bundle: limpio).
  serverExternalPackages: ["sharp"],
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
};

export default nextConfig;
