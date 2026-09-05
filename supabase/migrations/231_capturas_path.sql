-- ================================================================
-- MIGRACIÓN 231: el path de Storage de cada captura
--
-- `capturas_producto` guarda la URL pública, que es lo que pinta el
-- <img>, pero borrar o reemplazar el fichero necesita el PATH dentro
-- del bucket. Deducirlo de la URL funciona hasta que deja de
-- funcionar: al reemplazar se le añade `?v=<timestamp>` para tirar la
-- caché, y el día que Supabase cambie la forma de la URL pública el
-- borrado empezaría a fallar en silencio, dejando ficheros huérfanos
-- que nadie ve. Es la misma razón por la que `catalogo_items` guarda
-- `foto_path` además de `foto_url`.
--
-- Nulable: la columna nace con la tabla vacía —la biblioteca no tenía
-- todavía ninguna captura cuando esto se añadió—, así que no hay nada
-- que rellenar, pero un null no rompe nada: sin path, el borrado deja
-- el fichero y sigue con la fila.
-- ================================================================

alter table capturas_producto add column if not exists path text;

notify pgrst, 'reload schema';
