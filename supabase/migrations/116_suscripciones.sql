-- ================================================================
-- MIGRACIÓN 116: Suscripciones (Fase B del módulo Servicios)
--
-- El acuerdo entre un cliente y un servicio contratado, a un PRECIO PACTADO
-- distinto por cliente, con su periodicidad y su próximo cobro. Es la pieza que
-- convierte «Servicios» en un módulo de verdad (control de contratos recurrentes).
-- Ver docs/planes/modulo-servicios.md.
--
-- Decisiones que consagra el esquema:
--  · `precio_pactado` es SUYO una vez guardado: cambiar la tarifa del servicio NO
--    repisa las suscripciones vivas (por eso el precio se copia, no se une por join).
--  · `estado` guarda solo lo MANUAL (ACTIVA/PAUSADA/CANCELADA). «Vencida» se DERIVA
--    de fecha_fin + renovacion_automatica al leer — sin cron ni cuarta constante.
--  · `moneda` sale siempre de las del cliente (validación en la acción, no aquí).
--  · Sin índice único (cliente, servicio): un cliente puede tener el mismo servicio
--    dos veces (dos locales, dos campañas).
--
-- Multi-tenant por client_id (sin RLS, como el resto del esquema: la app entra con
-- service_role y toda query filtra por client_id).
-- ================================================================

-- ── 1. Marcar un servicio como suscribible ──
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS es_suscribible       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS periodicidad_defecto text;

-- ── 2. Tabla de suscripciones ──
CREATE TABLE IF NOT EXISTS suscripciones (
  suscripcion_id        text PRIMARY KEY,
  client_id             text NOT NULL,
  empresa_id            text NOT NULL,
  cliente_id            text NOT NULL,   -- → third_parties.tercero_id (a quién se le vende)
  producto_id           text NOT NULL,   -- → products.producto_id (tipo SERVICIO)
  precio_pactado        numeric(18,2) NOT NULL DEFAULT 0,
  moneda                text NOT NULL,
  periodicidad          text NOT NULL DEFAULT 'MENSUAL',
  fecha_inicio          date NOT NULL,
  fecha_proximo_cobro   date NOT NULL,
  fecha_fin             date,            -- NULL = indefinida
  renovacion_automatica boolean NOT NULL DEFAULT true,
  estado                text NOT NULL DEFAULT 'ACTIVA',  -- ACTIVA | PAUSADA | CANCELADA
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suscripciones_periodicidad_chk CHECK (periodicidad IN ('MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL')),
  CONSTRAINT suscripciones_estado_chk       CHECK (estado IN ('ACTIVA','PAUSADA','CANCELADA'))
);

CREATE INDEX IF NOT EXISTS suscripciones_client_idx  ON suscripciones (client_id);
CREATE INDEX IF NOT EXISTS suscripciones_cliente_idx ON suscripciones (client_id, cliente_id);
CREATE INDEX IF NOT EXISTS suscripciones_cobro_idx   ON suscripciones (client_id, estado, fecha_proximo_cobro);

-- ── 3. La página propia del módulo ahora incluye Suscripciones ──
UPDATE modulos_catalogo
SET paginas = '[{"ruta":"/portal/servicios","label":"Servicios","orden":0},{"ruta":"/portal/suscripciones","label":"Suscripciones","orden":1}]'::jsonb
WHERE clave = 'servicios';

NOTIFY pgrst, 'reload schema';
