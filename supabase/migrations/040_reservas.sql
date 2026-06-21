-- ================================================================
-- MIGRACIÓN 040: Reservas y citas · Reservas (Fase 0 · Tanda 1)
--
-- Cada reserva ocupa plaza en una franja para una fecha.
-- Estados: PENDIENTE → CONFIRMADA/RECHAZADA (por el dueño, salvo
--   confirmación automática). Una vez confirmada puede marcarse
--   NO_SHOW o CANCELADA (por el cliente o el dueño).
-- Canal: web, bot o manual (desde el panel del dueño).
--
-- telegram_chat_id: chat de Telegram del cliente que reserva por
--   el bot, para notificarle cambios de estado.
--
-- confirmacion_automatica: snapshot del ajuste en el momento de
--   crear la reserva (el valor global puede cambiar después).
--
-- Numeración: RES-XXXXXXXX.
-- ================================================================

create table if not exists reservas (
  reserva_id              text          primary key,     -- RES-XXXXXXXX
  client_id               text          not null,
  franja_id               text          not null,

  fecha                   date          not null,
  personas                int           not null default 1,
  nombre_cliente          text          not null,
  telefono                text,
  notas                   text,

  canal                   text          not null default 'manual',  -- web | bot | manual
  estado                  text          not null default 'PENDIENTE', -- PENDIENTE | CONFIRMADA | RECHAZADA | NO_SHOW | CANCELADA
  telegram_chat_id        text,                                      -- para notificar al cliente vía bot
  confirmacion_automatica boolean       not null default false,

  created_at              timestamptz   not null default now(),
  updated_at              timestamptz   not null default now()
);

create index if not exists idx_res_client  on reservas (client_id);
create index if not exists idx_res_franja  on reservas (franja_id);
create index if not exists idx_res_fecha   on reservas (fecha);
create index if not exists idx_res_estado  on reservas (estado);

alter table public.reservas enable row level security;
grant select, insert, update, delete on public.reservas to service_role;

notify pgrst, 'reload schema';
