-- ================================================================
-- MIGRACIÓN 099: Bucket de Storage `contratos`
--
-- Cierra un agujero de reproducibilidad, no añade funcionalidad: el bucket
-- `contratos` se creó A MANO en el proyecto de producción y no estaba en
-- ninguna migración. Consecuencia: en una base nueva (o al reconstruir el
-- proyecto desde `supabase/migrations/`) NO existía, y subir un contrato
-- —de empleado (`rrhh.ts`) o de tercero (`terceros.ts`)— fallaba.
--
-- Es el mismo fallo que tenía `logos`, arreglado en la 098. Con esta migración,
-- los tres buckets que usa el código (`catalogo` 077, `logos` 098, `contratos`
-- 099) quedan creados por migración. No queda ninguno suelto.
--
-- `public = true` REPRODUCE el estado real de producción; no lo cambia. Es lo
-- que exige el código hoy: `rrhh.ts` y `terceros.ts` sirven el PDF con
-- `getPublicUrl()`, que solo funciona en un bucket público. Ponerlo privado NO
-- es un cambio de migración: obligaría a pasar los dos módulos a URLs firmadas
-- (`createSignedUrl`), y eso se decide y se hace aparte.
--
-- Sin `file_size_limit` ni `allowed_mime_types`, igual que en producción: la
-- validación (solo PDF, máx. 10 MB) ya vive en `subirContratoPdf` (rrhh.ts).
-- ================================================================

insert into storage.buckets (id, name, public)
values ('contratos', 'contratos', true)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
