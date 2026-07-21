-- ================================================================
-- MIGRACIÓN 120: Fase G del módulo Servicios — qué baja al punto de venta
--
-- Hasta hoy el seed del dispositivo llevaba un `.eq('tipo','PRODUCTO')` FIJO, con este
-- comentario textual: «Los servicios se deciden más adelante; de momento no bajan al
-- dispositivo». Esto es ese más adelante: lo decide el dueño por caja, porque un
-- mostrador y una peluquería no venden lo mismo.
--
-- `tipos_catalogo`: PRODUCTO | SERVICIO | AMBOS. Mismo vocabulario y mismo wording que
-- el selector de importación del catálogo QR (`TipoImportacion`), para no inventar un
-- segundo idioma para la misma pregunta.
--
-- **Default 'PRODUCTO' a propósito:** es exactamente lo que hacen hoy las cajas
-- existentes. Una migración que cambie sola lo que se ofrece en un mostrador en marcha
-- sería una sorpresa, no una mejora — quien quiera servicios los activa.
--
-- Ver docs/planes/modulo-servicios.md (Fase G).
-- ================================================================

ALTER TABLE cajas
  ADD COLUMN IF NOT EXISTS tipos_catalogo text NOT NULL DEFAULT 'PRODUCTO';

ALTER TABLE cajas
  DROP CONSTRAINT IF EXISTS cajas_tipos_catalogo_chk;
ALTER TABLE cajas
  ADD CONSTRAINT cajas_tipos_catalogo_chk
  CHECK (tipos_catalogo IN ('PRODUCTO', 'SERVICIO', 'AMBOS'));

NOTIFY pgrst, 'reload schema';
