-- ================================================================
-- MIGRACIÓN 011: Grants explícitos y Row Level Security (RLS)
--
-- Contexto:
--   Supabase deja de otorgar permisos automáticos en el schema public
--   a partir del 30 oct 2026. Toda la app usa createAdminClient()
--   con service_role, que bypasea RLS. Esta migración:
--
--   1. Habilita RLS en todas las tablas → bloquea acceso desde
--      claves anon/authenticated sin políticas explícitas.
--   2. Otorga permisos explícitos a service_role → cumple el nuevo
--      requisito de Supabase y documenta el acceso real del sistema.
--
--   Usa bloques DO para verificar existencia antes de aplicar —
--   así la migración es segura aunque alguna tabla no exista todavía.
-- ================================================================

-- ── Tablas con columnas IDENTITY (necesitan grant en la secuencia) ────────────

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('empresa_usuario', 'pares_tasa')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', rec.tablename);
  END LOOP;
END $$;

-- Secuencias de columnas IDENTITY
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'empresa_usuario_id_seq' AND relkind = 'S') THEN
    GRANT USAGE, SELECT ON SEQUENCE public.empresa_usuario_id_seq TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'pares_tasa_par_id_seq' AND relkind = 'S') THEN
    GRANT USAGE, SELECT ON SEQUENCE public.pares_tasa_par_id_seq TO service_role;
  END IF;
END $$;

-- ── Todas las demás tablas del proyecto ──────────────────────────────────────

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'clients',
        'client_users',
        'empresas',
        'monedas',
        'tasas_cambio',
        'plans',
        'payments',
        'settings',
        'contratos',
        'logos',
        'third_parties',
        'product_categories',
        'products'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', rec.tablename);
  END LOOP;
END $$;

-- ── Recarga caché de PostgREST ───────────────────────────────────────────────

notify pgrst, 'reload schema';
