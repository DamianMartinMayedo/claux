-- ================================================================
-- MIGRACIÓN 199: Consolidación multi-moneda — tasa congelada por fila
--
-- Un cliente migra años de varias empresas con monedas distintas y quiere
-- consolidar a una. Hoy el importador entra NATIVO y Reportes, al «Ver en» una
-- moneda, convierte a la tasa VIGENTE (la de hoy). En Cuba eso falsea el
-- histórico: un USD de 2022 no vale el de hoy. La tasa vigente sirve para saldos
-- actuales, no para importes antiguos.
--
-- Solución B — nativo + tasa CONGELADA por fila (la fija el cliente, no la
-- inventa el sistema): una columna que guarda, a la fecha de la fila, cuántos de
-- la moneda de consolidación (monedas.es_consolidacion) vale 1 de la moneda
-- nativa. El importe nativo real se guarda SIEMPRE (monto/moneda); la tasa
-- congelada es un dato aparte y auditable. NULL = no se aportó → Reportes cae a
-- la tasa vigente (comportamiento actual), y lo señala.
--
-- Sin tablas nuevas (RLS y purga heredadas de gastos_cobros).
-- Ver docs/planes/importador-autoservicio-cliente.md (§7).
-- ================================================================

ALTER TABLE public.gastos_cobros
  ADD COLUMN IF NOT EXISTS tasa_consolidacion NUMERIC NULL
    CHECK (tasa_consolidacion IS NULL OR tasa_consolidacion > 0);

COMMENT ON COLUMN public.gastos_cobros.tasa_consolidacion IS
  'Consolidación (solución B): tasa CONGELADA nativo→moneda de consolidación (monedas.es_consolidacion) a la fecha de la fila. La fija el cliente al importar (columna «Tasa a X» o «Importe en X»). NULL = no aportada → Reportes usa la tasa vigente. El importe nativo real va en monto/moneda; esto es un dato auditable aparte.';
