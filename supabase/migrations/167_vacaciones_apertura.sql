-- ================================================================
-- MIGRACIÓN 167: saldo de vacaciones de APERTURA al dar de alta un trabajador
--
-- PROBLEMA. Un negocio que empieza a usar CLAUX a mitad de año llega con vacaciones
-- ya acumuladas por su plantilla, y hoy no hay forma de cargarlas: el saldo se DERIVA
-- de las nóminas confirmadas (mig. 142/143), así que un trabajador migrado arranca
-- inevitablemente en cero y su primer disfrute de vacaciones sale «sin saldo».
--
-- POR QUÉ NO ES UN TOTAL MUTABLE. La regla de `CONTEXTO § RRHH` es que el saldo se
-- deriva y no se guarda, precisamente para que reabrir o borrar una nómina no lo
-- desincronice. Una columna `vacaciones_saldo` que alguien pudiera editar sería la
-- vuelta del bug que esa decisión evitó.
--
-- POR QUÉ NO ES UN ÍTEM PUNTUAL. Fue la primera idea y NO funciona, por dos motivos:
--   · `saldoVacacionesAcumulado()` no lee ítems: suma
--     `vacaciones_acumuladas_periodo − vacaciones_pagadas_periodo` de las LÍNEAS de las
--     nóminas confirmadas. Un ítem sería invisible para ese cálculo.
--   · un ítem necesita una `linea_id`, que necesita una nómina — y al dar de alta al
--     trabajador no existe ninguna.
--
-- SOLUCIÓN. Un dato de APERTURA en la ficha, y la derivación pasa a ser
--
--     saldo = apertura + Σ (acumulado − pagado) de las nóminas confirmadas
--
-- Sigue siendo una derivación: la apertura es el punto de partida inmutable —el mismo
-- papel que la cuenta técnica de «Apertura» del importador general— y todo lo que se
-- mueva después lo siguen diciendo las nóminas. Reabrir o borrar una nómina recalcula
-- el saldo solo, igual que antes.
--
-- IMPORTE, no días. El sistema deriva y muestra un IMPORTE (la acumulación es el
-- 9,09 % del salario percibido, Art. 102 de la Ley 116), así que la apertura entra en
-- la misma unidad; convertir días exigiría fijar un valor-día del pasado que nadie
-- conoce. Poder verlo en días es un objetivo posterior y necesita su propia decisión.
--
-- `default 0` y `not null`: un trabajador ya existente arranca sin apertura, o sea que
-- su saldo sale exactamente igual que antes de esta migración.
--
-- Plan: docs/planes/nomina-coste-deuda-plan-de-trabajo.md (Fase 4)
-- ================================================================

alter table public.empleados
  add column if not exists vacaciones_apertura numeric(18,2) not null default 0;

comment on column public.empleados.vacaciones_apertura is
  'Importe de vacaciones ya acumulado ANTES de empezar a usar CLAUX (para negocios que '
  'migran a mitad de año). Punto de partida inmutable de la derivación del saldo: '
  'saldo = apertura + Σ nóminas confirmadas. NO es un total mutable —eso es justo lo '
  'que la derivación evita— y se carga por el importador de Personal.';

notify pgrst, 'reload schema';
