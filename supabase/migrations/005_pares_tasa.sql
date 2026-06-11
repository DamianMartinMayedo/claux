-- 005_pares_tasa.sql
-- Configuración de pares de cambio por cliente.
-- Reemplaza el campo fuente_auto en monedas.

CREATE TABLE IF NOT EXISTS pares_tasa (
  par_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id  TEXT    NOT NULL,
  origen     TEXT    NOT NULL,
  destino    TEXT    NOT NULL,
  fuente     TEXT    NOT NULL DEFAULT 'MANUAL',  -- 'EL_TOQUE' | 'FRANKFURTER' | 'MANUAL'
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, origen, destino)
);

CREATE INDEX IF NOT EXISTS idx_pares_client  ON pares_tasa (client_id);
CREATE INDEX IF NOT EXISTS idx_pares_origen  ON pares_tasa (client_id, origen);
CREATE INDEX IF NOT EXISTS idx_pares_destino ON pares_tasa (client_id, destino);

-- Quitar fuente_auto de monedas (ya no se utiliza)
ALTER TABLE monedas DROP COLUMN IF EXISTS fuente_auto;
