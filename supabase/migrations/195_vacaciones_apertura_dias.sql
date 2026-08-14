-- ================================================================
-- MIGRACIÓN 195: saldo de vacaciones de APERTURA también en DÍAS
--
-- PROBLEMA. La mig. 167 dio la apertura del saldo en IMPORTE, y dejó dicho que llevarlo
-- también en días «es un objetivo posterior y necesita su propia decisión». Esta es esa
-- decisión: un negocio que migra a mitad de año llega con vacaciones ya acumuladas y hay
-- que poder cargarlas en las DOS unidades, coherentes entre sí, para que la valoración
-- del disfrute (`saldo_importe ÷ saldo_dias`) parta de un promedio con sentido.
--
-- MISMO PAPEL QUE EL IMPORTE. Es el punto de partida INMUTABLE de la derivación
--     saldo_dias = apertura_dias + Σ (dias_acumulados − dias_pagados) de las confirmadas
-- No es un total mutable —eso es justo lo que la derivación evita— y se carga por el
-- importador de Personal o por el modal de la ficha, nunca por el alta normal.
--
-- FUERA DE `construirCamposEmpleado`. Igual que `vacaciones_apertura` (mig. 167): esa
-- función escribe todo lo que le llega, así que si la apertura viajara con el formulario
-- del alta, guardar el teléfono la pondría a 0 en silencio. Se toca solo por su acción
-- propia (`guardarVacacionesApertura`).
--
-- `default 0` y `not null`: un trabajador ya existente arranca sin apertura de días, o
-- sea con el saldo-días saliendo exactamente igual que antes de esta migración.
--
-- Plan: docs/planes/vacaciones-liquidacion-dias.md (Fase 1)
-- ================================================================

alter table public.empleados
  add column if not exists vacaciones_apertura_dias numeric not null default 0;

comment on column public.empleados.vacaciones_apertura_dias is
  'Días de vacaciones ya acumulados ANTES de empezar a usar CLAUX (gemelo en días de '
  'vacaciones_apertura, mig. 167). Punto de partida inmutable de la derivación del saldo '
  'en días: saldo_dias = apertura_dias + Σ nóminas confirmadas. NO es un total mutable y '
  'se carga por el importador de Personal o el modal de la ficha, nunca por el alta.';

notify pgrst, 'reload schema';
