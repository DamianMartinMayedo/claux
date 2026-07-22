-- ================================================================
-- MIGRACIÓN 131: se retira el interruptor de facturación automática
--
-- ⚠️ APLICAR **DESPUÉS** DE DESPLEGAR EL CÓDIGO, no antes. Es un DROP COLUMN, y el
-- código en producción sigue escribiendo `facturacion_auto` al guardar una empresa
-- hasta que se despliega esta rama: borrarla antes rompe crear y editar empresas
-- (PostgREST falla la escritura entera por una columna que no existe). Se aplicó
-- adelantada una vez y hubo que restaurarla; de ahí este aviso.
--
-- La 123 añadió `empresas.facturacion_auto` apagado por defecto: el borrador de una
-- suscripción solo se hacía si alguien encontraba la casilla y la marcaba. Se revierte
-- porque la decisión no existe: un cobro pactado que vence no se decide, ocurre. Y el
-- borrador no compromete a nada — no se emite ni se envía, se revisa y se emite (esa
-- parte de la 123 sigue en pie y es la que hace seguro automatizarlo).
--
-- El coste real de haberlo hecho opcional: en producción la casilla estaba apagada en
-- TODAS las empresas, y el camino manual —la pestaña «Facturación del período»— llevaba
-- roto desde la mig. 125 (pedía columnas de descuento ya borradas, la consulta fallaba
-- entera y la pantalla decía «no hay cobros»). Entre las dos cosas, las suscripciones
-- no se facturaban por ninguna vía y nada lo advertía.
--
-- A partir de aquí el cron deja el borrador en TODA empresa que pueda numerar. La letra
-- de facturación sigue siendo el único requisito, porque sin ella no hay con qué numerar;
-- y quien quiera adelantarse al cron tiene el botón de Suscripciones.
-- ================================================================

ALTER TABLE empresas
  DROP COLUMN IF EXISTS facturacion_auto;

NOTIFY pgrst, 'reload schema';
