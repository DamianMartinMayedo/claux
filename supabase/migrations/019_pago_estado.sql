-- 019 — Estado de confirmación del pago.
--
-- Un pago puede crearse "por confirmar" (esperado, dinero aún no verificado) y luego
-- confirmarse cuando el cliente paga de verdad. Solo los confirmados cuentan como ingreso.
-- Los pagos históricos se consideran confirmados.

alter table payments
  add column if not exists estado text not null default 'confirmado';
-- valores: 'por_confirmar' | 'confirmado'

create index if not exists idx_payments_estado on payments (estado);

notify pgrst, 'reload schema';
