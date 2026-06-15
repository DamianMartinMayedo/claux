-- ================================================================
-- MIGRACIÓN 023: Gastos y cobros (base contable, Fase 4 · Tanda 2)
--
-- Registro simple de ingresos/egresos NO facturados:
--   GASTO → egreso (compra de insumos, alquiler, salarios, servicios…)
--   COBRO → ingreso directo no ligado a una factura de Ventas
--
-- Un registro tiene un monto total. Su liquidación (pago de un gasto /
-- cobro de un ingreso) NO se guarda aquí: es un movimiento de Tesorería
-- con origen PAGO/COBRO y referencia_id = registro_id. Así Tesorería es la
-- única fuente de movimientos de dinero y se permiten pagos PARCIALES:
--   monto_liquidado(registro) = Σ movimientos_tesoreria.monto
--                               where referencia_id = registro_id
--   estado = LIQUIDADO (≥ monto) | PARCIAL (>0) | PENDIENTE (0)
--
-- Lo pendiente alimenta CxP (gastos) y CxC (cobros) en la Tanda 3.
-- vencimiento se guarda ya para el aging de CxC/CxP.
--
-- Numeración interna: GAS-XXXXXXXX / COB-XXXXXXXX (UUID corto).
-- ================================================================

create table if not exists gastos_cobros (
  registro_id   text          primary key,                -- GAS-XXXXXXXX | COB-XXXXXXXX
  client_id     text          not null,
  empresa_id    text          not null,

  tipo          text          not null,                   -- GASTO | COBRO
  fecha         date          not null default current_date,
  vencimiento   date,                                     -- opcional (aging CxC/CxP)
  tercero_id    text,                                     -- proveedor (gasto) o cliente (cobro), opcional
  categoria     text,
  descripcion   text          not null,
  moneda        text          not null,
  monto         numeric(18,2) not null,

  notas         text,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

create index if not exists idx_gc_client   on gastos_cobros (client_id);
create index if not exists idx_gc_empresa  on gastos_cobros (empresa_id);
create index if not exists idx_gc_tipo     on gastos_cobros (tipo);
create index if not exists idx_gc_tercero  on gastos_cobros (tercero_id);
create index if not exists idx_gc_fecha    on gastos_cobros (fecha);

alter table public.gastos_cobros enable row level security;
grant select, insert, update, delete on public.gastos_cobros to service_role;

notify pgrst, 'reload schema';
