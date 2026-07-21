-- ================================================================
-- MIGRACIÓN 123: interruptor de facturación automática de suscripciones
--
-- Con el módulo de Contabilidad, el cron diario puede dejar el BORRADOR hecho el día
-- que toca cobrar, en vez de obligar al dueño a entrar, elegir período y pulsar. El
-- aviso «Toca cobrar» pasa entonces a decir que el borrador ya está esperando.
--
-- **Solo borradores, nunca emitidas** (decisión 9 del plan: nada se emite solo). Un
-- error de precio en un borrador se corrige; en una factura emitida con número hay que
-- anularla y explicárselo al cliente.
--
-- Va por EMPRESA y no por cliente ni por suscripción: la factura la emite una empresa
-- concreta, con su letra y su numeración, así que es la unidad natural de la decisión.
-- Apagado por defecto: a quien no lo active no le cambia absolutamente nada.
-- ================================================================

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS facturacion_auto boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
