-- ─────────────────────────────────────────────────────────────────────────────
-- 015  Ventas — mejoras de campos
--      · condicion_pago y notas_internas en ofertas y facturas
--      · descuento por línea (descuento_pct, descuento_importe)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Condición de pago y notas internas
alter table ofertas
  add column if not exists condicion_pago text not null default 'CONTADO',
  add column if not exists notas_internas text;

alter table facturas
  add column if not exists condicion_pago text not null default 'CONTADO',
  add column if not exists notas_internas text;

-- 2. Descuento por línea (porcentaje + importe calculado)
alter table documento_lineas
  add column if not exists descuento_pct     numeric(6,2)  not null default 0,
  add column if not exists descuento_importe numeric(18,2) not null default 0;

notify pgrst, 'reload schema';
