-- ================================================================
-- MIGRACIÓN 194: vacaciones en DÍAS congeladas en la línea + días a liquidar
--
-- PROBLEMA. El saldo de vacaciones se lleva en IMPORTE (mig. 142/143/167), pero el
-- derecho legal real se cuenta en DÍAS. Para derivar el saldo también en días con la
-- misma regla que el importe —`saldo = apertura + Σ (acumulado − pagado)` sobre las
-- nóminas CONFIRMADAS— hacen falta las columnas gemelas de días en la línea, porque
-- `dias_trabajados`/`dias_vacaciones` viven en `incidencias_nomina`, que es MUTABLE y no
-- se congela al confirmar: derivar de ahí rompería la invariante «el saldo sale de lo
-- cerrado, no de lo que aún puede cambiar».
--
-- QUÉ AÑADE.
--   nomina_lineas.vacaciones_dias_acumulados_periodo  → 1/11 de los días trabajados del
--       mes (gemelo en días de `vacaciones_acumuladas_periodo`).
--   nomina_lineas.vacaciones_dias_pagados_periodo     → días de vacaciones que salieron
--       del saldo este mes: disfrute + liquidación por baja (gemelo de
--       `vacaciones_pagadas_periodo`).
--   incidencias_nomina.dias_liquidacion               → días de vacaciones que se LIQUIDAN
--       de golpe al causar baja. Campo propio (no se mezcla con `dias_vacaciones`) para
--       poder avisar en la hoja de nómina con un botón y distinguirlo en el recibo.
--
-- `default 0` y `not null`: el histórico queda en 0 —coherente con «solo se migra el
-- saldo de apertura, no el historial mes a mes»— y ninguna nómina ya confirmada cambia.
-- Un tenant que ya opera en CLAUX con saldo en IMPORTE pero días históricos = 0 se
-- resuelve por su apertura de días (mig. 195) o por la red de seguridad de la valoración
-- (motor: sin días de saldo, se cae al valor del día del período).
--
-- Plan: docs/planes/vacaciones-liquidacion-dias.md (Fase 0)
-- ================================================================

alter table public.nomina_lineas
  add column if not exists vacaciones_dias_acumulados_periodo numeric not null default 0,
  add column if not exists vacaciones_dias_pagados_periodo    numeric not null default 0;

comment on column public.nomina_lineas.vacaciones_dias_acumulados_periodo is
  'Días de vacaciones acumulados este período (1/11 de los días trabajados efectivos). '
  'Gemelo en DÍAS de vacaciones_acumuladas_periodo; se congela al generar/recalcular la '
  'línea y alimenta la derivación del saldo en días.';
comment on column public.nomina_lineas.vacaciones_dias_pagados_periodo is
  'Días de vacaciones que salieron del saldo este período: disfrute + liquidación por '
  'baja. Gemelo en DÍAS de vacaciones_pagadas_periodo.';

alter table public.incidencias_nomina
  add column if not exists dias_liquidacion numeric not null default 0;

comment on column public.incidencias_nomina.dias_liquidacion is
  'Días de vacaciones que se LIQUIDAN de golpe al causar baja (solo MIPYME_CUBA). '
  'Normalmente 0; lo propone el aviso de baja de la hoja de nómina con el saldo derivado '
  'en días, editable a mano. Entra en el devengado como las vacaciones disfrutadas, pero '
  'NO en la base del IUFT ni de la SS de empresa (criterio de Claudia, 2026-08-13).';

notify pgrst, 'reload schema';
