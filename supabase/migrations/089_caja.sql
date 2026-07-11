-- ================================================================
-- MIGRACIÓN 089: Módulo Caja registradora offline (PWA)
--
-- Punto de venta que funciona offline (PWA instalable desde Claux) y
-- sincroniza cuando hay conexión. Módulo INDEPENDIENTE (funciona solo);
-- si el cliente tiene inventario/base, refleja RESÚMENES por cierre:
--   · Tesorería (base):  un INGRESO resumen por moneda y cierre (origen=CAJA).
--   · Inventario:        un SALIDA resumen por producto y cierre (origen=VENTA).
-- El DETALLE (ventas una a una + líneas de stock) vive en las tablas de
-- este módulo (caja_tickets / caja_ticket_lineas) y alimenta las pestañas
-- de Operaciones del portal.
--
-- Idempotencia: ticket_uuid (detalle) y sesion_uuid (resúmenes) son claves
-- naturales generadas offline; re-sincronizar o re-subir un archivo no duplica.
--
-- Numeración interna: CAJ-XXXXXXXX (instancia de caja).
-- ================================================================

-- ── 1. Instancias de caja ────────────────────────────────────────────────────
create table if not exists cajas (
  caja_id            text          primary key,                 -- CAJ-XXXXXXXX
  client_id          text          not null,
  empresa_id         text          not null,
  nombre             text          not null,
  almacen_id         text,                                      -- de dónde descuenta stock (si inventario)
  cuentas_moneda     jsonb         not null default '{}',       -- {"CUP":"CTA-…","USD":"CTA-…"} (si base)
  monedas_aceptadas  text[]        not null default '{}',
  sync_token         text          not null unique,             -- token opaco para seed/sync (revocable)
  activa             boolean       not null default true,
  last_sync_at       timestamptz,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now()
);
create index if not exists idx_cajas_client  on cajas (client_id);
create index if not exists idx_cajas_empresa on cajas (empresa_id);
create index if not exists idx_cajas_token   on cajas (sync_token);

-- ── 2. Sesiones / cierres (Z) — unidad de los resúmenes ──────────────────────
create table if not exists caja_sesiones (
  sesion_uuid        text          primary key,                 -- generado offline
  caja_id            text          not null,
  client_id          text          not null,
  empresa_id         text          not null,
  abierta_at         timestamptz   not null,
  cerrada_at         timestamptz,
  estado             text          not null default 'ABIERTA',  -- ABIERTA | CERRADA
  numero_z           int,
  fondo_inicial      jsonb         not null default '{}',        -- por moneda
  efectivo_contado   jsonb         not null default '{}',        -- por moneda (arqueo)
  total_por_moneda   jsonb         not null default '{}',        -- resumen de ventas del cierre
  tesoreria_movs     jsonb,                                      -- ids INGRESO por moneda (null = no posteado)
  stock_movs         jsonb,                                      -- ids SALIDA por producto (null = no posteado)
  posted_at          timestamptz,
  sincronizado_at    timestamptz,
  created_at         timestamptz   not null default now()
);
create index if not exists idx_caja_sesiones_caja   on caja_sesiones (caja_id);
create index if not exists idx_caja_sesiones_client on caja_sesiones (client_id, empresa_id);

-- ── 3. Tickets (detalle: cada venta, una a una) ──────────────────────────────
create table if not exists caja_tickets (
  ticket_uuid        text          primary key,                 -- generado offline (crypto.randomUUID)
  caja_id            text          not null,
  client_id          text          not null,
  empresa_id         text          not null,
  sesion_uuid        text,
  fecha              timestamptz   not null,                     -- momento real de la venta (offline)
  moneda             text          not null,
  total              numeric(18,2) not null default 0,
  medio_pago         text,
  origen_sync        text          not null default 'ONLINE',   -- ONLINE | ARCHIVO
  sincronizado_at    timestamptz   not null default now(),
  created_at         timestamptz   not null default now()
);
create index if not exists idx_caja_tickets_scope  on caja_tickets (client_id, empresa_id, fecha);
create index if not exists idx_caja_tickets_caja   on caja_tickets (caja_id, sincronizado_at);
create index if not exists idx_caja_tickets_sesion on caja_tickets (sesion_uuid);

-- ── 4. Líneas de ticket (detalle de stock: pestaña Movimientos de stock) ─────
create table if not exists caja_ticket_lineas (
  id                 bigint        generated always as identity primary key,
  ticket_uuid        text          not null,
  client_id          text          not null,
  producto_id        text,                                      -- null → texto libre (sin inventario)
  descripcion        text          not null,
  cantidad           numeric(18,3) not null,
  precio_unitario    numeric(18,2) not null default 0,
  subtotal           numeric(18,2) not null default 0
);
create index if not exists idx_caja_lineas_ticket   on caja_ticket_lineas (ticket_uuid);
create index if not exists idx_caja_lineas_producto on caja_ticket_lineas (client_id, producto_id);

