-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 192 — Fase 4: el interruptor del complemento C1
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ UNA COLUMNA Y NO UN SECTOR. El complemento C1 —depreciación,
-- provisiones, intangibles, liquidación anual del impuesto, reparto de
-- utilidades— no depende del giro del negocio: una cafetería con contador y una
-- cafetería sin contador venden lo mismo. Lo que cambia es quién le lleva los
-- libros. Por eso es un interruptor que se suma a cualquier pack, y no un pack
-- aparte ni una rama del sector.
--
-- TRES ESTADOS, no dos: `null` es «todavía no se lo hemos preguntado», y no es lo
-- mismo que «dijo que no». Con un boolean `not null default false` la pantalla no
-- podría distinguir al cliente al que hay que preguntarle del que ya contestó, y
-- acabaría preguntándoselo para siempre o no preguntándoselo nunca. Es la misma
-- razón por la que `pack_servicios` (mig. 186) es un text nullable.
--
-- Activarlo NO cambia nada visible hasta el primer registro: por la regla del P&L
-- progresivo, un renglón sin apuntes no se pinta. Sembrar el complemento a quien
-- no lo necesita solo le llena la lista de categorías; por eso se pregunta.

alter table public.clients
  add column if not exists lleva_contador boolean;

comment on column public.clients.lleva_contador is
  'Interruptor del complemento C1 del catálogo (fase 4): true → la semilla añade depreciación, '
  'provisiones, intangibles, liquidación del impuesto sobre utilidades y reparto de utilidades. '
  'NULL = todavía no se le ha preguntado, que no es lo mismo que «no». Re-preguntable desde el '
  'asistente de catálogo.';
