-- Habilita Realtime en la tabla clients para que el portal detecte cambios
-- (estado, módulos, fecha_expiracion) sin recargar la página.
alter publication supabase_realtime add table clients;
