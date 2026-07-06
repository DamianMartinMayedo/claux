-- Renombrar la funcionalidad "Catálogo QR" → "Catálogo digital" (sin jerga QR en
-- el nombre; el QR es solo una de las formas de compartir el enlace). La etiqueta
-- visible del menú lateral vive en modulos_catalogo.paginas (JSONB), ver mig. 024.

UPDATE modulos_catalogo
SET nombre = 'Catálogo digital + mini-web',
    paginas = '[
  {"ruta": "/portal/catalogo", "label": "Catálogo digital", "orden": 0}
]'::jsonb
WHERE clave = 'catalogo_qr';
