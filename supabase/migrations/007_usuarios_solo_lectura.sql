-- 007_usuarios_solo_lectura.sql
-- Agrega flag de solo lectura a los usuarios del portal.

ALTER TABLE client_users
  ADD COLUMN IF NOT EXISTS solo_lectura BOOLEAN NOT NULL DEFAULT FALSE;
