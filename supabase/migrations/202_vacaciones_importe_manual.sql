-- ================================================================
-- MIGRACIÓN 202: importe MANUAL del pago de vacaciones por incidencia
--
-- PROBLEMA. El pago de un día de vacaciones se valora al PROMEDIO del saldo acumulado
-- (`saldo_importe ÷ saldo_dias`, mig. 142/167/194/195). Un cliente que empieza a usar
-- CLAUX sin cargar su acumulado —o que lo carga solo en días, sin importe— tiene
-- `saldo_importe = 0` aunque acumule días, así que el promedio da 0 y el pago de las
-- vacaciones disfrutadas sale 0. La red de seguridad que valoraba el día contra el
-- salario del período ENMASCARABA el caso (pagaba un número inventado que nadie eligió),
-- y por eso se retira: sin acumulado en importe el pago automático es 0 —explícito— y el
-- dueño fija a mano cuánto pagar.
--
-- SOLUCIÓN. Un importe OPCIONAL en la incidencia del mes (`incidencias_nomina`, mig. 143)
-- que, cuando está puesto, MANDA sobre el cálculo del disfrute (`vacaciones_pagar`):
--   · null  → automático: promedio del saldo; 0 si no hay acumulado en importe.
--   · valor → ese importe se paga por las vacaciones disfrutadas ESTE mes.
-- No toca la liquidación por baja (`dias_liquidacion`), que sigue saliendo del saldo, ni
-- los DÍAS (el derecho se cuenta en días igual, salgan a 0 importe o al importe manual):
-- la derivación del saldo en días (mig. 194/195) no cambia.
--
-- POR QUÉ EN LA INCIDENCIA Y NO EN LA FICHA. Es un dato DEL PERÍODO, como los días de
-- vacaciones que lo acompañan: cada mes puede querer corregirse o no. La ficha guarda la
-- APERTURA (punto de partida inmutable, mig. 167/195); esto es el ajuste puntual del mes.
-- La línea sigue congelando el RESULTADO al confirmar, así que el recibo y el saldo se
-- derivan igual que hoy.
--
-- `numeric` NULLABLE, sin default: null = «sin corregir» (automático), que es como se
-- comporta toda incidencia ya existente. El check impide un negativo.
-- ================================================================

alter table public.incidencias_nomina
  add column if not exists vacaciones_importe_manual numeric;

alter table public.incidencias_nomina
  drop constraint if exists inc_vac_importe_manual_ck;
alter table public.incidencias_nomina
  add constraint inc_vac_importe_manual_ck
  check (vacaciones_importe_manual is null or vacaciones_importe_manual >= 0);

comment on column public.incidencias_nomina.vacaciones_importe_manual is
  'Importe MANUAL del pago de vacaciones disfrutadas este mes (solo MIPYME_CUBA). '
  'null = automático (promedio del saldo importe÷días; 0 si no hay acumulado en importe). '
  'Un valor MANDA sobre el cálculo del disfrute (vacaciones_pagar); no toca la liquidación '
  'por baja ni los días acumulados/pagados. Es un dato del período, como dias_vacaciones: '
  'lo fija el dueño con «Corregir importe» para clientes que no traen su acumulado.';

notify pgrst, 'reload schema';
