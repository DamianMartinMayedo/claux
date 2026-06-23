-- ================================================================
-- MIGRACIÓN 067: Seed de la necesidad "Contabilidad" en diagnóstico
-- ================================================================

insert into diagnostico_necesidades (clave, etiqueta, descripcion, icono, modulos, orden, activa)
values (
  'contabilidad',
  'Contabilidad',
  'Ventas, gastos y reportes. La base de CLAUX, siempre activa.',
  'contabilidad',
  '["base"]'::jsonb,
  0,
  true
)
on conflict (clave) do nothing;

-- Reordenar: la contabilidad va primera (orden 0), el resto arranca en 1
update diagnostico_necesidades
set orden = sub.row_num
from (
  select clave, row_number() over (order by case when clave = 'contabilidad' then -1 else orden end) - 1 as row_num
  from diagnostico_necesidades
) sub
where diagnostico_necesidades.clave = sub.clave;
