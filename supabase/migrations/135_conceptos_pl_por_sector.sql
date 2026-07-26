-- ================================================================
-- MIGRACIÓN 135: Conceptos de P&L sugeridos por sector (M1)
--
-- El cliente que teclea sus números a mano (dossier SIN Contabilidad) se enfrenta
-- a una rejilla vacía sin saber QUÉ escribir. `plantillas_sector` ya resuelve las
-- etiquetas y los módulos sugeridos de cada tipo de negocio; aquí gana los
-- conceptos típicos de su estado de resultados, agrupados por el mismo vocabulario
-- que usa `dossier_lineas`: INGRESO | COSTO_VENTAS | GASTO_OPERATIVO.
--
-- PRECARGA LAS FILAS, NUNCA LOS IMPORTES. Un importe sugerido es un número
-- inventado que acabaría en un documento que el dueño enseña a un inversor.
--
-- Es un campo en una tabla que ya existe: cero código de cálculo nuevo. Y es lo
-- que hace COMPLETABLE el paso de desglose (M2) — sin esto sería otra pantalla en
-- blanco, que es exactamente el problema que venía a resolver.
-- ================================================================

alter table plantillas_sector
  add column if not exists conceptos_pl jsonb not null default '{}'::jsonb;

comment on column plantillas_sector.conceptos_pl is
  'Conceptos típicos del estado de resultados por sector: {"INGRESO":[…],"COSTO_VENTAS":[…],"GASTO_OPERATIVO":[…]}. Precarga filas del desglose, nunca importes.';

update plantillas_sector set conceptos_pl = j.conceptos from (values
  ('restaurante', '{"INGRESO":["Comidas","Bebidas","Delivery y para llevar","Eventos"],
                    "COSTO_VENTAS":["Alimentos","Bebidas","Envases y desechables"],
                    "GASTO_OPERATIVO":["Salarios","Alquiler","Electricidad","Gas","Agua","Limpieza","Publicidad","Mantenimiento"]}'),
  ('cafeteria',   '{"INGRESO":["Cafetería","Repostería","Para llevar"],
                    "COSTO_VENTAS":["Café e insumos","Repostería","Envases y desechables"],
                    "GASTO_OPERATIVO":["Salarios","Alquiler","Electricidad","Agua","Limpieza","Publicidad"]}'),
  ('bar',         '{"INGRESO":["Bebidas","Comida","Eventos y música"],
                    "COSTO_VENTAS":["Bebidas y licores","Alimentos","Hielo y desechables"],
                    "GASTO_OPERATIVO":["Salarios","Alquiler","Electricidad","Licencias","Seguridad","Publicidad"]}'),
  ('tienda',      '{"INGRESO":["Ventas en tienda","Ventas a domicilio","Ventas por encargo"],
                    "COSTO_VENTAS":["Mercancía","Transporte de compras","Empaque"],
                    "GASTO_OPERATIVO":["Salarios","Alquiler","Electricidad","Publicidad","Transporte","Mantenimiento"]}'),
  ('barberia',    '{"INGRESO":["Cortes y afeitado","Tratamientos","Venta de productos"],
                    "COSTO_VENTAS":["Productos de uso","Productos para reventa"],
                    "GASTO_OPERATIVO":["Salarios y comisiones","Alquiler","Electricidad","Agua","Publicidad","Herramientas"]}'),
  ('peluqueria',  '{"INGRESO":["Cortes y peinados","Coloración","Tratamientos","Venta de productos"],
                    "COSTO_VENTAS":["Tintes y productos","Productos para reventa"],
                    "GASTO_OPERATIVO":["Salarios y comisiones","Alquiler","Electricidad","Agua","Publicidad","Herramientas"]}'),
  ('estetica',    '{"INGRESO":["Tratamientos faciales","Tratamientos corporales","Manicura y pedicura","Venta de productos"],
                    "COSTO_VENTAS":["Productos de cabina","Productos para reventa","Material desechable"],
                    "GASTO_OPERATIVO":["Salarios y comisiones","Alquiler","Electricidad","Agua","Publicidad","Equipamiento"]}'),
  ('gimnasio',    '{"INGRESO":["Mensualidades","Clases dirigidas","Entrenamiento personal","Venta de productos"],
                    "COSTO_VENTAS":["Productos para reventa","Material fungible"],
                    "GASTO_OPERATIVO":["Salarios de entrenadores","Alquiler","Electricidad","Agua","Mantenimiento de equipos","Publicidad"]}'),
  ('clinica',     '{"INGRESO":["Consultas","Procedimientos","Venta de productos"],
                    "COSTO_VENTAS":["Material sanitario","Medicamentos","Laboratorio externo"],
                    "GASTO_OPERATIVO":["Salarios","Alquiler","Electricidad","Agua","Seguros","Licencias","Publicidad"]}'),
  ('alquiler',    '{"INGRESO":["Alquiler por hora","Abonos y bonos","Eventos y torneos"],
                    "COSTO_VENTAS":["Material fungible","Personal de la actividad"],
                    "GASTO_OPERATIVO":["Salarios","Alquiler del local","Electricidad","Agua","Mantenimiento","Publicidad"]}'),
  ('servicios',   '{"INGRESO":["Servicios prestados","Proyectos","Mantenimientos"],
                    "COSTO_VENTAS":["Subcontratas","Materiales del servicio","Transporte del servicio"],
                    "GASTO_OPERATIVO":["Salarios","Alquiler","Electricidad","Teléfono e internet","Publicidad","Transporte"]}')
) as j(sector, conceptos)
where plantillas_sector.sector = j.sector;

notify pgrst, 'reload schema';
