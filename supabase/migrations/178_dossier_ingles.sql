-- 178 · Versión en inglés del dossier (relato + resumen)
--
-- El deck puede llevar los DOS idiomas dentro y el botón ES/EN los intercambia en
-- vivo (mismo enlace, sin traducir por visita: el deck es caché de por vida). El
-- dueño genera la versión inglesa una vez con IA y se guarda aquí.
--
--   · dossier_secciones.cuerpo_en   → el relato de cada sección, traducido.
--   · dossiers.resumen_portada_en   → la línea de pitch de la portada, traducida.
--   · dossiers.traduccion_en_at     → cuándo se generó; si el ES cambia después,
--                                     la UI marca «inglés desactualizado».
--
-- Sin nuevas tablas → no toca la purga del tenant (columnas de tablas ya purgadas).

alter table public.dossier_secciones
  add column if not exists cuerpo_en text;

alter table public.dossiers
  add column if not exists resumen_portada_en text,
  add column if not exists traduccion_en_at   timestamptz;

comment on column public.dossier_secciones.cuerpo_en is
  'Traducción al inglés del cuerpo de la sección. Vacío = sin versión inglesa.';
comment on column public.dossiers.resumen_portada_en is
  'Traducción al inglés del resumen de portada.';
comment on column public.dossiers.traduccion_en_at is
  'Cuándo se generó la versión inglesa; si el relato ES cambia después, queda desactualizada.';

notify pgrst, 'reload schema';
