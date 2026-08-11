-- 181 · Clasificación P&L propia de cada dossier
--
-- El catálogo de categorías es del cliente, pero un dossier puede representar una
-- empresa distinta o aplicar un criterio distinto. Esta configuración no modifica
-- categorias_gastos.rol_pl, que sigue siendo la verdad global de Contabilidad.

alter table public.dossiers
  add column if not exists categorias_roles jsonb not null default '{}';

comment on column public.dossiers.categorias_roles is
  'Papel P&L por categoría dentro de este dossier. No modifica categorias_gastos. JSON {categoria_id: rol_pl}.';
