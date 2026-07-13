-- ================================================================
-- MIGRACIÓN 094: Respuesta del admin a un mensaje de soporte
--
-- Permite responder un mensaje de soporte desde el admin (nueva UI en
-- /admin/soporte) y guarda la respuesta junto al mensaje original.
-- ================================================================

alter table soporte_mensajes add column if not exists respuesta text;
alter table soporte_mensajes add column if not exists respuesta_at timestamptz;

notify pgrst, 'reload schema';
