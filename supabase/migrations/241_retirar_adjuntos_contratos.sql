-- ================================================================
-- MIGRACIÓN 241: se retira la subida de ficheros de los contratos
--
-- Decisión del propietario (2026-09-08) tras la auditoría de subidas:
-- la plataforma dejaba subir un PDF en dos sitios —contrato de empleado
-- (RRHH) y contrato de tercero— y los dos se retiran enteros.
--
-- POR QUÉ, y no «lo arreglamos»:
--   1. El bucket `contratos` era PÚBLICO (mig. 099, que ya lo documentaba
--      como deuda). Cualquiera con la URL descargaba el contrato sin
--      sesión, sin caducidad y para siempre. Comprobado contra producción:
--      HTTP 200 y 3,6 MB sin una sola credencial.
--   2. Nadie borraba los ficheros. Terceros no tenía ni un `.remove()`, y
--      en RRHH el PDF sobrevivía al borrado del empleado.
--   3. No lo usaba nadie: en toda la base había UN fichero (del cliente de
--      pruebas CLI-0003) y una URL colgando que ya daba 404.
--
-- Arreglarlo bien —URLs firmadas, limpieza al borrar, antivirus, cuota por
-- cliente— es un sistema de adjuntos, no un parche en dos formularios. Se
-- hará de una vez y para todos los sitios que lo necesiten:
-- `docs/planes/adjuntos-ficheros.md`.
--
-- QUÉ SE PIERDE: `contratos.pdf_nombre` de una fila de pruebas y dos URLs
-- muertas. Ningún dato de negocio. Lo que se conserva es lo que sí se
-- consulta: el contrato como registro (tipo, fechas, salario, periodicidad)
-- y, en terceros, el número y las fechas del contrato.
--
-- El fichero del bucket se borró con la API de Storage antes de esta
-- migración (borrar `storage.objects` a mano dejaría el blob huérfano).
-- ================================================================

-- ── 1. Las columnas que guardaban la URL pública ──────────────────────────
alter table public.contratos
  drop column if exists pdf_url,
  drop column if exists pdf_nombre;

alter table public.third_parties
  drop column if exists contrato_url;

-- ── 2. El bucket entero: NO se borra desde aquí ───────────────────────────
-- Postgres lo impide (`storage.protect_delete()`: «Direct deletion from storage
-- tables is not allowed»), y con razón: borrar la fila dejaría el blob huérfano
-- en S3. El bucket `contratos` se borró con la API de Storage el 2026-09-08,
-- junto con su único fichero, y deja de existir en vez de quedarse vacío y
-- público —un bucket sin dueño es justo lo que nadie revisa—.
--
-- Esto ANULA la migración 099. En una base nueva la 099 lo volverá a crear:
-- es inofensivo (nadie lo usa) y no se toca, porque reescribir una migración
-- ya aplicada es peor. El sistema de adjuntos futuro creará el suyo, privado
-- y servido con `createSignedUrl`, el patrón que ya usa `documentos-firmados`
-- (mig. 200).

notify pgrst, 'reload schema';
