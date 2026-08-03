-- ================================================================
-- MIGRACIÓN 163: prorratear el PRIMER período
--
-- Se dejó fuera de la v1 a propósito. Con el calendario ya por mes, encaja: un
-- socio que entra el 20 no debería pagar el mes entero, y hoy o paga de más o el
-- dueño le edita la factura a mano cada vez que da un alta a mitad de mes.
--
-- `NOT NULL DEFAULT false` reproduce EXACTAMENTE el comportamiento de hoy, así que
-- ningún acuerdo existente cambia al aplicar esto. Es opt-in por acuerdo, no una
-- política del negocio: quien cobra el mes entero desde el día uno lo sigue
-- haciendo sin tocar nada.
--
-- **Solo la PRIMERA factura del acuerdo.** El prorrateo al CANCELAR a mitad de
-- ciclo (la devolución) queda fuera: es la operación inversa, toca dinero ya
-- cobrado y necesita su propio diseño. Va a mejoras futuras.
-- ================================================================

alter table suscripciones
  add column if not exists prorratear boolean not null default false;

comment on column suscripciones.prorratear is
  'Si la PRIMERA factura del acuerdo cobra solo los días de fecha_inicio al fin de su ciclo. Default false = comportamiento previo a la mig. 163 (ciclo completo).';
