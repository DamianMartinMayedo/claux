-- ================================================================
-- MIGRACIÓN 117: rastro suscripción → línea de factura (Fase D)
--
-- La facturación del período crea una factura BORRADOR por (cliente, moneda) con
-- una línea por suscripción. Guardar de qué suscripción salió cada línea da la
-- IDEMPOTENCIA real: no volver a facturar una suscripción que ya tiene línea en el
-- período (defensa además del avance de `fecha_proximo_cobro`). Ver
-- docs/planes/modulo-servicios.md (Fase D).
-- ================================================================

ALTER TABLE documento_lineas
  ADD COLUMN IF NOT EXISTS suscripcion_id text;

CREATE INDEX IF NOT EXISTS documento_lineas_suscripcion_idx
  ON documento_lineas (suscripcion_id) WHERE suscripcion_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
