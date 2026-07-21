-- ================================================================
-- MIGRACIÓN 119: Fase F del módulo Servicios — Citas ↔ catálogo
--
-- Citas tiene su propia tabla `servicios` (SER-, mig. 052) sin relación con el
-- catálogo `products`. El negocio mantiene la misma lista dos veces sin saberlo, y con
-- suscripciones colgando de una de ellas la divergencia deja de ser cosmética.
--
--  1. `servicios.moneda` (decisión 6). Hasta hoy `precio` era un número SIN moneda que
--     la UI pintaba como «$» y el bot anunciaba como «$»: un precio de 2.000 CUP se le
--     ofrecía al cliente final como si fueran dólares. En CLAUX toda moneda sale de las
--     del cliente (tabla `monedas`), nunca de una lista fija.
--
--  2. `servicios.producto_id` — vínculo BLANDO al catálogo, sin FK, calcado de
--     `catalogo_items.producto_id` (mig. 077). El catálogo (`products`) es la verdad
--     COMERCIAL (código, precio por moneda, lo que sale en la factura); Citas añade lo
--     OPERATIVO (duración, qué profesional lo presta). **Citas sigue funcionando sola**
--     sin los módulos `servicios` ni `inventario`: el vínculo es llenado rápido aditivo
--     en una dirección, nunca una dependencia — por eso es nullable y sin FK.
--
-- Ver docs/planes/modulo-servicios.md (Fase F).
-- ================================================================

ALTER TABLE servicios
  ADD COLUMN IF NOT EXISTS moneda      text,
  ADD COLUMN IF NOT EXISTS producto_id text;

CREATE INDEX IF NOT EXISTS servicios_producto_idx
  ON servicios (producto_id) WHERE producto_id IS NOT NULL;

-- Relleno de la moneda que faltaba: solo donde hay precio (sin precio no hay moneda que
-- adivinar) y solo con la moneda de CONSOLIDACIÓN del cliente, que es la que ya usan sus
-- reportes. Quien no tenga moneda de consolidación se queda en NULL y el formulario se
-- la pedirá: mejor un hueco visible que un dato inventado.
UPDATE servicios s
   SET moneda = m.codigo, updated_at = now()
  FROM monedas m
 WHERE m.client_id = s.client_id
   AND m.es_consolidacion = true
   AND s.moneda IS NULL
   AND s.precio IS NOT NULL;

NOTIFY pgrst, 'reload schema';
