-- ================================================================
-- MIGRACIÓN 159: el conteo deja de aplicar ajustes sin causa
--
-- PROBLEMA. La 156 aplicaba TODAS las líneas con el mismo `motivo_tipo: 'CONTEO'` y
-- el texto «Conteo físico CNT-XXXX». En el ledger, una caja robada, tres botellas
-- rotas y un error de teclado quedaban **idénticos** — justo lo que la 154 vino a
-- arreglar (poder SUMAR la merma). Un conteo así cuadra el número y pierde el porqué,
-- que es lo único que el dueño puede usar para tomar una decisión.
--
-- LO QUE HACE. Contar no produce un ajuste: produce un **acta de discrepancias**.
-- Cada línea que descuadra lleva su causa (`motivo_tipo`) y su explicación (`nota`),
-- y el AJUSTE que se genera hereda LA SUYA, no la del conteo.
--
-- `CONTEO` cambia de significado, no de valor: pasa de cajón de sastre a lo único que
-- de verdad quiere decir — **error de registro**, la diferencia que no es pérdida
-- física. Se mantiene el mismo código porque no hay ni un movimiento con
-- `motivo_tipo` en producción (la 154 y la 156 son de hoy y aún sin desplegar), así
-- que no hay histórico al que se le cambie el sentido por detrás.
--
-- SIN CHECK CONSTRAINT, como la 154: el vocabulario lo valida la acción del portal
-- (`MOTIVOS_FALTANTE` / `MOTIVOS_SOBRANTE` en `_inventario-helpers.ts`), que además
-- distingue lo que puede causar un FALTANTE de lo que puede causar un SOBRANTE — un
-- CHECK no puede saber el signo de la diferencia.
--
-- POR QUÉ `contado_por` ES TEXTO LIBRE y no un `client_user_id`: quien cuenta el
-- almacén rara vez es quien teclea (se cuenta con el móvil en la mano o en papel, y
-- lo carga el encargado). Un desplegable de usuarios del portal dejaría el acta
-- firmada por quien no contó, que es peor que no firmarla.
-- ================================================================

alter table conteo_lineas
  add column if not exists motivo_tipo text,
  add column if not exists nota        text;

alter table conteos
  add column if not exists contado_por text;

comment on column conteo_lineas.motivo_tipo is
  'Causa de la diferencia de ESTA linea (mig. 159). La hereda el AJUSTE que se genera. '
  'Obligatoria al aplicar en toda linea que descuadra; NULL en las que cuadran. '
  'CONTEO = error de registro (la diferencia que no es perdida fisica).';

comment on column conteo_lineas.nota is
  'Explicacion libre de la diferencia (mig. 159). Viaja al `motivo` del movimiento.';

comment on column conteos.contado_por is
  'Quien conto, en texto libre (mig. 159): quien cuenta rara vez es quien teclea.';

notify pgrst, 'reload schema';
