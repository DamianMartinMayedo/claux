-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 190 — Fase 3: `rol_pl` acepta `INGRESO_OPERATIVO`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE. El ingreso del negocio entra por dos puertas distintas y hasta
-- ahora solo una sabía decir de qué vive el negocio:
--
--   · La FACTURA lleva líneas, y sus líneas llevan productos: su desglose sale
--     del catálogo de productos (decisión ⑤, ya en el motor).
--   · El COBRO SIN FACTURA no lleva líneas —el cierre del TPV, la suscripción
--     cobrada, el reembolso de un proveedor, la ganancia por la tasa— y solo
--     tiene una categoría de `categorias_gastos`. Sin un rol de ingreso, esa
--     categoría no puede decir nada: el importe entra en «Cobros directos» y se
--     acabó.
--
-- Un negocio que cobra por mostrador tiene ahí TODA su facturación. Por eso el
-- rol va en la misma tabla y no en una nueva: la fila ya existe, ya la elige el
-- dueño al anotar el cobro, y lo único que le falta es decir a qué renglón va.
--
-- NO RECLASIFICA NADA, igual que la 188. Las categorías que hoy usan los cobros
-- se quedan con el rol que tengan; el dueño las mueve cuando quiera, o la semilla
-- las planta en un cliente vacío. Adivinar por el nombre cuál de las categorías
-- existentes «parece un ingreso» reescribiría el pasado de un negocio real.
--
-- Depende de: 188 (los tres roles de fuera del resultado).

alter table public.categorias_gastos
  drop constraint if exists categorias_gastos_rol_pl_check;

alter table public.categorias_gastos
  add constraint categorias_gastos_rol_pl_check check (rol_pl in (
    -- Gasto, dentro del resultado
    'COSTE_VENTAS', 'PERSONAL', 'OPERATIVO', 'OTRO',
    -- Fuera del resultado (mig. 188)
    'INVERSION', 'PATRIMONIO', 'FINANCIACION',
    -- Ingreso (esta migración)
    'INGRESO_OPERATIVO'
  ));

comment on column public.categorias_gastos.rol_pl is
  'Renglón del estado de resultados al que va la categoría. Se lee en la categoría RAÍZ; '
  'las hijas heredan (mig. 134). Cuatro roles de gasto que restan, tres que mueven dinero '
  'sin ser gasto (mig. 188) y el de ingreso para el cobro sin factura (mig. 190).';
