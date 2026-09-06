-- ─────────────────────────────────────────────────────────────────────────────
-- 234 · El modelo de IA que le toca a cada nivel
--
-- Hasta ahora el modelo era UNO GLOBAL (`settings.ia_model`) y lo único que
-- cambiaba con el nivel era el CUPO (`nivel_limites.ia_conversaciones`: 500 /
-- 1.500 / 5.000). Un cliente Pro y uno Inicial hablaban con el mismo modelo: el
-- escalón se notaba en cuánto podías preguntar, no en la calidad de la respuesta,
-- que es donde se justifica el precio.
--
-- Va como COLUMNA y no como fila de `nivel_limites` porque esa tabla es
-- `(nivel, dimension) → int`: solo números, y esto es el nombre de un modelo.
--
-- SEMILLA: los tres niveles arrancan con el principal que esté VIVO, para que
-- ningún cliente note el cambio el día del despliegue. El valor no se teclea —se
-- resuelve del catálogo y validado contra él—, así que la migración es correcta
-- se aplique hoy o dentro de seis meses, aunque para entonces el principal sea
-- otro o esté desactivado. Es la lección del `deepseek`: un id escrito a mano
-- envejece solo. Hoy resuelve a `gemini-3.6-flash`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.niveles
  add column if not exists ia_model text;

comment on column public.niveles.ia_model is
  'Modelo de IA de este nivel (id de ia_modelos). NULL = usa el global settings.ia_model. Se edita en /admin/niveles con un select del catálogo, nunca a mano.';

update public.niveles set ia_model = coalesce(
  -- 1. El principal, si sigue vivo en el catálogo.
  (select s.value from public.settings s
     join public.ia_modelos m on m.id = s.value
    where s.key = 'ia_model' and m.activo),
  -- 2. Si no, el primer activo de pago: el nivel de un cliente que paga no debe
  --    caer por defecto en el gratis de respaldo.
  (select id from public.ia_modelos where activo and not gratis order by orden limit 1),
  -- 3. Y si no hay ninguno de pago, cualquiera activo.
  (select id from public.ia_modelos where activo order by orden limit 1)
)
where ia_model is null;
