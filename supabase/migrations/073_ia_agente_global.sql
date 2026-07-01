-- ================================================================
-- MIGRACIÓN 073: Nombre y tono del agente IA pasan a ser GLOBALES
--
-- Decisión del propietario: el cliente ya NO decide el nombre ni el tono del
-- asistente; los fija el equipo CLAUX desde el admin. El agente se llama "Claux".
-- El cliente solo VE su consumo (informativo) en su perfil.
--
-- clients.ia_config conserva únicamente el override de cupo por cliente (mig. 072);
-- las claves nombre_agente/tono que pudiera tener quedan obsoletas (se ignoran).
-- ================================================================

insert into settings (key, value) values
  ('ia_nombre_agente', 'Claux'),
  ('ia_tono',          'cercano y directo, como un asesor de confianza')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
