-- ================================================================
-- MIGRACIÓN 121: el precio de una suscripción es MENSUAL, y el cobro se calcula
--
-- Problema que arregla (detectado probando): `precio_pactado` era el importe de CADA
-- COBRO, así que «10.000 CUP» significaba una cosa distinta según la periodicidad —
-- 10.000 al mes o 10.000 al trimestre— y comparar dos clientes era imposible sin mirar
-- también su ciclo. Encima obligaba al dueño a hacer la multiplicación de cabeza.
--
--  · `precio_mensual`  — la base, siempre por mes. El importe del cobro se CALCULA:
--                        precio_mensual × meses(periodicidad) − descuento.
--  · `descuento_modo`  — PORCENTAJE | MONTO_FIJO, el mismo vocabulario que los ajustes
--                        de las facturas (`documento_ajustes.modo`). Sirve para el
--                        clásico «si me lo pagas al año, te hago precio».
--  · `descuento_valor` — el % o el importe, según el modo.
--
-- CONVERSIÓN DE LO EXISTENTE: el valor viejo era el importe del ciclo, así que se
-- divide entre los meses de su periodicidad para que el cobro efectivo NO cambie. Hoy
-- solo hay una suscripción y es MENSUAL (divide entre 1), pero la conversión va escrita
-- igualmente: una migración correcta no depende de qué haya hoy en la base.
--
-- El precio sigue siendo SUYO una vez guardado: cambiar la tarifa del catálogo no
-- repisa las suscripciones vivas. Eso no cambia.
-- ================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'suscripciones' AND column_name = 'precio_pactado')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'suscripciones' AND column_name = 'precio_mensual') THEN
    ALTER TABLE suscripciones RENAME COLUMN precio_pactado TO precio_mensual;

    UPDATE suscripciones
       SET precio_mensual = round(precio_mensual / CASE periodicidad
             WHEN 'TRIMESTRAL' THEN 3 WHEN 'SEMESTRAL' THEN 6 WHEN 'ANUAL' THEN 12 ELSE 1 END, 2)
     WHERE periodicidad <> 'MENSUAL';
  END IF;
END $$;

ALTER TABLE suscripciones
  ADD COLUMN IF NOT EXISTS descuento_modo  text          NOT NULL DEFAULT 'PORCENTAJE',
  ADD COLUMN IF NOT EXISTS descuento_valor numeric(18,2) NOT NULL DEFAULT 0;

ALTER TABLE suscripciones DROP CONSTRAINT IF EXISTS suscripciones_descuento_modo_chk;
ALTER TABLE suscripciones ADD CONSTRAINT suscripciones_descuento_modo_chk
  CHECK (descuento_modo IN ('PORCENTAJE', 'MONTO_FIJO'));

NOTIFY pgrst, 'reload schema';
