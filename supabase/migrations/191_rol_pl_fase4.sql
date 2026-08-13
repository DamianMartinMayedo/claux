-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 191 — Fase 4: `rol_pl` acepta los tres papeles que faltaban
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE. Con los ocho papeles anteriores el informe ya separaba lo que
-- resta de lo que no, y el ingreso del gasto. Le faltaban tres distinciones, y
-- las tres las hace un contador en cuanto entra a llevar los libros:
--
--   · `DEPRECIACION` — el desgaste de lo que compraste una vez. Es gasto y resta,
--     pero NO sale de la caja este mes. Metido en «Gastos operativos» hace que el
--     dueño busque en qué se le fue un dinero que no se fue a ninguna parte, y
--     borra la única lectura que importa aquí: cuánto de su resultado es caja.
--   · `IMPUESTO_UTILIDAD` — el impuesto sobre la utilidad. No es un gasto de
--     llevar el negocio: se calcula DESPUÉS del resultado, sobre él. Sumado
--     entre los otros impuestos, el resultado operativo del que sale queda
--     contaminado por lo que él mismo produce.
--   · `INGRESO_OTRO` — lo que entra sin ser lo que vendes: la ganancia por la
--     tasa, el reembolso de un proveedor, la venta de un freezer viejo. Contado
--     como facturación, un mes bueno de verdad y un mes en el que vendiste la
--     moto se leen igual.
--
-- NO RECLASIFICA NADA, igual que la 188 y la 190. Las categorías existentes se
-- quedan con su papel; el dueño las mueve cuando quiera, o la semilla las planta
-- en un cliente nuevo. Adivinar por el nombre cuál de las que ya hay «parece una
-- depreciación» reescribiría el pasado de un negocio real — y en este caso el
-- pasado de CLI-0014, que es de un partner y tiene seis apuntes de depreciación
-- reales esperando a que su dueño decida.
--
-- Depende de: 188 (los tres de fuera del resultado) y 190 (el de ingreso).

alter table public.categorias_gastos
  drop constraint if exists categorias_gastos_rol_pl_check;

alter table public.categorias_gastos
  add constraint categorias_gastos_rol_pl_check check (rol_pl in (
    -- Gasto, dentro del resultado
    'COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'OTRO',
    -- Fuera del resultado (mig. 188)
    'INVERSION', 'PATRIMONIO', 'FINANCIACION',
    -- Ingreso (mig. 190)
    'INGRESO_OPERATIVO',
    -- Esta migración: los renglones propios de la Fase 4
    'DEPRECIACION', 'IMPUESTO_UTILIDAD', 'INGRESO_OTRO'
  ));

comment on column public.categorias_gastos.rol_pl is
  'Renglón del estado de resultados al que va la categoría. Se lee en la categoría RAÍZ; '
  'las hijas heredan (mig. 134). Once papeles: seis de gasto que restan (los cuatro de la '
  'mig. 134 más DEPRECIACION e IMPUESTO_UTILIDAD, mig. 191), tres que mueven dinero sin ser '
  'gasto (mig. 188) y dos de ingreso (mig. 190 y 191).';
