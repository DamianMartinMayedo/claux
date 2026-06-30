-- 071: "Monedas y tasas" deja de ser página del módulo Contabilidad (base).
--
-- Motivo: la moneda es configuración transversal (la usan Ventas, Compras,
-- Gastos, Tesorería, Inventario/productos y RRHH/nómina, módulos independientes
-- entre sí). Estando bajo `requireModulo('base')`, un cliente con solo
-- Inventario o solo RRHH no podía gestionar sus monedas ni tasas. Pasa al menú
-- de cuenta del portal: siempre disponible y gratis, sin gating.
--
-- Aquí solo la quitamos del catálogo del módulo base para que no aparezca en el
-- grupo "Contabilidad" del sidebar. El acceso pasa a ser por el menú de cuenta.

update modulos_catalogo
set paginas = coalesce((
  select jsonb_agg(elem order by (elem->>'orden')::int)
  from jsonb_array_elements(paginas) elem
  where elem->>'ruta' <> '/portal/monedas'
), '[]'::jsonb)
where clave = 'base';
