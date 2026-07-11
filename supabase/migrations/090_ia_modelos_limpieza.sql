-- 090_ia_modelos_limpieza.sql
-- ================================================================
-- Limpieza del catálogo de modelos de IA + reconciliación de RLS.
--
-- Causa raíz (verificada contra el proveedor real, OpenCode Zen):
--   minimax-m3-free  → HTTP 401 "Model minimax-m3-free is not supported"
--   qwen3.6-plus-free → HTTP 401 "Model qwen3.6-plus-free is not supported"
-- Esos dos ids ya NO existen en el proveedor. Si el admin los activa y uno queda
-- de principal, cada llamada a chat() lanza y el asistente deja de responder.
-- Se eliminan del catálogo. nemotron-3-ultra-free y big-pickle SÍ responden bien
-- (HTTP 200, JSON válido) y se conservan tal cual (siguen inactivos por defecto;
-- se pueden activar sin riesgo).
--
-- Además: la RLS de ia_modelos se había aplicado a mano en producción (policy
-- admin_full_access) pero no vivía en ninguna migración — la 072 creó la tabla sin
-- RLS y la 085 solo tocó tablas que YA tenían RLS activado, así que saltó esta.
-- Se reconcilia aquí, idempotente y con el mismo patrón que el resto del admin,
-- para que un entorno nuevo no deje la tabla abierta al rol anon.
-- ================================================================

delete from ia_modelos where id in ('minimax-m3-free', 'qwen3.6-plus-free');

alter table ia_modelos enable row level security;
drop policy if exists "admin_full_access" on public.ia_modelos;
create policy "admin_full_access" on public.ia_modelos
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
