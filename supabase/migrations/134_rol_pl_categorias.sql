-- ================================================================
-- MIGRACIÓN 134: `rol_pl` — el papel de cada categoría en el estado de resultados
--
-- Es la pieza que da ESTRUCTURA al P&L sin que el cliente compre nada: con solo
-- `base`, una lista plana de categorías pasa a ser
--
--   Ingresos − Coste de ventas = Margen bruto − Personal − Operativos
--   = Resultado operativo − Otros = Resultado neto
--
-- CUATRO DECISIONES QUE ESTO CONSAGRA:
--
-- 1. VALOR DE FÁBRICA, no deberes para el dueño. Quien no toque nada ya obtiene el
--    waterfall: las categorías que escribe el sistema traen su papel puesto
--    (compras y servicios_terceros → coste de ventas; salarios → personal;
--    comisiones bancarias → otros/financieros) y el resto nace OPERATIVO.
--
-- 2. EL PAPEL LO FIJA LA RAÍZ. Una subcategoría hereda el `rol_pl` de su categoría
--    madre: «Suministros · Electricidad» no puede ser coste de ventas si
--    «Suministros» es operativo. Así el dueño clasifica una vez, no N veces, y el
--    rollup jerárquico del informe cuadra con sus subtotales por definición.
--    La columna existe en las filas hijas pero NO se lee: el cálculo sube al padre.
--
-- 3. NO TOCA EL DOBLE CONTEO. El coste de ventas sale de GASTOS INCURRIDOS ya
--    clasificados —una sola fuente—, nunca de `documento_lineas.costo_unitario`.
--    Ese sigue siendo el margen unitario informativo de la mig. 118: responde «qué
--    artículo me deja dinero», no «cuál fue mi margen bruto del mes». Son dos
--    preguntas distintas y por eso son dos números distintos.
--
-- 4. ABSORBE `dossier_costo_ventas`. Ese booleano por nombre de categoría era una
--    segunda fuente de verdad sobre el mismo dato, y hacía que los dos estados de
--    resultados del producto (portal y dossier) pudieran clasificar distinto. Sus
--    datos se vuelcan aquí y el código deja de leerla; la tabla queda inerte (no se
--    borra: `eliminar_cliente()` de la mig. 096 la limpia y no vamos a tocar la
--    cascada de borrado por un ahorro cosmético).
-- ================================================================

-- ── 1. La columna ────────────────────────────────────────────────────────────
alter table categorias_gastos
  add column if not exists rol_pl text not null default 'OPERATIVO';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'categorias_gastos_rol_pl_check') then
    alter table categorias_gastos
      add constraint categorias_gastos_rol_pl_check
      check (rol_pl in ('COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'OTRO'));
  end if;
end $$;

comment on column categorias_gastos.rol_pl is
  'Papel en el estado de resultados: COSTE_VENTAS | PERSONAL | OPERATIVO | OTRO. '
  'Solo se lee en categorías RAÍZ; una subcategoría hereda el de su madre.';

-- ── 2. Valores de fábrica por clave de sistema ───────────────────────────────
update categorias_gastos set rol_pl = 'COSTE_VENTAS', updated_at = now()
 where clave_sistema in ('compras', 'servicios_terceros') and rol_pl = 'OPERATIVO';

update categorias_gastos set rol_pl = 'PERSONAL', updated_at = now()
 where clave_sistema = 'salarios' and rol_pl = 'OPERATIVO';

-- Financiera, no operativa: mezclarla con el alquiler y la luz distorsiona el
-- resultado OPERATIVO, que es el número que dice si el negocio funciona.
update categorias_gastos set rol_pl = 'OTRO', updated_at = now()
 where clave_sistema = 'comisiones_bancarias' and rol_pl = 'OPERATIVO';

-- ── 3. Absorber la clasificación que ya hizo el dueño en el dossier ──────────
-- `dossier_costo_ventas` es (client_id, categoria TEXT) → booleano. Se cruza por
-- nombre a nivel raíz, que es como se escribió.
update categorias_gastos c
   set rol_pl = 'COSTE_VENTAS', updated_at = now()
  from dossier_costo_ventas d
 where d.client_id = c.client_id
   and d.categoria = c.nombre
   and c.parent_id is null
   and d.es_costo_ventas = true
   and c.rol_pl = 'OPERATIVO';

-- ── 4. Índice de lectura del informe ─────────────────────────────────────────
create index if not exists idx_categorias_gastos_rol_pl
  on categorias_gastos (client_id, rol_pl) where parent_id is null;

notify pgrst, 'reload schema';
