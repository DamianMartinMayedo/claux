-- ================================================================
-- MIGRACIÓN 058: Vínculo opcional recurso↔empleado (RRHH) + etiqueta "Personal"
--
-- Citas funciona standalone (personal manual). Si el negocio tiene el módulo RRHH,
-- puede IMPORTAR su lista de empleados como personal de la agenda (llenado rápido,
-- principio de módulos independientes). El vínculo `empleado_id` evita duplicar al
-- reimportar; es opcional y nullable (los que no tienen RRHH no lo usan).
--
-- Además: la etiqueta genérica pasa de "Profesional" a "Personal" (más cercano y
-- alineado con la lista de RRHH).
-- ================================================================

alter table recursos add column if not exists empleado_id text;
create index if not exists idx_recursos_empleado on recursos (empleado_id);

-- Etiqueta genérica → "Personal" en los sectores de personas (los específicos
-- como Barbero/Cabina/Cancha se mantienen).
update plantillas_sector
set etiquetas = jsonb_set(jsonb_set(etiquetas, '{recurso}', '"Personal"'), '{recurso_pl}', '"Personal"')
where etiquetas->>'recurso' = 'Profesional';

notify pgrst, 'reload schema';
