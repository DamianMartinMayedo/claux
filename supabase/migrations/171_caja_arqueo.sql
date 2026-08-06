-- ================================================================
-- MIGRACIÓN 171: Caja — el arqueo, de verdad
--
-- Hasta ahora «cerrar turno» pedía un número por moneda, lo guardaba y cerraba:
-- no lo comparaba con nada, no enseñaba el descuadre y no confirmaba. Y faltaban
-- las dos piezas sin las cuales la cuenta no puede cuadrar nunca:
--
--   · el FONDO INICIAL con el que se abre la gaveta para dar cambio
--     (`caja_sesiones.fondo_inicial` existía desde la mig. 089 y NADIE lo escribía:
--      cero cierres con fondo en toda la base),
--   · las SALIDAS de efectivo del turno (se pagó al proveedor, el dueño retiró).
--
-- Sin ellas la fórmula del descuadre que ya exportaba el sistema
-- (`contado − (fondo + ventas)`) era además falsa por otro lado: mete las
-- transferencias en el saco del efectivo y le exige a la gaveta un dinero que
-- nunca pasó por ella. Eso lo cierra la migración siguiente (cuenta por medio de
-- pago); aquí se capturan los datos que faltaban.
--
-- Y el NÚMERO Z: la columna está desde la 089, nunca se escribió, y la descarga la
-- saca como primera columna «Cierre nº» — siempre vacía. Lo asigna el SERVIDOR al
-- ingerir el cierre, nunca el dispositivo: con dos móviles en el mismo punto, o con
-- un IndexedDB borrado, un correlativo generado offline se duplica o salta, y una
-- serie que se audita no puede depender de la memoria de un teléfono.
-- ================================================================

-- ── 1. Quién cerró ───────────────────────────────────────────────────────────
-- Texto libre, como `conteos.contado_por`: quien cuenta el dinero rara vez es
-- quien teclea, y hasta que exista el vínculo empleado ↔ usuario del TPV (ficha
-- R3 del backlog) un nombre escrito a mano es infinitamente mejor que nada.
alter table caja_sesiones
  add column if not exists cerrada_por text;

-- ── 2. La serie Z ────────────────────────────────────────────────────────────
-- Único por punto de venta, no global: cada caja lleva su propia serie, que es lo
-- que se audita. Parcial porque las sesiones sin numerar (abiertas, o históricas)
-- son legítimas y son muchas.
create unique index if not exists idx_caja_sesiones_z
  on caja_sesiones (caja_id, numero_z)
  where numero_z is not null;

-- Asignación atómica. El `pg_advisory_xact_lock` por caja es lo que impide que dos
-- cierres sincronizados a la vez se lleven el mismo número: `max()+1` sin lock es
-- una condición de carrera, no un correlativo. Idempotente: si la sesión ya tiene
-- número, devuelve el suyo y no consume otro.
create or replace function caja_asignar_numero_z(
  p_client_id   text,
  p_caja_id     text,
  p_sesion_uuid text
) returns integer
language plpgsql
as $$
declare
  v_z integer;
begin
  select numero_z into v_z
    from caja_sesiones
   where sesion_uuid = p_sesion_uuid and client_id = p_client_id;
  if v_z is not null then return v_z; end if;

  perform pg_advisory_xact_lock(hashtext('caja_z:' || p_caja_id));

  select coalesce(max(numero_z), 0) + 1 into v_z
    from caja_sesiones
   where caja_id = p_caja_id and client_id = p_client_id;

  update caja_sesiones
     set numero_z = v_z
   where sesion_uuid = p_sesion_uuid and client_id = p_client_id;

  return v_z;
end; $$;

grant execute on function caja_asignar_numero_z(text, text, text) to service_role;

-- ── 3. Movimientos de efectivo del turno ─────────────────────────────────────
-- Tabla y no un `jsonb` en la sesión: cada movimiento tiene su motivo, su hora y su
-- importe, y son la otra mitad de por qué una caja no cuadra.
-- `movimiento_uuid` se genera OFFLINE, igual que `ticket_uuid`: es lo que hace que
-- reenviar un lote no duplique nada.
create table if not exists caja_turno_movimientos (
  movimiento_uuid text        primary key,
  sesion_uuid     text        not null,
  caja_id         text        not null,
  client_id       text        not null,
  tipo            text        not null default 'SALIDA'
                                check (tipo in ('SALIDA', 'ENTRADA')),
  moneda          text        not null,
  importe         numeric(18,2) not null,
  motivo          text,
  fecha           timestamptz not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_caja_turno_movs_sesion on caja_turno_movimientos (sesion_uuid);
create index if not exists idx_caja_turno_movs_client on caja_turno_movimientos (client_id);

alter table public.caja_turno_movimientos enable row level security;
grant select, insert, update, delete on public.caja_turno_movimientos to service_role;

-- ── 4. Purga del tenant ──────────────────────────────────────────────────────
-- `eliminar_cliente()` es una lista A MANO y cada tabla nueva la deja incompleta en
-- silencio: nada falla al crear la tabla, nada falla al borrar el cliente, y el
-- fallo solo aparece cuando alguien encuentra filas de un cliente que ya no existe
-- (mig. 146). Se añade en la MISMA migración que crea la tabla.
--
-- Se PARCHEA la función en vez de reescribirla entera: su cuerpo enumera decenas de
-- tablas y volver a teclearlo de memoria es la forma más fácil de perder una por el
-- camino. Idempotente: si ya está, no toca nada.
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'eliminar_cliente'
   limit 1;

  if src is null then
    raise exception 'No existe eliminar_cliente(): revisa antes de seguir';
  end if;

  if position('caja_turno_movimientos' in src) = 0 then
    src := replace(
      src,
      'delete from caja_ticket_lineas',
      'delete from caja_turno_movimientos    where client_id = p_client_id;' ||
      E'\n  delete from caja_ticket_lineas'
    );
    execute src;
  end if;
end $$;

notify pgrst, 'reload schema';
