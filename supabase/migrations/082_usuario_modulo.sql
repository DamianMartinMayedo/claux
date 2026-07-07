-- ================================================================
-- MIGRACIÓN 082: Tabla junction usuario_modulo
-- Permisos por usuario a nivel de módulo/funcionalidad (ver / editar),
-- ENCIMA del gating por tenant (clients.modulos_activos).
--
-- Semántica (retrocompatible):
--   admin_empresa      → todos los módulos contratados (sin filas)
--   usuario SIN filas  → todos los contratados (no rompe operadores existentes)
--   usuario CON filas  → solo esos módulos ∩ contratados; puede_editar por fila
-- 'Solo lectura' (client_users.solo_lectura) sigue siendo el interruptor maestro:
-- si está activo, el usuario no edita nada aunque puede_editar sea TRUE.
--
-- Ocultar un módulo a un usuario es solo capa de UI/permisos: el módulo sigue
-- existiendo y sus relaciones entre módulos (cascadas, actualizaciones automáticas)
-- permanecen intactas.
-- ================================================================

CREATE TABLE IF NOT EXISTS usuario_modulo (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES client_users(user_id) ON DELETE CASCADE,
  modulo_clave TEXT NOT NULL,               -- clave del catálogo (módulo o funcionalidad)
  puede_editar BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, modulo_clave)
);

CREATE INDEX IF NOT EXISTS idx_usr_mod_user ON usuario_modulo (user_id);

-- ── RLS + grants a service_role (mismo patrón que 011; la app usa service_role) ──
ALTER TABLE public.usuario_modulo ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usuario_modulo TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'usuario_modulo_id_seq' AND relkind = 'S') THEN
    GRANT USAGE, SELECT ON SEQUENCE public.usuario_modulo_id_seq TO service_role;
  END IF;
END $$;

-- ── Recarga caché de PostgREST ───────────────────────────────────────────────
notify pgrst, 'reload schema';
