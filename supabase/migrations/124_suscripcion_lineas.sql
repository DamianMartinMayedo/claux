-- ================================================================
-- MIGRACIÓN 124: una suscripción con VARIOS servicios
--
-- Un cliente que contrata tres servicios tenía que darse de alta tres veces, y la
-- lista de Acuerdos lo enseñaba como tres acuerdos distintos. No lo son: es UN
-- acuerdo con tres líneas, exactamente igual que la factura que genera (que ya
-- salía con una línea por servicio, porque la facturación agrupa por cliente y
-- moneda).
--
-- Reparto de responsabilidades tras esta migración:
--  · `suscripciones`      → el ACUERDO: cliente, empresa, moneda, periodicidad,
--                           descuento, fechas, estado. Todo lo que se pacta UNA vez.
--  · `suscripcion_lineas` → QUÉ se le presta y a qué precio mensual cada cosa.
--
-- Por qué el precio baja a la línea y el descuento NO: el precio es de cada
-- servicio; el descuento es del acuerdo («si me lo pagas al año, te hago precio»)
-- y se aplica sobre el importe del ciclo completo. Al facturar se reparte entre
-- las líneas como porcentaje efectivo (descuento/bruto), que es exacto y además
-- deja el descuento a la vista en cada línea de la factura.
--
-- El rastro de idempotencia sigue siendo `documento_lineas.suscripcion_id`: ahora
-- varias líneas de la misma factura comparten suscripción, y la defensa (¿este
-- acuerdo ya se facturó en este período?) funciona igual, por pertenencia.
--
-- Multi-tenant por client_id (sin RLS, como el resto del esquema).
-- ================================================================

-- ── 1. Las líneas del acuerdo ──
CREATE TABLE IF NOT EXISTS suscripcion_lineas (
  linea_id       text PRIMARY KEY,
  client_id      text NOT NULL,
  suscripcion_id text NOT NULL REFERENCES suscripciones(suscripcion_id) ON DELETE CASCADE,
  producto_id    text NOT NULL,   -- → products.producto_id (tipo SERVICIO, suscribible)
  precio_mensual numeric(18,2) NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS suscripcion_lineas_sus_idx    ON suscripcion_lineas (suscripcion_id);
CREATE INDEX IF NOT EXISTS suscripcion_lineas_client_idx ON suscripcion_lineas (client_id);

-- Sin único (suscripcion_id, producto_id) a propósito: el mismo servicio puede ir
-- dos veces en un acuerdo (dos locales, dos campañas), igual que ya se permitían
-- dos suscripciones al mismo servicio.

-- ── 2. Mover lo que ya existe: cada suscripción actual pasa a ser un acuerdo de una línea ──
INSERT INTO suscripcion_lineas (linea_id, client_id, suscripcion_id, producto_id, precio_mensual)
SELECT
  'SLN-' || upper(substr(md5(random()::text || s.suscripcion_id), 1, 8)),
  s.client_id, s.suscripcion_id, s.producto_id, s.precio_mensual
FROM suscripciones s
WHERE NOT EXISTS (
  SELECT 1 FROM suscripcion_lineas l WHERE l.suscripcion_id = s.suscripcion_id
);

-- ── 3. Retirar los campos que ya no son del acuerdo ──
-- Se hace DESPUÉS de copiar, en la misma migración: dejarlos sería tener dos
-- fuentes de verdad para el mismo dato, que es peor que perderlos.
ALTER TABLE suscripciones
  DROP COLUMN IF EXISTS producto_id,
  DROP COLUMN IF EXISTS precio_mensual;

NOTIFY pgrst, 'reload schema';
