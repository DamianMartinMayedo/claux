-- ================================================================
-- MIGRACIÓN 172: Caja — la cuenta sigue al medio de pago
--
-- El TPV distingue efectivo de transferencia desde el primer día, y la
-- contabilidad no: `cajas.cuentas_moneda` es UNA cuenta por moneda, así que un
-- cobro por Transfermóvil o Enzona entraba en la CAJA DE EFECTIVO. En Cuba eso ya
-- es la mitad del mostrador, y tiene dos consecuencias:
--   · el saldo de la caja física dice tener un dinero que está en el banco;
--   · el arqueo del turno no puede cuadrar nunca, porque se le exige a la gaveta
--     un efectivo que nunca pasó por ella.
--
-- `cuentas_transferencia` es OPCIONAL y nace vacío: sin ella todo sigue yendo a la
-- cuenta de efectivo, o sea que **ninguna caja en marcha cambia de comportamiento**.
--
-- El registro de `gastos_cobros` sigue siendo UNO POR MONEDA: al estado de
-- resultados le importa la venta, no por qué puerta entró el dinero.
-- ================================================================

alter table cajas
  add column if not exists cuentas_transferencia jsonb not null default '{}';

comment on column cajas.cuentas_transferencia is
  'Moneda → cuenta_id donde entra lo cobrado por transferencia. Vacío = a la cuenta de efectivo (cuentas_moneda), que es el comportamiento anterior.';

notify pgrst, 'reload schema';
