/**
 * La URL pública de esta instalación, sin barra final.
 *
 * Las URLs absolutas hacen falta donde una relativa no vale: el sitemap, los
 * canónicos y los datos estructurados que lee un buscador. En producción viene
 * de `NEXT_PUBLIC_SITE_URL`; el valor por defecto es el dominio real para que un
 * despliegue sin esa variable no publique enlaces a `localhost`.
 */
export const SITIO = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://claux.es').replace(/\/$/, '')
