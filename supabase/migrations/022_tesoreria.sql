-- ================================================================
-- MIGRACIÓN 022: Tesorería (base contable, Fase 4 · Tanda 1)
--
-- Tesorería = cuentas/cajas + movimientos + saldos multimoneda.
-- Es la base sobre la que se asientan cobros y pagos (tandas siguientes):
-- cada cobro/pago genera un movimiento con origen COBRO/PAGO.
--
--   cuentas               → cajas de efectivo, cuentas de banco, pasarelas
--   movimientos_tesoreria → ingresos / egresos sobre una cuenta
--
-- Saldo de una cuenta = saldo_inicial + Σ INGRESO − Σ EGRESO (calculado).
-- Cada cuenta tiene UNA moneda; los saldos se muestran por moneda (sin
-- conversión). Una transferencia entre cuentas de la misma moneda se
-- registra como dos movimientos (EGRESO + INGRESO) agrupados por transfer_grupo.
--
-- Numeración interna: CTA-XXXXXXXX, MOV-XXXXXXXX (UUID corto, como almacenes/ventas).
-- ================================================================

-- ── Cuentas ────────────────────────────────────────────────────────────────────

create table if not exists cuentas (
  cuenta_id      text          primary key,                -- CTA-XXXXXXXX
  client_id      text          not null,
  empresa_id     text          not null,

  nombre         text          not null,
  tipo           text          not null default 'CAJA',    -- CAJA | BANCO | PASARELA | OTRO
  moneda         text          not null,                   -- código de moneda (CUP, USD, MLC…)
  saldo_inicial  numeric(18,2) not null default 0,

  activa         boolean       not null default true,
  notas          text,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now()
);

create index if not exists idx_cuentas_client  on cuentas (client_id);
create index if not exists idx_cuentas_empresa on cuentas (empresa_id);
create index if not exists idx_cuentas_activa  on cuentas (activa);

-- ── Movimientos ────────────────────────────────────────────────────────────────

create table if not exists movimientos_tesoreria (
  movimiento_id  text          primary key,                -- MOV-XXXXXXXX
  client_id      text          not null,
  empresa_id     text          not null,
  cuenta_id      text          not null,

  fecha          date          not null default current_date,
  tipo           text          not null,                   -- INGRESO | EGRESO
  monto          numeric(18,2) not null,                   -- siempre positivo
  moneda         text          not null,                   -- = cuenta.moneda (denormalizado)
  concepto       text          not null,
  categoria      text,

  origen         text          not null default 'MANUAL',  -- MANUAL | COBRO | PAGO | TRANSFERENCIA
  referencia_id  text,                                     -- id de cobro/pago/factura/gasto (tandas futuras)
  transfer_grupo text,                                     -- agrupa las 2 patas de una transferencia

  notas          text,
  created_at     timestamptz   not null default now()
);

create index if not exists idx_mov_client   on movimientos_tesoreria (client_id);
create index if not exists idx_mov_empresa  on movimientos_tesoreria (empresa_id);
create index if not exists idx_mov_cuenta    on movimientos_tesoreria (cuenta_id);
create index if not exists idx_mov_fecha     on movimientos_tesoreria (fecha);
create index if not exists idx_mov_origen    on movimientos_tesoreria (origen);
create index if not exists idx_mov_transfer  on movimientos_tesoreria (transfer_grupo);

-- ── RLS y grants ───────────────────────────────────────────────────────────────

alter table public.cuentas               enable row level security;
alter table public.movimientos_tesoreria enable row level security;

grant select, insert, update, delete on public.cuentas               to service_role;
grant select, insert, update, delete on public.movimientos_tesoreria to service_role;

notify pgrst, 'reload schema';
