-- ================================================================
-- MIGRACIÓN 238: el onboarding del cliente nuevo
--
-- Plan `docs/planes/onboarding-cliente-nuevo.md` § 8. El dashboard pasa a llevar
-- un bloque de puesta en marcha que se calcula EN VIVO contando filas reales
-- (¿hay moneda?, ¿hay empresa?, ¿hay almacén?…). Por eso aquí no hay ninguna
-- tabla de progreso: lo que un cliente ya configuró se sabe mirando sus datos, y
-- una tabla paralela solo podría contradecirlos.
--
-- Lo único que NO se puede deducir de los datos son dos decisiones del dueño:
--
--   · `onboarding_oculto_at` — «no me lo enseñes más». Va en `clients` y no en el
--     navegador porque el dueño entra desde varios móviles, y no en `client_users`
--     porque el negocio se configura una vez, no una por usuario. Se recupera
--     desde Perfil. El equipo impersonando lo IGNORA a propósito (es su vía rápida
--     de revisión).
--
--   · `onboarding_import_no` — «empiezo de cero», la respuesta a la pregunta de si
--     trae datos de un sistema anterior. Sin esto la pregunta volvería cada vez.
--     No toca `migracion_estado`: ese estado lo gobierna el equipo, y un cliente
--     que dice «empiezo de cero» no cierra una migración.
--
-- Dos columnas en una tabla que ya existe ⇒ no toca `eliminar_cliente` ni las
-- políticas RLS, que es justo donde estas cosas se quedan cortas en silencio.
-- ================================================================

alter table public.clients
  add column if not exists onboarding_oculto_at timestamptz,
  add column if not exists onboarding_import_no boolean not null default false;

comment on column public.clients.onboarding_oculto_at is
  'Cuándo el cliente ocultó el bloque de puesta en marcha del dashboard. NULL = visible. Se ignora al impersonar.';
comment on column public.clients.onboarding_import_no is
  'El cliente respondió «empiezo de cero» a la pregunta de traer datos de un sistema anterior.';
