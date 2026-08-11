-- 180 · Categorías excluidas del paso «Coste de ventas» del dossier
--
-- La exclusión es solo una preferencia de ese dossier: no borra la categoría de
-- Contabilidad, no cambia su rol_pl y no excluye sus importes de ningún cálculo.
-- Sirve para apartar categorías duplicadas o irrelevantes de esta pantalla.

alter table public.dossiers
  add column if not exists categorias_excluidas text[] not null default '{}';

comment on column public.dossiers.categorias_excluidas is
  'IDs de categorías raíz que no se muestran en la clasificación de este dossier. No afecta a importes ni a categorias_gastos.';