-- ── 5. RLS y grants (patrón del repo: RLS on, sin políticas; acceso vía service_role) ──
alter table public.cajas              enable row level security;
alter table public.caja_sesiones      enable row level security;
alter table public.caja_tickets       enable row level security;
alter table public.caja_ticket_lineas enable row level security;

grant select, insert, update, delete on public.cajas              to service_role;
grant select, insert, update, delete on public.caja_sesiones      to service_role;
grant select, insert, update, delete on public.caja_tickets       to service_role;
grant select, insert, update, delete on public.caja_ticket_lineas to service_role;

-- ── 6. Semilla del catálogo comercial ────────────────────────────────────────
--   Precio PLACEHOLDER (10/18): el propietario lo ajusta en /admin/modulos.
--   Los precios viven en datos, nunca en código (CONTEXTO §5).
insert into modulos_catalogo
  (clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, tipo, orden, paginas) values
  ('caja', 'Caja',
   'Punto de venta offline (PWA): cobra sin conexión y sincroniza. Ventas, cierres y stock.',
   10, 18, false, 'modulo', 25,
   '[{"ruta":"/portal/caja","label":"Cajas","orden":0},
     {"ruta":"/portal/caja/operaciones","label":"Operaciones","orden":1},
     {"ruta":"/portal/caja/cierres","label":"Cierres","orden":2},
     {"ruta":"/portal/caja/sincronizar","label":"Sincronizar","orden":3}]'::jsonb)
on conflict (clave) do nothing;

-- ── 7. Permitir stock negativo en VENTA (la venta ya ocurrió; no se rechaza) ──
--   Se re-crea inv_aplicar_movimiento con un parámetro OPCIONAL al final
--   (p_permitir_negativo, default false). Backward-compatible: los callers
--   existentes (compras/ajustes, que pasan 12 args) conservan comportamiento
--   idéntico. La ingesta de caja lo pasa true para origen='VENTA'.
--   No hay dependencias duras (plpgsql resuelve las llamadas en runtime), así
--   que inv_confirmar_compra / inv_anular_compra siguen funcionando sin cambios.
drop function if exists inv_aplicar_movimiento(text, text, date, text, text, text, text, numeric, numeric, text, text, text);

create or replace function inv_aplicar_movimiento(
  p_client_id text, p_empresa_id text, p_fecha date, p_tipo text,
  p_producto_id text, p_almacen_id text, p_almacen_destino_id text,
  p_cantidad numeric, p_costo_unitario numeric, p_motivo text,
  p_origen text, p_referencia_id text,
  p_permitir_negativo boolean default false
) returns jsonb
language plpgsql as $$
declare
  v_mov     text := 'MVI-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
  v_res_alm numeric;
  v_global  numeric;
begin
  insert into movimientos_inventario (
    movimiento_id, client_id, empresa_id, fecha, tipo, producto_id,
    almacen_id, almacen_destino_id, cantidad, costo_unitario, motivo, origen, referencia_id
  ) values (
    v_mov, p_client_id, p_empresa_id, coalesce(p_fecha, current_date), p_tipo, p_producto_id,
    p_almacen_id, p_almacen_destino_id, p_cantidad, p_costo_unitario, p_motivo,
    coalesce(p_origen, 'MANUAL'), p_referencia_id
  );

  if p_tipo = 'TRANSFERENCIA' then
    v_res_alm := inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_id, -p_cantidad);
    if v_res_alm < 0 and not p_permitir_negativo then raise exception 'STOCK_NEGATIVO'; end if;
    perform inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_destino_id, p_cantidad);
    -- global: neto cero
  elsif p_tipo = 'SALIDA' then
    v_res_alm := inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_id, -p_cantidad);
    if v_res_alm < 0 and not p_permitir_negativo then raise exception 'STOCK_NEGATIVO'; end if;
    update products set stock_actual = stock_actual - p_cantidad, updated_at = now()
      where producto_id = p_producto_id and client_id = p_client_id;
  else
    -- ENTRADA o AJUSTE: p_cantidad con su signo (ENTRADA siempre > 0)
    v_res_alm := inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_id, p_cantidad);
    if v_res_alm < 0 and not p_permitir_negativo then raise exception 'STOCK_NEGATIVO'; end if;
    update products set stock_actual = stock_actual + p_cantidad, updated_at = now()
      where producto_id = p_producto_id and client_id = p_client_id;
  end if;

  select stock_actual into v_global from products
    where producto_id = p_producto_id and client_id = p_client_id;

  return jsonb_build_object('movimiento_id', v_mov, 'stock_global', coalesce(v_global, 0), 'stock_almacen', v_res_alm);
end; $$;

grant execute on function inv_aplicar_movimiento(
  text, text, date, text, text, text, text, numeric, numeric, text, text, text, boolean
) to service_role;

notify pgrst, 'reload schema';
