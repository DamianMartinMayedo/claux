-- ================================================================
-- MIGRACIÓN 125: el descuento pasa a ser POR SERVICIO (por línea)
--
-- Cambio de criterio del propietario: el descuento no es del acuerdo entero, es de
-- cada servicio. Un cliente puede tener un servicio a tarifa y otro rebajado. Así
-- que baja de `suscripciones` a `suscripcion_lineas`, junto al precio (mig. 124).
--
-- Migración de los datos existentes sin cambiar totales:
--   · PORCENTAJE → el MISMO % en cada línea da el mismo total del acuerdo.
--   · MONTO_FIJO → íntegro a UNA sola línea (repartirlo entre N líneas o ponerlo en
--     todas multiplicaría el descuento; a una línea conserva el importe).
-- ================================================================

ALTER TABLE suscripcion_lineas
  ADD COLUMN IF NOT EXISTS descuento_modo  text          NOT NULL DEFAULT 'PORCENTAJE',
  ADD COLUMN IF NOT EXISTS descuento_valor numeric(18,2) NOT NULL DEFAULT 0;

-- PORCENTAJE del acuerdo → mismo % en todas sus líneas.
UPDATE suscripcion_lineas sl
SET descuento_modo = 'PORCENTAJE', descuento_valor = s.descuento_valor
FROM suscripciones s
WHERE sl.suscripcion_id = s.suscripcion_id
  AND s.descuento_modo = 'PORCENTAJE' AND s.descuento_valor > 0;

-- MONTO_FIJO del acuerdo → íntegro a la primera línea del acuerdo.
UPDATE suscripcion_lineas sl
SET descuento_modo = 'MONTO_FIJO', descuento_valor = s.descuento_valor
FROM suscripciones s
WHERE sl.suscripcion_id = s.suscripcion_id
  AND s.descuento_modo = 'MONTO_FIJO' AND s.descuento_valor > 0
  AND sl.linea_id = (
    SELECT l2.linea_id FROM suscripcion_lineas l2
    WHERE l2.suscripcion_id = s.suscripcion_id ORDER BY l2.linea_id LIMIT 1);

-- El descuento deja de ser del acuerdo.
ALTER TABLE suscripciones
  DROP COLUMN IF EXISTS descuento_modo,
  DROP COLUMN IF EXISTS descuento_valor;

NOTIFY pgrst, 'reload schema';
