-- ================================================================
-- MIGRACIÓN 004: Tabla junction empresa_usuario
-- Controla qué usuarios tienen acceso a qué empresas.
-- admin_empresa → acceso a todas las empresas del cliente (bypass)
-- usuario       → solo las filas explícitas en esta tabla
-- ================================================================

CREATE TABLE IF NOT EXISTS empresa_usuario (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(empresa_id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES client_users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (empresa_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_emp_usr_user    ON empresa_usuario (user_id);
CREATE INDEX IF NOT EXISTS idx_emp_usr_empresa ON empresa_usuario (empresa_id);
