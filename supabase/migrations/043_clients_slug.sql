-- ================================================================
-- MIGRACIÓN 043: Slug público por cliente (Fase 0 · Tanda 3)
--
-- Cada tenant tiene un slug único para sus URLs públicas:
--   claux.app/la-bodeguita/reservar
--   claux.app/la-bodeguita/carta
--
-- El slug lo elige el dueño en su perfil. NULL = sin página pública.
-- ================================================================

alter table clients add column if not exists slug text unique;

notify pgrst, 'reload schema';
